import { GridBoard, GRID_COLS, GRID_ROWS } from './GridEngine';
import { ArchetypeId, Cluster, ShapeProjectile, TileColor } from '../types/game';
import { ParticleSystem } from './ParticleSystem';
import { soundManager } from '../audio/soundManager';
import { STAGES, aiLevelStats } from './stages';
import { AiLevel } from '../types/game';
import { ARCHETYPES, SPEEDSTER_FIRE_BUFF_SEC, TRANSPORTER_SWAP_BUFF_SEC } from './archetypes';

// ---------------------------------------------------------------------------
// v2.3 utility AI: per-archetype weight profiles + smart skill triggers +
// tactical FSM. Pure helpers are exported so headless tests can check the
// scoring, swap search, trigger conditions and boss awakening without a
// running game loop.
// ---------------------------------------------------------------------------

export interface SwapResult {
  a: { col: number; row: number };
  b: { col: number; row: number };
  size: number; // largest cluster the swap creates
}

export interface ScoreCtx {
  board: GridBoard;
  playerCol: number;
  shield: number;
  bestSwap: SwapResult | null;
  dominantColor: TileColor;
}

export interface SkillTriggerCtx {
  board: GridBoard;
  aiCol: number;
  aiRow: number;
  playerCol: number;
  incoming: ShapeProjectile[];
  boardOriginX: number;
  cellW: number;
  gap: number;
  bestSwap: SwapResult | null;
}

// Merge per-archetype factor maps by taking the max per factor key
// (hybrid rule from the spec).
export function mergeWeightFactors(maps: Record<string, number>[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const m of maps) {
    for (const k of Object.keys(m)) merged[k] = Math.max(merged[k] ?? 1, m[k]);
  }
  return merged;
}

function profileFactors(id: ArchetypeId, cluster: Cluster, ctx: ScoreCtx): Record<string, number> {
  const f: Record<string, number> = {};
  const tiles = cluster.tiles;
  const cols = new Set(tiles.map((t) => t.col));
  const rows = new Set(tiles.map((t) => t.row));
  const n = tiles.length;
  switch (id) {
    case 'lancer':
      if (cluster.shapeType === 'spear') f.spear = 2.5;
      // Enemy frontline = its bottom 2 rows (rows 3-4, closest to the player).
      if ([...rows].some((r) => r >= 3)) f.frontline = 2.0;
      if (cluster.color === 'red') f.red = 1.5;
      break;
    case 'wave':
      // Central 3 columns (0-based 3-5) = core defense.
      if ([...cols].some((c) => c >= 3 && c <= 5)) f.center = 3.0;
      if (cluster.shapeType === 'wall') f.wall = 2.5;
      if (cluster.color === 'blue') f.blue = 2.0;
      break;
    case 'sniper':
      if (n <= 2) f.quick = 2.0;
      if (cols.has(ctx.playerCol)) f.align = 2.5;
      break;
    case 'painter':
      if (cluster.color === ctx.dominantColor) f.dense = 2.5;
      if (n >= 6) f.big = 3.0;
      break;
    case 'transporter':
      if (
        ctx.bestSwap &&
        tiles.some(
          (t) =>
            (t.col === ctx.bestSwap!.a.col && t.row === ctx.bestSwap!.a.row) ||
            (t.col === ctx.bestSwap!.b.col && t.row === ctx.bestSwap!.b.row)
        )
      ) {
        f.swap = 3.0;
      }
      break;
    case 'speedster':
      if (cluster.color === 'yellow') f.yellow = 2.0;
      // Threat evasion (x2.5) lives in the decision flow, not the score.
      break;
    case 'monochrome':
      if (cluster.color === 'red') f.redCluster = 3.5;
      // Low shield: a non-red cluster is worth absorbing (+10 shield).
      if (ctx.shield < 20 && cluster.color !== 'red') f.absorb = 2.5;
      break;
  }
  return f;
}

// Base score (size x10 + 20 for special shapes) times the merged profile
// multipliers. Noise is applied by the controller, not here.
export function scoreCluster(archetypes: ArchetypeId[], cluster: Cluster, ctx: ScoreCtx): number {
  const base = cluster.tiles.length * 10 + (cluster.shapeType !== 'standard' ? 20 : 0);
  const merged = mergeWeightFactors(archetypes.map((id) => profileFactors(id, cluster, ctx)));
  let mult = 1;
  for (const k of Object.keys(merged)) mult *= merged[k];
  return base * mult;
}

// --- Small board simulations (read-only; the board is never mutated) ---

type ColorGrid = (TileColor | null)[][];

function colorGridOf(board: GridBoard): ColorGrid {
  return board.tiles.map((row) => row.map((t) => t.color));
}

function clusterSizeAt(colors: ColorGrid, col: number, row: number): number {
  const color = colors[row]?.[col];
  if (!color) return 0;
  const seen = new Set<string>();
  const stack: [number, number][] = [[col, row]];
  seen.add(`${col},${row}`);
  let size = 0;
  while (stack.length > 0) {
    const [c, r] = stack.pop()!;
    size++;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      const key = `${nc},${nr}`;
      if (nc < 0 || nc >= GRID_COLS || nr < 0 || nr >= GRID_ROWS || seen.has(key)) continue;
      if (colors[nr]?.[nc] !== color) continue;
      seen.add(key);
      stack.push([nc, nr]);
    }
  }
  return size;
}

// Best adjacent swap on the board (right/down neighbours only; the mirror
// pair is the same swap). Optionally restricted to swaps whose resulting
// cluster has the given color. Returns null when no swap creates a cluster
// of at least minSize.
export function findBestSwap(
  board: GridBoard,
  minSize: number = 1,
  colorFilter?: TileColor
): SwapResult | null {
  const colors = colorGridOf(board);
  let best: SwapResult | null = null;
  const consider = (c1: number, r1: number, c2: number, r2: number) => {
    const col1 = colors[r1]?.[c1];
    const col2 = colors[r2]?.[c2];
    if (!col1 || !col2 || col1 === col2) return;
    if (board.isTileLocked(c1, r1) || board.isTileLocked(c2, r2)) return;
    const sim = colors.map((row) => [...row]);
    sim[r1][c1] = col2;
    sim[r2][c2] = col1;
    const size = Math.max(clusterSizeAt(sim, c1, r1), clusterSizeAt(sim, c2, r2));
    const resultColor = sim[r1][c1];
    if (size < minSize) return;
    if (colorFilter && resultColor !== colorFilter) {
      // The other end may still be the filtered color.
      if (sim[r2][c2] !== colorFilter) return;
    }
    if (!best || size > best.size) best = { a: { col: c1, row: r1 }, b: { col: c2, row: r2 }, size };
  };
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (c + 1 < GRID_COLS) consider(c, r, c + 1, r);
      if (r + 1 < GRID_ROWS) consider(c, r, c, r + 1);
    }
  }
  return best;
}

function maxConsecutiveInColumn(colors: ColorGrid, col: number, color: TileColor): number {
  let best = 0;
  let run = 0;
  for (let r = 0; r < GRID_ROWS; r++) {
    if (colors[r]?.[col] === color) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

// Smart skill trigger conditions (spec 2.9.3). Pure: no board mutation.
export function checkSkillTrigger(id: ArchetypeId, ctx: SkillTriggerCtx): boolean {
  const { board } = ctx;
  switch (id) {
    case 'lancer': {
      // Current column has 2+ non-red tiles, and converting 2 of them
      // (mirroring convertColumnToRed: first 2 unlocked tiles, top-down)
      // would make a vertical run of 3+ red.
      const col = ctx.aiCol;
      let nonRed = 0;
      for (let r = 0; r < GRID_ROWS; r++) {
        if (board.isTileLocked(col, r)) continue;
        if (board.tiles[r]?.[col]?.color !== 'red') nonRed++;
      }
      if (nonRed < 2) return false;
      const sim = colorGridOf(board);
      let converted = 0;
      for (let r = 0; r < GRID_ROWS && converted < 2; r++) {
        if (board.isTileLocked(col, r)) continue;
        sim[r][col] = 'red';
        converted++;
      }
      return maxConsecutiveInColumn(sim, col, 'red') >= 3;
    }
    case 'wave': {
      // 3+ cooldown (empty) tiles in the current row.
      let empty = 0;
      for (let c = 0; c < GRID_COLS; c++) {
        if (board.isTileLocked(c, ctx.aiRow)) continue;
        if (board.tiles[ctx.aiRow]?.[c]?.color === null) empty++;
      }
      return empty >= 3;
    }
    case 'sniper': {
      // Aligned with the player in the same column, or the player is in
      // the open central 3 columns (0-based 3-5) where the beam can reach
      // the core lane.
      return ctx.playerCol === ctx.aiCol || (ctx.playerCol >= 3 && ctx.playerCol <= 5);
    }
    case 'painter': {
      // Painting the foot cross to the dominant color would complete a
      // 5+ cluster.
      const dominant = board.getDominantColor();
      const sim = colorGridOf(board);
      const cross: [number, number][] = [
        [ctx.aiCol, ctx.aiRow],
        [ctx.aiCol - 1, ctx.aiRow],
        [ctx.aiCol + 1, ctx.aiRow],
        [ctx.aiCol, ctx.aiRow - 1],
        [ctx.aiCol, ctx.aiRow + 1],
      ];
      for (const [c, r] of cross) {
        if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) continue;
        if (board.isTileLocked(c, r)) continue;
        sim[r][c] = dominant;
      }
      return clusterSizeAt(sim, ctx.aiCol, ctx.aiRow) >= 5;
    }
    case 'transporter': {
      return !!ctx.bestSwap && ctx.bestSwap.size >= 5;
    }
    case 'speedster': {
      // A 6+ cell projectile or a beam is closing in on my column.
      return ctx.incoming.some((p) => {
        if (p.owner !== 'player') return false;
        const isBeam = p.archetypeId === 'sniper' && p.cells.length <= 1;
        if (!isBeam && p.cells.length < 6) return false;
        const step = ctx.cellW + ctx.gap;
        for (const cell of p.cells) {
          if (cell.destroyed) continue;
          const cellWorldX = p.x + cell.relCol * step;
          const c = Math.floor((cellWorldX - ctx.boardOriginX + ctx.cellW / 2) / step);
          if (c === ctx.aiCol) return true;
        }
        return false;
      });
    }
    case 'monochrome': {
      // A launchable red cluster of 5+, or red is scarce on the board.
      const redClusters = board.clusters.filter((c) => c.isActivePad && c.color === 'red');
      if (redClusters.some((c) => c.tiles.length >= 5)) return true;
      let redTiles = 0;
      for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
          if (board.tiles[r]?.[c]?.color === 'red') redTiles++;
        }
      }
      return redTiles <= 6;
    }
  }
}

// Final boss skill cadence base (seconds): 3.5s in phase 1, 2.2s awakened.
// The controller adds +0~1.0s of randomness on top.
export function bossSkillIntervalBase(awakened: boolean): number {
  return awakened ? 2.2 : 3.5;
}

export const BOSS_SKILL_ORDER = ['crimson', 'tide', 'beam', 'chroma', 'overdrive', 'rewrite', 'blink'] as const;
export type BossSkillName = (typeof BOSS_SKILL_ORDER)[number];

// Phase-2 combo patterns: (CHROMA FUSION -> OVERDRIVE SURGE) or
// (PHASE BLINK -> OMNI-BEAM), alternating.
export const BOSS_COMBOS: [BossSkillName, BossSkillName][] = [
  ['chroma', 'overdrive'],
  ['blink', 'beam'],
];

export class AIController {
  public x: number = 0;
  public y: number = 0;
  public radius: number = 22;

  public hp: number = 100;
  public maxHp: number = 100;
  // v2.2 Phase 2: diegetic HP bar residual (see PlayerCharacter.displayHp).
  public displayHp: number = 100;
  // Monochrome absorb shield (mirrors the player rule: +10 per absorbed
  // non-red cluster, cap MONOCHROME_SHIELD_MAX).
  public shield: number = 0;
  // v2.2 balance: launch buff windows (seconds remaining, game time) —
  // same rule as PlayerCharacter: transporter swap / speedster blink arm
  // the 1.5s fire buff; GameEngine consumes them on the AI's next launch.
  public swapBuffRemaining: number = 0;
  public speedBuffRemaining: number = 0;
  public currentCol: number = 4;
  public currentRow: number = 1;

  public hitFlashTimer: number = 0;
  public slowTimer: number = 0;
  public knockbackX: number = 0;
  public knockbackY: number = 0;
  // v2.2: shrink-zone outside-wall speed penalty (x0.7), set by GameEngine.
  public speedMult: number = 1.0;
  // v2.2: collapse-push invulnerability (0.3s).
  public invincibleTimer: number = 0;

  // Stage & archetype configuration (v2.3: from stages.ts, single source).
  public stage: number = 1;
  public archetypes: ArchetypeId[] = [];
  public aiLevel: AiLevel = 1;
  public isBoss: boolean = false; // final boss only (skill engine)
  public isSectorBoss: boolean = false;
  public isFinalBoss: boolean = false;
  public bossSkillTimer: number = 5.0;
  public bossSkillCycle: number = 0;
  public isBossOverdrive: boolean = false;
  // v2.3: monochrome skill sets this; GameEngine consumes it on the next
  // launch (one launch only, same rule as boss overdrive).
  public overdriveActive: boolean = false;
  // v2.3 final boss phase 2.
  public awakened: boolean = false;
  public bossCoreHp: number = 350;
  private bossCoreMaxHp: number = 350;
  private bossComboQueue: BossSkillName[] = [];
  private bossComboTimer: number = 0;
  private bossComboAlt: boolean = false;
  // v2.2: set by GameEngine during the 80-90s shrink warning — the AI
  // biases its movement toward the center area.
  public moveToCenter: boolean = false;
  // v2.3: set by GameEngine when the enemy core has collapsed (launch
  // wait -20% in the last-stand crisis).
  public coreCrisis: boolean = false;
  // v2.3: set by the decision logic when a wave core-defense launch must
  // bypass the monochrome absorb rule; consumed by GameEngine.
  public bypassAbsorb: boolean = false;

  // Per-archetype skill cooldowns (seconds remaining).
  private skillCooldowns: Partial<Record<ArchetypeId, number>> = {};
  private decisionTimer: number = 0;
  private targetTile: { col: number; row: number } | null = null;
  private launchCooldown: number = 1.0;
  private threatenedCols: Set<number> = new Set();

  constructor(initialX: number, initialY: number) {
    this.x = initialX;
    this.y = initialY;
  }

  public setStage(stageNum: number) {
    this.stage = stageNum;
    const cfg = STAGES[stageNum - 1];
    this.archetypes = [...cfg.archetypes];
    this.aiLevel = cfg.aiLevel;
    this.isFinalBoss = !!cfg.isFinalBoss;
    this.isSectorBoss = !!cfg.isSectorBoss;
    this.isBoss = this.isFinalBoss;

    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.displayHp = cfg.hp;
    this.shield = 0;
    this.overdriveActive = false;
    this.awakened = false;
    this.bossCoreHp = cfg.coreHp;
    this.bossCoreMaxHp = cfg.coreHp;
    this.bossComboQueue = [];
    this.bossComboTimer = 0;
    this.bossComboAlt = false;
    this.skillCooldowns = {};
    this.swapBuffRemaining = 0;
    this.speedBuffRemaining = 0;
    this.bypassAbsorb = false;
    this.coreCrisis = false;

    if (this.isFinalBoss) {
      this.radius = 26; // 보스 거대화
      this.bossSkillTimer = 4.0;
      this.bossSkillCycle = 0;
    } else if (this.isSectorBoss) {
      this.radius = 26; // 섹터 보스도 거대화
    } else {
      this.radius = 22;
    }
  }

  // Final boss awakening: HP 50% (125) or core HP 50% (200) reached.
  // Returns true only on the frame it triggers.
  public checkAwakening(particleSystem?: ParticleSystem): boolean {
    if (!this.isFinalBoss || this.awakened) return false;
    if (this.hp > this.maxHp * 0.5 && this.bossCoreHp > this.bossCoreMaxHp * 0.5) return false;
    this.awakened = true;
    // Next skill comes soon at the faster phase-2 cadence.
    this.bossSkillTimer = Math.min(this.bossSkillTimer, bossSkillIntervalBase(true));
    if (particleSystem) {
      particleSystem.addFloatingText(this.x, this.y - 50, 'OMNI-AWAKENING!', '#FF0033', 24);
      particleSystem.addShockwave(this.x, this.y, 220, '#FF0033');
      particleSystem.addShockwave(this.x, this.y, 160, '#FFD700');
    }
    soundManager.playBossWarning();
    return true;
  }

  public update(
    dt: number,
    boardOriginX: number,
    boardOriginY: number,
    cellW: number,
    cellH: number,
    gap: number,
    enemyBoard: GridBoard,
    incomingProjectiles: ShapeProjectile[],
    particleSystem: ParticleSystem,
    onLaunch: (cluster: Cluster) => void,
    onBossSniperFire?: () => void,
    playerPos?: { col: number; row: number }
  ) {
    // Timers
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    if (this.slowTimer > 0) this.slowTimer = Math.max(0, this.slowTimer - dt);
    if (this.invincibleTimer > 0) this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    // v2.2 Phase 2: red residual bar eases down toward real HP (45 HP/s).
    if (this.displayHp > this.hp) {
      this.displayHp = Math.max(this.hp, this.displayHp - dt * 45);
    } else {
      this.displayHp = this.hp;
    }
    this.decisionTimer -= dt;
    this.launchCooldown = Math.max(0, this.launchCooldown - dt);
    for (const k of Object.keys(this.skillCooldowns) as ArchetypeId[]) {
      this.skillCooldowns[k] = Math.max(0, (this.skillCooldowns[k] ?? 0) - dt);
    }
    // v2.2 balance: launch buff windows tick down with game time.
    if (this.swapBuffRemaining > 0) {
      this.swapBuffRemaining = Math.max(0, this.swapBuffRemaining - dt);
    }
    if (this.speedBuffRemaining > 0) {
      this.speedBuffRemaining = Math.max(0, this.speedBuffRemaining - dt);
    }

    const colStep = cellW + gap;
    const rowStep = cellH + gap;

    // Current grid position
    const relX = this.x - boardOriginX;
    const relY = this.y - boardOriginY;
    this.currentCol = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(relX / colStep)));
    this.currentRow = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(relY / rowStep)));

    const stats = aiLevelStats(this.aiLevel);
    const reactionInterval = stats.reaction;
    const baseMoveSpeed = stats.moveSpeed;
    const playerCol = playerPos?.col ?? 4;

    // --- Final boss skill engine (7 skills + phase-2 combos) ---
    if (this.isFinalBoss) {
      this.checkAwakening(particleSystem);
      if (this.bossComboQueue.length > 0) {
        this.bossComboTimer -= dt;
        if (this.bossComboTimer <= 0) {
          const next = this.bossComboQueue.shift()!;
          this.executeBossSkill(next, enemyBoard, particleSystem, boardOriginX, boardOriginY, onBossSniperFire, cellW, gap);
        }
      }
      this.bossSkillTimer -= dt;
      if (this.bossSkillTimer <= 0) {
        this.bossSkillTimer = bossSkillIntervalBase(this.awakened) + Math.random() * 1.0;
        if (this.awakened) {
          const combo = this.bossComboAlt ? BOSS_COMBOS[1] : BOSS_COMBOS[0];
          this.bossComboAlt = !this.bossComboAlt;
          this.executeBossSkill(combo[0], enemyBoard, particleSystem, boardOriginX, boardOriginY, onBossSniperFire, cellW, gap);
          this.bossComboQueue = [combo[1]];
          this.bossComboTimer = 0.8;
        } else {
          const name = BOSS_SKILL_ORDER[this.bossSkillCycle % BOSS_SKILL_ORDER.length];
          this.bossSkillCycle++;
          this.executeBossSkill(name, enemyBoard, particleSystem, boardOriginX, boardOriginY, onBossSniperFire, cellW, gap);
        }
      }
    }

    // --- Decision logic ---
    if (this.decisionTimer <= 0) {
      this.decisionTimer = reactionInterval + Math.random() * 0.2;

      // Threat assessment: incoming player projectiles.
      const threatenedCols = new Set<number>();
      // Core defense: a 6+ cell projectile entering the central 3 columns
      // (0-based 3-5). Set to the column it threatens.
      let defendCol: number | null = null;
      const threatY = boardOriginY + GRID_ROWS * rowStep + 86;
      for (const p of incomingProjectiles) {
        if (p.owner === 'player' && p.y < threatY) {
          const isBig = p.cells.length >= 6;
          for (const cell of p.cells) {
            if (cell.destroyed) continue;
            const cellWorldX = p.x + cell.relCol * colStep;
            const c = Math.floor((cellWorldX - boardOriginX + cellW / 2) / colStep);
            if (c >= 0 && c < GRID_COLS) {
              threatenedCols.add(c);
              if (isBig && c >= 3 && c <= 5 && defendCol === null) {
                defendCol = c;
              }
            }
          }
        }
      }
      this.threatenedCols = threatenedCols;

      const centerTile = () => ({
        col: 3 + Math.floor(Math.random() * 3),
        row: 1 + Math.floor(Math.random() * 2),
      });

      const hasWave = this.archetypes.includes('wave');
      const hasSpeedster = this.archetypes.includes('speedster');
      const hasTransporter = this.archetypes.includes('transporter');

      let decided = false;

      // Priority 1 — 80-90s shrink warning: head for the center area so
      // the AI is not isolated in a corner when the zone anchors.
      if (
        this.moveToCenter &&
        (this.currentCol < 3 || this.currentCol > 5 || this.currentRow < 1 || this.currentRow > 2)
      ) {
        this.targetTile = centerTile();
        decided = true;
      }

      // Priority 2 — core defense (wave profile): meet a big central
      // projectile with a blue cluster in the same column instead of a
      // plain dodge. (No blue cluster there: fall through.)
      if (!decided && (hasWave || this.isFinalBoss) && defendCol !== null) {
        const blue = enemyBoard.clusters.find(
          (c) => c.isActivePad && c.color === 'blue' && c.tiles.some((t) => t.col === defendCol)
        );
        if (blue) {
          const inCol = blue.tiles.filter((t) => t.col === defendCol);
          const chosenTile = inCol[Math.floor(Math.random() * inCol.length)];
          this.targetTile = { col: chosenTile.col, row: chosenTile.row };
          // A defense launch bypasses the monochrome absorb rule: the
          // blue block is meant to clash, not evaporate.
          this.bypassAbsorb = true;
          decided = true;
        }
      }

      // Priority 3 — evade a threatened column (aiLevel 2+). Speedster
      // (x2.5 evade) tries two columns away first.
      if (!decided && this.aiLevel >= 2 && threatenedCols.has(this.currentCol)) {
        const colRange = enemyBoard.colRange();
        let safeCol: number | null = null;
        const steps = hasSpeedster ? [2, 1] : [1];
        for (const step of steps) {
          for (const dir of [-1, 1]) {
            const cand = this.currentCol + dir * step;
            if (cand >= colRange.min && cand <= colRange.max && !threatenedCols.has(cand)) {
              safeCol = cand;
              break;
            }
          }
          if (safeCol !== null) break;
        }
        if (safeCol !== null) {
          this.targetTile = { col: safeCol, row: this.moveToCenter ? centerTile().row : Math.floor(Math.random() * 2) };
          decided = true;
        }
      }

      if (!decided) {
        // Priority 4 — offense: weighted utility scoring over the active
        // clusters. Hybrid profiles merge by per-factor max.
        const activeClusters = enemyBoard.clusters.filter((c) => c.isActivePad);
        if (activeClusters.length > 0) {
          const bestSwap = hasTransporter ? findBestSwap(enemyBoard, 1) : null;
          const ctx: ScoreCtx = {
            board: enemyBoard,
            playerCol,
            shield: this.shield,
            bestSwap,
            dominantColor: enemyBoard.getDominantColor(),
          };
          let best: Cluster | null = null;
          let bestScore = -Infinity;
          for (const c of activeClusters) {
            let s = scoreCluster(this.archetypes, c, ctx);
            if (stats.noise > 0) s *= 1 + (Math.random() * 2 - 1) * stats.noise;
            if (s > bestScore) {
              bestScore = s;
              best = c;
            }
          }
          const chosenTile = best!.tiles[Math.floor(Math.random() * best!.tiles.length)];
          this.targetTile = { col: chosenTile.col, row: chosenTile.row };
        } else {
          // No launchable cluster: discard to cycle (aiLevel 4+) or wander.
          if (this.aiLevel >= 4 && Math.random() < 0.3) {
            enemyBoard.discardTile(this.currentCol, this.currentRow);
            particleSystem.addFloatingText(this.x, this.y - 20, 'AI FLUSH!', '#FF8833', 13);
          }
          const colRange = enemyBoard.colRange();
          let col: number;
          if (hasTransporter && Math.random() < 0.5) {
            // Transporter side maneuvering: drift to an outer column.
            const side = Math.random() < 0.5 ? [colRange.min, colRange.min + 1] : [colRange.max - 1, colRange.max];
            col = side[Math.floor(Math.random() * side.length)];
          } else {
            col = colRange.min + Math.floor(Math.random() * (colRange.max - colRange.min + 1));
          }
          this.targetTile = { col, row: Math.floor(Math.random() * GRID_ROWS) };
        }
      }

      // Smart skill triggers (non-boss stages): one skill per decision
      // tick, first ready archetype whose condition holds.
      if (!this.isFinalBoss && this.archetypes.length > 0) {
        const bestSwap = hasTransporter ? findBestSwap(enemyBoard, 1) : null;
        const triggerCtx: SkillTriggerCtx = {
          board: enemyBoard,
          aiCol: this.currentCol,
          aiRow: this.currentRow,
          playerCol,
          incoming: incomingProjectiles,
          boardOriginX,
          cellW,
          gap,
          bestSwap,
        };
        for (const id of this.archetypes) {
          if ((this.skillCooldowns[id] ?? 0) > 0) continue;
          if (!checkSkillTrigger(id, triggerCtx)) continue;
          if (this.executeArchetypeSkill(id, enemyBoard, particleSystem, boardOriginX, boardOriginY, onBossSniperFire, cellW, gap)) {
            this.skillCooldowns[id] = ARCHETYPES[id].skillCooldown;
          }
          break;
        }
      }
    }

    // Move towards targetTile
    if (this.targetTile) {
      const targetWorldX = boardOriginX + this.targetTile.col * colStep + cellW / 2;
      const targetWorldY = boardOriginY + this.targetTile.row * rowStep + cellH / 2;

      const dx = targetWorldX - this.x;
      const dy = targetWorldY - this.y;
      const dist = Math.hypot(dx, dy);

      // Passive move modifiers: transporter +15%; speedster +60% on yellow.
      let speed = baseMoveSpeed * this.speedMult;
      if (this.archetypes.includes('transporter')) speed *= 1.15;
      const curTile = enemyBoard.tiles[this.currentRow]?.[this.currentCol];
      if (this.archetypes.includes('speedster') && curTile?.color === 'yellow') speed *= 1.6;
      if (this.slowTimer > 0) speed *= 0.6;

      if (dist > 12) {
        this.x += (dx / dist) * speed * dt;
        this.y += (dy / dist) * speed * dt;
      } else {
        // Reached target tile! If on an active cluster, launch!
        if (this.launchCooldown <= 0) {
          const curCluster = enemyBoard.getClusterAt(this.currentCol, this.currentRow);
          if (curCluster && curCluster.isActivePad) {
            onLaunch(curCluster);
            // v2.3: launch wait from aiLevel (linear), +0~0.4s random;
            // -20% in the core-collapse crisis (last-stand).
            const wait = stats.launchWait * (this.coreCrisis ? 0.8 : 1);
            this.launchCooldown = wait + Math.random() * 0.4;
          }
        }
      }
    }

    // Apply knockback
    this.knockbackX *= Math.exp(-dt * 12);
    this.knockbackY *= Math.exp(-dt * 12);
    this.x += this.knockbackX * dt;
    this.y += this.knockbackY * dt;

    // Bounds clamp inside Enemy Grid (collapsed boards lose the outer
    // columns, so the playable range shrinks with them).
    const colRange = enemyBoard.colRange();
    const minX = boardOriginX + colRange.min * colStep + this.radius;
    const maxX = boardOriginX + (colRange.max + 1) * colStep - gap - this.radius;
    const minY = boardOriginY + this.radius;
    const maxY = boardOriginY + GRID_ROWS * rowStep - gap - this.radius;

    this.x = Math.max(minX, Math.min(maxX, this.x));
    this.y = Math.max(minY, Math.min(maxY, this.y));
  }

  // Execute one archetype skill on the enemy board. Returns false when the
  // skill could not fire (e.g. transporter found no swap) so no cooldown
  // is spent. Board-level effects: the AI "casts" from its position, so
  // lancer/wave/painter use the AI's current column/row.
  private executeArchetypeSkill(
    id: ArchetypeId,
    enemyBoard: GridBoard,
    particleSystem: ParticleSystem,
    boardOriginX: number,
    boardOriginY: number,
    onBossSniperFire?: () => void,
    cellW: number = 110,
    gap: number = 6
  ): boolean {
    soundManager.playSkill(id);
    switch (id) {
      case 'lancer': {
        enemyBoard.convertColumnToRed(this.currentCol, 2);
        particleSystem.addFloatingText(this.x, this.y - 30, 'CRIMSON LANCE!', '#FF3366', 16);
        particleSystem.addShockwave(this.x, this.y, 80, '#FF3366');
        return true;
      }
      case 'wave': {
        enemyBoard.refillRow(this.currentRow);
        particleSystem.addFloatingText(this.x, this.y - 30, 'TIDE SURGE!', '#33CCFF', 16);
        particleSystem.addShockwave(this.x, this.y, 100, '#33CCFF');
        return true;
      }
      case 'sniper': {
        particleSystem.addLaserBeam(this.x, this.y, this.x, boardOriginY + 700, '#00FFAA', 18);
        particleSystem.addFloatingText(this.x, this.y - 30, 'PIERCING BEAM!', '#00FFAA', 16);
        if (onBossSniperFire) onBossSniperFire();
        return true;
      }
      case 'painter': {
        enemyBoard.paintAdjacentDominant(this.currentCol, this.currentRow);
        particleSystem.addFloatingText(this.x, this.y - 30, 'CHROMA INFUSION!', '#FF8800', 16);
        particleSystem.addShockwave(this.x, this.y, 90, '#FF8800');
        return true;
      }
      case 'transporter': {
        const swap = findBestSwap(enemyBoard, 1);
        if (!swap) return false;
        enemyBoard.swapTiles(swap.a.col, swap.a.row, swap.b.col, swap.b.row);
        particleSystem.addFloatingText(this.x, this.y - 30, 'QUANTUM SWAP!', '#B57EDC', 16);
        particleSystem.addShockwave(this.x, this.y, 80, '#B57EDC');
        // v2.2 balance: swap-link bonus — first launch within 1.5s deals
        // +15% damage (same rule as the player transporter).
        this.swapBuffRemaining = TRANSPORTER_SWAP_BUFF_SEC;
        return true;
      }
      case 'speedster': {
        this.blinkAway(enemyBoard, particleSystem, boardOriginX, cellW, gap);
        return true;
      }
      case 'monochrome': {
        enemyBoard.convertRandomToRed(3);
        this.overdriveActive = true;
        particleSystem.addFloatingText(this.x, this.y - 30, 'BLOOD OVERDRIVE!', '#FF0033', 18);
        particleSystem.addShockwave(this.x, this.y, 120, '#FF0033');
        return true;
      }
    }
  }

  // Blink 110px toward a safe column (away from threatened columns) and
  // turn the landing tile yellow. Shared by the speedster skill and the
  // boss PHASE BLINK.
  private blinkAway(
    enemyBoard: GridBoard,
    particleSystem: ParticleSystem,
    boardOriginX: number,
    cellW: number,
    gap: number
  ) {
    const colRange = enemyBoard.colRange();
    let safeCol: number | null = null;
    for (let d = 1; d <= GRID_COLS && safeCol === null; d++) {
      for (const dir of [-1, 1]) {
        const cand = this.currentCol + dir * d;
        if (cand >= colRange.min && cand <= colRange.max && !this.threatenedCols.has(cand)) {
          safeCol = cand;
          break;
        }
      }
    }
    if (safeCol === null) safeCol = 4;
    const colStep = cellW + gap;
    this.x = boardOriginX + safeCol * colStep + cellW / 2;
    this.currentCol = safeCol;
    const tile = enemyBoard.tiles[this.currentRow]?.[safeCol];
    if (tile) {
      tile.cooldownRemaining = 0;
      tile.cooldownMax = 0;
      tile.color = 'yellow';
    }
    // v2.2 balance: a blink (speedster skill or boss PHASE BLINK) arms
    // the 1.5s fire buff — first launch after the blink gets +15% speed
    // and +15% damage.
    this.speedBuffRemaining = SPEEDSTER_FIRE_BUFF_SEC;
    particleSystem.addFloatingText(this.x, this.y - 30, 'BLINK CHARGE!', '#FFCC00', 16);
    particleSystem.addShockwave(this.x, this.y, 110, '#FFCC00');
  }

  // Final boss skill execution (7 skills). `bossSkillCycle` is set to the
  // executed skill's index so the renderer core color stays in sync.
  private executeBossSkill(
    name: BossSkillName,
    enemyBoard: GridBoard,
    particleSystem: ParticleSystem,
    boardOriginX: number,
    boardOriginY: number,
    onBossSniperFire?: () => void,
    cellW: number = 110,
    gap: number = 6
  ) {
    this.bossSkillCycle = BOSS_SKILL_ORDER.indexOf(name);
    soundManager.playSkill('monochrome');

    switch (name) {
      case 'crimson': {
        enemyBoard.convertColumnToRed(this.currentCol, 3);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: CRIMSON STRIKE!', '#FF0055', 18);
        particleSystem.addShockwave(this.x, this.y, 110, '#FF0055');
        break;
      }
      case 'tide': {
        enemyBoard.refillRow(this.currentRow);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: TIDE FLOOD!', '#33CCFF', 18);
        particleSystem.addShockwave(this.x, this.y, 110, '#33CCFF');
        break;
      }
      case 'beam': {
        if (onBossSniperFire) onBossSniperFire();
        particleSystem.addLaserBeam(this.x, this.y, this.x, boardOriginY + 700, '#00FFAA', 22);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: OMNI-BEAM!', '#00FFAA', 18);
        break;
      }
      case 'chroma': {
        enemyBoard.paintAdjacentDominant(this.currentCol, this.currentRow);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: CHROMA FUSION!', '#FF8800', 18);
        particleSystem.addShockwave(this.x, this.y, 110, '#FF8800');
        break;
      }
      case 'overdrive': {
        enemyBoard.convertRandomToRed(4);
        this.isBossOverdrive = true;
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: OVERDRIVE SURGE!', '#FF0000', 20);
        particleSystem.addShockwave(this.x, this.y, 130, '#FF0000');
        break;
      }
      case 'rewrite': {
        // QUANTUM REWRITE: force-swap tiles of the dominant color to
        // complete a 6+ cluster at once. Fallback: the best swap of any
        // color (still a rewrite, just under 6).
        const dominant = enemyBoard.getDominantColor();
        const swap = findBestSwap(enemyBoard, 6, dominant) ?? findBestSwap(enemyBoard, 1);
        if (swap) {
          enemyBoard.swapTiles(swap.a.col, swap.a.row, swap.b.col, swap.b.row);
          particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: QUANTUM REWRITE!', '#B57EDC', 18);
          particleSystem.addShockwave(this.x, this.y, 130, '#B57EDC');
        }
        break;
      }
      case 'blink': {
        // PHASE BLINK: dodge a big projectile/beam, landing tile yellow.
        this.blinkAway(enemyBoard, particleSystem, boardOriginX, cellW, gap);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: PHASE BLINK!', '#FFCC00', 18);
        break;
      }
    }
  }

  public takeDamage(amount: number, isDirect: boolean = true) {
    // v2.2: collapse-push invulnerability (0.3s) blocks damage like a dash.
    if (this.invincibleTimer > 0) return;
    // v2.3: monochrome absorb shield absorbs first (mirrors the player).
    if (this.shield > 0) {
      if (this.shield >= amount) {
        this.shield -= amount;
        return;
      }
      amount -= this.shield;
      this.shield = 0;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlashTimer = 0.2;
    soundManager.playHit(isDirect);
  }

  public reset(startX: number, startY: number, stageNum: number = 1) {
    this.x = startX;
    this.y = startY;
    this.setStage(stageNum);
    this.slowTimer = 0;
    this.hitFlashTimer = 0;
    this.invincibleTimer = 0;
    this.speedMult = 1.0;
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.launchCooldown = 1.2;
    this.decisionTimer = 0;
    this.targetTile = null;
    this.isBossOverdrive = false;
    this.moveToCenter = false;
  }
}
