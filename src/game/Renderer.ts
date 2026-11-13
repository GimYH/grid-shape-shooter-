import { GridBoard, GRID_COLS, GRID_ROWS, COLOR_HEX } from './GridEngine';
import { PlayerCharacter } from './CharacterController';
import { AIController } from './AIController';
import { ProjectileManager } from './ProjectileManager';
import { ParticleSystem } from './ParticleSystem';
import { ARCHETYPES } from './archetypes';

export class CanvasRenderer {
  public canvasWidth = 1920;
  public canvasHeight = 1080;

  // Board layout geometry
  public cellW = 124;
  public cellH = 68;
  public gap = 8;

  // Board physical bounds
  public enemyOriginX = 0;
  public enemyOriginY = 90;

  public neutralZoneY = 410;
  public neutralZoneHeight = 220;

  public playerOriginX = 0;
  public playerOriginY = 660;

  constructor() {
    const totalGridW = GRID_COLS * this.cellW + (GRID_COLS - 1) * this.gap;
    // Center grids horizontally in the 1920 canvas
    this.enemyOriginX = Math.round((this.canvasWidth - totalGridW) / 2);
    this.playerOriginX = this.enemyOriginX;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    playerBoard: GridBoard,
    enemyBoard: GridBoard,
    player: PlayerCharacter,
    enemy: AIController,
    player2: PlayerCharacter | null,
    projectileMgr: ProjectileManager,
    particleSystem: ParticleSystem,
    screenShake: number,
    gameTime: number
  ) {
    ctx.save();

    // Apply Screen Shake
    if (screenShake > 0) {
      const sx = (Math.random() - 0.5) * screenShake * 16;
      const sy = (Math.random() - 0.5) * screenShake * 16;
      ctx.translate(sx, sy);
    }

    // 1. Background
    this.renderBackground(ctx, gameTime);

    // 2. Neutral Clash Zone
    this.renderNeutralZone(ctx, gameTime);

    // 3. Enemy Grid
    const opponentCol = player2 ? player2.currentCol : enemy.currentCol;
    const opponentRow = player2 ? player2.currentRow : enemy.currentRow;
    this.renderGrid(ctx, enemyBoard, this.enemyOriginX, this.enemyOriginY, 'enemy', opponentCol, opponentRow);

    // 4. Player Grid
    this.renderGrid(ctx, playerBoard, this.playerOriginX, this.playerOriginY, 'player', player.currentCol, player.currentRow);

    // 5. Lasers
    this.renderLasers(ctx, particleSystem);

    // 6. Projectiles
    this.renderProjectiles(ctx, projectileMgr, gameTime);

    // 7. Characters
    if (player2) {
      this.renderPlayer(ctx, player2, gameTime);
    } else {
      this.renderEnemy(ctx, enemy, gameTime);
    }
    this.renderPlayer(ctx, player, gameTime);

    // 8. Shockwaves & Particles
    this.renderShockwaves(ctx, particleSystem);
    this.renderParticles(ctx, particleSystem);

    // 9. Floating Combat Text
    this.renderFloatingTexts(ctx, particleSystem);

    ctx.restore();
  }

  private renderBackground(ctx: CanvasRenderingContext2D, time: number) {
    // Deep sci-fi radial gradient
    const bgGrad = ctx.createRadialGradient(
      this.canvasWidth / 2,
      this.canvasHeight / 2,
      100,
      this.canvasWidth / 2,
      this.canvasHeight / 2,
      1100
    );
    bgGrad.addColorStop(0, '#0c1222');
    bgGrad.addColorStop(0.6, '#070a14');
    bgGrad.addColorStop(1, '#03050a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Subtle perspective grid lines
    ctx.strokeStyle = 'rgba(40, 70, 110, 0.12)';
    ctx.lineWidth = 1;

    const gridSize = 48;
    const offset = (time * 20) % gridSize;

    ctx.beginPath();
    for (let x = 0; x <= this.canvasWidth; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvasHeight);
    }
    for (let y = 0; y <= this.canvasHeight; y += gridSize) {
      ctx.moveTo(0, y + offset);
      ctx.lineTo(this.canvasWidth, y + offset);
    }
    ctx.stroke();
  }

  private renderNeutralZone(ctx: CanvasRenderingContext2D, time: number) {
    const totalW = GRID_COLS * this.cellW + (GRID_COLS - 1) * this.gap;
    const x = this.enemyOriginX;
    const y = this.neutralZoneY;
    const h = this.neutralZoneHeight;

    // Glowing boundary box
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.strokeStyle = 'rgba(100, 140, 200, 0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 12, y, totalW + 24, h);
    ctx.fillRect(x - 12, y, totalW + 24, h);

    // Center collision line
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(255, 200, 50, 0.35)';
    ctx.beginPath();
    ctx.moveTo(x - 12, y + h / 2);
    ctx.lineTo(x + totalW + 12, y + h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Neutral zone watermark
    ctx.font = '700 13px "Chakra Petch", monospace';
    ctx.fillStyle = 'rgba(180, 210, 255, 0.3)';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ NEUTRAL CLASH ZONE · BLOCK-TO-BLOCK COLLISION ⚡', this.canvasWidth / 2, y + h / 2 + 5);

    // Column guides across neutral zone
    ctx.strokeStyle = 'rgba(50, 80, 130, 0.1)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= GRID_COLS; c++) {
      const colX = x + c * (this.cellW + this.gap) - this.gap / 2;
      ctx.beginPath();
      ctx.moveTo(colX, y);
      ctx.lineTo(colX, y + h);
      ctx.stroke();
    }

    ctx.restore();
  }

  private renderGrid(
    ctx: CanvasRenderingContext2D,
    board: GridBoard,
    originX: number,
    originY: number,
    owner: 'player' | 'enemy',
    currentCol: number,
    currentRow: number
  ) {
    const totalW = GRID_COLS * this.cellW + (GRID_COLS - 1) * this.gap;
    const totalH = GRID_ROWS * this.cellH + (GRID_ROWS - 1) * this.gap;

    ctx.save();

    // Board container border
    ctx.strokeStyle = owner === 'player' ? 'rgba(0, 255, 170, 0.35)' : 'rgba(255, 51, 102, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(originX - 10, originY - 10, totalW + 20, totalH + 20);

    // Board title tag
    ctx.font = '700 12px "Chakra Petch", monospace';
    ctx.fillStyle = owner === 'player' ? '#00FFAA' : '#FF3366';
    ctx.textAlign = 'left';
    ctx.fillText(
      owner === 'player' ? '● PLAYER GRID (8x4)' : '▲ ENEMY HOSTILE GRID (8x4)',
      originX,
      originY - 18
    );

    // Render individual tiles
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const tile = board.tiles[r][c];
        const tx = originX + c * (this.cellW + this.gap);
        const ty = originY + r * (this.cellH + this.gap);

        // Find if this tile belongs to an active cluster
        const cluster = board.getClusterAt(c, r);
        const isActivePad = cluster ? cluster.isActivePad : false;

        this.renderTile(
          ctx,
          tx,
          ty,
          this.cellW,
          this.cellH,
          tile.color,
          tile.cooldownRemaining,
          isActivePad,
          c === currentCol && r === currentRow,
          tile.pulsePhase,
          cluster?.shapeType
        );
      }
    }

    // Draw active cluster connection borders
    this.renderClusterOutlines(ctx, board, originX, originY);

    ctx.restore();
  }

  private renderTile(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    color: 'red' | 'blue' | 'yellow' | null,
    cooldownRemaining: number,
    isActivePad: boolean,
    isHovered: boolean,
    pulsePhase: number,
    shapeType?: string
  ) {
    const radius = 8;

    // Cooldown tile state
    if (!color) {
      ctx.fillStyle = 'rgba(20, 25, 38, 0.8)';
      ctx.strokeStyle = 'rgba(50, 60, 80, 0.4)';
      ctx.lineWidth = 1.5;
      this.drawRoundedRect(ctx, x, y, w, h, radius);
      ctx.fill();
      ctx.stroke();

      // Circular reload progress
      const progress = Math.max(0, Math.min(1, 1 - cooldownRemaining / 2.0));
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.strokeStyle = 'rgba(100, 120, 160, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(150, 170, 200, 0.6)';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${cooldownRemaining.toFixed(1)}s`, cx, cy + 4);
      return;
    }

    // Active color tile
    const hex = COLOR_HEX[color];
    const pulse = 0.85 + Math.sin(pulsePhase) * 0.15;

    // Gradient fill
    const tileGrad = ctx.createLinearGradient(x, y, x, y + h);
    if (color === 'red') {
      tileGrad.addColorStop(0, `rgba(255, 51, 102, ${isActivePad ? 0.35 * pulse : 0.18})`);
      tileGrad.addColorStop(1, `rgba(180, 20, 60, ${isActivePad ? 0.45 * pulse : 0.25})`);
    } else if (color === 'blue') {
      tileGrad.addColorStop(0, `rgba(51, 204, 255, ${isActivePad ? 0.35 * pulse : 0.18})`);
      tileGrad.addColorStop(1, `rgba(20, 120, 190, ${isActivePad ? 0.45 * pulse : 0.25})`);
    } else {
      tileGrad.addColorStop(0, `rgba(255, 204, 0, ${isActivePad ? 0.35 * pulse : 0.18})`);
      tileGrad.addColorStop(1, `rgba(190, 140, 10, ${isActivePad ? 0.45 * pulse : 0.25})`);
    }

    ctx.fillStyle = tileGrad;
    ctx.strokeStyle = isActivePad ? hex : `${hex}66`;
    ctx.lineWidth = isActivePad ? (isHovered ? 3.5 : 2.5) : 1.2;

    this.drawRoundedRect(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.stroke();

    // Inner neon highlight for active pads
    if (isActivePad) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * pulse})`;
      ctx.lineWidth = 1;
      this.drawRoundedRect(ctx, x + 3, y + 3, w - 6, h - 6, radius - 2);
      ctx.stroke();
    }

    // Shape type badge icon indicator in corner
    if (isActivePad && shapeType && shapeType !== 'standard') {
      ctx.font = '700 10px "Chakra Petch", monospace';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'right';
      const label =
        shapeType === 'spear' ? '✦ SPEAR' :
        shapeType === 'wall' ? '❚ WALL' :
        shapeType === 'homing' ? '⦿ HOMING' :
        shapeType === 'meteor' ? '✸ METEOR' : '';
      ctx.fillText(label, x + w - 8, y + 16);
    }

    // Crosshair target overlay if character is standing on this tile
    if (isHovered) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      const cornerSize = 10;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(x + cornerSize, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + cornerSize);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(x + w - cornerSize, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + cornerSize);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(x, y + h - cornerSize);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + cornerSize, y + h);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(x + w, y + h - cornerSize);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w - cornerSize, y + h);
      ctx.stroke();
    }
  }

  // Draw connected bridges or border glow between active cluster tiles
  private renderClusterOutlines(
    ctx: CanvasRenderingContext2D,
    board: GridBoard,
    originX: number,
    originY: number
  ) {
    for (const cluster of board.clusters) {
      if (!cluster.isActivePad) continue;

      const hex = COLOR_HEX[cluster.color];
      ctx.strokeStyle = `${hex}CC`;
      ctx.lineWidth = 3;

      // Draw bridge lines between adjacent tiles in the same cluster
      for (const t of cluster.tiles) {
        const tx = originX + t.col * (this.cellW + this.gap) + this.cellW / 2;
        const ty = originY + t.row * (this.cellH + this.gap) + this.cellH / 2;

        // Check right
        if (cluster.tiles.some((ot) => ot.col === t.col + 1 && ot.row === t.row)) {
          const nextTx = originX + (t.col + 1) * (this.cellW + this.gap) + this.cellW / 2;
          ctx.beginPath();
          ctx.moveTo(tx + this.cellW / 2 - 4, ty);
          ctx.lineTo(nextTx - this.cellW / 2 + 4, ty);
          ctx.stroke();
        }
        // Check down
        if (cluster.tiles.some((ot) => ot.col === t.col && ot.row === t.row + 1)) {
          const nextTy = originY + (t.row + 1) * (this.cellH + this.gap) + this.cellH / 2;
          ctx.beginPath();
          ctx.moveTo(tx, ty + this.cellH / 2 - 4);
          ctx.lineTo(tx, nextTy - this.cellH / 2 + 4);
          ctx.stroke();
        }
      }
    }
  }

  private renderProjectiles(
    ctx: CanvasRenderingContext2D,
    projectileMgr: ProjectileManager,
    time: number
  ) {
    for (const p of projectileMgr.projectiles) {
      ctx.save();

      // Render each active cell in the shape
      for (const cell of p.cells) {
        if (cell.destroyed) continue;

        const cellX = p.x + cell.relCol * (p.cellWidth + this.gap);
        const cellY = p.y + cell.relRow * (p.cellHeight + this.gap);

        // Cell outer neon glow
        ctx.shadowColor = p.glowColor;
        ctx.shadowBlur = 14;

        // Cell body
        ctx.fillStyle = p.glowColor;
        this.drawRoundedRect(ctx, cellX, cellY, p.cellWidth, p.cellHeight, 6);
        ctx.fill();

        // Inner core
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFFFFF';
        this.drawRoundedRect(ctx, cellX + 4, cellY + 4, p.cellWidth - 8, p.cellHeight - 8, 4);
        ctx.fill();

        // If HP > 1, show durability count
        if (cell.hp > 1) {
          ctx.fillStyle = '#000000';
          ctx.font = '700 12px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`HP ${cell.hp}`, cellX + p.cellWidth / 2, cellY + p.cellHeight / 2 + 4);
        }
      }

      // Special shape cosmetic overlays
      if (p.shapeType === 'spear') {
        // Spear velocity trail
        ctx.strokeStyle = p.glowColor;
        ctx.lineWidth = 4;
        const tipY = p.owner === 'player' ? p.y : p.y + p.cellHeight;
        ctx.beginPath();
        ctx.moveTo(p.x + p.cellWidth / 2, tipY);
        ctx.lineTo(p.x + p.cellWidth / 2, tipY + (p.owner === 'player' ? 60 : -60));
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private renderPlayer(ctx: CanvasRenderingContext2D, player: PlayerCharacter, time: number) {
    ctx.save();
    ctx.translate(player.x, player.y);

    const config = ARCHETYPES[player.archetypeId];

    // Hit flash
    if (player.hitFlashTimer > 0) {
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 30;
    }

    // Dash i-frame ghost blur and refraction aura
    if (player.dashDurationRemaining > 0) {
      ctx.strokeStyle = '#00FFAA';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00FFAA';
      ctx.shadowBlur = 25;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 14, 0, Math.PI * 2);
      ctx.stroke();

      // Ghost trail behind move direction
      ctx.fillStyle = 'rgba(0, 255, 170, 0.35)';
      ctx.beginPath();
      ctx.arc(-player.moveDir.x * 24, -player.moveDir.y * 24, player.radius * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Overdrive flaming aura (Monochrome)
    if (player.overdriveActive) {
      ctx.strokeStyle = 'rgba(255, 0, 50, 0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 12 + Math.sin(time * 15) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Shield aura
    if (player.shield > 0) {
      ctx.strokeStyle = '#33CCFF';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Character core circle
    ctx.fillStyle = player.hitFlashTimer > 0 ? '#FFFFFF' : player.isInvincible ? '#00FFAA' : config.color;
    ctx.shadowColor = player.isInvincible ? '#00FFAA' : config.color;
    ctx.shadowBlur = player.isInvincible ? 24 : 18;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();

    // Directional chevron / arrow pointing direction
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    if (!player.isPlayer2) {
      ctx.moveTo(0, -player.radius + 6);
      ctx.lineTo(player.radius - 8, player.radius - 8);
      ctx.lineTo(0, player.radius - 14);
      ctx.lineTo(-player.radius + 8, player.radius - 8);
    } else {
      ctx.moveTo(0, player.radius - 6);
      ctx.lineTo(player.radius - 8, -player.radius + 8);
      ctx.lineTo(0, -player.radius + 14);
      ctx.lineTo(-player.radius + 8, -player.radius + 8);
    }
    ctx.closePath();
    ctx.fill();

    // Dash Cooldown ring arc beneath player
    if (player.dashCooldownRemaining > 0) {
      const progress = 1 - (player.dashCooldownRemaining / player.dashCooldownMax);
      ctx.strokeStyle = 'rgba(0, 255, 170, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }

    // Grabbed tile orb if Transporter
    if (player.grabbedTileColor) {
      const orbColor = COLOR_HEX[player.grabbedTileColor];
      ctx.fillStyle = orbColor;
      ctx.shadowColor = orbColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(player.radius + 14, -player.radius, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  public renderEnemy(ctx: CanvasRenderingContext2D, enemy: AIController, time: number = 0) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);

    // Hit flash
    if (enemy.hitFlashTimer > 0) {
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 30;
    }

    // Boss Aura & Crown
    if (enemy.isBoss) {
      // Golden / Crimson pulsing boss aura
      ctx.strokeStyle = enemy.isBossOverdrive ? '#FF0000' : 'rgba(255, 180, 0, 0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, enemy.radius + 12 + Math.sin(time * 12) * 5, 0, Math.PI * 2);
      ctx.stroke();

      // Crown spikes on top
      ctx.fillStyle = '#FFCC00';
      ctx.shadowColor = '#FFCC00';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.moveTo(-16, -enemy.radius - 2);
      ctx.lineTo(-12, -enemy.radius - 16);
      ctx.lineTo(-6, -enemy.radius - 6);
      ctx.lineTo(0, -enemy.radius - 22);
      ctx.lineTo(6, -enemy.radius - 6);
      ctx.lineTo(12, -enemy.radius - 16);
      ctx.lineTo(16, -enemy.radius - 2);
      ctx.closePath();
      ctx.fill();
    }

    // Outer threat ring
    ctx.strokeStyle = enemy.isBoss ? '#FF0055' : '#FF3366';
    ctx.lineWidth = enemy.isBoss ? 4 : 3;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 6, 0, Math.PI * 2);
    ctx.stroke();

    // Mecha core
    ctx.fillStyle = enemy.hitFlashTimer > 0 ? '#FFFFFF' : enemy.isBoss ? '#770022' : '#990033';
    ctx.shadowColor = enemy.isBoss ? '#FF0055' : '#FF3366';
    ctx.shadowBlur = enemy.isBoss ? 24 : 16;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
    ctx.fill();

    // Directional arrow pointing DOWN (towards player)
    ctx.shadowBlur = 0;
    ctx.fillStyle = enemy.isBoss ? '#FFD700' : '#FF88AA';
    ctx.beginPath();
    ctx.moveTo(0, enemy.radius - 6);
    ctx.lineTo(enemy.radius - 8, -enemy.radius + 8);
    ctx.lineTo(0, -enemy.radius + 14);
    ctx.lineTo(-enemy.radius + 8, -enemy.radius + 8);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private renderLasers(ctx: CanvasRenderingContext2D, particleSystem: ParticleSystem) {
    for (const lb of particleSystem.laserBeams) {
      ctx.save();
      ctx.strokeStyle = lb.color;
      ctx.lineWidth = lb.width;
      ctx.globalAlpha = lb.alpha;
      ctx.shadowColor = lb.color;
      ctx.shadowBlur = 24;

      ctx.beginPath();
      ctx.moveTo(lb.x1, lb.y1);
      ctx.lineTo(lb.x2, lb.y2);
      ctx.stroke();

      // White laser core
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = lb.width * 0.4;
      ctx.stroke();

      ctx.restore();
    }
  }

  private renderShockwaves(ctx: CanvasRenderingContext2D, particleSystem: ParticleSystem) {
    for (const sw of particleSystem.shockwaves) {
      ctx.save();
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = sw.alpha;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D, particleSystem: ParticleSystem) {
    for (const p of particleSystem.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;

      if (p.shape === 'square') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D, particleSystem: ParticleSystem) {
    for (const ft of particleSystem.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = ft.alpha;
      ctx.fillStyle = ft.color;
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 10;
      ctx.font = `700 ${ft.fontSize}px "Chakra Petch", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
