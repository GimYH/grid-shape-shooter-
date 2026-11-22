import {
  ShapeProjectile,
  ProjectileCell,
  TileColor,
  ShapePatternType,
  Cluster,
} from '../types/game';
import { ParticleSystem } from './ParticleSystem';
import { soundManager } from '../audio/soundManager';
import { COLOR_HEX, GRID_ROWS } from './GridEngine';
import {
  LANCER_SPEAR_SPEED_MULT,
  MONOCHROME_BLUE_CLASH_TAKEN_MULT,
  MONOCHROME_OVERDRIVE_MULT,
  MONOCHROME_RED_DMG_MULT,
  PAINTER_BIG_SPEED_MULT,
  SNIPER_BIG_HIT_DMG_MULT,
  CLASH_ADVANTAGE_MULT,
  FRONTLINE_DMG_MULT,
  FRONTLINE_SPEED_MULT,
  OVERCHARGE_SPEED_MULT,
  SPEAR_SPEED_MULT,
  WAVE_WALL_CELL_HP_BONUS,
} from './archetypes';

// v3.0 cluster-size damage table (fixed TOTAL damage per projectile,
// capped at 8 cells — 9+ cells keep only their cell-HP tiers).
// damagePerCell = table / cell count, kept as a float: the final hit
// rounds after multipliers, so the total stays on the table. 1-2 cell
// clusters (sniper quick shots) extrapolate the 3-cell rate (4/cell):
// 1 cell -> 4, 2 cells -> 8.
export const CLUSTER_DAMAGE_TABLE: readonly number[] = [0, 4, 8, 12, 16, 20, 23, 25, 27];
export function clusterBaseDamage(cellCount: number): number {
  return CLUSTER_DAMAGE_TABLE[Math.max(0, Math.min(cellCount, 8))];
}

export class ProjectileManager {
  public projectiles: ShapeProjectile[] = [];
  // v2.2: called when a clash is won; GameEngine reduces the launcher's
  // skill cooldown by 1.0s and counts clashesWon.
  // v2.2 Phase 2: winnerCells = the winning projectile's launch size —
  // a 6+ cell clash win fires a 35ms micro-hitstop (GameEngine side).
  // v3.0 Phase 2 Zone 1: clashPos = where the winning clash happened,
  // so the engine can drop a 'COUNTER! -1s' floating text on the spot.
  public onClashWin: ((winnerOwner: 'player' | 'enemy', winnerCells?: number, clashPos?: { x: number; y: number }) => void) | null = null;

  public createProjectile(
    owner: 'player' | 'enemy',
    cluster: Cluster,
    boardOriginX: number,
    boardOriginY: number,
    cellW: number,
    cellH: number,
    gap: number,
    archetypeId: string,
    overdriveActive: boolean = false,
    frontline: boolean = false
  ): ShapeProjectile {
    // Determine anchor (top-left bounding box of cluster)
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const t of cluster.tiles) {
      if (t.col < minC) minC = t.col;
      if (t.col > maxC) maxC = t.col;
      if (t.row < minR) minR = t.row;
      if (t.row > maxR) maxR = t.row;
    }

    const anchorX = boardOriginX + minC * (cellW + gap);
    const anchorY = boardOriginY + minR * (cellH + gap);

    // Calculate base durability
    const count = cluster.tiles.length;
    let baseHp = 1;
    if (count >= 9) {
      baseHp = 3;
    } else if (count >= 6) {
      baseHp = 2;
    }

    // Blue color doubles durability
    if (cluster.color === 'blue') {
      baseHp *= 2;
    }

    // Archetype modifier: Lancer vertical spear gets +1 cell HP (the
    // phase-2 awakened boss has the lancer passive too).
    if ((archetypeId === 'lancer' || archetypeId === 'boss-awakened') && cluster.shapeType === 'spear') {
      baseHp += 1;
    }

    // v2.2 balance: Wave horizontal wall (3+ cells) gets +1 cell HP.
    if (archetypeId === 'wave' && cluster.shapeType === 'wall') {
      baseHp += WAVE_WALL_CELL_HP_BONUS;
    }

    // v3.0 damage pipeline (single source of truth for the order):
    //   base = CLUSTER_DAMAGE_TABLE[min(cells, 8)] (fixed total)
    //   per-cell base = base / cells
    //   creation-time multipliers (baked into damagePerCell here):
    //     frontline x1.20, monochrome red x1.15, sniper 3+ x1.10,
    //     overdrive x1.35
    //   launch-buff multipliers (GameEngine, packet-carried):
    //     transporter swap x1.15, speedster blink x1.20, royale KO +10%
    //   hit-time multipliers (GameEngine, applied at impact):
    //     combo 1+0.06*count (cap x1.60), core x2 after 90s,
    //     sniper 1-2 core x0.40
    //   hard caps last: character 30, core 55.
    const baseTotal = clusterBaseDamage(count);
    let dmgMult = 1.0;
    if (archetypeId === 'monochrome' && cluster.color === 'red') {
      dmgMult *= MONOCHROME_RED_DMG_MULT; // v3.0: red +15% (was x2.0)
    }
    if (overdriveActive) {
      dmgMult *= MONOCHROME_OVERDRIVE_MULT; // v3.0: x1.35 (was x1.5)
    }
    // v3.0 sniper: a 3+ cluster hit deals +10% damage.
    if (archetypeId === 'sniper' && count >= 3) {
      dmgMult *= SNIPER_BIG_HIT_DMG_MULT;
    }
    // v3.0 frontline bonus: +20% damage on launches from the front 2 rows.
    if (frontline) {
      dmgMult *= FRONTLINE_DMG_MULT;
    }
    // Per-cell share of the table total — kept as a float so the rounded
    // final damage stays on the table after multipliers.
    const damagePerCell = (baseTotal * dmgMult) / count;

    // Calculate speed
    let speedMult = 1.0;
    if (cluster.color === 'red') speedMult = 1.3;
    else if (cluster.color === 'blue') speedMult = 0.6;
    else if (cluster.color === 'yellow') speedMult = 1.0;

    if (cluster.shapeType === 'spear') {
      // v2.2 balance: lancer spear 2.0 -> 1.45 (still the fastest spear,
      // but slow enough to react to / intercept in the neutral zone).
      // v3.0: 1.45 -> 1.40.
      speedMult *= (archetypeId === 'lancer' ? LANCER_SPEAR_SPEED_MULT : SPEAR_SPEED_MULT);
    }
    if (cluster.shapeType === 'wall' && archetypeId === 'wave') {
      speedMult *= 2.0;
    }
    // v3.0 painter: a 5+ cluster launch is +10% faster.
    if (archetypeId === 'painter' && count >= 5) {
      speedMult *= PAINTER_BIG_SPEED_MULT;
    }

    const baseVy = 560; // px/s (v2.2)
    // v2.2 frontline bonus: +15% speed on launches from the front 2 rows.
    const frontlineSpeed = frontline ? FRONTLINE_SPEED_MULT : 1.0;
    const vy = owner === 'player' ? -baseVy * speedMult * frontlineSpeed : baseVy * speedMult * frontlineSpeed;

    const cells: ProjectileCell[] = cluster.tiles.map((t) => ({
      relCol: t.col - minC,
      relRow: t.row - minR,
      hp: baseHp,
      maxHp: baseHp,
      destroyed: false,
    }));

    const proj: ShapeProjectile = {
      id: `${owner}_${Date.now()}_${Math.random()}`,
      owner,
      color: cluster.color,
      shapeType: cluster.shapeType,
      archetypeId,
      x: anchorX,
      y: anchorY,
      vx: 0,
      vy,
      cellWidth: cellW,
      cellHeight: cellH,
      cells,
      damagePerCell,
      speedMultiplier: speedMult,
      glowColor: COLOR_HEX[cluster.color],
      trailTimer: 0,
      frontline,
      comboAwarded: false,
      overchargeTriggered: false,
    };

    this.projectiles.push(proj);
    return proj;
  }

  // Create Sniper Beam Projectile
  public createSniperBeam(
    owner: 'player' | 'enemy',
    col: number,
    boardOriginX: number,
    boardOriginY: number,
    cellW: number,
    cellH: number,
    gap: number
  ): ShapeProjectile {
    const x = boardOriginX + col * (cellW + gap);
    const y = boardOriginY + (owner === 'player' ? 0 : (GRID_ROWS - 1) * (cellH + gap));
    const vy = owner === 'player' ? -800 : 800;

    const proj: ShapeProjectile = {
      id: `sniper_beam_${Date.now()}`,
      owner,
      color: 'yellow',
      shapeType: 'spear',
      archetypeId: 'sniper',
      x,
      y,
      vx: 0,
      vy,
      cellWidth: cellW,
      cellHeight: cellH,
      cells: [{ relCol: 0, relRow: 0, hp: 2, maxHp: 2, destroyed: false }],
      // v3.0: Piercing Beam damage 24 (was 12).
      damagePerCell: 24,
      speedMultiplier: 2.2,
      glowColor: '#00FFAA',
      trailTimer: 0,
      frontline: false,
      isBeam: true,
      comboAwarded: false,
      overchargeTriggered: false,
    };

    this.projectiles.push(proj);
    return proj;
  }

  public update(
    dt: number,
    particleSystem: ParticleSystem,
    playerTargetX: number,
    enemyTargetX: number
  ) {
    const gap = 6; // v2.2 cell gap

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];

      // Homing logic: steer X towards opponent
      if (p.shapeType === 'homing') {
        const targetX = p.owner === 'player' ? enemyTargetX : playerTargetX;
        const diffX = targetX - (p.x + p.cellWidth);
        const steerSpeed = 160;
        p.vx = Math.sign(diffX) * Math.min(Math.abs(diffX) * 2, steerSpeed);
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Particle trails
      p.trailTimer += dt;
      if (p.trailTimer > 0.04) {
        p.trailTimer = 0;
        for (const cell of p.cells) {
          if (cell.destroyed) continue;
          const cx = p.x + cell.relCol * (p.cellWidth + gap) + p.cellWidth / 2;
          const cy = p.y + cell.relRow * (p.cellHeight + gap) + p.cellHeight / 2;
          particleSystem.emitTrail(cx, cy, p.glowColor, p.shapeType === 'spear' ? 6 : 4);
        }
      }

      // Check if all cells are destroyed or far out of bounds
      const allDestroyed = p.cells.every((c) => c.destroyed);
      const isOffScreen = p.y < -300 || p.y > 1400;

      if (allDestroyed || isOffScreen) {
        this.projectiles.splice(i, 1);
      }
    }

    // Check Neutral Clash (Block-to-block collision between player & enemy projectiles)
    this.resolveBlockCollisions(particleSystem);
  }

  // Column / Cell-level AABB collision and partial offset destruction
  private resolveBlockCollisions(particleSystem: ParticleSystem) {
    const gap = 6; // v2.2 cell gap
    const playerProjs = this.projectiles.filter((p) => p.owner === 'player');
    const enemyProjs = this.projectiles.filter((p) => p.owner === 'enemy');

    // v2.2 type advantage in neutral clashes only: blue > red > yellow >
    // blue. The advantaged side deals double clash damage. Direct hits on
    // characters and cores are NOT affected.
    // v2.2 balance: Monochrome red no longer fully ignores blue — blue
    // deals 1.5x clash damage to it (a normal red projectile takes 2x).
    // The phase-2 awakened final boss shares the same reduced immunity.
    const beats = (a: ShapeProjectile, b: ShapeProjectile): boolean => {
      if (b.color === 'red' && (b.archetypeId === 'monochrome' || b.archetypeId === 'boss-awakened')) return false;
      return (
        (a.color === 'blue' && b.color === 'red') ||
        (a.color === 'red' && b.color === 'yellow') ||
        (a.color === 'yellow' && b.color === 'blue')
      );
    };

    // Clash damage multiplier for `attacker` hitting `defender`.
    // v3.0: type advantage is x1.75 (was x2.0).
    const clashMult = (attacker: ShapeProjectile, defender: ShapeProjectile): number => {
      if (beats(attacker, defender)) return CLASH_ADVANTAGE_MULT;
      if (
        attacker.color === 'blue' &&
        defender.color === 'red' &&
        (defender.archetypeId === 'monochrome' || defender.archetypeId === 'boss-awakened')
      ) {
        return MONOCHROME_BLUE_CLASH_TAKEN_MULT;
      }
      return 1;
    };

    for (const pProj of playerProjs) {
      for (const eProj of enemyProjs) {
        // Iterate through all active cells in both projectiles
        for (const pCell of pProj.cells) {
          if (pCell.destroyed) continue;
          const pLeft = pProj.x + pCell.relCol * (pProj.cellWidth + gap);
          const pTop = pProj.y + pCell.relRow * (pProj.cellHeight + gap);
          const pRight = pLeft + pProj.cellWidth;
          const pBottom = pTop + pProj.cellHeight;

          for (const eCell of eProj.cells) {
            if (eCell.destroyed) continue;
            const eLeft = eProj.x + eCell.relCol * (eProj.cellWidth + gap);
            const eTop = eProj.y + eCell.relRow * (eProj.cellHeight + gap);
            const eRight = eLeft + eProj.cellWidth;
            const eBottom = eTop + eProj.cellHeight;

            // AABB Collision overlap
            const overlapX = Math.max(0, Math.min(pRight, eRight) - Math.max(pLeft, eLeft));
            const overlapY = Math.max(0, Math.min(pBottom, eBottom) - Math.max(pTop, eTop));

            if (overlapX > 8 && overlapY > 8) {
              // Clash occurred!
              const clashX = (Math.max(pLeft, eLeft) + Math.min(pRight, eRight)) / 2;
              const clashY = (Math.max(pTop, eTop) + Math.min(pBottom, eBottom)) / 2;

              // Exchange damage (type advantage doubles the advantaged
              // side's clash damage; blue vs monochrome red is 1.5x).
              const pDamageToTake = eCell.hp * clashMult(eProj, pProj);
              const eDamageToTake = pCell.hp * clashMult(pProj, eProj);

              pCell.hp -= pDamageToTake;
              eCell.hp -= eDamageToTake;

              soundManager.playClash();

              if (pCell.hp <= 0) {
                pCell.destroyed = true;
                particleSystem.emitBlockDestruction(clashX, clashY, pProj.glowColor, 12);
              }
              if (eCell.hp <= 0) {
                eCell.destroyed = true;
                particleSystem.emitBlockDestruction(clashX, clashY, eProj.glowColor, 12);
              }

              // v2.2 counter-overcharge: the surviving cell's projectile
              // accelerates x1.35 once, and its launcher's skill cooldown
              // drops by 1.0s (via onClashWin). Upper bound: only a
              // projectile launched with 3+ cells qualifies — a 1-2 cell
              // snipe winning a clash gets no overcharge. cells.length is
              // the launch size (cells are never removed, only marked
              // destroyed). v3.0: the once-only flag lives on the
              // projectile (overchargeTriggered), not a manager-side Set;
              // speed is x1.35 (was x1.4).
              if (pCell.hp > 0 && eCell.hp <= 0 && pProj.cells.length >= 3 && !pProj.overchargeTriggered) {
                pProj.overchargeTriggered = true;
                pProj.vy *= OVERCHARGE_SPEED_MULT;
                this.onClashWin?.('player', pProj.cells.length, { x: clashX, y: clashY });
              }
              if (eCell.hp > 0 && pCell.hp <= 0 && eProj.cells.length >= 3 && !eProj.overchargeTriggered) {
                eProj.overchargeTriggered = true;
                eProj.vy *= OVERCHARGE_SPEED_MULT;
                this.onClashWin?.('enemy', eProj.cells.length, { x: clashX, y: clashY });
              }

              particleSystem.addShockwave(clashX, clashY, 45, '#FFFFFF');
              particleSystem.addFloatingText(clashX, clashY - 10, 'BLOCK!', '#FFFFFF', 14);
            }
          }
        }
      }
    }
  }

  public clear() {
    this.projectiles = [];
  }
}
