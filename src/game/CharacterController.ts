import { ArchetypeId, SkillEffect, TileColor } from '../types/game';
import { ARCHETYPES } from './archetypes';
import { GridBoard, GRID_COLS, GRID_ROWS } from './GridEngine';
import { ParticleSystem } from './ParticleSystem';
import { soundManager } from '../audio/soundManager';

export class PlayerCharacter {
  public x: number = 0;
  public y: number = 0;
  public vx: number = 0;
  public vy: number = 0;
  public radius: number = 22;

  public hp: number = 100;
  public maxHp: number = 100;
  public shield: number = 0;

  public archetypeId: ArchetypeId = 'lancer';
  public skillCooldownRemaining: number = 0;

  public currentCol: number = 3;
  public currentRow: number = 2;

  public hitFlashTimer: number = 0;
  public slowTimer: number = 0;
  public knockbackX: number = 0;
  public knockbackY: number = 0;

  // Archetype specific state
  public grabbedTileColor: TileColor | null = null; // Transporter
  public grabbedPos: { col: number; row: number } | null = null;
  public overdriveActive: boolean = false; // Monochrome
  // Result of the last random skill effect (wave/monochrome). GameEngine
  // reads this right after triggerSkill and carries it in the skill packet
  // so the remote side applies the same tiles. Null for other archetypes
  // and for remote-applied skills.
  public lastSkillEffect: SkillEffect | null = null;

  public isPlayer2: boolean = false;

  // Dash System
  public dashCooldownMax: number = 2.5;
  public dashCooldownRemaining: number = 0;
  public dashDurationRemaining: number = 0;
  public isInvincible: boolean = false;
  public moveDir: { x: number; y: number } = { x: 0, y: -1 };

  // Remote smooth interpolation targets
  public targetX: number = 0;
  public targetY: number = 0;

  constructor(initialX: number, initialY: number, isPlayer2: boolean = false) {
    this.x = initialX;
    this.y = initialY;
    this.targetX = initialX;
    this.targetY = initialY;
    this.isPlayer2 = isPlayer2;
    this.moveDir = { x: 0, y: isPlayer2 ? 1 : -1 };
  }

  public setArchetype(newArchetype: ArchetypeId) {
    if (this.archetypeId === newArchetype) return;
    this.archetypeId = newArchetype;
    this.skillCooldownRemaining = 0;
    this.grabbedTileColor = null;
    this.grabbedPos = null;
    soundManager.playSwitch();
  }

  public performDash(particleSystem: ParticleSystem): boolean {
    if (this.dashCooldownRemaining > 0) return false;
    const maxCD = this.archetypeId === 'speedster' ? 1.5 : 2.5;
    this.dashCooldownMax = maxCD;
    this.dashCooldownRemaining = maxCD;
    this.dashDurationRemaining = 0.16;
    this.isInvincible = true;

    soundManager.playDash();
    particleSystem.addShockwave(this.x, this.y, 75, '#00FFAA');
    particleSystem.addFloatingText(this.x, this.y - 30, 'DASH!', '#00FFAA', 15);
    return true;
  }

  public discardCurrentTile(board: GridBoard, particleSystem: ParticleSystem): boolean {
    const success = board.discardTile(this.currentCol, this.currentRow, 0.7);
    if (success) {
      // If the Transporter discarded the tile it was holding, clear the grab
      // so a later swap cannot target an empty (stale) tile.
      if (
        this.grabbedPos &&
        this.grabbedPos.col === this.currentCol &&
        this.grabbedPos.row === this.currentRow
      ) {
        this.grabbedPos = null;
        this.grabbedTileColor = null;
      }
      soundManager.playDiscard();
      particleSystem.emitBlockDestruction(this.x, this.y, '#33CCFF', 8);
      particleSystem.addFloatingText(this.x, this.y - 25, 'FLUSH (0.7s)', '#33CCFF', 14);
      return true;
    }
    return false;
  }

  public setRemotePosition(targetX: number, targetY: number, col: number, row: number) {
    this.targetX = targetX;
    this.targetY = targetY;
    this.currentCol = Math.max(0, Math.min(GRID_COLS - 1, col));
    this.currentRow = Math.max(0, Math.min(GRID_ROWS - 1, row));
  }

  public update(
    dt: number,
    keys: Record<string, boolean>,
    boardOriginX: number,
    boardOriginY: number,
    cellW: number,
    cellH: number,
    gap: number,
    board: GridBoard,
    isLocalMulti: boolean = false
  ) {
    const config = ARCHETYPES[this.archetypeId];

    // Update timers
    if (this.skillCooldownRemaining > 0) {
      this.skillCooldownRemaining = Math.max(0, this.skillCooldownRemaining - dt);
    }
    if (this.dashCooldownRemaining > 0) {
      this.dashCooldownRemaining = Math.max(0, this.dashCooldownRemaining - dt);
    }
    if (this.dashDurationRemaining > 0) {
      this.dashDurationRemaining = Math.max(0, this.dashDurationRemaining - dt);
      this.isInvincible = true;
    } else {
      this.isInvincible = false;
    }
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    }
    if (this.slowTimer > 0) {
      this.slowTimer = Math.max(0, this.slowTimer - dt);
    }

    // Determine current grid cell under feet
    const relX = this.x - boardOriginX;
    const relY = this.y - boardOriginY;
    const colStep = cellW + gap;
    const rowStep = cellH + gap;

    this.currentCol = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(relX / colStep)));
    this.currentRow = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(relY / rowStep)));

    const currentTile = board.tiles[this.currentRow]?.[this.currentCol];

    // Calculate movement speed
    let baseSpeed = 340;
    if (this.archetypeId === 'transporter') {
      baseSpeed *= 1.15; // +15% passive
    }

    // On cooldown tile: -30% slow
    if (currentTile && currentTile.color === null) {
      baseSpeed *= 0.7;
    }

    // Speedster on yellow tile: +60% speed
    if (this.archetypeId === 'speedster' && currentTile && currentTile.color === 'yellow') {
      baseSpeed *= 1.6;
    }

    // Yellow hit slow: -40% speed
    if (this.slowTimer > 0) {
      baseSpeed *= 0.6;
    }

    // Input movement vector.
    // Local 2P: P1 uses WASD only, P2 uses Arrow keys only, so the two
    // characters never move together. Single/online: P1 accepts both.
    let moveX = 0;
    let moveY = 0;

    if (isLocalMulti) {
      if (!this.isPlayer2) {
        if (keys['KeyW']) moveY -= 1;
        if (keys['KeyS']) moveY += 1;
        if (keys['KeyA']) moveX -= 1;
        if (keys['KeyD']) moveX += 1;
      } else {
        if (keys['ArrowUp']) moveY -= 1;
        if (keys['ArrowDown']) moveY += 1;
        if (keys['ArrowLeft']) moveX -= 1;
        if (keys['ArrowRight']) moveX += 1;
      }
    } else if (!this.isPlayer2) {
      if (keys['ArrowUp'] || keys['KeyW']) moveY -= 1;
      if (keys['ArrowDown'] || keys['KeyS']) moveY += 1;
      if (keys['ArrowLeft'] || keys['KeyA']) moveX -= 1;
      if (keys['ArrowRight'] || keys['KeyD']) moveX += 1;
    }

    // Normalize and track facing direction
    const len = Math.hypot(moveX, moveY);
    if (len > 0) {
      moveX /= len;
      moveY /= len;
      this.moveDir = { x: moveX, y: moveY };
    }

    // If dashing, override speed with 3.5x burst in moveDir!
    let finalMoveX = moveX;
    let finalMoveY = moveY;
    if (this.dashDurationRemaining > 0) {
      baseSpeed *= 3.5;
      finalMoveX = this.moveDir.x;
      finalMoveY = this.moveDir.y;
    }

    // Apply knockback decay
    this.knockbackX *= Math.exp(-dt * 12);
    this.knockbackY *= Math.exp(-dt * 12);

    this.vx = finalMoveX * baseSpeed + this.knockbackX;
    this.vy = finalMoveY * baseSpeed + this.knockbackY;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Clamp to player board boundaries
    const minX = boardOriginX + this.radius;
    const maxX = boardOriginX + GRID_COLS * colStep - gap - this.radius;
    const minY = boardOriginY + this.radius;
    const maxY = boardOriginY + GRID_ROWS * rowStep - gap - this.radius;

    this.x = Math.max(minX, Math.min(maxX, this.x));
    this.y = Math.max(minY, Math.min(maxY, this.y));
  }

  // Update remote peer state (smooth 60fps lerp and timers)
  public updateRemote(dt: number) {
    if (this.targetX !== 0 || this.targetY !== 0) {
      const dist = Math.hypot(this.targetX - this.x, this.targetY - this.y);
      if (dist > 180) {
        // Teleport on large jumps (spawn, blink) instead of dragging across
        // the board with a slow lerp.
        this.x = this.targetX;
        this.y = this.targetY;
      } else {
        const lerpSpeed = Math.min(1.0, dt * 24);
        this.x += (this.targetX - this.x) * lerpSpeed;
        this.y += (this.targetY - this.y) * lerpSpeed;
      }
    }

    if (this.dashCooldownRemaining > 0) {
      this.dashCooldownRemaining = Math.max(0, this.dashCooldownRemaining - dt);
    }
    if (this.dashDurationRemaining > 0) {
      this.dashDurationRemaining = Math.max(0, this.dashDurationRemaining - dt);
      this.isInvincible = true;
    } else {
      this.isInvincible = false;
    }
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    }
    if (this.slowTimer > 0) {
      this.slowTimer = Math.max(0, this.slowTimer - dt);
    }
  }

  // Trigger Active Skill.
  // `effect`: when applying a skill received from the remote player, the
  // exact random outcome the sender rolled. Passed through for wave and
  // monochrome so the remote board changes identically instead of rolling
  // again. Omit it (local play, AI) to roll and record lastSkillEffect.
  public triggerSkill(
    board: GridBoard,
    particleSystem: ParticleSystem,
    boardOriginX: number,
    boardOriginY: number,
    cellW: number,
    cellH: number,
    gap: number,
    onSniperFire?: () => void,
    effect?: SkillEffect | null
  ): boolean {
    if (this.skillCooldownRemaining > 0) return false;
    this.lastSkillEffect = null;

    const config = ARCHETYPES[this.archetypeId];
    soundManager.playSkill(this.archetypeId);

    switch (this.archetypeId) {
      case 'lancer': {
        // Convert 2 tiles in current column to Red
        board.convertColumnToRed(this.currentCol, 2);
        particleSystem.addFloatingText(this.x, this.y - 30, 'CRIMSON LANCE!', '#FF3366', 16);
        particleSystem.addShockwave(this.x, this.y, 80, '#FF3366');
        this.skillCooldownRemaining = config.skillCooldown;
        return true;
      }
      case 'wave': {
        // Refill all cooldown tiles in current row
        if (effect?.kind === 'wave') {
          board.refillRowWith(this.currentRow, effect.tiles);
        } else {
          this.lastSkillEffect = { kind: 'wave', tiles: board.refillRow(this.currentRow) };
        }
        particleSystem.addFloatingText(this.x, this.y - 30, 'TIDE SURGE!', '#33CCFF', 16);
        particleSystem.addShockwave(this.x, this.y, 100, '#33CCFF');
        this.skillCooldownRemaining = config.skillCooldown;
        return true;
      }
      case 'sniper': {
        // Instant Piercing Beam down column towards frontline
        const targetBeamY = this.isPlayer2 ? this.y + 600 : this.y - 600;
        particleSystem.addLaserBeam(
          this.x,
          this.y,
          this.x,
          targetBeamY,
          '#00FFAA',
          18
        );
        particleSystem.addFloatingText(this.x, this.y - 30, 'PIERCING BEAM!', '#00FFAA', 16);
        if (onSniperFire) onSniperFire();
        this.skillCooldownRemaining = config.skillCooldown;
        return true;
      }
      case 'painter': {
        // Paint adjacent to dominant color
        board.paintAdjacentDominant(this.currentCol, this.currentRow);
        particleSystem.addFloatingText(this.x, this.y - 30, 'CHROMA INFUSION!', '#FF8800', 16);
        particleSystem.addShockwave(this.x, this.y, 90, '#FF8800');
        this.skillCooldownRemaining = config.skillCooldown;
        return true;
      }
      case 'transporter': {
        const currentTile = board.tiles[this.currentRow]?.[this.currentCol];
        // A grab goes stale if its tile was launched/discarded meanwhile.
        // Drop it and treat this press as a fresh grab instead of swapping
        // an empty tile.
        if (this.grabbedPos) {
          const grabbedTile = board.tiles[this.grabbedPos.row]?.[this.grabbedPos.col];
          if (!grabbedTile || !grabbedTile.color) {
            this.grabbedPos = null;
            this.grabbedTileColor = null;
          }
        }
        if (!this.grabbedPos) {
          // 1st press: Grab tile
          if (currentTile && currentTile.color) {
            this.grabbedTileColor = currentTile.color;
            this.grabbedPos = { col: this.currentCol, row: this.currentRow };
            particleSystem.addFloatingText(this.x, this.y - 30, 'TILE GRABBED!', '#B57EDC', 15);
            return true;
          }
        } else {
          // Pressing on the same tile cancels the grab (no cooldown spent).
          // Returns false, and GameEngine relays the cancel online so the
          // remote copy drops its grab too.
          if (this.grabbedPos.col === this.currentCol && this.grabbedPos.row === this.currentRow) {
            this.grabbedPos = null;
            this.grabbedTileColor = null;
            particleSystem.addFloatingText(this.x, this.y - 30, 'GRAB CANCELED', '#94A3B8', 13);
            return false;
          }
          // 2nd press: Swap with current tile
          board.swapTiles(
            this.grabbedPos.col,
            this.grabbedPos.row,
            this.currentCol,
            this.currentRow
          );
          particleSystem.addFloatingText(this.x, this.y - 30, 'QUANTUM SWAP!', '#B57EDC', 16);
          particleSystem.addShockwave(this.x, this.y, 80, '#B57EDC');
          this.grabbedPos = null;
          this.grabbedTileColor = null;
          this.skillCooldownRemaining = config.skillCooldown;
          return true;
        }
        return false;
      }
      case 'speedster': {
        // Blink forward toward front line (clamped within board boundaries)
        const blinkDist = this.isPlayer2 ? 110 : -110;
        const rowStep = cellH + gap;
        const minY = boardOriginY + this.radius;
        const maxY = boardOriginY + GRID_ROWS * rowStep - gap - this.radius;
        this.y = Math.max(minY, Math.min(maxY, this.y + blinkDist));
        this.currentRow = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor((this.y - boardOriginY) / rowStep)));

        const tile = board.tiles[this.currentRow]?.[this.currentCol];
        if (tile) {
          tile.cooldownRemaining = 0;
          tile.color = 'yellow';
        }
        particleSystem.addFloatingText(this.x, this.y - 30, 'BLINK CHARGE!', '#FFCC00', 16);
        particleSystem.addShockwave(this.x, this.y, 110, '#FFCC00');
        this.skillCooldownRemaining = config.skillCooldown;
        return true;
      }
      case 'monochrome': {
        // Overdrive: 3 tiles to red + 1.5x damage boost
        if (effect?.kind === 'monochrome') {
          board.convertTilesToRed(effect.tiles);
        } else {
          this.lastSkillEffect = { kind: 'monochrome', tiles: board.convertRandomToRed(3) };
        }
        this.overdriveActive = true;
        particleSystem.addFloatingText(this.x, this.y - 30, 'BLOOD OVERDRIVE!', '#FF0033', 18);
        particleSystem.addShockwave(this.x, this.y, 120, '#FF0033');
        this.skillCooldownRemaining = config.skillCooldown;
        return true;
      }
    }
    return false;
  }

  public takeDamage(amount: number, isDirect: boolean = true) {
    if (this.isInvincible) {
      // Evaded attack during dash!
      return;
    }

    if (this.shield > 0) {
      if (this.shield >= amount) {
        this.shield -= amount;
        return;
      } else {
        amount -= this.shield;
        this.shield = 0;
      }
    }
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlashTimer = 0.2;
    soundManager.playHit(isDirect);
  }

  public reset(startX: number, startY: number) {
    this.x = startX;
    this.y = startY;
    this.targetX = startX;
    this.targetY = startY;
    this.vx = 0;
    this.vy = 0;
    this.hp = 100;
    this.shield = 0;
    this.skillCooldownRemaining = 0;
    this.dashCooldownRemaining = 0;
    this.dashDurationRemaining = 0;
    this.isInvincible = false;
    this.slowTimer = 0;
    this.hitFlashTimer = 0;
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.grabbedPos = null;
    this.grabbedTileColor = null;
    this.overdriveActive = false;
  }
}
