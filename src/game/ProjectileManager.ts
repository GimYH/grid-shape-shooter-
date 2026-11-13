import {
  ShapeProjectile,
  ProjectileCell,
  TileColor,
  ShapePatternType,
  Cluster,
} from '../types/game';
import { ParticleSystem } from './ParticleSystem';
import { soundManager } from '../audio/soundManager';
import { COLOR_HEX } from './GridEngine';

export class ProjectileManager {
  public projectiles: ShapeProjectile[] = [];

  public createProjectile(
    owner: 'player' | 'enemy',
    cluster: Cluster,
    boardOriginX: number,
    boardOriginY: number,
    cellW: number,
    cellH: number,
    gap: number,
    archetypeId: string,
    overdriveActive: boolean = false
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
    let sizeDmgMult = 1.0;

    if (count >= 9) {
      baseHp = 3;
      sizeDmgMult = 2.0;
    } else if (count >= 6) {
      baseHp = 2;
      sizeDmgMult = 1.5;
    }

    // Blue color doubles durability
    if (cluster.color === 'blue') {
      baseHp *= 2;
    }

    // Archetype modifier: Lancer vertical spear gets +1 cell HP
    if (archetypeId === 'lancer' && cluster.shapeType === 'spear') {
      baseHp += 1;
    }

    // Calculate base damage per cell
    let baseDmg = cluster.color === 'red' ? 4 : 3;
    if (archetypeId === 'monochrome' && cluster.color === 'red') {
      baseDmg *= 2.0; // Monochrome passive
    }
    if (overdriveActive) {
      baseDmg *= 1.5;
    }
    const finalDmg = Math.round(baseDmg * sizeDmgMult);

    // Calculate speed
    let speedMult = 1.0;
    if (cluster.color === 'red') speedMult = 1.3;
    else if (cluster.color === 'blue') speedMult = 0.6;
    else if (cluster.color === 'yellow') speedMult = 1.0;

    if (cluster.shapeType === 'spear') {
      speedMult *= (archetypeId === 'lancer' ? 2.0 : 1.8);
    }
    if (cluster.shapeType === 'wall' && archetypeId === 'wave') {
      speedMult *= 2.0;
    }

    const baseVy = 440; // px/s
    const vy = owner === 'player' ? -baseVy * speedMult : baseVy * speedMult;

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
      x: anchorX,
      y: anchorY,
      vx: 0,
      vy,
      cellWidth: cellW,
      cellHeight: cellH,
      cells,
      damagePerCell: finalDmg,
      speedMultiplier: speedMult,
      glowColor: COLOR_HEX[cluster.color],
      trailTimer: 0,
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
    const y = boardOriginY + (owner === 'player' ? 0 : 3 * (cellH + gap));
    const vy = owner === 'player' ? -800 : 800;

    const proj: ShapeProjectile = {
      id: `sniper_beam_${Date.now()}`,
      owner,
      color: 'yellow',
      shapeType: 'spear',
      x,
      y,
      vx: 0,
      vy,
      cellWidth: cellW,
      cellHeight: cellH,
      cells: [{ relCol: 0, relRow: 0, hp: 2, maxHp: 2, destroyed: false }],
      damagePerCell: 12,
      speedMultiplier: 2.2,
      glowColor: '#00FFAA',
      trailTimer: 0,
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
    const gap = 8;

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
    const gap = 8;
    const playerProjs = this.projectiles.filter((p) => p.owner === 'player');
    const enemyProjs = this.projectiles.filter((p) => p.owner === 'enemy');

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

              // Exchange damage
              const pDamageToTake = eCell.hp;
              const eDamageToTake = pCell.hp;

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
