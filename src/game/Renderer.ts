import { GridBoard, GRID_COLS, GRID_ROWS, COLOR_HEX } from './GridEngine';
import { PlayerCharacter } from './CharacterController';
import { AIController } from './AIController';
import { ProjectileManager } from './ProjectileManager';
import { ParticleSystem } from './ParticleSystem';
import { ARCHETYPES, ARCHETYPE_LIST } from './archetypes';
import { STAGES, SECTOR_THEMES } from './stages';
import { ArchetypeId, CoreState, ShrinkPhase, ShrinkRect, TileColor } from '../types/game';
import { ARCHETYPE_PORTRAITS } from '../assets/portraits';

// Boss skill cycle colors for the OMNI-OVERLORD core (7 skills: Crimson,
// Tide, Beam, Chroma, Overdrive, Quantum Rewrite, Phase Blink).
const BOSS_SKILL_COLORS = ['#FF0055', '#33CCFF', '#00FFAA', '#FF8800', '#FF0000', '#B57EDC', '#FFCC00'];

export class CanvasRenderer {
  public canvasWidth = 1920;
  public canvasHeight = 1080;

  // Board layout geometry (v2.2: 9x5, 110x56 cells, 6px gap)
  public cellW = 110;
  public cellH = 56;
  public gap = 6;

  // Board physical bounds (v2.2)
  public enemyOriginX = 0;
  public enemyOriginY = 80;

  public neutralZoneY = 404;
  public neutralZoneHeight = 232;

  public playerOriginX = 0;
  public playerOriginY = 656;

  // v2.3: current campaign stage (1..30). Set by GameEngine on battle
  // start; the background tints by sector, even stages and boss stages.
  public stageId: number = 1;

  // v2.2 Phase 2: rejection shake target (set by GameEngine.render each
  // frame; null when no tile is shaking).
  public rejectTile: { owner: 'player' | 'enemy'; col: number; row: number; until: number } | null = null;

  // v2.2 Phase 2: preloaded portraits for the cut-in overlay.
  private portraitImages = new Map<ArchetypeId, HTMLImageElement>();

  constructor() {
    const totalGridW = GRID_COLS * this.cellW + (GRID_COLS - 1) * this.gap;
    // Center grids horizontally in the 1920 canvas
    this.enemyOriginX = Math.round((this.canvasWidth - totalGridW) / 2);
    this.playerOriginX = this.enemyOriginX;
    // Preload the cut-in portraits (data URLs; the first draw may miss
    // while they load, later cut-ins hit the cache).
    if (typeof window !== 'undefined') {
      for (const arch of ARCHETYPE_LIST) {
        const img = new Image();
        img.src = ARCHETYPE_PORTRAITS[arch.id];
        this.portraitImages.set(arch.id, img);
      }
    }
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
    gameTime: number,
    playerCore?: CoreState,
    enemyCore?: CoreState,
    shrinkRect?: ShrinkRect | null,
    shrinkRect2?: ShrinkRect | null,
    shrinkPhase?: ShrinkPhase,
    isRoyale?: boolean,
    portalWarnings?: { col: number; until: number }[],
    cutin?: { portrait: ArchetypeId; label: string; until: number; durationMs: number } | null
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

    // 3. Enemy Grid — in royale the top board is a warp portal instead.
    if (isRoyale) {
      this.renderPortal(ctx, gameTime);
    } else {
      const opponentCol = player2 ? player2.currentCol : enemy.currentCol;
      const opponentRow = player2 ? player2.currentRow : enemy.currentRow;
      this.renderGrid(ctx, enemyBoard, this.enemyOriginX, this.enemyOriginY, 'enemy', opponentCol, opponentRow);
    }

    // 4. Player Grid
    this.renderGrid(ctx, playerBoard, this.playerOriginX, this.playerOriginY, 'player', player.currentCol, player.currentRow);

    // 4b. Rear cores (behind each board, central 3 columns)
    if (!isRoyale && enemyCore) this.renderCore(ctx, enemyCore, this.enemyOriginX, this.enemyOriginY - 22, false);
    if (playerCore) this.renderCore(ctx, playerCore, this.playerOriginX, this.playerOriginY + GRID_ROWS * (this.cellH + this.gap) - this.gap, true);

    // 5. Lasers
    this.renderLasers(ctx, particleSystem);

    // 6. Projectiles
    this.renderProjectiles(ctx, projectileMgr, gameTime);

    // 6a. Royale incoming warning lines (0.4s before the projectile drops).
    if (isRoyale && portalWarnings && portalWarnings.length > 0) {
      this.renderPortalWarnings(ctx, portalWarnings, gameTime);
    }

    // 6b. Shrink walls (over the boards, under the characters)
    if (shrinkPhase === 'shrinking' || shrinkPhase === 'closed') {
      if (!isRoyale) this.renderShrinkWall(ctx, shrinkRect2 ?? null, this.enemyOriginX, this.enemyOriginY, gameTime);
      this.renderShrinkWall(ctx, shrinkRect ?? null, this.playerOriginX, this.playerOriginY, gameTime);
    }

    // 7. Characters
    if (player2) {
      this.renderPlayer(ctx, player2, gameTime, enemyBoard, shrinkRect2 ?? null);
    } else if (!isRoyale) {
      this.renderEnemy(ctx, enemy, gameTime, shrinkRect2 ?? null);
    }
    this.renderPlayer(ctx, player, gameTime, playerBoard, shrinkRect ?? null);

    // 8. Shockwaves & Particles
    this.renderShockwaves(ctx, particleSystem);
    this.renderParticles(ctx, particleSystem);

    // 8b. Neutral zone watermark on top so flying tiles never cover it
    this.renderNeutralZoneWatermark(ctx);

    // 9. Floating Combat Text
    this.renderFloatingTexts(ctx, particleSystem);

    // 10. Portrait cut-in (skill cast / combo 7+ / boss awakening).
    if (cutin) this.renderCutin(ctx, cutin);

    ctx.restore();
  }

  // v2.2 Phase 2: portrait cut-in at the right end of the neutral zone
  // (the only free canvas strip: the DOM cockpits cover both outer edges).
  // Slides in from the right, holds, then fades in the last 0.3s.
  private renderCutin(
    ctx: CanvasRenderingContext2D,
    cutin: { portrait: ArchetypeId; label: string; until: number; durationMs: number }
  ) {
    const img = this.portraitImages.get(cutin.portrait);
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const remaining = cutin.until - performance.now();
    if (remaining <= 0) return;
    const elapsed = Math.max(0, cutin.durationMs - remaining);
    const slideIn = Math.min(1, elapsed / 250);
    const fadeOut = Math.min(1, remaining / 300);
    const alpha = Math.min(slideIn, fadeOut);
    const size = 130;
    // Right end of the neutral zone; the DOM right cockpit starts at
    // x=1484, so the portrait (130px) parks at 1342..1472.
    const x = 1342 + (1 - slideIn) * 60;
    const y = this.neutralZoneY + this.neutralZoneHeight / 2 - size / 2;
    const color = ARCHETYPES[cutin.portrait]?.color ?? '#FFFFFF';

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    this.drawRoundedRect(ctx, x, y, size, size, 16);
    ctx.fillStyle = '#0B0F1A';
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.save();
    this.drawRoundedRect(ctx, x, y, size, size, 16);
    ctx.clip();
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
    // Label pill under the portrait.
    ctx.font = '700 15px "Chakra Petch", monospace';
    ctx.textAlign = 'center';
    const label = cutin.label;
    const lw = ctx.measureText(label).width + 24;
    const ly = y + size + 8;
    ctx.fillStyle = 'rgba(3, 6, 12, 0.85)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    this.drawRoundedRect(ctx, x + size / 2 - lw / 2, ly, lw, 26, 13);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(label, x + size / 2, ly + 18);
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

    // v2.3: sector accent glow (all 6 stages of a sector share one theme).
    const stage = STAGES[Math.max(0, Math.min(this.stageId - 1, STAGES.length - 1))];
    const theme = SECTOR_THEMES[stage?.sector ?? 1];
    if (theme) {
      const glow = ctx.createRadialGradient(
        this.canvasWidth / 2, 0, 50,
        this.canvasWidth / 2, 0, 900
      );
      glow.addColorStop(0, theme.accent + '26');
      glow.addColorStop(1, theme.accent + '00');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }
    // Even stages and sector/final bosses get a mood tint overlay.
    if (stage?.isFinalBoss) {
      ctx.fillStyle = 'rgba(120, 10, 40, 0.22)';
      ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    } else if (stage?.isSectorBoss) {
      ctx.fillStyle = 'rgba(90, 20, 90, 0.20)';
      ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    } else if (this.stageId % 2 === 0) {
      ctx.fillStyle = 'rgba(20, 50, 110, 0.14)';
      ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
    }

    // Subtle perspective grid lines (sector-tinted)
    ctx.strokeStyle = theme?.grid ?? 'rgba(40, 70, 110, 0.12)';
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

    // (Watermark text is drawn late via renderNeutralZoneWatermark.)

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

  // Neutral zone watermark, drawn late so projectiles/particles pass under it.
  // v2.2: dark outline + brighter fill so it stays readable on white tiles.
  private renderNeutralZoneWatermark(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.font = '700 13px "Chakra Petch", monospace';
    ctx.textAlign = 'center';
    const text = '⚡ NEUTRAL CLASH ZONE · BLOCK-TO-BLOCK COLLISION ⚡';
    const tx = this.canvasWidth / 2;
    const ty = this.neutralZoneY + this.neutralZoneHeight / 2 + 5;
    ctx.strokeStyle = 'rgba(3, 6, 12, 0.85)';
    ctx.lineWidth = 4;
    ctx.strokeText(text, tx, ty);
    ctx.fillStyle = 'rgba(200, 225, 255, 0.55)';
    ctx.fillText(text, tx, ty);
    ctx.restore();
  }

  // GRID ROYALE (v2.4): the warp portal replaces the top board. It sits in
  // the Y <= 80 strip; my projectiles vanish into it and enemy projectiles
  // drop out of it. The 80..404 area below stays open flight space.
  private renderPortal(ctx: CanvasRenderingContext2D, time: number) {
    const cx = this.canvasWidth / 2;
    const cy = 40;
    const rx = 430;
    const ry = 30;
    ctx.save();

    // Outer glow ring (rotating dashes for a swirling gate feel).
    ctx.translate(cx, cy);
    ctx.rotate(0);
    const grad = ctx.createLinearGradient(-rx, 0, rx, 0);
    grad.addColorStop(0, '#33CCFF');
    grad.addColorStop(0.5, '#B57EDC');
    grad.addColorStop(1, '#FF3366');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 4;
    ctx.setLineDash([26, 14]);
    ctx.lineDashOffset = -time * 60;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Inner glow fill.
    const fill = ctx.createRadialGradient(0, 0, 4, 0, 0, rx);
    fill.addColorStop(0, 'rgba(181, 126, 220, 0.35)');
    fill.addColorStop(1, 'rgba(51, 204, 255, 0.05)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Label.
    ctx.save();
    ctx.font = '700 15px "Chakra Petch", monospace';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(3, 6, 12, 0.9)';
    ctx.lineWidth = 4;
    ctx.strokeText('WARP PORTAL · 전송 포탈', cx, cy + 5);
    ctx.fillStyle = 'rgba(220, 235, 255, 0.9)';
    ctx.fillText('WARP PORTAL · 전송 포탈', cx, cy + 5);
    ctx.restore();
  }

  // GRID ROYALE (v2.4): 0.4s warning line at the top of the column an
  // incoming projectile is about to drop from.
  private renderPortalWarnings(
    ctx: CanvasRenderingContext2D,
    warnings: { col: number; until: number }[],
    time: number
  ) {
    const pulse = 0.45 + 0.35 * Math.sin(time * 14);
    ctx.save();
    for (const w of warnings) {
      const x = this.enemyOriginX + w.col * (this.cellW + this.gap) + this.cellW / 2;
      ctx.strokeStyle = `rgba(255, 68, 68, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(x, this.enemyOriginY);
      ctx.lineTo(x, this.neutralZoneY);
      ctx.stroke();
      ctx.setLineDash([]);
      // Warning chevron at the portal edge.
      ctx.fillStyle = `rgba(255, 68, 68, ${Math.min(1, pulse + 0.3)})`;
      ctx.beginPath();
      ctx.moveTo(x - 12, this.enemyOriginY + 2);
      ctx.lineTo(x + 12, this.enemyOriginY + 2);
      ctx.lineTo(x, this.enemyOriginY + 18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // v2.2 rear core: a slim bar behind the board spanning the central 3
  // columns. Crack lines deepen at 60% and 30% HP.
  private renderCore(
    ctx: CanvasRenderingContext2D,
    core: CoreState,
    originX: number,
    y: number,
    isPlayer: boolean
  ) {
    const step = this.cellW + this.gap;
    const x = originX + 3 * step;
    const w = 3 * this.cellW + 2 * this.gap;
    const h = 22;
    const frac = Math.max(0, core.hp / core.maxHp);

    ctx.save();
    // Base slab
    ctx.fillStyle = 'rgba(12, 16, 28, 0.95)';
    ctx.strokeStyle = isPlayer ? 'rgba(0, 255, 170, 0.5)' : 'rgba(255, 51, 102, 0.5)';
    ctx.lineWidth = 2;
    this.drawRoundedRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
    // HP fill
    if (frac > 0) {
      const grad = ctx.createLinearGradient(x, y, x + w, y);
      grad.addColorStop(0, '#FF2244');
      grad.addColorStop(1, '#FF6688');
      ctx.fillStyle = grad;
      this.drawRoundedRect(ctx, x + 2, y + 2, (w - 4) * frac, h - 4, 4);
      ctx.fill();
    }
    // v2.2 Phase 2: 50% collapse tick — the line the bar must not cross.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 2);
    ctx.lineTo(x + w / 2, y + h - 2);
    ctx.stroke();
    // Crack lines
    if (core.crack >= 1) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + 2);
      ctx.lineTo(x + w * 0.38, y + h / 2);
      ctx.lineTo(x + w * 0.32, y + h - 2);
      ctx.stroke();
    }
    if (core.crack >= 2) {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.65, y + 2);
      ctx.lineTo(x + w * 0.58, y + h / 2);
      ctx.lineTo(x + w * 0.68, y + h - 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.5, y + 2);
      ctx.lineTo(x + w * 0.52, y + h - 2);
      ctx.stroke();
    }
    // Label
    ctx.font = '700 11px "Chakra Petch", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`CORE ${core.hp}/${core.maxHp}`, x + w / 2, y + h / 2 + 4);
    ctx.restore();
  }

  // v2.2 shrink wall: red translucent bands cover the board outside the
  // safe rect, with a pulsing border around the safe zone.
  private renderShrinkWall(
    ctx: CanvasRenderingContext2D,
    rect: ShrinkRect | null,
    originX: number,
    originY: number,
    time: number
  ) {
    if (!rect) return;
    const totalW = GRID_COLS * this.cellW + (GRID_COLS - 1) * this.gap;
    const totalH = GRID_ROWS * this.cellH + (GRID_ROWS - 1) * this.gap;
    const bx = originX;
    const by = originY;
    const pulse = 0.22 + Math.sin(time * 6) * 0.08;

    ctx.save();
    ctx.fillStyle = `rgba(255, 30, 50, ${pulse})`;
    if (rect.y > by) ctx.fillRect(bx, by, totalW, rect.y - by);
    const bottom = rect.y + rect.h;
    if (bottom < by + totalH) ctx.fillRect(bx, bottom, totalW, by + totalH - bottom);
    if (rect.x > bx) ctx.fillRect(bx, rect.y, rect.x - bx, rect.h);
    const right = rect.x + rect.w;
    if (right < bx + totalW) ctx.fillRect(right, rect.y, bx + totalW - right, rect.h);
    if (rect.w > 0 && rect.h > 0) {
      ctx.strokeStyle = `rgba(255, 60, 80, ${0.5 + Math.sin(time * 6) * 0.2})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
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

    // Board container border (rounded bubble frame)
    ctx.strokeStyle = owner === 'player' ? 'rgba(0, 255, 170, 0.35)' : 'rgba(255, 51, 102, 0.35)';
    ctx.lineWidth = 2;
    this.drawRoundedRect(ctx, originX - 10, originY - 10, totalW + 20, totalH + 20, 18);
    ctx.stroke();

    // Board title tag
    ctx.font = '700 12px "Chakra Petch", monospace';
    ctx.fillStyle = owner === 'player' ? '#00FFAA' : '#FF3366';
    ctx.textAlign = 'left';
    ctx.fillText(
      owner === 'player' ? '● PLAYER GRID (9x5)' : '▲ ENEMY HOSTILE GRID (9x5)',
      originX,
      originY - 18
    );

    // v2.2 Phase 2: frontline glow — the boundary of the front 2 rows
    // (player rows 0-1, enemy rows 3-4) where the x1.25/x1.15 bonus applies.
    {
      const rowStep = this.cellH + this.gap;
      const frontY =
        owner === 'player'
          ? originY + 2 * rowStep - this.gap / 2
          : originY + 3 * rowStep - this.gap / 2;
      ctx.save();
      ctx.strokeStyle = owner === 'player' ? 'rgba(0, 255, 170, 0.5)' : 'rgba(255, 51, 102, 0.5)';
      ctx.shadowColor = owner === 'player' ? '#00FFAA' : '#FF3366';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(originX, frontY);
      ctx.lineTo(originX + totalW, frontY);
      ctx.stroke();
      ctx.restore();
    }

    // Render individual tiles
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const tile = board.tiles[r][c];
        let tx = originX + c * (this.cellW + this.gap);
        const ty = originY + r * (this.cellH + this.gap);
        // v2.2 Phase 2: rejected launch — the tile shakes 3px side to side.
        if (
          this.rejectTile &&
          this.rejectTile.owner === owner &&
          this.rejectTile.col === c &&
          this.rejectTile.row === r &&
          performance.now() < this.rejectTile.until
        ) {
          tx += Math.sin(performance.now() / 16) * 3;
        }

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
          tile.cooldownMax,
          isActivePad,
          c === currentCol && r === currentRow,
          tile.pulsePhase,
          cluster?.shapeType,
          board.isTileLocked(c, r)
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
    cooldownMax: number,
    isActivePad: boolean,
    isHovered: boolean,
    pulsePhase: number,
    shapeType?: string,
    isLocked: boolean = false
  ) {
    // Round bubble tiles. Radius is clamped so small cells stay pill-like
    // instead of collapsing into circles.
    const radius = Math.min(14, w / 2 - 2, h / 2 - 2);

    // v2.2 locked tile (collapsed column or shrink wall): dark slab with a
    // red X. It never refills and never joins a cluster.
    if (isLocked) {
      ctx.fillStyle = 'rgba(10, 12, 20, 0.92)';
      ctx.strokeStyle = 'rgba(255, 60, 80, 0.4)';
      ctx.lineWidth = 1.5;
      this.drawRoundedRect(ctx, x, y, w, h, radius);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 60, 80, 0.55)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      const pad = 10;
      ctx.beginPath();
      ctx.moveTo(x + pad, y + pad);
      ctx.lineTo(x + w - pad, y + h - pad);
      ctx.moveTo(x + w - pad, y + pad);
      ctx.lineTo(x + pad, y + h - pad);
      ctx.stroke();
      return;
    }

    // Cooldown tile state: dark rubble with a few settled shard fragments
    // (deterministic per tile so they don't shimmer between frames).
    if (!color) {
      ctx.fillStyle = 'rgba(20, 25, 38, 0.8)';
      ctx.strokeStyle = 'rgba(50, 60, 80, 0.4)';
      ctx.lineWidth = 1.5;
      this.drawRoundedRect(ctx, x, y, w, h, radius);
      ctx.fill();
      ctx.stroke();

      const seed = this.hash2(x, y);
      ctx.fillStyle = 'rgba(130, 150, 180, 0.28)';
      for (let i = 0; i < 3; i++) {
        const sx = x + w * (0.22 + 0.3 * this.hash2(seed, i * 7 + 1));
        const sy = y + h * (0.25 + 0.5 * this.hash2(seed, i * 13 + 2));
        const s = 3 + this.hash2(seed, i * 5 + 3) * 4;
        const a = this.hash2(seed, i * 11 + 4) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(sx + Math.cos(a) * s, sy + Math.sin(a) * s);
        ctx.lineTo(sx + Math.cos(a + 2.1) * s, sy + Math.sin(a + 2.1) * s);
        ctx.lineTo(sx + Math.cos(a + 4.2) * s, sy + Math.sin(a + 4.2) * s);
        ctx.closePath();
        ctx.fill();
      }

      // Circular reload progress (denominator is this tile's own cooldown)
      const progress = cooldownMax > 0 ? Math.max(0, Math.min(1, 1 - cooldownRemaining / cooldownMax)) : 1;
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

    // Hairline cracks: two deterministic fractures per tile, clipped to the
    // rounded shape so they never spill past the edge. Subtle on idle
    // tiles, a touch stronger on primed pads.
    ctx.save();
    this.drawRoundedRect(ctx, x, y, w, h, radius);
    ctx.clip();
    const crackSeed = this.hash2(x, y);
    const ccx = x + w / 2;
    const ccy = y + h / 2;
    ctx.strokeStyle = `rgba(0, 0, 0, ${isActivePad ? 0.28 : 0.18})`;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const a0 = this.hash2(crackSeed, i * 17 + 1) * Math.PI * 2;
      const a1 = a0 + (this.hash2(crackSeed, i * 29 + 2) - 0.5) * 1.2;
      const r0 = Math.min(w, h) * 0.18;
      const r1 = Math.min(w, h) * 0.52;
      const mx = ccx + Math.cos(a0) * r0;
      const my = ccy + Math.sin(a0) * r0;
      const ex = ccx + Math.cos(a1) * r1;
      const ey = ccy + Math.sin(a1) * r1;
      ctx.beginPath();
      ctx.moveTo(ccx, ccy);
      ctx.lineTo(mx, my);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    // One white glint facet next to the cracks.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.18, y + h * 0.22);
    ctx.lineTo(x + w * 0.42, y + h * 0.18);
    ctx.lineTo(x + w * 0.3, y + h * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // v2.2 Phase 2: colorblind symbol — low-alpha geometry at tile
    // center (red triangle, blue square, yellow circle).
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    const scx = x + w / 2;
    const scy = y + h / 2;
    if (color === 'red') {
      ctx.beginPath();
      ctx.moveTo(scx, scy - 8);
      ctx.lineTo(scx + 8, scy + 6);
      ctx.lineTo(scx - 8, scy + 6);
      ctx.closePath();
      ctx.fill();
    } else if (color === 'blue') {
      ctx.fillRect(scx - 7, scy - 7, 14, 14);
    } else {
      ctx.beginPath();
      ctx.arc(scx, scy, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

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
    // (soft rounded corner brackets).
    if (isHovered) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
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
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

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

      // v2.2 Phase 2: cluster size number at the centroid.
      const cx = cluster.tiles.reduce((a, t) => a + originX + t.col * (this.cellW + this.gap) + this.cellW / 2, 0) / cluster.tiles.length;
      const cy = cluster.tiles.reduce((a, t) => a + originY + t.row * (this.cellH + this.gap) + this.cellH / 2, 0) / cluster.tiles.length;
      ctx.save();
      ctx.font = '700 13px "Chakra Petch", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(3, 6, 12, 0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = hex;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(String(cluster.tiles.length), cx, cy + 4.5);
      ctx.restore();

      // v2.2 Phase 2: launch-lane rail — a faint vertical dotted line over
      // each of the cluster's columns (upward for the player board,
      // downward for the enemy board) so the firing line is visible.
      const cols = [...new Set(cluster.tiles.map((t) => t.col))];
      for (const col of cols) {
        const colCx = originX + col * (this.cellW + this.gap) + this.cellW / 2;
        const rows = cluster.tiles.filter((t) => t.col === col).map((t) => t.row);
        const minRow = Math.min(...rows);
        const maxRow = Math.max(...rows);
        ctx.save();
        ctx.strokeStyle = `${hex}2E`;
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (board.owner === 'player') {
          ctx.moveTo(colCx, originY);
          ctx.lineTo(colCx, originY + minRow * (this.cellH + this.gap));
        } else {
          ctx.moveTo(colCx, originY + (maxRow + 1) * (this.cellH + this.gap) - this.gap);
          ctx.lineTo(colCx, originY + GRID_ROWS * (this.cellH + this.gap) - this.gap);
        }
        ctx.stroke();
        ctx.restore();
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

        // Cell body (round bubble block)
        ctx.fillStyle = p.glowColor;
        this.drawRoundedRect(ctx, cellX, cellY, p.cellWidth, p.cellHeight, 10);
        ctx.fill();

        // Inner core
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFFFFF';
        this.drawRoundedRect(ctx, cellX + 4, cellY + 4, p.cellWidth - 8, p.cellHeight - 8, 7);
        ctx.fill();

        // Crack seam across the core: the block reads as about to shatter.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cellX + p.cellWidth * 0.2, cellY + p.cellHeight * 0.25);
        ctx.lineTo(cellX + p.cellWidth * 0.5, cellY + p.cellHeight * 0.5);
        ctx.lineTo(cellX + p.cellWidth * 0.78, cellY + p.cellHeight * 0.72);
        ctx.stroke();

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
        ctx.lineCap = 'round';
        const tipY = p.owner === 'player' ? p.y : p.y + p.cellHeight;
        ctx.beginPath();
        ctx.moveTo(p.x + p.cellWidth / 2, tipY);
        ctx.lineTo(p.x + p.cellWidth / 2, tipY + (p.owner === 'player' ? 60 : -60));
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // v2.2 Phase 2: diegetic character HUD — 48x6 HP bar (+30px below the
  // fighter, flips to -32px above on the edge row), 25 HP tick marks, a
  // red residual bar that eases toward real HP, a white shield overlay,
  // discard pips, and a yellow wavy ring while slowed.
  private renderCharacterHud(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    hp: number,
    maxHp: number,
    displayHp: number,
    shield: number,
    discardStacks: number | null,
    slowTimer: number,
    time: number,
    flip: boolean,
    hpColor: string
  ) {
    const barW = 48;
    const barH = 6;
    const barY = flip ? y - 32 - barH : y + 30;
    const frac = Math.max(0, Math.min(1, hp / maxHp));
    const dispFrac = Math.max(0, Math.min(1, displayHp / maxHp));

    ctx.save();
    // Bar background
    ctx.fillStyle = 'rgba(3, 6, 12, 0.85)';
    this.drawRoundedRect(ctx, x - barW / 2, barY, barW, barH, 3);
    ctx.fill();
    // Red residual (damage ghost) + live HP on top
    if (dispFrac > 0) {
      ctx.fillStyle = 'rgba(255, 68, 85, 0.9)';
      this.drawRoundedRect(ctx, x - barW / 2, barY, barW * dispFrac, barH, 3);
      ctx.fill();
    }
    if (frac > 0) {
      ctx.fillStyle = hpColor;
      this.drawRoundedRect(ctx, x - barW / 2, barY, barW * frac, barH, 3);
      ctx.fill();
    }
    // 25 HP tick marks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    for (const t of [0.25, 0.5, 0.75]) {
      const tx = x - barW / 2 + barW * t;
      ctx.beginPath();
      ctx.moveTo(tx, barY);
      ctx.lineTo(tx, barY + barH);
      ctx.stroke();
    }
    // Shield: white overlay on the bar
    if (shield > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      const sw = barW * Math.min(1, shield / 100);
      this.drawRoundedRect(ctx, x - barW / 2, barY, sw, barH, 3);
      ctx.fill();
    }
    // Discard pips (3 x 4px dots under the bar)
    if (discardStacks !== null) {
      const pipY = flip ? barY - 10 : barY + barH + 6;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < discardStacks ? '#00FFAA' : 'rgba(100, 116, 139, 0.6)';
        ctx.beginPath();
        ctx.arc(x - 9 + i * 9, pipY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Yellow slow wave ring
    if (slowTimer > 0) {
      ctx.strokeStyle = 'rgba(255, 204, 0, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 16) {
        const r = radius + 14 + Math.sin(a * 3 + time * 10) * 2.5;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderPlayer(
    ctx: CanvasRenderingContext2D,
    player: PlayerCharacter,
    time: number,
    board?: GridBoard,
    shrinkRect?: ShrinkRect | null
  ) {
    const config = ARCHETYPES[player.archetypeId];
    const R = player.radius;
    const facingDown = player.isPlayer2;

    // Stance: tile under feet + cluster shape (drives lancer/wave/
    // speedster boosts and the painter core color).
    const tile = board?.tiles[player.currentRow]?.[player.currentCol];
    const tileColor: TileColor | null = tile?.color ?? null;
    const stanceShape = board?.getClusterAt(player.currentCol, player.currentRow)?.shapeType;

    const shapeOpts = {
      time,
      skillReady: player.skillCooldownRemaining <= 0,
      overdrive: player.overdriveActive,
      shield: player.shield > 0,
      tileColor,
      grabbedColor: player.grabbedTileColor,
      spearBoost: player.archetypeId === 'lancer' && stanceShape === 'spear',
      wallBoost: player.archetypeId === 'wave' && stanceShape === 'wall',
      speedBoost: player.archetypeId === 'speedster' && tileColor === 'yellow',
      flash: player.hitFlashTimer > 0,
    };

    ctx.save();
    ctx.translate(player.x, player.y);

    // Dash ghosts: 3 afterimages trailing the move direction.
    if (player.dashDurationRemaining > 0) {
      for (let i = 3; i >= 1; i--) {
        ctx.save();
        ctx.globalAlpha = 0.3 - i * 0.06;
        ctx.translate(-player.moveDir.x * 12 * i, -player.moveDir.y * 12 * i);
        ctx.rotate(facingDown ? Math.PI : 0);
        this.drawFighterShape(ctx, player.archetypeId, R, config.color, { ...shapeOpts, flash: false });
        ctx.restore();
      }
    }

    ctx.rotate(facingDown ? Math.PI : 0);
    if (player.dashDurationRemaining > 0) ctx.globalAlpha = 0.8;
    this.drawFighterShape(ctx, player.archetypeId, R, config.color, shapeOpts);
    ctx.globalAlpha = 1;
    ctx.restore();

    // State rings (screen space, unrotated).
    ctx.save();
    ctx.translate(player.x, player.y);
    // Skill ready: thin pulsing outer ring.
    if (player.skillCooldownRemaining <= 0) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 + 0.25 * Math.sin(time * 6)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, R + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Shrink zone outside: red dashed noise ring.
    if (shrinkRect && !this.pointInRect(player.x, player.y, shrinkRect)) {
      ctx.strokeStyle = 'rgba(255, 40, 60, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -time * 20;
      ctx.beginPath();
      ctx.arc(0, 0, R + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Overdrive aura (Monochrome)
    if (player.overdriveActive) {
      ctx.strokeStyle = 'rgba(255, 0, 50, 0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, R + 12 + Math.sin(time * 15) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Shield aura (Monochrome: white outer ring per spec; other
    // archetypes keep the blue ring).
    if (player.shield > 0) {
      ctx.strokeStyle = player.archetypeId === 'monochrome' ? '#FFFFFF' : '#33CCFF';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, R + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Dash Cooldown ring arc beneath player
    if (player.dashCooldownRemaining > 0) {
      const progress = 1 - (player.dashCooldownRemaining / player.dashCooldownMax);
      ctx.strokeStyle = 'rgba(0, 255, 170, 0.7)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, R + 6, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
    // Grabbed tile orb if Transporter
    if (player.grabbedTileColor) {
      const orbColor = COLOR_HEX[player.grabbedTileColor];
      ctx.fillStyle = orbColor;
      ctx.shadowColor = orbColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(R + 14, -R, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // v2.2 Phase 2: diegetic HP bar + discard pips + slow wave.
    this.renderCharacterHud(
      ctx, player.x, player.y, R,
      player.hp, player.maxHp, player.displayHp, player.shield,
      player.discardStacks, player.slowTimer, time,
      player.isPlayer2 ? player.currentRow === 0 : player.currentRow === GRID_ROWS - 1,
      player.isPlayer2 ? '#F87171' : '#34D399'
    );
  }

  // v2.2 signature vector shapes. Every shape points UP (-Y) in local
  // space; the caller rotates P2 by PI. Common language: dark outline
  // (#0B0F1A, 2.5px) + archetype-color fill + white core, 3 layers.
  private drawFighterShape(
    ctx: CanvasRenderingContext2D,
    archetypeId: string,
    radius: number,
    color: string | CanvasGradient,
    opts: {
      time: number;
      skillReady?: boolean;
      overdrive?: boolean;
      shield?: boolean;
      tileColor?: TileColor | null;
      grabbedColor?: TileColor | null;
      spearBoost?: boolean;
      wallBoost?: boolean;
      speedBoost?: boolean;
      flash?: boolean;
      bossSkillColor?: string;
    }
  ) {
    const R = radius;
    const flash = !!opts.flash;
    const fill = flash ? '#FFFFFF' : color;
    const outline = '#0B0F1A';

    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = outline;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.fillStyle = fill;
    // shadowColor takes a plain color string; gradients fall back to white.
    ctx.shadowColor = flash ? '#FFFFFF' : typeof color === 'string' ? color : '#FFFFFF';
    ctx.shadowBlur = flash ? 30 : 16;

    const core = (x: number, y: number, r: number) => {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = flash ? 30 : 16;
      ctx.fillStyle = fill;
    };

    switch (archetypeId) {
      case 'lancer': {
        const tip = opts.spearBoost ? R * 1.15 : R;
        ctx.beginPath();
        ctx.moveTo(0, -tip);
        ctx.lineTo(R * 0.42, 0);
        ctx.lineTo(0, R * 0.85);
        ctx.lineTo(-R * 0.42, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Short reverse wings
        ctx.beginPath();
        ctx.moveTo(-R * 0.42, -R * 0.1);
        ctx.lineTo(-R * 0.85, -R * 0.42);
        ctx.lineTo(-R * 0.3, -R * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(R * 0.42, -R * 0.1);
        ctx.lineTo(R * 0.85, -R * 0.42);
        ctx.lineTo(R * 0.3, -R * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // White core diamond
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(0, -R * 0.3);
        ctx.lineTo(R * 0.16, 0);
        ctx.lineTo(0, R * 0.3);
        ctx.lineTo(-R * 0.16, 0);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'wave': {
        // Wide curved barrier arc (crescent band)
        ctx.beginPath();
        ctx.arc(0, R * 0.6, R * 0.95, Math.PI * 1.08, Math.PI * 1.92);
        ctx.arc(0, R * 0.6, R * 0.5, Math.PI * 1.92, Math.PI * 1.08, true);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (opts.wallBoost) {
          ctx.beginPath();
          ctx.arc(0, R * 0.6, R * 1.15, Math.PI * 1.12, Math.PI * 1.88);
          ctx.stroke();
        }
        core(0, R * 0.3, R * 0.22);
        break;
      }
      case 'sniper': {
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // 4 crosshair ticks, top one protruding
        ctx.strokeStyle = fill;
        ctx.lineWidth = 3;
        const ticks = [
          { a: -Math.PI / 2, len: R * 1.22 },
          { a: Math.PI / 2, len: R * 1.0 },
          { a: 0, len: R * 1.0 },
          { a: Math.PI, len: R * 1.0 },
        ];
        for (const t of ticks) {
          ctx.beginPath();
          ctx.moveTo(Math.cos(t.a) * R * 0.8, Math.sin(t.a) * R * 0.8);
          ctx.lineTo(Math.cos(t.a) * t.len, Math.sin(t.a) * t.len);
          ctx.stroke();
        }
        // Rotating outer ring while the skill is ready
        if (opts.skillReady) {
          ctx.save();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          ctx.lineDashOffset = -opts.time * 40;
          ctx.beginPath();
          ctx.arc(0, 0, R * 1.08, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        core(0, 0, R * 0.28);
        break;
      }
      case 'painter': {
        // 4-direction rounded cross star
        const armW = R * 0.5;
        const armL = R * 0.9;
        this.drawRoundedRect(ctx, -armW / 2, -armL, armW, armL * 2, armW / 2);
        ctx.fill();
        ctx.stroke();
        this.drawRoundedRect(ctx, -armL, -armW / 2, armL * 2, armW, armW / 2);
        ctx.fill();
        ctx.stroke();
        // Rotating square core, tinted by the tile underfoot
        ctx.save();
        ctx.rotate(opts.time * 1.5);
        ctx.shadowBlur = 0;
        ctx.fillStyle = opts.tileColor ? COLOR_HEX[opts.tileColor] : '#FFFFFF';
        const s = R * 0.42;
        this.drawRoundedRect(ctx, -s / 2, -s / 2, s, s, 3);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'transporter': {
        // Two opposing half-discs
        ctx.save();
        if (opts.grabbedColor) ctx.rotate(opts.time * 3);
        ctx.beginPath();
        ctx.arc(-R * 0.38, 0, R * 0.5, Math.PI / 2, Math.PI * 1.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(R * 0.38, 0, R * 0.5, -Math.PI / 2, Math.PI / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        core(0, 0, R * 0.24);
        if (opts.grabbedColor) {
          ctx.fillStyle = COLOR_HEX[opts.grabbedColor];
          ctx.beginPath();
          ctx.arc(0, -R * 0.85, R * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'speedster': {
        // Trailing tail (extends on yellow)
        const tailLen = opts.speedBoost ? R * 1.5 : R * 1.0;
        ctx.beginPath();
        ctx.moveTo(-R * 0.25, R * 0.35);
        ctx.lineTo(0, R * 0.35 + tailLen);
        ctx.lineTo(R * 0.25, R * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Two forward chevrons (>>)
        ctx.strokeStyle = fill;
        ctx.lineWidth = R * 0.26;
        for (const off of [0, -R * 0.42]) {
          ctx.beginPath();
          ctx.moveTo(off - R * 0.15, -R * 0.62);
          ctx.lineTo(off + R * 0.42, 0);
          ctx.lineTo(off - R * 0.15, R * 0.62);
          ctx.stroke();
        }
        core(0, 0, R * 0.2);
        break;
      }
      case 'monochrome': {
        // Black octagon + crimson cracks + white horns
        ctx.fillStyle = flash ? '#FFFFFF' : '#111111';
        ctx.strokeStyle = flash ? '#FFFFFF' : '#FF0033';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * R;
          const py = Math.sin(a) * R;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Cracks (glow while overdriving)
        ctx.strokeStyle = opts.overdrive ? '#FF2244' : '#8A0020';
        ctx.shadowColor = opts.overdrive ? '#FF0033' : 'transparent';
        ctx.shadowBlur = opts.overdrive ? 12 : 0;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-R * 0.4, -R * 0.5);
        ctx.lineTo(0, 0);
        ctx.lineTo(R * 0.3, R * 0.55);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(R * 0.5, -R * 0.3);
        ctx.lineTo(R * 0.1, R * 0.1);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // White horns
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(-R * 0.75, -R * 0.55);
        ctx.lineTo(-R * 0.95, -R * 1.15);
        ctx.lineTo(-R * 0.45, -R * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(R * 0.75, -R * 0.55);
        ctx.lineTo(R * 0.95, -R * 1.15);
        ctx.lineTo(R * 0.45, -R * 0.8);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'boss': {
        // Large hexagon + crown horns + floating triangle shards
        ctx.fillStyle = flash ? '#FFFFFF' : '#770022';
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * R;
          const py = Math.sin(a) * R;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Crown horns on top
        ctx.fillStyle = '#FFCC00';
        ctx.shadowColor = '#FFCC00';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.moveTo(-R * 0.6, -R * 0.85);
        ctx.lineTo(-R * 0.45, -R * 1.25);
        ctx.lineTo(-R * 0.22, -R * 0.9);
        ctx.lineTo(0, -R * 1.35);
        ctx.lineTo(R * 0.22, -R * 0.9);
        ctx.lineTo(R * 0.45, -R * 1.25);
        ctx.lineTo(R * 0.6, -R * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        // 3 floating triangle shards orbiting
        ctx.fillStyle = '#FFD700';
        for (let i = 0; i < 3; i++) {
          const a = opts.time * 0.8 + (i * Math.PI * 2) / 3;
          const sx = Math.cos(a) * R * 1.35;
          const sy = Math.sin(a) * R * 1.35;
          ctx.beginPath();
          ctx.moveTo(sx, sy - 7);
          ctx.lineTo(sx + 6, sy + 5);
          ctx.lineTo(sx - 6, sy + 5);
          ctx.closePath();
          ctx.fill();
        }
        // Core takes the current boss skill's color
        ctx.fillStyle = opts.bossSkillColor ?? '#FF0055';
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.32, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        // Generic enemy drone: red hexagon with a downward white chevron
        // (screen space; the caller does not rotate enemy shapes).
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * R * 0.9;
          const py = Math.sin(a) * R * 0.9;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(0, R * 0.5);
        ctx.lineTo(R * 0.35, -R * 0.2);
        ctx.lineTo(-R * 0.35, -R * 0.2);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  // v2.3 hybrid rendering: two archetype vector shapes layered — the
  // first at near-full size filled with a two-color gradient, the second
  // smaller on top in its own color. No separate art needed.
  private drawHybridFighterShape(
    ctx: CanvasRenderingContext2D,
    archA: string,
    archB: string,
    radius: number,
    opts: {
      time: number;
      skillReady?: boolean;
      overdrive?: boolean;
      shield?: boolean;
      tileColor?: TileColor | null;
      grabbedColor?: TileColor | null;
      spearBoost?: boolean;
      wallBoost?: boolean;
      speedBoost?: boolean;
      flash?: boolean;
      bossSkillColor?: string;
    }
  ) {
    const grad = ctx.createLinearGradient(-radius, -radius, radius, radius);
    grad.addColorStop(0, ARCHETYPES[archA as keyof typeof ARCHETYPES]?.color ?? '#FF3366');
    grad.addColorStop(1, ARCHETYPES[archB as keyof typeof ARCHETYPES]?.color ?? '#33CCFF');
    this.drawFighterShape(ctx, archA, radius * 0.95, grad, opts);
    ctx.save();
    ctx.globalAlpha = 0.92;
    this.drawFighterShape(
      ctx,
      archB,
      radius * 0.58,
      ARCHETYPES[archB as keyof typeof ARCHETYPES]?.color ?? '#33CCFF',
      opts
    );
    ctx.restore();
  }

  private pointInRect(x: number, y: number, rect: ShrinkRect | null): boolean {
    return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  public renderEnemy(ctx: CanvasRenderingContext2D, enemy: AIController, time: number = 0, shrinkRect?: ShrinkRect | null) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    const R = enemy.radius;
    if (enemy.isBoss) {
      this.drawFighterShape(ctx, 'boss', R, '#FF0055', {
        time,
        flash: enemy.hitFlashTimer > 0,
        overdrive: enemy.isBossOverdrive || enemy.awakened,
        bossSkillColor: BOSS_SKILL_COLORS[enemy.bossSkillCycle % BOSS_SKILL_COLORS.length],
      });
    } else if (enemy.archetypes.length >= 2) {
      // v2.3 hybrid: two signature shapes layered with a two-color gradient.
      this.drawHybridFighterShape(ctx, enemy.archetypes[0], enemy.archetypes[1], R, {
        time,
        flash: enemy.hitFlashTimer > 0,
        overdrive: enemy.overdriveActive,
        shield: enemy.shield > 0,
      });
    } else if (enemy.archetypes.length === 1) {
      const id = enemy.archetypes[0];
      this.drawFighterShape(ctx, id, R, ARCHETYPES[id].color, {
        time,
        flash: enemy.hitFlashTimer > 0,
        overdrive: enemy.overdriveActive,
        shield: enemy.shield > 0,
      });
    } else {
      this.drawFighterShape(ctx, 'drone', R, '#FF3366', { time, flash: enemy.hitFlashTimer > 0 });
    }
    ctx.restore();

    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    // Boss aura ring (pulsing gold, red while overdriving; phase-2
    // awakening turns it crimson with a faster pulse + crack ring).
    if (enemy.isBoss) {
      const awakened = enemy.awakened;
      ctx.strokeStyle = awakened ? '#FF0033' : enemy.isBossOverdrive ? '#FF0000' : 'rgba(255, 180, 0, 0.8)';
      ctx.lineWidth = awakened ? 5 : 4;
      ctx.beginPath();
      ctx.arc(0, 0, R + 12 + Math.sin(time * (awakened ? 20 : 12)) * 5, 0, Math.PI * 2);
      ctx.stroke();
      if (awakened) {
        ctx.strokeStyle = 'rgba(255, 0, 51, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = -time * 30;
        ctx.beginPath();
        ctx.arc(0, 0, R + 20 + Math.sin(time * 20) * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      // Ring in the enemy's primary archetype color (red for the tutorial
      // drone, gold for sector bosses).
      const ringColor = enemy.isSectorBoss
        ? '#FFD700'
        : enemy.archetypes.length > 0
          ? ARCHETYPES[enemy.archetypes[0]].color
          : '#FF3366';
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = enemy.isSectorBoss ? 4 : 3;
      ctx.beginPath();
      ctx.arc(0, 0, R + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Shrink zone outside: red dashed ring
    if (shrinkRect && !this.pointInRect(enemy.x, enemy.y, shrinkRect)) {
      ctx.strokeStyle = 'rgba(255, 40, 60, 0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -time * 20;
      ctx.beginPath();
      ctx.arc(0, 0, R + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // v2.2 Phase 2: diegetic HP bar (no discard pips for the AI).
    this.renderCharacterHud(
      ctx, enemy.x, enemy.y, R,
      enemy.hp, enemy.maxHp, enemy.displayHp, enemy.shield,
      null, enemy.slowTimer, time,
      enemy.currentRow === 0,
      '#F87171'
    );
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

      if (p.shape === 'shard') {
        // Tumbling triangle fragment.
        const a = p.angle ?? 0;
        const s = p.size * 0.62;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * s, p.y + Math.sin(a) * s);
        ctx.lineTo(p.x + Math.cos(a + 2.1) * s, p.y + Math.sin(a + 2.1) * s);
        ctx.lineTo(p.x + Math.cos(a + 4.2) * s, p.y + Math.sin(a + 4.2) * s);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === 'square') {
        this.drawRoundedRect(ctx, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, Math.max(2, p.size * 0.28));
        ctx.fill();
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
      // Dark outline (same as the neutral-zone watermark) so text stays
      // readable over bright tiles as well as dark bands.
      ctx.strokeStyle = 'rgba(3, 6, 12, 0.85)';
      ctx.lineWidth = Math.max(3, Math.round(ft.fontSize / 5));
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  // Deterministic 0..1 hash for per-tile decoration (cracks, rubble) so
  // the texture is stable across frames instead of flickering.
  private hash2(a: number, b: number): number {
    const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return v - Math.floor(v);
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
