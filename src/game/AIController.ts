import { GridBoard, GRID_COLS, GRID_ROWS } from './GridEngine';
import { ShapeProjectile, Cluster } from '../types/game';
import { ParticleSystem } from './ParticleSystem';
import { soundManager } from '../audio/soundManager';

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

  // Stage & Boss configuration
  public stage: number = 1;
  public isBoss: boolean = false;
  public bossSkillTimer: number = 5.0;
  public bossSkillCycle: number = 0;
  public isBossOverdrive: boolean = false;

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

    if (this.isBoss) {
      this.maxHp = 200; // 보스 체력 2배!
      this.hp = 200;
      this.radius = 26; // 보스 거대화
      this.bossSkillTimer = 4.0;
    } else {
      this.maxHp = 100;
      this.hp = 100;
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
    this.decisionTimer -= dt;
    this.launchCooldown = Math.max(0, this.launchCooldown - dt);

    const colStep = cellW + gap;
    const rowStep = cellH + gap;

    // Current grid position
    const relX = this.x - boardOriginX;
    const relY = this.y - boardOriginY;
    this.currentCol = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(relX / colStep)));
    this.currentRow = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(relY / rowStep)));

    // Stage-based AI difficulty parameters
    // Stage 1: slow, casual. Stage 4: aggressive, fast. Stage 5: Boss with all skills.
    let reactionInterval = 0.5;
    let baseMoveSpeed = 260;

    if (this.stage === 1) {
      reactionInterval = 0.8;
      baseMoveSpeed = 220;
    } else if (this.stage === 2) {
      reactionInterval = 0.55;
      baseMoveSpeed = 270;
    } else if (this.stage === 3) {
      reactionInterval = 0.4;
      baseMoveSpeed = 310;
    } else if (this.stage >= 4) {
      reactionInterval = 0.28;
      baseMoveSpeed = 350;
    }

    // Boss Omni-Skill Engine
    if (this.isBoss) {
      this.bossSkillTimer -= dt;
      if (this.bossSkillTimer <= 0) {
        this.bossSkillTimer = 4.2 + Math.random() * 2.0;
        this.triggerBossSkill(enemyBoard, particleSystem, boardOriginX, boardOriginY, onBossSniperFire);
      }
    }

    // AI Decision logic
    if (this.decisionTimer <= 0) {
      this.decisionTimer = reactionInterval + Math.random() * 0.2;

      // 1. Threat assessment: Check incoming player projectiles
      const threatenedCols = new Set<number>();
      for (const p of incomingProjectiles) {
        if (p.owner === 'player' && p.y < boardOriginY + 360) {
          for (const cell of p.cells) {
            if (cell.destroyed) continue;
            const cellWorldX = p.x + cell.relCol * colStep;
            const c = Math.floor((cellWorldX - boardOriginX + cellW / 2) / colStep);
            if (c >= 0 && c < GRID_COLS) {
              threatenedCols.add(c);
            }
          }
        }
      }

      // If current column threatened and stage >= 2, evade or intercept
      if (this.stage >= 2 && threatenedCols.has(this.currentCol)) {
        let safeCol = this.currentCol;
        if (!threatenedCols.has(this.currentCol - 1) && this.currentCol > 0) {
          safeCol = this.currentCol - 1;
        } else if (!threatenedCols.has(this.currentCol + 1) && this.currentCol < GRID_COLS - 1) {
          safeCol = this.currentCol + 1;
        }
        this.targetTile = { col: safeCol, row: Math.floor(Math.random() * 2) };
      } else {
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
            enemyBoard.discardTile(this.currentCol, this.currentRow, 0.7);
            particleSystem.addFloatingText(this.x, this.y - 20, 'AI FLUSH!', '#FF8833', 13);
          }
          this.targetTile = { col: Math.floor(Math.random() * GRID_COLS), row: Math.floor(Math.random() * GRID_ROWS) };
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

      let speed = baseMoveSpeed;
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
            const cdBase = this.isBoss ? 0.9 : this.stage >= 3 ? 1.0 : 1.5;
            this.launchCooldown = cdBase + Math.random() * 0.6;
          }
        }
      }
    }

    // Apply knockback
    this.knockbackX *= Math.exp(-dt * 12);
    this.knockbackY *= Math.exp(-dt * 12);
    this.x += this.knockbackX * dt;
    this.y += this.knockbackY * dt;

    // Bounds clamp inside Enemy Grid
    const minX = boardOriginX + this.radius;
    const maxX = boardOriginX + GRID_COLS * colStep - gap - this.radius;
    const minY = boardOriginY + this.radius;
    const maxY = boardOriginY + GRID_ROWS * rowStep - gap - this.radius;

    this.x = Math.max(minX, Math.min(maxX, this.x));
    this.y = Math.max(minY, Math.min(maxY, this.y));
  }

  // Boss executes all 7 skills across a rotation
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
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.launchCooldown = 1.2;
    this.decisionTimer = 0;
    this.targetTile = null;
    this.isBossOverdrive = false;
  }
}
