import { ArchetypeId, SkillEffect, TileColor } from '../types/game';
import {
  ARCHETYPES,
  SPEEDSTER_FIRE_BUFF_SEC,
  TRANSPORTER_SWAP_BUFF_SEC,
} from './archetypes';
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
  // v2.2 Phase 2: diegetic HP bar residual — the red ghost bar eases
  // toward hp after damage (snaps up instantly on heals).
  public displayHp: number = 100;

  public archetypeId: ArchetypeId = 'lancer';
  public skillCooldownRemaining: number = 0;
  // v2.2 balance: launch buff windows (seconds remaining, game time).
  // Transporter: +15% damage on the first launch within 1.5s of a swap.
  // Speedster: +15% speed/damage on the first launch within 1.5s of a
  // blink or dash. Consumed by GameEngine.handlePlayerLaunch / the AI
  // launch handler; the renderer draws the buff ring while active.
  public swapBuffRemaining: number = 0;
  public speedBuffRemaining: number = 0;

  // Hotfix (2026-11-21): monochrome absorb internal cooldown (seconds
  // remaining, game time). While > 0 an absorb still evaporates the
  // cluster but grants no shield — stops infinite shield farming.
  public absorbCooldownRemaining: number = 0;

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
  public dashCooldownMax: number = 1.6;
  public dashCooldownRemaining: number = 0;
  public dashDurationRemaining: number = 0;
  public isInvincible: boolean = false;
  // v2.2: collapse-push invulnerability (0.3s) is separate from the dash
  // window so it never grants the dash speed burst.
  public invincibleTimer: number = 0;
  // v2.2: 3-stack discard magazine, 1 stack recharges every 1.2s.
  public discardStacks: number = 3;
  public discardRecharge: number = 0;
  // v2.2: shrink-zone outside-wall speed penalty (x0.7), set by GameEngine.
  public externalSpeedMult: number = 1.0;
  public moveDir: { x: number; y: number } = { x: 0, y: -1 };
  // Mobile portrait joystick (analog): set by GameEngine.joystickVector.
  // Direction is pre-quantized to 8 ways by the joystick; the vector
  // length (0..1) is the stick deflection and scales movement speed.
  // Overrides the keyboard vector while active. P1 only.
  public analogMove: { x: number; y: number } | null = null;

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
    this.swapBuffRemaining = 0;
    this.speedBuffRemaining = 0;
    this.absorbCooldownRemaining = 0;
    this.grabbedTileColor = null;
    this.grabbedPos = null;
    soundManager.playSwitch();
  }

  // v2.2 core collapse: a grab on an outer (1st/9th) column can never
  // swap — swapTiles refuses locked tiles — so drop it the moment the
  // columns collapse instead of leaving a stale grab behind.
  public releaseGrabOnCollapsedColumn() {
    if (this.grabbedPos && (this.grabbedPos.col === 0 || this.grabbedPos.col === GRID_COLS - 1)) {
      this.grabbedPos = null;
      this.grabbedTileColor = null;
    }
  }

  public performDash(particleSystem: ParticleSystem): boolean {
    if (this.dashCooldownRemaining > 0) return false;
    const maxCD = this.archetypeId === 'speedster' ? 1.0 : 1.6;
    this.dashCooldownMax = maxCD;
    this.dashCooldownRemaining = maxCD;
    this.dashDurationRemaining = 0.16;
    this.isInvincible = true;
    // v2.2 balance: a speedster dash arms the 1.5s fire buff (first
    // launch after the dash gets +15% speed and +15% damage).
    if (this.archetypeId === 'speedster') {
      this.speedBuffRemaining = SPEEDSTER_FIRE_BUFF_SEC;
    }

    soundManager.playDash();
    particleSystem.addShockwave(this.x, this.y, 75, '#00FFAA');
    particleSystem.addFloatingText(this.x, this.y - 30, 'DASH!', '#00FFAA', 15);
    return true;
  }

  public discardCurrentTile(board: GridBoard, particleSystem: ParticleSystem): boolean {
    if (this.discardStacks <= 0) return false;
    const success = board.discardTile(this.currentCol, this.currentRow);
    if (success) {
      this.discardStacks -= 1;
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
      particleSystem.addFloatingText(this.x, this.y - 25, 'FLUSH', '#33CCFF', 14);
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
    // v2.2 balance: launch buff windows tick down with game time.
    if (this.swapBuffRemaining > 0) {
      this.swapBuffRemaining = Math.max(0, this.swapBuffRemaining - dt);
    }
    if (this.speedBuffRemaining > 0) {
      this.speedBuffRemaining = Math.max(0, this.speedBuffRemaining - dt);
    }
    // v2.2 Phase 2: the red residual bar on the diegetic HP bar eases
    // down toward real HP (45 HP/s); heals snap it up at once.
    if (this.displayHp > this.hp) {
      this.displayHp = Math.max(this.hp, this.displayHp - dt * 45);
    } else {
      this.displayHp = this.hp;
    }
    if (this.dashCooldownRemaining > 0) {
      this.dashCooldownRemaining = Math.max(0, this.dashCooldownRemaining - dt);
    }
    if (this.dashDurationRemaining > 0) {
      this.dashDurationRemaining = Math.max(0, this.dashDurationRemaining - dt);
    }
    if (this.absorbCooldownRemaining > 0) {
      this.absorbCooldownRemaining = Math.max(0, this.absorbCooldownRemaining - dt);
    }
    if (this.invincibleTimer > 0) {
      this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    }
    this.isInvincible = this.dashDurationRemaining > 0 || this.invincibleTimer > 0;
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    }
    if (this.slowTimer > 0) {
      this.slowTimer = Math.max(0, this.slowTimer - dt);
    }
    // v2.2 balance: the remote copy's launch buff windows tick the same way.
    if (this.swapBuffRemaining > 0) {
      this.swapBuffRemaining = Math.max(0, this.swapBuffRemaining - dt);
    }
    if (this.speedBuffRemaining > 0) {
      this.speedBuffRemaining = Math.max(0, this.speedBuffRemaining - dt);
    }
    // v2.2 discard magazine recharge: 1 stack per 1.2s.
    if (this.discardStacks < 3) {
      this.discardRecharge += dt;
      if (this.discardRecharge >= 1.2) {
        this.discardRecharge -= 1.2;
        this.discardStacks = Math.min(3, this.discardStacks + 1);
      }
    } else {
      this.discardRecharge = 0;
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
    let baseSpeed = 420;
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

    // Shrink zone: outside the wall the character slows to x0.7.
    if (this.externalSpeedMult !== 1.0) {
      baseSpeed *= this.externalSpeedMult;
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

    // Analog joystick input (mobile portrait controls): overrides the
    // keyboard vector. Direction is pre-quantized to 8 ways by the
    // joystick; the vector length (0..1) scales movement speed.
    let speedScale = 1;
    if (this.analogMove) {
      const mag = Math.hypot(this.analogMove.x, this.analogMove.y);
      if (mag >= 0.15) {
        const clamped = Math.min(1, mag);
        moveX = this.analogMove.x / mag;
        moveY = this.analogMove.y / mag;
        speedScale = clamped;
      }
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

    // Joystick deflection scales the (possibly dashed) speed.
    baseSpeed *= speedScale;

    // Apply knockback decay
    this.knockbackX *= Math.exp(-dt * 12);
    this.knockbackY *= Math.exp(-dt * 12);

    this.vx = finalMoveX * baseSpeed + this.knockbackX;
    this.vy = finalMoveY * baseSpeed + this.knockbackY;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Clamp to player board boundaries (collapsed boards lose the outer
    // columns, so the playable range shrinks with them).
    const colRange = board.colRange();
    const minX = boardOriginX + colRange.min * colStep + this.radius;
    const maxX = boardOriginX + (colRange.max + 1) * colStep - gap - this.radius;
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
    }
    if (this.absorbCooldownRemaining > 0) {
      this.absorbCooldownRemaining = Math.max(0, this.absorbCooldownRemaining - dt);
    }
    if (this.invincibleTimer > 0) {
      this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    }
    this.isInvincible = this.dashDurationRemaining > 0 || this.invincibleTimer > 0;
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    }
    if (this.slowTimer > 0) {
      this.slowTimer = Math.max(0, this.slowTimer - dt);
    }
    // v2.2 balance: the remote copy's launch buff windows tick the same way.
    if (this.swapBuffRemaining > 0) {
      this.swapBuffRemaining = Math.max(0, this.swapBuffRemaining - dt);
    }
    if (this.speedBuffRemaining > 0) {
      this.speedBuffRemaining = Math.max(0, this.speedBuffRemaining - dt);
    }
    // v2.2 discard magazine recharge (remote peer copy ticks the same way).
    if (this.discardStacks < 3) {
      this.discardRecharge += dt;
      if (this.discardRecharge >= 1.2) {
        this.discardRecharge -= 1.2;
        this.discardStacks = Math.min(3, this.discardStacks + 1);
      }
    } else {
      this.discardRecharge = 0;
    }
  }

  // Trigger Active Skill.
  // `effect`: when applying a skill received from the remote player, the
  // exact random outcome the sender rolled. Passed through for wave and
  // monochrome so the remote board changes identically instead of rolling
  // again. Omit it (local play, AI) to roll and record lastSkillEffect.
  // `blinkDir`: the sender's movement direction for a speedster blink
  // (online only — local play uses this.moveDir). Without it the remote
  // copy would blink in its own stale direction.
  public triggerSkill(
    board: GridBoard,
    particleSystem: ParticleSystem,
    boardOriginX: number,
    boardOriginY: number,
    cellW: number,
    cellH: number,
    gap: number,
    onSniperFire?: () => void,
    effect?: SkillEffect | null,
    blinkDirParam?: { x: number; y: number } | null
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
          // v2.2 balance: swap-link bonus — the first launch within 1.5s
          // deals +15% damage (purple ring around the character).
          this.swapBuffRemaining = TRANSPORTER_SWAP_BUFF_SEC;
          this.grabbedPos = null;
          this.grabbedTileColor = null;
          this.skillCooldownRemaining = config.skillCooldown;
          return true;
        }
        return false;
      }
      case 'speedster': {
        // Hotfix (2026-11-21): blink along the current movement direction
        // (blinkDir from the skill packet online; otherwise this.moveDir —
        // updated on every movement input, so it is the last moved
        // direction when standing still, and the forward direction
        // initially). The old code always blinked straight up (P1) / down
        // (P2), ignoring the direction keys.
        const blinkDir = blinkDirParam ?? this.moveDir;
        const blinkDist = 110;
        const rowStep = cellH + gap;
        const colStep = cellW + gap;
        const range = board.colRange();
        const minX = boardOriginX + range.min * colStep + this.radius;
        const maxX = boardOriginX + (range.max + 1) * colStep - gap - this.radius;
        const minY = boardOriginY + this.radius;
        const maxY = boardOriginY + GRID_ROWS * rowStep - gap - this.radius;
        this.x = Math.max(minX, Math.min(maxX, this.x + blinkDir.x * blinkDist));
        this.y = Math.max(minY, Math.min(maxY, this.y + blinkDir.y * blinkDist));
        this.currentCol = Math.max(0, Math.min(GRID_COLS - 1, Math.floor((this.x - boardOriginX) / colStep)));
        this.currentRow = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor((this.y - boardOriginY) / rowStep)));

        const tile = board.tiles[this.currentRow]?.[this.currentCol];
        // A locked (collapsed / shrink-wall) landing tile must not turn
        // yellow and its cooldown must not clear — the blink itself
        // still moves, only the tile effect is skipped.
        if (tile && !board.isTileLocked(this.currentCol, this.currentRow)) {
          tile.cooldownRemaining = 0;
          tile.cooldownMax = 0;
          tile.color = 'yellow';
        }
        particleSystem.addFloatingText(this.x, this.y - 30, 'BLINK CHARGE!', '#FFCC00', 16);
        particleSystem.addShockwave(this.x, this.y, 110, '#FFCC00');
        // v2.2 balance: blink arms the 1.5s fire buff (first launch after
        // the blink gets +15% speed and +15% damage).
        this.speedBuffRemaining = SPEEDSTER_FIRE_BUFF_SEC;
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
    // Dash, collapse-push, and the 0.15s consecutive-hit protection all
    // block damage. invincibleTimer is checked directly (not just the
    // isInvincible flag) so protection set mid-frame works immediately.
    if (this.isInvincible || this.invincibleTimer > 0) {
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
    this.displayHp = 100;
    this.shield = 0;
    this.skillCooldownRemaining = 0;
    this.swapBuffRemaining = 0;
    this.speedBuffRemaining = 0;
    this.absorbCooldownRemaining = 0;
    this.dashCooldownRemaining = 0;
    this.dashDurationRemaining = 0;
    this.isInvincible = false;
    this.invincibleTimer = 0;
    this.discardStacks = 3;
    this.discardRecharge = 0;
    this.externalSpeedMult = 1.0;
    this.slowTimer = 0;
    this.hitFlashTimer = 0;
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.analogMove = null;
    this.grabbedPos = null;
    this.grabbedTileColor = null;
    this.overdriveActive = false;
  }
}
