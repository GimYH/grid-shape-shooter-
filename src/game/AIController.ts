import { GridBoard, GRID_COLS, GRID_ROWS } from './GridEngine';
import { ShapeProjectile, Cluster } from '../types/game';
import { ParticleSystem } from './ParticleSystem';
import { soundManager } from '../audio/soundManager';
import { STAGES } from './stages';

export class AIController {
  public x: number = 0;
  public y: number = 0;
  public radius: number = 22;

  public hp: number = 100;
  public maxHp: number = 100;
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

  // Stage & Boss configuration
  public stage: number = 1;
  public isBoss: boolean = false;
  public bossSkillTimer: number = 5.0;
  public bossSkillCycle: number = 0;
  public isBossOverdrive: boolean = false;
  // v2.2: set by GameEngine during the 80-90s shrink warning — the AI
  // biases its movement toward the center area.
  public moveToCenter: boolean = false;

  private decisionTimer: number = 0;
  private targetTile: { col: number; row: number } | null = null;
  private launchCooldown: number = 1.0;

  constructor(initialX: number, initialY: number) {
    this.x = initialX;
    this.y = initialY;
  }

  public setStage(stageNum: number) {
    this.stage = stageNum;
    this.isBoss = stageNum >= 5;

    // v2.2: HP comes from stages.ts (single source of truth).
    const cfg = STAGES[stageNum - 1];
    this.maxHp = cfg.enemyHp;
    this.hp = cfg.enemyHp;
    if (this.isBoss) {
      this.radius = 26; // 보스 거대화
      this.bossSkillTimer = 4.0;
    } else {
      this.radius = 22;
    }
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
    onBossSniperFire?: () => void
  ) {
    // Timers
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    if (this.slowTimer > 0) this.slowTimer = Math.max(0, this.slowTimer - dt);
    if (this.invincibleTimer > 0) this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    this.decisionTimer -= dt;
    this.launchCooldown = Math.max(0, this.launchCooldown - dt);

    const colStep = cellW + gap;
    const rowStep = cellH + gap;

    // Current grid position
    const relX = this.x - boardOriginX;
    const relY = this.y - boardOriginY;
    this.currentCol = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(relX / colStep)));
    this.currentRow = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(relY / rowStep)));

    // v2.2: difficulty numbers come from stages.ts (single source of truth).
    const stageCfg = STAGES[this.stage - 1];
    const reactionInterval = stageCfg.aiReactionTime;
    const baseMoveSpeed = stageCfg.aiMoveSpeed;

    // Boss Omni-Skill Engine (5 skills, first at 4.0s, then 4.2 + 0~2.0s)
    if (this.isBoss) {
      this.bossSkillTimer -= dt;
      if (this.bossSkillTimer <= 0) {
        this.bossSkillTimer = (stageCfg.bossSkillInterval ?? 4.2) + Math.random() * 2.0;
        this.triggerBossSkill(enemyBoard, particleSystem, boardOriginX, boardOriginY, onBossSniperFire);
      }
    }

    // AI Decision logic
    if (this.decisionTimer <= 0) {
      this.decisionTimer = reactionInterval + Math.random() * 0.2;

      // 1. Threat assessment: Check incoming player projectiles
      const threatenedCols = new Set<number>();
      // v2.2 core defense: a 6+ cell projectile entering the central 3
      // columns (4-6, 1-indexed). Set to the column it threatens.
      let defendCol: number | null = null;
      // Board height + the original ~86px early-warning margin.
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

      // v2.2 center bias: random tile in the center area (cols 4-6,
      // rows 2-3, 1-indexed).
      const centerTile = () => ({
        col: 3 + Math.floor(Math.random() * 3),
        row: 1 + Math.floor(Math.random() * 2),
      });

      // Priority 1 — core defense (stage 3+): meet a big central
      // projectile with a blue cluster in the same column instead of a
      // plain dodge. (No blue cluster there: fall through.)
      let decided = false;
      if (this.stage >= 3 && defendCol !== null) {
        const blue = enemyBoard.clusters.find(
          (c) => c.isActivePad && c.color === 'blue' && c.tiles.some((t) => t.col === defendCol)
        );
        if (blue) {
          // Launch from a tile in the threatened column itself, so the
          // blue block meets the big projectile head-on.
          const inCol = blue.tiles.filter((t) => t.col === defendCol);
          const chosenTile = inCol[Math.floor(Math.random() * inCol.length)];
          this.targetTile = { col: chosenTile.col, row: chosenTile.row };
          decided = true;
        }
      }

      // Priority 2 — evade a threatened column (stage 2+)
      if (!decided && this.stage >= 2 && threatenedCols.has(this.currentCol)) {
        const colRange = enemyBoard.colRange();
        let safeCol = this.currentCol;
        if (!threatenedCols.has(this.currentCol - 1) && this.currentCol > colRange.min) {
          safeCol = this.currentCol - 1;
        } else if (!threatenedCols.has(this.currentCol + 1) && this.currentCol < colRange.max) {
          safeCol = this.currentCol + 1;
        }
        this.targetTile = { col: safeCol, row: this.moveToCenter ? centerTile().row : Math.floor(Math.random() * 2) };
        decided = true;
      }

      // Priority 3 — 80-90s center move: head for the center area so the
      // AI is not isolated in a corner when the shrink zone anchors.
      if (
        !decided &&
        this.moveToCenter &&
        (this.currentCol < 3 || this.currentCol > 5 || this.currentRow < 1 || this.currentRow > 2)
      ) {
        this.targetTile = centerTile();
        decided = true;
      }

      if (!decided) {
        // 2. Offense: Find the best active cluster
        const activeClusters = enemyBoard.clusters.filter((c) => c.isActivePad);

        if (activeClusters.length > 0) {
          // Higher stages prioritize 5+ big blocks and special shapes
          if (this.stage >= 3) {
            activeClusters.sort((a, b) => {
              const scoreA = a.tiles.length * 10 + (a.shapeType !== 'standard' ? 20 : 0);
              const scoreB = b.tiles.length * 10 + (b.shapeType !== 'standard' ? 20 : 0);
              return scoreB - scoreA;
            });
          }
          const bestCluster = activeClusters[0];
          const chosenTile = bestCluster.tiles[Math.floor(Math.random() * bestCluster.tiles.length)];
          this.targetTile = { col: chosenTile.col, row: chosenTile.row };
        } else {
          // In stage 4 or Boss, if no good clusters, discard awkward tiles to cycle!
          if (this.stage >= 4 && Math.random() < 0.3) {
            enemyBoard.discardTile(this.currentCol, this.currentRow);
            particleSystem.addFloatingText(this.x, this.y - 20, 'AI FLUSH!', '#FF8833', 13);
          }
          const colRange = enemyBoard.colRange();
          this.targetTile = {
            col: colRange.min + Math.floor(Math.random() * (colRange.max - colRange.min + 1)),
            row: Math.floor(Math.random() * GRID_ROWS),
          };
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

      let speed = baseMoveSpeed * this.speedMult;
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
            // v2.2: launch wait from stages.ts, +0~0.4s random.
            this.launchCooldown = stageCfg.aiLaunchWait + Math.random() * 0.4;
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

  // Boss executes 5 skills across a rotation
  private triggerBossSkill(
    enemyBoard: GridBoard,
    particleSystem: ParticleSystem,
    boardOriginX: number,
    boardOriginY: number,
    onBossSniperFire?: () => void
  ) {
    this.bossSkillCycle = (this.bossSkillCycle + 1) % 5;
    soundManager.playSkill('monochrome');

    switch (this.bossSkillCycle) {
      case 0: {
        // Boss Skill 1: Crimson Lance (Align column to Red)
        enemyBoard.convertColumnToRed(this.currentCol, 3);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: CRIMSON STRIKE!', '#FF0055', 18);
        particleSystem.addShockwave(this.x, this.y, 110, '#FF0055');
        break;
      }
      case 1: {
        // Boss Skill 2: Tide Surge (Row refill)
        enemyBoard.refillRow(this.currentRow);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: TIDE FLOOD!', '#33CCFF', 18);
        particleSystem.addShockwave(this.x, this.y, 110, '#33CCFF');
        break;
      }
      case 2: {
        // Boss Skill 3: Sniper Laser
        if (onBossSniperFire) onBossSniperFire();
        particleSystem.addLaserBeam(this.x, this.y, this.x, boardOriginY + 700, '#00FFAA', 22);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: OMNI-BEAM!', '#00FFAA', 18);
        break;
      }
      case 3: {
        // Boss Skill 4: Chroma Infusion
        enemyBoard.paintAdjacentDominant(this.currentCol, this.currentRow);
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: CHROMA FUSION!', '#FF8800', 18);
        particleSystem.addShockwave(this.x, this.y, 110, '#FF8800');
        break;
      }
      case 4: {
        // Boss Skill 5: Blood Overdrive
        enemyBoard.convertRandomToRed(4);
        this.isBossOverdrive = true;
        particleSystem.addFloatingText(this.x, this.y + 35, 'BOSS: OVERDRIVE SURGE!', '#FF0000', 20);
        particleSystem.addShockwave(this.x, this.y, 130, '#FF0000');
        break;
      }
    }
  }

  public takeDamage(amount: number, isDirect: boolean = true) {
    // v2.2: collapse-push invulnerability (0.3s) blocks damage like a dash.
    if (this.invincibleTimer > 0) return;
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
