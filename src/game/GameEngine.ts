import { GridBoard, BoardSnapshot, GRID_COLS, GRID_ROWS } from './GridEngine';
import { PlayerCharacter } from './CharacterController';
import { AIController } from './AIController';
import { ProjectileManager } from './ProjectileManager';
import { ParticleSystem } from './ParticleSystem';
import { CanvasRenderer } from './Renderer';
import { soundManager } from '../audio/soundManager';
import { ArchetypeId, Cluster, CoreState, GameMode, GameStats, ShrinkPhase, ShrinkRect, SkillEffect } from '../types/game';
import { ARCHETYPES } from './archetypes';
import { STAGES } from './stages';
import {
  startCampaignRun,
  markRunBroken,
  recordStageClear,
  tryRecordNoContinue,
  CampaignRunState,
} from './campaign';
import { NoContinueRecord } from '../types/game';
import { networkManager, NetworkAction } from './NetworkManager';

export type GameStatus =
  | 'title'
  | 'select'
  | 'online_lobby'
  | 'playing'
  | 'paused'
  | 'stage_clear'
  | 'victory'
  | 'defeat';

// v2.2 anti-instant-kill: no single direct character hit deals more than
// 35 damage. (Core hits are not capped.)
export const MAX_SINGLE_HIT_DMG = 35;

// v2.2 shrink anchor clamp: the 90s safe-zone center is clamped into the
// inner area (columns 3-7, rows 2-4, 1-indexed) so it never overlaps the
// core-collapse columns (1 and 9). Exported for headless verification.
export function clampShrinkAnchor(
  x: number,
  y: number,
  originX: number,
  originY: number,
  cellW: number,
  cellH: number,
  gap: number
): { x: number; y: number } {
  const stepX = cellW + gap;
  const stepY = cellH + gap;
  // 0-based columns 2..6 (1-indexed 3..7), rows 1..3 (1-indexed 2..4).
  const minX = originX + 2 * stepX + cellW / 2;
  const maxX = originX + 6 * stepX + cellW / 2;
  const minY = originY + 1 * stepY + cellH / 2;
  const maxY = originY + 3 * stepY + cellH / 2;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

// v2.2: a sniper projectile of 1-2 cells deals 50% damage to the rear core
// (character direct hits stay at 100%).
export function sniperCoreDamageMult(archetypeId: string | undefined, cellCount: number): number {
  return archetypeId === 'sniper' && cellCount <= 2 ? 0.5 : 1;
}

export class GameEngine {
  public canvas: HTMLCanvasElement | null = null;
  public ctx: CanvasRenderingContext2D | null = null;

  public status: GameStatus = 'title';
  public mode: GameMode = 'single';
  public currentStage: number = 1;

  public isOnline: boolean = false;
  public onlineRole: 'p1' | 'p2' = 'p1';
  public onlineRoomCode: string | null = null;
  private networkSyncTimer: number = 0;
  // Board reconciliation (online): hash exchange timer, consecutive
  // mismatches, and whether a snapshot request is outstanding.
  private boardSyncTimer: number = 0;
  private boardHashStreak: number = 0;
  private boardSyncPending: boolean = false;
  private boardSyncPendingSince: number = 0;
  // Set once a mid-battle disconnect has been resolved to a result, so the
  // poll in update() and the onPeerLeft callback cannot fire twice.
  private peerDisconnectHandled: boolean = false;

  public renderer: CanvasRenderer;
  public playerBoard: GridBoard;
  public enemyBoard: GridBoard;
  public player: PlayerCharacter;
  public player2: PlayerCharacter | null = null;
  public enemy: AIController;
  public projectileMgr: ProjectileManager;
  public particleSystem: ParticleSystem;

  public keys: Record<string, boolean> = {};
  public gameTime: number = 0;
  public screenShake: number = 0;
  public hitstopTimer: number = 0;

  public comboCount: number = 0;
  public comboTimer: number = 0;
  public comboMax: number = 0;

  // v2.2: independent combo for the second side (local/online 2P only;
  // single/boss track the player's combo alone).
  public combo2Count: number = 0;
  public combo2Timer: number = 0;
  public combo2Max: number = 0;

  public get comboMultiplier(): number {
    if (this.comboCount <= 1) return 1.0;
    return Math.min(3.0, 1.0 + (this.comboCount - 1) * 0.2);
  }

  public get combo2Multiplier(): number {
    if (this.combo2Count <= 1) return 1.0;
    return Math.min(3.0, 1.0 + (this.combo2Count - 1) * 0.2);
  }

  // v2.2 rear cores: one per side. Player core is always 250 HP; the
  // enemy core is 250, or 350 in the final boss stage.
  public playerCore: CoreState = { hp: 250, maxHp: 250, collapsed: false, crack: 0 };
  public enemyCore: CoreState = { hp: 250, maxHp: 250, collapsed: false, crack: 0 };

  // v2.2 90-second shrink zone. Anchors are each side's character position
  // at 90s; rects are the current safe zones in canvas coordinates.
  public shrinkPhase: ShrinkPhase = 'idle';
  public shrinkAnchor: { x: number; y: number } | null = null;
  public shrinkAnchor2: { x: number; y: number } | null = null;
  public shrinkRect: ShrinkRect | null = null;
  public shrinkRect2: ShrinkRect | null = null;
  public shrinkSent: boolean = false;
  private shrinkWarned: boolean = false;
  private pendingRemoteAnchor: { normX: number; normY: number } | null = null;
  private shrinkDmgAcc: number = 0;
  private shrinkDmgAcc2: number = 0;
  private refillSoundTimer: number = 0;

  public stats: GameStats = {
    damageDealt: 0,
    damageTaken: 0,
    shapesLaunched: 0,
    tilesDiscarded: 0,
    clashesWon: 0,
    maxClusterSize: 0,
    maxCombo: 0,
    gameDuration: 0,
    currentStage: 1,
  };

  // v2.3 campaign run: a live 1..30 no-continue attempt. A fresh run starts
  // at stage 1; a defeat (or leaving for the title) breaks/abandons it.
  // The victory modal reads lastNoContinue when the run completes.
  public campaignRun: CampaignRunState | null = null;
  public lastNoContinue: NoContinueRecord | null = null;

  private animationFrameId: number | null = null;
  private lastTime: number = 0;
  private onStateChangeCallback?: () => void;
  private lastPadButton0: boolean = false;
  private lastPadButton1: boolean = false;

  constructor(onStateChange?: () => void) {
    this.onStateChangeCallback = onStateChange;
    this.renderer = new CanvasRenderer();
    this.playerBoard = new GridBoard('player');
    this.enemyBoard = new GridBoard('enemy');
    this.particleSystem = new ParticleSystem();
    this.projectileMgr = new ProjectileManager();

    const pStartX = this.renderer.playerOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const pStartY = this.renderer.playerOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.player = new PlayerCharacter(pStartX, pStartY, false);

    const eStartX = this.renderer.enemyOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const eStartY = this.renderer.enemyOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.enemy = new AIController(eStartX, eStartY);
    this.resetCores();

    // v2.2 counter-overcharge: a clash winner's launcher gets -1.0s skill
    // cooldown and the win is counted for the result screen.
    this.projectileMgr.onClashWin = (winnerOwner) => {
      this.stats.clashesWon++;
      if (winnerOwner === 'player') {
        this.player.skillCooldownRemaining = Math.max(0, this.player.skillCooldownRemaining - 1.0);
      } else if (this.player2) {
        this.player2.skillCooldownRemaining = Math.max(0, this.player2.skillCooldownRemaining - 1.0);
      }
    };
  }

  // v2.2: reset both rear cores and the whole shrink-zone state. Called on
  // every battle start (and from the constructor for the title screen).
  private resetCores() {
    const enemyCoreHp = this.mode === 'multi' ? 250 : STAGES[this.currentStage - 1].coreHp;
    this.playerCore = { hp: 250, maxHp: 250, collapsed: false, crack: 0 };
    this.enemyCore = { hp: enemyCoreHp, maxHp: enemyCoreHp, collapsed: false, crack: 0 };
    this.shrinkPhase = 'idle';
    this.shrinkAnchor = null;
    this.shrinkAnchor2 = null;
    this.shrinkRect = null;
    this.shrinkRect2 = null;
    this.shrinkSent = false;
    this.shrinkWarned = false;
    this.pendingRemoteAnchor = null;
    this.shrinkDmgAcc = 0;
    this.shrinkDmgAcc2 = 0;
  }

  // v2.2: apply damage to a rear core, update its crack stage, and trigger
  // the 50% collapse (outer columns lock, characters pushed inward).
  private setCoreHp(side: 'player' | 'enemy', newHp: number) {
    const core = side === 'player' ? this.playerCore : this.enemyCore;
    core.hp = Math.max(0, newHp);
    core.crack = core.hp <= core.maxHp * 0.3 ? 2 : core.hp <= core.maxHp * 0.6 ? 1 : 0;
    if (!core.collapsed && core.hp <= core.maxHp * 0.5) {
      this.collapseSide(side);
    }
  }

  private damageCore(side: 'player' | 'enemy', dmg: number): number {
    const core = side === 'player' ? this.playerCore : this.enemyCore;
    this.setCoreHp(side, core.hp - dmg);
    return core.hp;
  }

  // v2.2 core collapse: lock the outer columns and push any character
  // standing on them one column inward with 0.3s invincibility.
  private collapseSide(side: 'player' | 'enemy') {
    const core = side === 'player' ? this.playerCore : this.enemyCore;
    const board = side === 'player' ? this.playerBoard : this.enemyBoard;
    if (core.collapsed) return;
    core.collapsed = true;
    board.collapseSides();
    const originX = side === 'player' ? this.renderer.playerOriginX : this.renderer.enemyOriginX;
    const step = this.renderer.cellW + this.renderer.gap;
    const centerX = (col: number) => originX + col * step + this.renderer.cellW / 2;

    if (side === 'player') {
      const c = this.player;
      if (c.currentCol === 0 || c.currentCol === GRID_COLS - 1) {
        const inner = c.currentCol === 0 ? 1 : GRID_COLS - 2;
        c.currentCol = inner;
        c.x = centerX(inner);
        c.targetX = c.x;
        c.invincibleTimer = 0.3;
        this.particleSystem.addFloatingText(c.x, c.y - 40, 'PUSHED IN!', '#FFD166', 16);
      }
    } else if (this.player2) {
      const c = this.player2;
      if (c.currentCol === 0 || c.currentCol === GRID_COLS - 1) {
        const inner = c.currentCol === 0 ? 1 : GRID_COLS - 2;
        c.currentCol = inner;
        c.x = centerX(inner);
        c.targetX = c.x;
        c.invincibleTimer = 0.3;
        this.particleSystem.addFloatingText(c.x, c.y - 40, 'PUSHED IN!', '#FFD166', 16);
      }
    } else {
      // Single/boss: the AI opponent.
      const c = this.enemy;
      if (c.currentCol === 0 || c.currentCol === GRID_COLS - 1) {
        const inner = c.currentCol === 0 ? 1 : GRID_COLS - 2;
        c.currentCol = inner;
        c.x = centerX(inner);
        c.invincibleTimer = 0.3;
        this.particleSystem.addFloatingText(c.x, c.y - 40, 'PUSHED IN!', '#FFD166', 16);
      }
    }
    this.triggerStateUpdate();
  }

  // v2.2 frontline bonus: a launch counts as frontline when any of its
  // tiles sits in the front 2 rows (player rows 0-1, enemy rows 3-4).
  private isFrontlineLaunch(owner: 'player' | 'enemy', cluster: Cluster): boolean {
    if (owner === 'player') {
      return cluster.tiles.some((t) => t.row <= 1);
    }
    return cluster.tiles.some((t) => t.row >= GRID_ROWS - 2);
  }

  // --- v2.2 shrink zone ---------------------------------------------------
  private boardRect(originX: number, originY: number, board: GridBoard): ShrinkRect {
    const range = board.colRange();
    const step = this.renderer.cellW + this.renderer.gap;
    const rowStep = this.renderer.cellH + this.renderer.gap;
    return {
      x: originX + range.min * step,
      y: originY,
      w: (range.max - range.min + 1) * step - this.renderer.gap,
      h: GRID_ROWS * rowStep - this.renderer.gap,
    };
  }

  // Map a normalized anchor from the peer's bottom board onto my top board.
  private mirrorAnchor(normX: number, normY: number): { x: number; y: number } {
    const totalW = GRID_COLS * this.renderer.cellW + (GRID_COLS - 1) * this.renderer.gap;
    const totalH = GRID_ROWS * this.renderer.cellH + (GRID_ROWS - 1) * this.renderer.gap;
    return {
      x: this.renderer.enemyOriginX + normX * totalW,
      y: this.renderer.enemyOriginY + (1 - normY) * totalH,
    };
  }

  // Clamp an anchor into the inner safe area (cols 3-7, rows 2-4) using
  // this renderer's geometry.
  private clampAnchor(x: number, y: number, originX: number, originY: number): { x: number; y: number } {
    return clampShrinkAnchor(x, y, originX, originY, this.renderer.cellW, this.renderer.cellH, this.renderer.gap);
  }

  private startShrink() {
    this.shrinkPhase = 'shrinking';
    // Anchors are clamped into the inner safe area (cols 3-7, rows 2-4)
    // so the safe zone never sits on a collapsed outer column.
    this.shrinkAnchor = this.clampAnchor(this.player.x, this.player.y, this.renderer.playerOriginX, this.renderer.playerOriginY);
    if (this.pendingRemoteAnchor) {
      const mirrored = this.mirrorAnchor(this.pendingRemoteAnchor.normX, this.pendingRemoteAnchor.normY);
      this.shrinkAnchor2 = this.clampAnchor(mirrored.x, mirrored.y, this.renderer.enemyOriginX, this.renderer.enemyOriginY);
      this.pendingRemoteAnchor = null;
    } else {
      const opp = this.player2 ?? this.enemy;
      this.shrinkAnchor2 = this.clampAnchor(opp.x, opp.y, this.renderer.enemyOriginX, this.renderer.enemyOriginY);
    }
    this.shrinkRect = this.boardRect(this.renderer.playerOriginX, this.renderer.playerOriginY, this.playerBoard);
    this.shrinkRect2 = this.boardRect(this.renderer.enemyOriginX, this.renderer.enemyOriginY, this.enemyBoard);
    if (this.isOnline && !this.shrinkSent) {
      this.shrinkSent = true;
      const totalW = GRID_COLS * this.renderer.cellW + (GRID_COLS - 1) * this.renderer.gap;
      const totalH = GRID_ROWS * this.renderer.cellH + (GRID_ROWS - 1) * this.renderer.gap;
      // The exchanged anchor is the CLAMPED one.
      networkManager.sendAction('sudden_death_anchor', {
        normX: Math.max(0, Math.min(1, (this.shrinkAnchor.x - this.renderer.playerOriginX) / totalW)),
        normY: Math.max(0, Math.min(1, (this.shrinkAnchor.y - this.renderer.playerOriginY) / totalH)),
      });
    }
    this.particleSystem.addFloatingText(960, 120, '수축 존 시작!', '#FF4444', 24);
    soundManager.playBossWarning();
    this.triggerStateUpdate();
  }

  // Shrink the safe rect from the full (possibly collapsed) board toward a
  // 2x2-tile zone centered on the anchor over 90..120s; fully closed at 135s.
  private shrinkRectFor(anchor: { x: number; y: number } | null, full: ShrinkRect | null, t: number): ShrinkRect | null {
    if (!anchor || !full) return null;
    const stepX = this.renderer.cellW + this.renderer.gap;
    const stepY = this.renderer.cellH + this.renderer.gap;
    const targetW = 2 * stepX - this.renderer.gap;
    const targetH = 2 * stepY - this.renderer.gap;
    if (t >= 45) {
      return { x: anchor.x, y: anchor.y, w: 0, h: 0 };
    }
    const progress = Math.min(1, Math.max(0, t / 30));
    const tx = Math.max(full.x, Math.min(full.x + full.w - targetW, anchor.x - targetW / 2));
    const ty = Math.max(full.y, Math.min(full.y + full.h - targetH, anchor.y - targetH / 2));
    return {
      x: full.x + (tx - full.x) * progress,
      y: full.y + (ty - full.y) * progress,
      w: full.w + (targetW - full.w) * progress,
      h: full.h + (targetH - full.h) * progress,
    };
  }

  private updateShrinkRects() {
    const t = this.gameTime - 90;
    const fullP = this.boardRect(this.renderer.playerOriginX, this.renderer.playerOriginY, this.playerBoard);
    const fullE = this.boardRect(this.renderer.enemyOriginX, this.renderer.enemyOriginY, this.enemyBoard);
    this.shrinkRect = this.shrinkRectFor(this.shrinkAnchor, fullP, t);
    this.shrinkRect2 = this.shrinkRectFor(this.shrinkAnchor2, fullE, t);
    if (t >= 45) this.shrinkPhase = 'closed';
    // Lock every tile whose center lies outside its side's safe rect.
    this.applyShrinkLocks(this.playerBoard, this.shrinkRect, this.renderer.playerOriginX, this.renderer.playerOriginY);
    this.applyShrinkLocks(this.enemyBoard, this.shrinkRect2, this.renderer.enemyOriginX, this.renderer.enemyOriginY);
  }

  private applyShrinkLocks(board: GridBoard, rect: ShrinkRect | null, originX: number, originY: number) {
    const stepX = this.renderer.cellW + this.renderer.gap;
    const stepY = this.renderer.cellH + this.renderer.gap;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const cx = originX + c * stepX + this.renderer.cellW / 2;
        const cy = originY + r * stepY + this.renderer.cellH / 2;
        const inside = !!rect && cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
        board.setShrinkLocked(c, r, !inside);
      }
    }
  }

  private pointInRect(x: number, y: number, rect: ShrinkRect | null): boolean {
    return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  // Outside-wall damage: 8 HP/s in 1-HP ticks, ignoring dash
  // invincibility, plus x0.7 move speed while outside.
  private applyShrinkDamage(dt: number) {
    if (this.shrinkRect && !this.pointInRect(this.player.x, this.player.y, this.shrinkRect)) {
      this.player.externalSpeedMult = 0.7;
      this.shrinkDmgAcc += 8 * dt;
      while (this.shrinkDmgAcc >= 1) {
        this.shrinkDmgAcc -= 1;
        this.player.hp = Math.max(0, this.player.hp - 1);
        this.player.hitFlashTimer = 0.2;
        this.stats.damageTaken += 1;
      }
    } else {
      this.player.externalSpeedMult = 1.0;
    }
    if (this.shrinkRect2) {
      if (this.player2) {
        if (!this.pointInRect(this.player2.x, this.player2.y, this.shrinkRect2)) {
          this.player2.externalSpeedMult = 0.7;
          this.shrinkDmgAcc2 += 8 * dt;
          while (this.shrinkDmgAcc2 >= 1) {
            this.shrinkDmgAcc2 -= 1;
            this.player2!.hp = Math.max(0, this.player2!.hp - 1);
            this.player2!.hitFlashTimer = 0.2;
          }
        } else {
          this.player2.externalSpeedMult = 1.0;
        }
      } else if (!this.pointInRect(this.enemy.x, this.enemy.y, this.shrinkRect2)) {
        this.enemy.speedMult = 0.7;
        this.shrinkDmgAcc2 += 8 * dt;
        while (this.shrinkDmgAcc2 >= 1) {
          this.shrinkDmgAcc2 -= 1;
          this.enemy.hp = Math.max(0, this.enemy.hp - 1);
          this.enemy.hitFlashTimer = 0.2;
        }
      } else {
        this.enemy.speedMult = 1.0;
      }
    }
  }

  public init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setupInputs();
    this.startLoop();
  }

  public destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.removeInputs();
  }

  private setupInputs() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  private removeInputs() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;

    // Number keys 1~7 to instant switch archetype (P1 in single/boss mode)
    if (this.mode !== 'multi' && ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].includes(e.code)) {
      const idx = parseInt(e.code.replace('Digit', ''), 10) - 1;
      const archetypeKeys: ArchetypeId[] = [
        'lancer',
        'wave',
        'sniper',
        'painter',
        'transporter',
        'speedster',
        'monochrome',
      ];
      if (archetypeKeys[idx]) {
        this.player.setArchetype(archetypeKeys[idx]);
        this.particleSystem.addFloatingText(
          this.player.x,
          this.player.y - 40,
          `CLASS: ${ARCHETYPES[archetypeKeys[idx]].name.toUpperCase()}`,
          ARCHETYPES[archetypeKeys[idx]].color,
          17
        );
        this.triggerStateUpdate();
      }
    }

    // Local Player Controls (P1). In local 2P, P1 uses the left-side
    // modifiers and letter keys only; P2 gets Enter / right modifiers /
    // Slash below, so the two players never share a key.
    const isLocal2P = this.mode === 'multi' && !this.isOnline;

    // Space: Attack / Launch
    if (e.code === 'Space' || e.code === 'KeyJ') {
      e.preventDefault();
      this.handlePlayerLaunch(1);
    }

    // Ctrl: Active Skill (preventDefault prevents browser shortcut triggers)
    if (
      e.code === 'ControlLeft' ||
      (!isLocal2P && e.code === 'ControlRight') ||
      e.code === 'KeyK' ||
      e.code === 'KeyQ'
    ) {
      e.preventDefault();
      this.handlePlayerSkill(1);
    }

    // Shift: Dash (i-frame evasion)
    if (e.code === 'ShiftLeft' || (!isLocal2P && e.code === 'ShiftRight') || e.code === 'KeyC') {
      e.preventDefault();
      this.handlePlayerDash(1);
    }

    // X or E or L: Discard tile (Fast reload)
    if (e.code === 'KeyX' || e.code === 'KeyE' || e.code === 'KeyL') {
      e.preventDefault();
      this.handlePlayerDiscard(1);
    }

    // Local 2P controls (P2, top board): Enter launch, ShiftRight dash,
    // ControlRight skill, Slash discard. P2 moves with Arrow keys.
    if (isLocal2P && this.player2) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.handlePlayerLaunch(2);
      } else if (e.code === 'ShiftRight') {
        e.preventDefault();
        this.handlePlayerDash(2);
      } else if (e.code === 'ControlRight') {
        e.preventDefault();
        this.handlePlayerSkill(2);
      } else if (e.code === 'Slash') {
        e.preventDefault();
        this.handlePlayerDiscard(2);
      }
    }

    // Escape or P: Pause (blocked while online: pausing one side would
    // desync the battle; togglePause guards it too)
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      this.togglePause();
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };

  private handleBlur = () => {
    this.keys = {};
  };

  public startGame(
    mode: GameMode = 'single',
    stage: number = 1,
    p1Archetype: ArchetypeId = 'lancer',
    p2Archetype: ArchetypeId = 'wave'
  ) {
    // Offline start: make sure no stale online state leaks in (a previous
    // online battle must not leave move-sync / pause-block / broadcasts on).
    this.isOnline = false;
    this.onlineRole = 'p1';
    this.onlineRoomCode = null;
    this.networkSyncTimer = 0;
    this.boardSyncTimer = 0;
    this.boardHashStreak = 0;
    this.boardSyncPending = false;
    this.peerDisconnectHandled = false;
    this.mode = mode;
    this.status = 'playing';
    this.gameTime = 0;

    if (mode === 'boss') {
      this.currentStage = 30;
    } else if (mode === 'multi') {
      this.currentStage = 1;
    } else {
      this.currentStage = stage;
    }

    // v2.3 campaign run: a fresh no-continue run starts at stage 1.
    // Jumping to a later stage (or boss rush) abandons any active run;
    // advanceToNextStage keeps the run alive.
    if (mode === 'single') {
      if (stage === 1) {
        this.campaignRun = startCampaignRun(1);
      } else if (!this.campaignRun || this.campaignRun.startStage !== 1) {
        this.campaignRun = null;
      }
    } else {
      this.campaignRun = null;
    }
    this.lastNoContinue = null;

    // v2.3: renderer tints the background by sector/stage.
    this.renderer.stageId = this.currentStage;

    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboMax = 0;
    this.combo2Count = 0;
    this.combo2Timer = 0;
    this.combo2Max = 0;
    this.resetCores();

    this.stats = {
      damageDealt: 0,
      damageTaken: 0,
      shapesLaunched: 0,
      tilesDiscarded: 0,
      clashesWon: 0,
      maxClusterSize: 0,
      maxCombo: 0,
      gameDuration: 0,
      currentStage: this.currentStage,
    };

    this.playerBoard.reset();
    this.enemyBoard.reset();
    this.projectileMgr.clear();
    this.particleSystem.clear();

    const pStartX = this.renderer.playerOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const pStartY = this.renderer.playerOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.player.reset(pStartX, pStartY);
    this.player.setArchetype(p1Archetype);

    const eStartX = this.renderer.enemyOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const eStartY = this.renderer.enemyOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;

    if (mode === 'multi') {
      this.player2 = new PlayerCharacter(eStartX, eStartY, true);
      this.player2.setArchetype(p2Archetype);
    } else {
      this.player2 = null;
      this.enemy.reset(eStartX, eStartY, this.currentStage);
      const cfg = STAGES[this.currentStage - 1];
      if (cfg.isFinalBoss || cfg.isSectorBoss) {
        soundManager.playBossWarning();
      }
    }

    soundManager.playSwitch();
    this.triggerStateUpdate();
  }

  public startOnlineGame(
    role: 'p1' | 'p2',
    roomCode: string,
    p1Arch: ArchetypeId,
    p2Arch: ArchetypeId,
    seed: number = 7777777
  ) {
    this.isOnline = true;
    this.onlineRole = role;
    this.onlineRoomCode = roomCode;
    this.mode = 'multi';
    this.status = 'playing';
    this.gameTime = 0;
    this.networkSyncTimer = 0;
    this.boardSyncTimer = 0;
    this.boardHashStreak = 0;
    this.boardSyncPending = false;
    this.peerDisconnectHandled = false;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboMax = 0;
    this.combo2Count = 0;
    this.combo2Timer = 0;
    this.combo2Max = 0;
    this.resetCores();

    this.stats = {
      damageDealt: 0,
      damageTaken: 0,
      shapesLaunched: 0,
      tilesDiscarded: 0,
      clashesWon: 0,
      maxClusterSize: 0,
      maxCombo: 0,
      gameDuration: 0,
      currentStage: 1,
    };

    // Symmetrical PRNG Board Seeds:
    // Host's bottom board is identical to Guest's top board
    // Guest's bottom board is identical to Host's top board
    const hostBoardSeed = Math.abs(seed) || 7777777;
    const guestBoardSeed = Math.abs(seed + 99991) || 8888888;

    if (role === 'p1') {
      this.playerBoard.reset(hostBoardSeed);
      this.enemyBoard.reset(guestBoardSeed, true);
    } else {
      this.playerBoard.reset(guestBoardSeed);
      this.enemyBoard.reset(hostBoardSeed, true);
    }

    this.projectileMgr.clear();
    this.particleSystem.clear();

    // Symmetrical View: My player is ALWAYS at bottom, remote opponent is at top
    const myArch = role === 'p1' ? p1Arch : p2Arch;
    const oppArch = role === 'p1' ? p2Arch : p1Arch;

    const pStartX = this.renderer.playerOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const pStartY = this.renderer.playerOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.player.reset(pStartX, pStartY);
    this.player.setArchetype(myArch);

    const eStartX = this.renderer.enemyOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const eStartY = this.renderer.enemyOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.player2 = new PlayerCharacter(eStartX, eStartY, true);
    this.player2.setArchetype(oppArch);

    networkManager.onPeerAction = (action) => {
      this.handleRemoteAction(action);
    };

    networkManager.onPeerLeft = () => {
      // The opponent left mid-battle: this is a win, not a freeze. (The old
      // handler only showed floating text and the game continued against a
      // frozen opponent forever.) The poll in update() covers the case
      // where this callback gets overwritten by the lobby modal.
      if (this.status === 'playing' && !this.peerDisconnectHandled) {
        this.peerDisconnectHandled = true;
        this.status = 'victory';
        this.particleSystem.addFloatingText(960, 540, 'OPPONENT DISCONNECTED!', '#FF3366', 22);
        soundManager.playVictory();
        this.triggerStateUpdate();
      }
    };

    soundManager.playSwitch();
    this.triggerStateUpdate();
  }

  private handleRemoteAction(action: NetworkAction) {
    if (!this.player2) return;
    // Late packets from a finished battle must not spawn projectiles or
    // change HP after the result screen. Rematches arrive as battle_start,
    // not as peer actions, so this guard cannot block a new battle.
    if (this.status !== 'playing') return;

    const totalW = GRID_COLS * this.renderer.cellW + (GRID_COLS - 1) * this.renderer.gap;
    const totalH = GRID_ROWS * this.renderer.cellH + (GRID_ROWS - 1) * this.renderer.gap;

    switch (action.type) {
      case 'move': {
        const d = action.data as {
          normX: number;
          normY: number;
          col: number;
          row: number;
          isDashing?: boolean;
        };
        const oppNormX = typeof d.normX === 'number' ? Math.max(0, Math.min(1, d.normX)) : 0.5;
        // Vertically mirrored: frontline faces frontline!
        const oppNormY = typeof d.normY === 'number' ? 1.0 - Math.max(0, Math.min(1, d.normY)) : 0.5;

        const targetX = this.renderer.enemyOriginX + oppNormX * totalW;
        const targetY = this.renderer.enemyOriginY + oppNormY * totalH;

        this.player2.setRemotePosition(targetX, targetY, d.col ?? 0, GRID_ROWS - 1 - (d.row ?? 0));
        if (d.isDashing && this.player2.dashDurationRemaining <= 0) {
          // Force-apply: the remote copy's dash cooldown lags by network
          // latency, so checking it would drop dashes that really happened.
          this.player2.dashCooldownRemaining = 0;
          this.player2.performDash(this.particleSystem);
        }
        break;
      }
      case 'dash': {
        this.player2.dashCooldownRemaining = 0;
        this.player2.performDash(this.particleSystem);
        break;
      }
      case 'launch': {
        const d = action.data as {
          cluster: {
            color: any;
            shapeType: any;
            shapeTitle?: string;
            tiles: { col: number; row: number }[];
          };
          archetypeId: ArchetypeId;
          overdrive?: boolean;
          painterProc?: boolean;
          frontline?: boolean;
          col?: number;
          row?: number;
        };
        if (!d.cluster) break;
        // Map cluster to enemy board (rows flipped)
        const mappedCluster: Cluster = {
          id: `remote_proj_${Date.now()}`,
          color: d.cluster.color,
          shapeType: d.cluster.shapeType,
          shapeTitle: d.cluster.shapeTitle || '',
          isActivePad: true,
          tiles: d.cluster.tiles.map((t) => ({
            col: t.col,
            row: GRID_ROWS - 1 - t.row,
          })),
        };

        const originY = this.renderer.enemyOriginY;
        this.projectileMgr.createProjectile(
          'enemy',
          mappedCluster,
          this.renderer.enemyOriginX,
          originY,
          this.renderer.cellW,
          this.renderer.cellH,
          this.renderer.gap,
          d.archetypeId || this.player2.archetypeId,
          !!d.overdrive,
          !!d.frontline
        );
        this.enemyBoard.launchCluster(mappedCluster);
        // A launched tile can no longer be a held Transporter grab.
        if (
          this.player2.grabbedPos &&
          mappedCluster.tiles.some(
            (t) => t.col === this.player2!.grabbedPos!.col && t.row === this.player2!.grabbedPos!.row
          )
        ) {
          this.player2.grabbedPos = null;
          this.player2.grabbedTileColor = null;
        }
        // Painter 10% passive: the sender rolled it and sent the result, so
        // both sides paint the same (mirrored) tiles.
        if (d.painterProc) {
          this.enemyBoard.paintAdjacentDominant(
            d.col ?? this.player2.currentCol,
            GRID_ROWS - 1 - (d.row ?? this.player2.currentRow)
          );
        }
        soundManager.playLaunch(mappedCluster.color, mappedCluster.tiles.length, mappedCluster.shapeType);
        this.particleSystem.emitLaunchParticles(this.player2.x, this.player2.y, '#FF3366');
        break;
      }
      case 'absorb': {
        // Monochrome absorb: non-red cluster evaporates into shield instead
        // of launching. Mirror the tile consumption + shield onto the
        // remote player's copy.
        const d = action.data as {
          tiles: { col: number; row: number }[];
          shieldGain?: number;
        };
        if (!d.tiles) break;
        const mapped: Cluster = {
          id: `remote_absorb_${Date.now()}`,
          color: 'red',
          shapeType: 'standard',
          shapeTitle: '',
          isActivePad: false,
          tiles: d.tiles.map((t) => ({
            col: t.col,
            row: GRID_ROWS - 1 - t.row,
          })),
        };
        this.enemyBoard.launchCluster(mapped, 0.5);
        this.player2.shield = Math.min(
          40,
          this.player2.shield + (typeof d.shieldGain === 'number' ? d.shieldGain : 10)
        );
        this.particleSystem.addFloatingText(this.player2.x, this.player2.y - 30, '+10 SHIELD ABSORBED!', '#33CCFF', 16);
        break;
      }
      case 'skill': {
        const d = action.data as {
          archetypeId: ArchetypeId;
          col: number;
          row: number;
          effect?: SkillEffect;
        };
        if (typeof d.col === 'number') this.player2.currentCol = d.col;
        if (typeof d.row === 'number') this.player2.currentRow = GRID_ROWS - 1 - d.row;

        const stepX = this.renderer.cellW + this.renderer.gap;
        const stepY = this.renderer.cellH + this.renderer.gap;
        this.player2.x = this.renderer.enemyOriginX + this.player2.currentCol * stepX + this.renderer.cellW / 2;
        this.player2.y = this.renderer.enemyOriginY + this.player2.currentRow * stepY + this.renderer.cellH / 2;
        this.player2.targetX = this.player2.x;
        this.player2.targetY = this.player2.y;

        // Force-apply: the skill already fired on the sender's side. The
        // remote copy's cooldown lags by latency; checking it would drop
        // skills that really happened and desync the boards.
        this.player2.skillCooldownRemaining = 0;
        // Mirror the explicit skill effect into this board's frame (the
        // sender's rows are flipped from this side's point of view).
        let effect: SkillEffect | null = null;
        if (d.effect?.kind === 'wave') {
          effect = {
            kind: 'wave',
            tiles: d.effect.tiles.map((t) => ({
              col: t.col,
              row: GRID_ROWS - 1 - t.row,
              color: t.color,
            })),
          };
        } else if (d.effect?.kind === 'monochrome') {
          effect = {
            kind: 'monochrome',
            tiles: d.effect.tiles.map((t) => ({ col: t.col, row: GRID_ROWS - 1 - t.row })),
          };
        }
        this.player2.triggerSkill(
          this.enemyBoard,
          this.particleSystem,
          this.renderer.enemyOriginX,
          this.renderer.enemyOriginY,
          this.renderer.cellW,
          this.renderer.cellH,
          this.renderer.gap,
          () => {
            this.projectileMgr.createSniperBeam(
              'enemy',
              this.player2?.currentCol || 0,
              this.renderer.enemyOriginX,
              this.renderer.enemyOriginY,
              this.renderer.cellW,
              this.renderer.cellH,
              this.renderer.gap
            );
            soundManager.playLaunch('yellow', 1, 'spear');
          },
          effect
        );
        break;
      }
      case 'discard': {
        const d = action.data as { col: number; row: number };
        this.enemyBoard.discardTile(d.col, GRID_ROWS - 1 - d.row);
        // Keep the remote copy's discard magazine in step with the sender.
        this.player2.discardStacks = Math.max(0, this.player2.discardStacks - 1);
        soundManager.playDiscard();
        break;
      }
      case 'hit': {
        const d = action.data as { newHp: number; dmg: number };
        this.player2.hp = d.newHp;
        this.player2.hitFlashTimer = 0.2;
        soundManager.playHit(true, 0);
        this.particleSystem.emitBlockDestruction(this.player2.x, this.player2.y, '#FF3366', 15);
        this.particleSystem.addFloatingText(this.player2.x, this.player2.y - 30, `-${d.dmg} HIT!`, '#FF3366', 18);
        this.triggerStateUpdate();
        break;
      }
      case 'core_hit': {
        // The peer hit MY core and sends the authoritative HP: apply it to
        // my copy of their core (the top core on my screen).
        const d = action.data as { newHp: number; dmg: number };
        this.setCoreHp('enemy', d.newHp);
        soundManager.playHit(true, 0);
        this.particleSystem.addFloatingText(this.player2.x, this.player2.y - 50, `CORE -${d.dmg}!`, '#FF0055', 20);
        this.triggerStateUpdate();
        break;
      }
      case 'sudden_death_anchor': {
        // The peer reached 90s and sends its anchor (normalized to its own
        // bottom board). Mirror it onto my top board. If my shrink has not
        // started yet, hold it until it does.
        const d = action.data as { normX: number; normY: number };
        if (typeof d.normX !== 'number' || typeof d.normY !== 'number') break;
        if (this.shrinkPhase === 'shrinking' || this.shrinkPhase === 'closed') {
          this.shrinkAnchor2 = this.mirrorAnchor(d.normX, d.normY);
        } else {
          this.pendingRemoteAnchor = { normX: d.normX, normY: d.normY };
        }
        break;
      }
      case 'board_hash': {
        // Compare the sender's bottom board with my copy of it (the top
        // board, mirrored). One mismatch can be an in-flight packet, so a
        // snapshot is requested only after two consecutive mismatches.
        const d = action.data as { hash: string };
        if (typeof d.hash !== 'string') break;
        if (d.hash === this.enemyBoard.colorHash(true)) {
          this.boardHashStreak = 0;
        } else {
          this.boardHashStreak++;
          if (this.boardHashStreak >= 2 && !this.boardSyncPending) {
            this.boardSyncPending = true;
            this.boardSyncPendingSince = this.gameTime;
            this.boardHashStreak = 0;
            networkManager.sendAction('board_request', {});
          }
        }
        break;
      }
      case 'board_request': {
        // The peer's copy of my board drifted: send the authoritative
        // snapshot (my bottom board, unmirrored; the peer mirrors it).
        networkManager.sendAction('board_sync', { snapshot: this.playerBoard.snapshot() });
        break;
      }
      case 'board_sync': {
        const d = action.data as { snapshot: BoardSnapshot };
        this.boardSyncPending = false;
        this.boardHashStreak = 0;
        if (d.snapshot) {
          this.enemyBoard.applySnapshot(d.snapshot, true);
        }
        break;
      }
      // NOTE: no 'rematch' peer_action case on purpose. Rematches are
      // coordinated by the server, which sends one shared battle_start
      // (single seed) once both players request one. A peer-relayed
      // rematch restarted each side with its own Date.now() seed and
      // desynced the boards.
    }
  }

  public advanceToNextStage() {
    this.currentStage = Math.min(30, this.currentStage + 1);
    this.status = 'playing';
    this.comboCount = 0;
    this.comboTimer = 0;
    this.combo2Count = 0;
    this.combo2Timer = 0;
    this.combo2Max = 0;
    this.resetCores();
    this.renderer.stageId = this.currentStage;

    this.playerBoard.reset();
    this.enemyBoard.reset();
    this.projectileMgr.clear();
    this.particleSystem.clear();

    const pStartX = this.renderer.playerOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const pStartY = this.renderer.playerOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.player.reset(pStartX, pStartY);

    const eStartX = this.renderer.enemyOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const eStartY = this.renderer.enemyOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.enemy.reset(eStartX, eStartY, this.currentStage);

    if (this.currentStage === 30) {
      soundManager.playBossWarning();
    } else if (STAGES[this.currentStage - 1].isSectorBoss) {
      soundManager.playBossWarning();
    } else {
      soundManager.playSwitch();
    }

    this.triggerStateUpdate();
  }

  // Player Launch (P1 = bottom board, P2 = top board)
  public handlePlayerLaunch(playerNum: 1 | 2 = 1, broadcast: boolean = true) {
    if (this.status !== 'playing') return;

    const actor = playerNum === 1 ? this.player : this.player2;
    const board = playerNum === 1 ? this.playerBoard : this.enemyBoard;
    const ownerStr = playerNum === 1 ? 'player' : 'enemy';
    const originX = playerNum === 1 ? this.renderer.playerOriginX : this.renderer.enemyOriginX;
    const originY = playerNum === 1 ? this.renderer.playerOriginY : this.renderer.enemyOriginY;

    if (!actor) return;
    const cluster = board.getClusterAt(actor.currentCol, actor.currentRow);
    if (!cluster) return;

    // Monochrome special rule
    if (actor.archetypeId === 'monochrome' && cluster.color !== 'red') {
      if (this.isOnline && broadcast && playerNum === 1) {
        networkManager.sendAction('absorb', {
          tiles: cluster.tiles.map((t) => ({ col: t.col, row: t.row })),
          shieldGain: 10,
        });
      }
      board.launchCluster(cluster, 0.5);
      actor.shield = Math.min(40, actor.shield + 10);
      soundManager.playSkill('monochrome');
      this.particleSystem.addFloatingText(actor.x, actor.y - 30, '+10 SHIELD ABSORBED!', '#33CCFF', 16);
      this.particleSystem.addShockwave(actor.x, actor.y, 70, '#33CCFF');
      this.triggerStateUpdate();
      return;
    }

    if (!cluster.isActivePad) return;

    // Painter passive roll happens once here; the result is sent with the
    // launch so the remote side paints the same tiles.
    const painterProc = actor.archetypeId === 'painter' && Math.random() < 0.1;

    if (playerNum === 1) {
      this.stats.shapesLaunched++;
      if (cluster.tiles.length > this.stats.maxClusterSize) {
        this.stats.maxClusterSize = cluster.tiles.length;
      }
    }

    const frontline = this.isFrontlineLaunch(ownerStr, cluster);

    if (this.isOnline && broadcast && playerNum === 1) {
      networkManager.sendAction('launch', {
        cluster: {
          color: cluster.color,
          shapeType: cluster.shapeType,
          shapeTitle: cluster.shapeTitle,
          tiles: cluster.tiles.map((t) => ({ col: t.col, row: t.row })),
        },
        archetypeId: actor.archetypeId,
        overdrive: actor.overdriveActive,
        painterProc,
        frontline,
        col: actor.currentCol,
        row: actor.currentRow,
      });
    }

    // Painter passive
    if (painterProc) {
      board.paintAdjacentDominant(actor.currentCol, actor.currentRow);
    }

    const proj = this.projectileMgr.createProjectile(
      ownerStr,
      cluster,
      originX,
      originY,
      this.renderer.cellW,
      this.renderer.cellH,
      this.renderer.gap,
      actor.archetypeId,
      actor.overdriveActive,
      frontline
    );

    board.launchCluster(cluster);

    // A launched tile can no longer be a held Transporter grab.
    if (
      actor.grabbedPos &&
      cluster.tiles.some((t) => t.col === actor.grabbedPos!.col && t.row === actor.grabbedPos!.row)
    ) {
      actor.grabbedPos = null;
      actor.grabbedTileColor = null;
    }

    if (actor.overdriveActive) {
      actor.overdriveActive = false;
    }

    soundManager.playLaunch(cluster.color, cluster.tiles.length, cluster.shapeType);
    this.particleSystem.emitLaunchParticles(actor.x, actor.y, proj.glowColor);
    this.particleSystem.addShockwave(actor.x, actor.y, 60, proj.glowColor);

    if (cluster.tiles.length >= 9) {
      this.screenShake = 0.5;
      this.particleSystem.addFloatingText(actor.x, actor.y - 50, 'COLOSSAL BIG BLOCK!', '#FF0055', 20);
    } else if (cluster.tiles.length >= 6) {
      this.screenShake = 0.25;
      this.particleSystem.addFloatingText(actor.x, actor.y - 45, 'MEGA BLOCK!', '#FFAA00', 18);
    } else if (cluster.shapeType !== 'standard') {
      this.particleSystem.addFloatingText(actor.x, actor.y - 40, cluster.shapeTitle, '#FFFFFF', 16);
    }

    if (frontline) {
      this.particleSystem.addFloatingText(actor.x, actor.y - 62, 'FRONTLINE!', '#FFD166', 15);
    }

    this.triggerStateUpdate();
  }

  // Player Skill
  public handlePlayerSkill(playerNum: 1 | 2 = 1, broadcast: boolean = true) {
    if (this.status !== 'playing') return;

    const actor = playerNum === 1 ? this.player : this.player2;
    const board = playerNum === 1 ? this.playerBoard : this.enemyBoard;
    const originX = playerNum === 1 ? this.renderer.playerOriginX : this.renderer.enemyOriginX;
    const originY = playerNum === 1 ? this.renderer.playerOriginY : this.renderer.enemyOriginY;
    const ownerStr = playerNum === 1 ? 'player' : 'enemy';

    if (!actor) return;

    // Capture the pre-skill cell: the remote side reproduces the skill from
    // this position (e.g. Speedster blink starts here).
    const preCol = actor.currentCol;
    const preRow = actor.currentRow;
    const hadGrab = !!actor.grabbedPos;

    const activated = actor.triggerSkill(
      board,
      this.particleSystem,
      originX,
      originY,
      this.renderer.cellW,
      this.renderer.cellH,
      this.renderer.gap,
      () => {
        // Sniper beam
        this.projectileMgr.createSniperBeam(
          ownerStr,
          actor.currentCol,
          originX,
          originY,
          this.renderer.cellW,
          this.renderer.cellH,
          this.renderer.gap
        );
        soundManager.playLaunch('yellow', 1, 'spear');
      }
    );

    // Broadcast only if the skill actually happened. The old code sent the
    // action BEFORE checking the cooldown, so the remote side applied
    // skills that never fired locally. Exception: a Transporter grab
    // cancel returns false but must still be relayed, or the remote copy
    // keeps a grab this side dropped.
    const grabCanceled =
      actor.archetypeId === 'transporter' && hadGrab && !actor.grabbedPos && !activated;
    if (this.isOnline && broadcast && playerNum === 1 && (activated || grabCanceled)) {
      networkManager.sendAction('skill', {
        archetypeId: actor.archetypeId,
        col: preCol,
        row: preRow,
        // Explicit random outcome for wave/monochrome; the remote side
        // applies these exact tiles instead of rolling its own.
        effect: actor.lastSkillEffect ?? undefined,
      });
    }

    if (activated) {
      this.triggerStateUpdate();
    }
  }

  // Player Discard (3-stack magazine, 0.45s refill)
  public handlePlayerDiscard(playerNum: 1 | 2 = 1, broadcast: boolean = true) {
    if (this.status !== 'playing') return;

    const actor = playerNum === 1 ? this.player : this.player2;
    const board = playerNum === 1 ? this.playerBoard : this.enemyBoard;
    if (!actor) return;

    // Execute first, broadcast only on success: discarding an already-empty
    // tile must not consume the remote side's tile.
    const col = actor.currentCol;
    const row = actor.currentRow;
    const success = actor.discardCurrentTile(board, this.particleSystem);
    if (success) {
      if (this.isOnline && broadcast && playerNum === 1) {
        networkManager.sendAction('discard', { col, row });
      }
      if (playerNum === 1) {
        this.stats.tilesDiscarded++;
        this.triggerStateUpdate();
      }
    }
  }

  // Player Dash (i-frame evasion)
  public handlePlayerDash(playerNum: 1 | 2 = 1, broadcast: boolean = true) {
    if (this.status !== 'playing') return;

    const actor = playerNum === 1 ? this.player : this.player2;
    if (!actor) return;

    // Execute first, broadcast only on success: a dash on cooldown must
    // not make the remote copy dash (and go invincible) for free.
    const success = actor.performDash(this.particleSystem);
    if (success) {
      if (this.isOnline && broadcast && playerNum === 1) {
        networkManager.sendAction('dash', {});
      }
      this.triggerStateUpdate();
    }
  }

  // AI launch handler
  private handleEnemyLaunch = (cluster: Cluster) => {
    const aiArchs = this.enemy.archetypes;
    const bypass = this.enemy.bypassAbsorb;
    this.enemy.bypassAbsorb = false;

    // v2.3 monochrome passive: a non-red cluster evaporates into shield
    // instead of launching (mirrors the player rule), unless this launch
    // is a wave core-defense counter.
    if (aiArchs.includes('monochrome') && cluster.color !== 'red' && !bypass) {
      this.enemyBoard.launchCluster(cluster, 0.5);
      this.enemy.shield = Math.min(40, this.enemy.shield + 10);
      soundManager.playSkill('monochrome');
      this.particleSystem.addFloatingText(this.enemy.x, this.enemy.y - 30, '+10 SHIELD ABSORBED!', '#33CCFF', 16);
      this.particleSystem.addShockwave(this.enemy.x, this.enemy.y, 70, '#33CCFF');
      this.triggerStateUpdate();
      return;
    }

    // v2.3: the projectile carries the AI's archetype identity so the
    // passives apply (lancer spear speed/HP, wave wall speed, monochrome
    // red damage + clash immunity, sniper core 50%). Phase-2 awakened
    // final-boss projectiles get 'boss-awakened' (red clash immunity +
    // spear +1 HP, no damage x2).
    let arch = 'standard';
    if (this.enemy.isFinalBoss && this.enemy.awakened) {
      arch = 'boss-awakened';
    } else if (cluster.color === 'red' && aiArchs.includes('monochrome')) {
      arch = 'monochrome';
    } else if (cluster.shapeType === 'spear' && aiArchs.includes('lancer')) {
      arch = 'lancer';
    } else if (cluster.shapeType === 'wall' && aiArchs.includes('wave')) {
      arch = 'wave';
    } else if (aiArchs.length === 1) {
      arch = aiArchs[0];
    }

    const overdrive = this.enemy.isBossOverdrive || this.enemy.overdriveActive;
    this.projectileMgr.createProjectile(
      'enemy',
      cluster,
      this.renderer.enemyOriginX,
      this.renderer.enemyOriginY,
      this.renderer.cellW,
      this.renderer.cellH,
      this.renderer.gap,
      arch,
      overdrive,
      this.isFrontlineLaunch('enemy', cluster)
    );
    this.enemyBoard.launchCluster(cluster);
    // v2.3 painter passive: 10% chance to paint the foot cross dominant.
    if (aiArchs.includes('painter') && Math.random() < 0.1) {
      this.enemyBoard.paintAdjacentDominant(this.enemy.currentCol, this.enemy.currentRow);
    }
    // v2.2: boss overdrive lasts exactly one launch (old bug: stayed on
    // until the battle ended). The monochrome skill overdrive is the same.
    if (this.enemy.isBossOverdrive) this.enemy.isBossOverdrive = false;
    if (this.enemy.overdriveActive) this.enemy.overdriveActive = false;
    soundManager.playLaunch(cluster.color, cluster.tiles.length, cluster.shapeType);
    this.particleSystem.emitLaunchParticles(this.enemy.x, this.enemy.y, '#FF3366');
    this.particleSystem.addShockwave(this.enemy.x, this.enemy.y, 60, '#FF3366');
  };

  private startLoop() {
    this.lastTime = performance.now();

    const loop = (currentTime: number) => {
      const rawDt = (currentTime - this.lastTime) / 1000;
      this.lastTime = currentTime;
      const dt = Math.min(rawDt, 0.05);

      if (this.status === 'playing') {
        if (this.hitstopTimer > 0) {
          this.hitstopTimer -= dt;
        } else {
          this.update(dt);
        }
      }

      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  private update(dt: number) {
    this.gameTime += dt;
    this.stats.gameDuration = this.gameTime;

    // Mid-battle disconnect detection. The server notifies the remaining
    // player via peer_left, but if the lobby modal overwrote the callback
    // (it re-registers its handlers on every render), the notification
    // would only update hidden lobby state. Polling the connection flags
    // here guarantees the battle ends with a result either way.
    if (this.isOnline && this.status === 'playing' && !this.peerDisconnectHandled) {
      if (!networkManager.isConnected) {
        this.peerDisconnectHandled = true;
        this.status = 'defeat';
        this.particleSystem.addFloatingText(960, 540, 'CONNECTION LOST', '#FF3366', 22);
        soundManager.playDefeat();
        this.triggerStateUpdate();
        return;
      }
      if (!networkManager.opponentConnected) {
        this.peerDisconnectHandled = true;
        this.status = 'victory';
        this.particleSystem.addFloatingText(960, 540, 'OPPONENT DISCONNECTED!', '#FF3366', 22);
        soundManager.playVictory();
        this.triggerStateUpdate();
        return;
      }
    }

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 2);
    }

    // v2.2 90-second shrink zone: warn at 80s, anchor at 90s, then close.
    if (!this.shrinkWarned && this.gameTime >= 80) {
      this.shrinkWarned = true;
      this.shrinkPhase = 'warning';
      this.particleSystem.addFloatingText(960, 120, '10초 후 수축 중심 고정!', '#FF4444', 22);
      this.triggerStateUpdate();
    }
    if (this.shrinkPhase === 'warning' && this.gameTime >= 90) {
      this.startShrink();
    }
    if (this.shrinkPhase === 'shrinking' || this.shrinkPhase === 'closed') {
      this.updateShrinkRects();
    }

    // Gamepad polling
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      const gp = gamepads[0];
      if (gp) {
        const axisX = gp.axes[0] || 0;
        const axisY = gp.axes[1] || 0;
        this.keys['ArrowLeft'] = axisX < -0.3 || (gp.buttons[14]?.pressed ?? false);
        this.keys['ArrowRight'] = axisX > 0.3 || (gp.buttons[15]?.pressed ?? false);
        this.keys['ArrowUp'] = axisY < -0.3 || (gp.buttons[12]?.pressed ?? false);
        this.keys['ArrowDown'] = axisY > 0.3 || (gp.buttons[13]?.pressed ?? false);

        if (gp.buttons[0]?.pressed) {
          if (!this.lastPadButton0) {
            this.handlePlayerLaunch(1);
          }
          this.lastPadButton0 = true;
        } else {
          this.lastPadButton0 = false;
        }

        if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) {
          if (!this.lastPadButton1) {
            this.handlePlayerSkill(1);
          }
          this.lastPadButton1 = true;
        } else {
          this.lastPadButton1 = false;
        }

        // X or Y (Button 2 or 3) -> Discard
        if (gp.buttons[3]?.pressed) {
          this.handlePlayerDiscard(1);
        }
      }
    }

    // Grid cooldown recovery. Collapsed boards refill 1.3x faster
    // (1.3s -> 1.0s). The return value tells whether any tile refilled
    // this frame, which is when the refill sound plays (throttled).
    const playerCDMult =
      (this.player.archetypeId === 'speedster' ? 1.5 : 1.0) * (this.playerCore.collapsed ? 1.3 : 1.0);
    const isSniper = this.player.archetypeId === 'sniper';
    const playerRefilled = this.playerBoard.update(dt, playerCDMult, isSniper);

    const enemyCDMult =
      (this.player2?.archetypeId === 'speedster' ||
      (this.mode !== 'multi' && this.enemy.archetypes.includes('speedster'))
        ? 1.5
        : 1.0) * (this.enemyCore.collapsed ? 1.3 : 1.0);
    // v2.3: offline, the enemy board uses the AI's archetypes (sniper
    // 1-2 cell launches, speedster refill); online/local 2P it uses P2's.
    const isEnemySniper =
      this.mode === 'multi'
        ? this.player2?.archetypeId === 'sniper'
        : this.enemy.archetypes.includes('sniper');
    const enemyRefilled = this.enemyBoard.update(dt, enemyCDMult, isEnemySniper);

    this.refillSoundTimer -= dt;
    if ((playerRefilled || enemyRefilled) && this.refillSoundTimer <= 0) {
      this.refillSoundTimer = 0.05;
      soundManager.playRefill();
    }

    // Player Movement & Online Position Sync
    if (this.isOnline) {
      this.player.update(
        dt,
        this.keys,
        this.renderer.playerOriginX,
        this.renderer.playerOriginY,
        this.renderer.cellW,
        this.renderer.cellH,
        this.renderer.gap,
        this.playerBoard
      );

      if (this.player2) {
        this.player2.updateRemote(dt);
      }

      this.networkSyncTimer += dt;
      if (this.networkSyncTimer > 0.05) {
        // 20 Hz position sync: enough for smooth remote interpolation
        // without flooding the WebSocket every frame.
        this.networkSyncTimer = 0;
        const totalW = GRID_COLS * this.renderer.cellW + (GRID_COLS - 1) * this.renderer.gap;
        const totalH = GRID_ROWS * this.renderer.cellH + (GRID_ROWS - 1) * this.renderer.gap;
        const normX = Math.max(0, Math.min(1, (this.player.x - this.renderer.playerOriginX) / totalW));
        const normY = Math.max(0, Math.min(1, (this.player.y - this.renderer.playerOriginY) / totalH));

        networkManager.sendAction('move', {
          normX,
          normY,
          col: this.player.currentCol,
          row: this.player.currentRow,
          isDashing: this.player.dashDurationRemaining > 0,
        });
      }

      // Board reconciliation: exchange a color hash of my bottom board
      // every 3 seconds. The peer compares it against its copy of my
      // board and requests a snapshot after two consecutive mismatches.
      // (Refill timing is frame-rate dependent, so hashes can drift even
      // with a shared seed; the snapshot bounds the drift.)
      this.boardSyncTimer += dt;
      if (this.boardSyncTimer > 3) {
        this.boardSyncTimer = 0;
        networkManager.sendAction('board_hash', { hash: this.playerBoard.colorHash(false) });
        // A snapshot request that was never answered (peer left, packet
        // lost) must not block future requests forever.
        if (this.boardSyncPending && this.gameTime - this.boardSyncPendingSince > 5) {
          this.boardSyncPending = false;
        }
      }
    } else {
      // Offline mode. In local 2P both characters are driven from the
      // keyboard (P1 WASD, P2 Arrows); the old code ran updateRemote on
      // P2 here, which left P2 frozen in place.
      const isLocal2P = this.mode === 'multi';
      this.player.update(
        dt,
        this.keys,
        this.renderer.playerOriginX,
        this.renderer.playerOriginY,
        this.renderer.cellW,
        this.renderer.cellH,
        this.renderer.gap,
        this.playerBoard,
        isLocal2P
      );

      if (this.mode === 'multi' && this.player2) {
        this.player2.update(
          dt,
          this.keys,
          this.renderer.enemyOriginX,
          this.renderer.enemyOriginY,
          this.renderer.cellW,
          this.renderer.cellH,
          this.renderer.gap,
          this.enemyBoard,
          true
        );
      } else {
        // v2.2: during the 80-90s shrink warning the AI heads for the
        // center so it is not isolated in a corner.
        this.enemy.moveToCenter = this.shrinkPhase === 'warning';
        // v2.3: feed the boss awakening inputs and the core-collapse
        // crisis flag (launch wait -20% in the last stand).
        this.enemy.bossCoreHp = this.enemyCore.hp;
        this.enemy.coreCrisis = this.enemyCore.collapsed;
        this.enemy.update(
          dt,
          this.renderer.enemyOriginX,
          this.renderer.enemyOriginY,
          this.renderer.cellW,
          this.renderer.cellH,
          this.renderer.gap,
          this.enemyBoard,
          this.projectileMgr.projectiles,
          this.particleSystem,
          this.handleEnemyLaunch,
          () => {
            // Boss Sniper Beam
            this.projectileMgr.createSniperBeam(
              'enemy',
              this.enemy.currentCol,
              this.renderer.enemyOriginX,
              this.renderer.enemyOriginY,
              this.renderer.cellW,
              this.renderer.cellH,
              this.renderer.gap
            );
            soundManager.playLaunch('red', 1, 'spear');
          },
          { col: this.player.currentCol, row: this.player.currentRow }
        );
      }
    }

    // v2.2 shrink-zone outside-wall damage (after movement, so it reads
    // the characters' current positions).
    if (this.shrinkPhase === 'shrinking' || this.shrinkPhase === 'closed') {
      this.applyShrinkDamage(dt);
    }

    // Projectiles & Particles update
    const target2X = this.player2 ? this.player2.x : this.enemy.x;
    this.projectileMgr.update(dt, this.particleSystem, this.player.x, target2X);
    this.particleSystem.update(dt);

    // Combo streak decay timer (4.0s timeout, v2.2)
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        if (this.comboCount > 0) {
          this.comboCount = 0;
          this.triggerStateUpdate();
        }
      }
    }

    // Second-side combo decay (local/online 2P only).
    if (this.combo2Timer > 0) {
      this.combo2Timer -= dt;
      if (this.combo2Timer <= 0) {
        this.combo2Timer = 0;
        if (this.combo2Count > 0) {
          this.combo2Count = 0;
          this.triggerStateUpdate();
        }
      }
    }

    // Check Projectile Impacts
    this.resolveBoardAndCharacterImpacts();

    // Check Win / Loss condition (v2.2: a destroyed rear core also ends
    // the battle immediately).
    if (this.mode === 'multi' && this.player2) {
      if ((this.player2.hp <= 0 || this.enemyCore.hp <= 0) && this.status === 'playing') {
        this.status = 'victory'; // I Won!
        soundManager.playVictory();
        this.triggerStateUpdate();
      } else if ((this.player.hp <= 0 || this.playerCore.hp <= 0) && this.status === 'playing') {
        this.status = 'defeat'; // I Lost!
        soundManager.playDefeat();
        this.triggerStateUpdate();
      }
    } else {
      // Single Mode or Boss Mode
      if ((this.enemy.hp <= 0 || this.enemyCore.hp <= 0) && this.status === 'playing') {
        if (this.mode === 'single' && this.currentStage < 30) {
          this.status = 'stage_clear';
          recordStageClear(this.currentStage);
          soundManager.playStageClear();
        } else {
          // Final boss beaten (campaign stage 30 or boss rush).
          this.status = 'victory';
          recordStageClear(30);
          this.lastNoContinue = tryRecordNoContinue(this.campaignRun);
          this.campaignRun = null;
          soundManager.playVictory();
        }
        this.triggerStateUpdate();
      } else if ((this.player.hp <= 0 || this.playerCore.hp <= 0) && this.status === 'playing') {
        this.status = 'defeat';
        // A defeat breaks the live no-continue run (retrying = continue).
        if (this.campaignRun) this.campaignRun = markRunBroken(this.campaignRun);
        soundManager.playDefeat();
        this.triggerStateUpdate();
      }
    }
  }

  // Pure physical collision damage: ONLY direct character hits take damage (Back wall damage DELETED)
  private resolveBoardAndCharacterImpacts() {
    const gap = this.renderer.gap;
    const cellW = this.renderer.cellW;
    const cellH = this.renderer.cellH;
    const targetOpponent = this.player2 || this.enemy;

    for (let i = this.projectileMgr.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectileMgr.projectiles[i];

      // 1. My projectile flying towards opponent
      if (p.owner === 'player') {
        for (const cell of p.cells) {
          if (cell.destroyed) continue;
          const cellLeft = p.x + cell.relCol * (cellW + gap);
          const cellTop = p.y + cell.relRow * (cellH + gap);
          const cellCenterX = cellLeft + cellW / 2;
          const cellCenterY = cellTop + cellH / 2;

          // Direct Hit on Target Hitbox
          const distToTarget = Math.hypot(cellCenterX - targetOpponent.x, cellCenterY - targetOpponent.y);
          if (distToTarget < targetOpponent.radius + cellW / 2) {
            // v2.2: while the 0.15s consecutive-hit protection (or the
            // 0.3s collapse-push protection) is up, the cell passes through
            // with no hit resolution at all — no combo, no cell loss, no
            // floating text. (Dash evasion keeps its old consume behavior.)
            if (targetOpponent.invincibleTimer > 0) continue;
            // Consecutive hit combo scaling
            this.comboCount++;
            this.comboTimer = 4.0;
            this.comboMax = Math.max(this.comboMax, this.comboCount);
            this.stats.maxCombo = this.comboMax;

            const mult = this.comboMultiplier;
            // v2.2 anti-instant-kill: one direct hit deals at most 35.
            const finalDmg = Math.min(MAX_SINGLE_HIT_DMG, Math.round(p.damagePerCell * mult));
            targetOpponent.takeDamage(finalDmg, true);
            this.stats.damageDealt += finalDmg;
            targetOpponent.knockbackY = -180;
            cell.destroyed = true;

            this.hitstopTimer = 0.05 + Math.min(0.04, this.comboCount * 0.005);
            this.screenShake = 0.25 + Math.min(0.35, this.comboCount * 0.03);
            soundManager.playHit(true, this.comboCount);

            this.particleSystem.emitBlockDestruction(cellCenterX, cellCenterY, p.glowColor, 20 + Math.min(30, this.comboCount * 3));

            let hitColor = '#FF3366';
            let hitText = `-${finalDmg} DIRECT!`;
            if (this.comboCount >= 7) {
              hitColor = '#EC4899';
              hitText = `-${finalDmg} (${mult.toFixed(1)}x OVERDRIVE!)`;
              this.particleSystem.addShockwave(cellCenterX, cellCenterY, 140, '#EC4899');
            } else if (this.comboCount >= 4) {
              hitColor = '#F59E0B';
              hitText = `-${finalDmg} (${mult.toFixed(1)}x HYPER!)`;
              this.particleSystem.addShockwave(cellCenterX, cellCenterY, 100, '#F59E0B');
            } else if (this.comboCount >= 2) {
              hitColor = '#06B6D4';
              hitText = `-${finalDmg} (${mult.toFixed(1)}x STRIKE)`;
            }
            this.particleSystem.addFloatingText(
              targetOpponent.x,
              targetOpponent.y - 20,
              hitText,
              hitColor,
              18 + Math.min(10, this.comboCount * 1.2)
            );

            if (p.color === 'yellow') {
              targetOpponent.slowTimer = 2.0;
              // Deterministic contamination around the hit cell: the
              // defender applies the same change to the same logical
              // board (mirrored frame) on their side.
              this.enemyBoard.contaminateAt(targetOpponent.currentCol, targetOpponent.currentRow);
            }
            if (p.color === 'red') {
              const opTile = this.enemyBoard.tiles[targetOpponent.currentRow]?.[targetOpponent.currentCol];
              if (opTile) {
                opTile.color = null;
                opTile.cooldownRemaining = 1.3;
                opTile.cooldownMax = 1.3;
              }
            }
            if (p.shapeType === 'meteor' && !p.isMeteorExploding) {
              p.isMeteorExploding = true;
              const meteorDmg = Math.min(MAX_SINGLE_HIT_DMG, Math.round(15 * mult));
              targetOpponent.takeDamage(meteorDmg, true);
              this.stats.damageDealt += meteorDmg;
              this.particleSystem.addShockwave(cellCenterX, cellCenterY, 160, '#FF5500');
              this.particleSystem.addFloatingText(targetOpponent.x, targetOpponent.y - 50, `METEOR -${meteorDmg} AOE!`, '#FF5500', 20);
            }

            // v2.2: 0.15s consecutive-hit protection after a direct hit
            // (never shortens a longer protection, e.g. the 0.3s push).
            targetOpponent.invincibleTimer = Math.max(targetOpponent.invincibleTimer, 0.15);

            this.triggerStateUpdate();
          }
        }

        // 1b. Rear core hit: a cell that passed through the central 3
        // columns (4-6) and behind the enemy board strikes the core.
        // Combo and frontline bonuses apply; red/yellow status effects do not.
        for (const cell of p.cells) {
          if (cell.destroyed) continue;
          const cellLeft = p.x + cell.relCol * (cellW + gap);
          const cellTop = p.y + cell.relRow * (cellH + gap);
          const cellCenterX = cellLeft + cellW / 2;
          const cellCenterY = cellTop + cellH / 2;
          const col = Math.floor((cellCenterX - this.renderer.enemyOriginX) / (cellW + gap));
          if (cellCenterY < this.renderer.enemyOriginY && col >= 3 && col <= 5) {
            this.comboCount++;
            this.comboTimer = 4.0;
            this.comboMax = Math.max(this.comboMax, this.comboCount);
            this.stats.maxCombo = this.comboMax;
            const mult = this.comboMultiplier;
            // 90s+ core hits deal double damage.
            const coreMult = this.gameTime >= 90 ? 2 : 1;
            // v2.2: sniper 1-2 cell projectiles deal 50% to the core.
            const finalDmg = Math.round(
              p.damagePerCell * mult * coreMult * sniperCoreDamageMult(p.archetypeId, p.cells.length)
            );
            this.damageCore('enemy', finalDmg);
            this.stats.damageDealt += finalDmg;
            cell.destroyed = true;
            this.hitstopTimer = 0.05;
            this.screenShake = 0.25;
            soundManager.playHit(true, this.comboCount);
            this.particleSystem.emitBlockDestruction(cellCenterX, cellCenterY, p.glowColor, 20);
            this.particleSystem.addFloatingText(
              this.renderer.enemyOriginX + 4 * (cellW + gap) + cellW / 2,
              this.renderer.enemyOriginY - 30,
              `CORE -${finalDmg}!`,
              '#FF0055',
              20
            );
            if (p.shapeType === 'meteor' && !p.isMeteorExploding) {
              p.isMeteorExploding = true;
              const meteorDmg = Math.round(15 * mult);
              this.damageCore('enemy', meteorDmg);
              this.stats.damageDealt += meteorDmg;
              this.particleSystem.addShockwave(cellCenterX, cellCenterY, 160, '#FF5500');
              this.particleSystem.addFloatingText(cellCenterX, cellCenterY - 30, `METEOR -${meteorDmg} AOE!`, '#FF5500', 20);
            }
            this.triggerStateUpdate();
          }
        }
      }

      // 2. Opponent projectile flying towards me
      if (p.owner === 'enemy') {
        for (const cell of p.cells) {
          if (cell.destroyed) continue;
          const cellLeft = p.x + cell.relCol * (cellW + gap);
          const cellTop = p.y + cell.relRow * (cellH + gap);
          const cellCenterX = cellLeft + cellW / 2;
          const cellCenterY = cellTop + cellH / 2;

          // Direct Hit on My Hitbox
          const distToPlayer = Math.hypot(cellCenterX - this.player.x, cellCenterY - this.player.y);
          if (distToPlayer < this.player.radius + cellW / 2) {
            // v2.2: while the 0.15s consecutive-hit protection (or the
            // 0.3s collapse-push protection) is up, the cell passes through
            // with no hit resolution at all.
            if (this.player.invincibleTimer > 0) continue;
            // Second-side combo (local/online 2P only). In local 2P the
            // damage scales with it; online, the attacker's own client is
            // the damage authority for its combo, so this side keeps the
            // unscaled value and the 'hit' packet syncs HP.
            let dmg = p.damagePerCell;
            if (this.mode === 'multi') {
              this.combo2Count++;
              this.combo2Timer = 4.0;
              this.combo2Max = Math.max(this.combo2Max, this.combo2Count);
              if (!this.isOnline) {
                dmg = Math.round(p.damagePerCell * this.combo2Multiplier);
              }
            }
            // v2.2 anti-instant-kill: one direct hit deals at most 35.
            dmg = Math.min(MAX_SINGLE_HIT_DMG, dmg);
            this.player.takeDamage(dmg, true);
            this.stats.damageTaken += dmg;
            this.player.knockbackY = 180;
            cell.destroyed = true;

            this.hitstopTimer = 0.05;
            this.screenShake = 0.3;
            this.particleSystem.emitBlockDestruction(cellCenterX, cellCenterY, p.glowColor, 20);
            this.particleSystem.addFloatingText(this.player.x, this.player.y - 20, `-${dmg} HIT!`, '#FF3366', 18);

            if (this.isOnline) {
              networkManager.sendAction('hit', { newHp: this.player.hp, dmg });
            }

            if (p.color === 'red') {
              const pTile = this.playerBoard.tiles[this.player.currentRow]?.[this.player.currentCol];
              if (pTile) {
                pTile.color = null;
                pTile.cooldownRemaining = 1.3;
                pTile.cooldownMax = 1.3;
              }
            }
            if (p.color === 'yellow') {
              this.player.slowTimer = 2.0;
              this.playerBoard.contaminateAt(this.player.currentCol, this.player.currentRow);
            }
            // v2.2: 0.15s consecutive-hit protection after a direct hit.
            this.player.invincibleTimer = Math.max(this.player.invincibleTimer, 0.15);
          }
        }

        // 2b. Rear core hit on my core (central 3 columns, behind my board).
        for (const cell of p.cells) {
          if (cell.destroyed) continue;
          const cellLeft = p.x + cell.relCol * (cellW + gap);
          const cellTop = p.y + cell.relRow * (cellH + gap);
          const cellCenterX = cellLeft + cellW / 2;
          const cellCenterY = cellTop + cellH / 2;
          const col = Math.floor((cellCenterX - this.renderer.playerOriginX) / (cellW + gap));
          const boardBottom = this.renderer.playerOriginY + GRID_ROWS * (cellH + gap) - gap;
          if (cellCenterY > boardBottom && col >= 3 && col <= 5) {
            let dmg = p.damagePerCell;
            if (this.mode === 'multi') {
              this.combo2Count++;
              this.combo2Timer = 4.0;
              this.combo2Max = Math.max(this.combo2Max, this.combo2Count);
              if (!this.isOnline) {
                dmg = Math.round(p.damagePerCell * this.combo2Multiplier);
              }
            }
            const coreMult = this.gameTime >= 90 ? 2 : 1;
            // v2.2: sniper 1-2 cell projectiles deal 50% to the core.
            const finalDmg = Math.round(dmg * coreMult * sniperCoreDamageMult(p.archetypeId, p.cells.length));
            const newHp = this.damageCore('player', finalDmg);
            this.stats.damageTaken += finalDmg;
            cell.destroyed = true;
            this.hitstopTimer = 0.05;
            this.screenShake = 0.25;
            soundManager.playHit(true, this.combo2Count);
            this.particleSystem.emitBlockDestruction(cellCenterX, cellCenterY, p.glowColor, 20);
            this.particleSystem.addFloatingText(
              this.renderer.playerOriginX + 4 * (cellW + gap) + cellW / 2,
              boardBottom + 30,
              `CORE -${finalDmg}!`,
              '#FF0055',
              20
            );
            // Online: the defender is the damage authority; send the
            // authoritative HP so the attacker's copy of my core syncs.
            if (this.isOnline) {
              networkManager.sendAction('core_hit', { newHp, dmg: finalDmg });
            }
            this.triggerStateUpdate();
          }
        }
      }
    }
  }

  // Navigation & Endless Game Loop Helpers
  public returnToTitle() {
    if (this.isOnline) {
      // Tell the server we're leaving so the peer isn't left in a ghost room.
      networkManager.disconnect();
      this.isOnline = false;
    }
    this.status = 'title';
    this.isOnline = false;
    this.campaignRun = null;
    this.playerBoard.reset();
    this.enemyBoard.reset();
    this.projectileMgr.clear();
    this.particleSystem.clear();
    this.resetCores();
    this.triggerStateUpdate();
  }

  public togglePause() {
    // Online battles cannot pause: only one side would freeze.
    if (this.isOnline) return;
    if (this.status === 'playing') {
      this.status = 'paused';
    } else if (this.status === 'paused') {
      this.status = 'playing';
    }
    this.triggerStateUpdate();
  }

  public restartCurrentBattle(broadcastRematch: boolean = true) {
    if (this.isOnline) {
      // Server-coordinated rematch: the battle restarts only when BOTH
      // players ask, with one shared seed from the server. Restarting
      // locally here (old behavior) used a different Date.now() seed per
      // side and desynced the boards.
      if (broadcastRematch) {
        networkManager.requestRematch();
        this.particleSystem.addFloatingText(960, 540, 'REMATCH REQUESTED - WAITING FOR OPPONENT', '#33CCFF', 20);
        this.triggerStateUpdate();
      }
      return;
    }
    if (this.mode === 'multi') {
      this.startGame('multi', 1, this.player.archetypeId, this.player2?.archetypeId || 'wave');
    } else if (this.mode === 'single') {
      this.startGame('single', this.currentStage, this.player.archetypeId);
    } else if (this.mode === 'boss') {
      this.startGame('boss', 30, this.player.archetypeId);
    }
  }

  private render() {
    if (!this.ctx) return;
    this.renderer.render(
      this.ctx,
      this.playerBoard,
      this.enemyBoard,
      this.player,
      this.enemy,
      this.player2,
      this.projectileMgr,
      this.particleSystem,
      this.screenShake,
      this.gameTime,
      this.playerCore,
      this.enemyCore,
      this.shrinkRect,
      this.shrinkRect2,
      this.shrinkPhase
    );
  }

  private triggerStateUpdate() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback();
    }
  }
}
