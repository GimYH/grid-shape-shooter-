import { GridBoard, BoardSnapshot, GRID_COLS, GRID_ROWS, TILE_COLORS } from './GridEngine';
import { PlayerCharacter } from './CharacterController';
import { AIController } from './AIController';
import { ProjectileManager } from './ProjectileManager';
import { ParticleSystem, EffectQuality } from './ParticleSystem';
import { FrameDefense } from './frameDefense';
import { CanvasRenderer } from './Renderer';
import { soundManager } from '../audio/soundManager';
import { ArchetypeId, Cluster, CoreState, DefeatCause, GameMode, GameStats, ShapeProjectile, ShrinkPhase, ShrinkRect, SkillEffect } from '../types/game';
import { ARCHETYPES, MONOCHROME_ABSORB_COOLDOWN_SEC, MONOCHROME_ABSORB_GAIN, MONOCHROME_ABSORB_REFILL_SEC, MONOCHROME_SHIELD_MAX, SPEEDSTER_FIRE_DMG_MULT, SPEEDSTER_FIRE_SPEED_MULT, TRANSPORTER_SWAP_DMG_MULT } from './archetypes';
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
import {
  ROYALE_GANGUP_REFILL_MULT,
  ROYALE_GANGUP_THRESHOLD,
  ROYALE_INCOMING_WARNING_SEC,
  ROYALE_KO_CORE_REWARD,
  ROYALE_KO_DMG_BUFF_MAX,
  ROYALE_KO_DMG_BUFF_STEP,
  ROYALE_KO_HP_REWARD,
  ROYALE_MAX_PLAYERS,
  ROYALE_PORTAL_Y,
  RoyaleIncomingPacket,
  RoyaleKoPacket,
  RoyalePlayerInfo,
  RoyaleStatusPacket,
  RoyaleTargetMode,
} from './royale';
import {
  ArcadeModeId,
  ArcadeMeteor,
  ArcadeRecords,
  ArcadeRenderState,
  ArcadeResult,
  DEFENSE_COLLAPSE_REFILL_MULT,
  DEFENSE_CORE_DMG_PER_HP,
  METEOR_TOUCH_DMG,
  MEGA_BARRIER_MULT,
  MEGA_GROGGY_MULT,
  MEGA_GROGGY_SEC,
  MEGA_LASER_DMG,
  MEGA_LASER_MAX_COLS,
  MEGA_LASER_MIN_COLS,
  MEGA_LASER_TELEGRAPH_SEC,
  MEGA_ORDER_SEC,
  MEGA_BOSS_MAX_HP,
  METEOR_CELL_HP,
  RUSH_BASE_SCORE,
  RUSH_BONUS_SEC,
  RUSH_GOAL_Y,
  RUSH_START_SEC,
  RushMission,
  WeaknessOrder,
  comboMultFor,
  counterColorOf,
  defenseWaveFor,
  formatArcadeTime,
  loadArcadeRecords,
  matchesMission,
  matchesWeakness,
  meteorFallSpeed,
  meteorRemainingHp,
  meteorSizeForRoll,
  meteorSpawnIntervalSec,
  randomRushMission,
  randomWeaknessOrder,
  recordDefenseRun,
  recordMegaClear,
  recordRushRun,
} from './arcade';

export type GameStatus =
  | 'title'
  | 'select'
  | 'online_lobby'
  | 'playing'
  | 'paused'
  | 'slowmo'
  | 'stage_clear'
  | 'victory'
  | 'defeat';

// v2.2 Phase 2: battle-start countdown (1.5s: 3 → 2 → 1 → FIGHT, 0.45s
// each) and decisive-moment slow motion (0.8s at 0.25x time scale).
export const COUNTDOWN_MS = 1500;
export const COUNTDOWN_STEP_MS = 450;
export const SLOWMO_DURATION_S = 0.8;
export const SLOWMO_TIMESCALE = 0.25;
// v2.2 Phase 2: input buffer (100ms) and launch grace (60ms — a launch
// pressed just after stepping off a 3+ cluster still fires it).
export const INPUT_BUFFER_MS = 100;
export const LAUNCH_GRACE_MS = 60;

// v2.2 Phase 2: countdown phase label from elapsed milliseconds since
// the countdown started. Exported for headless verification.
export function countdownLabel(elapsedMs: number): '3' | '2' | '1' | 'FIGHT!' {
  if (elapsedMs < COUNTDOWN_STEP_MS) return '3';
  if (elapsedMs < COUNTDOWN_STEP_MS * 2) return '2';
  if (elapsedMs < COUNTDOWN_STEP_MS * 3) return '1';
  return 'FIGHT!';
}

// v2.2 anti-instant-kill: no single direct character hit deals more than
// 35 damage. (Core hits are not capped.)
export const MAX_SINGLE_HIT_DMG = 35;

// Hotfix (2026-11-21): no single rear-core hit deals more than 60
// damage (per cell impact, meteor AOE included) — a 16-cell meteor must
// not two-shot a 250 HP core.
export const MAX_CORE_HIT_DMG = 60;

// v2.2 shrink anchor clamp: the 90s safe-zone center is clamped into the
// inner area (columns 3-7, rows 2-4, 1-indexed) so it never overlaps the
// core-collapse columns (1 and 9). Exported for headless verification.
// Hotfix (2026-11-21): the shrink zone is symmetric around the board
// center now, so the engine no longer calls this for anchors — it is
// retained for verification and for any caller that still needs a
// clamped in-board point.
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

// v2.2 balance: a sniper 1-2 cell snipe neither raises the combo count nor
// refreshes the 4s combo timer. 3+ clusters and the piercing beam (isBeam)
// still count. Damage itself is unaffected — only the combo bookkeeping.
export function countsForCombo(
  archetypeId: string | undefined,
  cellCount: number,
  isBeam?: boolean
): boolean {
  return !(archetypeId === 'sniper' && cellCount <= 2 && !isBeam);
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
  // Mobile portrait joystick vector (set by MobileJoystickControls).
  // Unit-ish vector, length 0..1 = stick deflection; null when released.
  // Fed into player.analogMove every frame; P1 only, like touch controls.
  public joystickVector: { x: number; y: number } | null = null;
  public gameTime: number = 0;
  // Wall-clock battle start (performance.now ms). BATTLE TIME on the
  // result screen uses this, not gameTime: gameTime only advances inside
  // the rAF update loop and is clamped to 0.05s/frame, so it lags real
  // time badly whenever frames run below 20fps or the tab is throttled
  // (a live royale round showed 0:05 after ~1 minute of play).
  private battleStartAt: number = 0;
  // BATTLE TIME excludes ESC-pause dwell: pauseAccum is the total paused
  // time (ms) since battleStartAt; pausedAt marks the current pause start
  // (0 when not paused). The campaign no-continue record is unaffected —
  // it uses its own Date.now() run clock (campaign.ts), not gameDuration.
  private pauseAccum: number = 0;
  private pausedAt: number = 0;
  public screenShake: number = 0;
  public hitstopTimer: number = 0;
  // v2.2 Phase 2: battle-start countdown end (performance.now ms). While
  // now < countdownEndAt the battle is frozen and input is ignored.
  public countdownEndAt: number = 0;
  // v2.2 Phase 2: decisive-moment slow motion. pendingResult is the
  // status the battle flips to when slowmoTimer runs out.
  public slowmoTimer: number = 0;
  public pendingResult: 'victory' | 'defeat' | 'stage_clear' | null = null;
  public defeatCause: DefeatCause | null = null;
  // v2.2 Phase 2: settings (localStorage 'gss_settings_v1').
  public shakeEnabled: boolean = true;
  // Optimization (2.1): effect quality (localStorage 'gss_settings_v1').
  public effectQuality: EffectQuality = 'medium';
  // Optimization (2.2): automatic frame defense (60-frame FPS watch).
  private frameDefense = new FrameDefense();
  // v2.2 Phase 2: online rematch vote state (server 'rematch_update').
  public rematchVotes: number = 0;
  public rematchRequested: boolean = false;
  // v2.2 Phase 2: portrait cut-in { portrait, label, until }.
  public cutin: { portrait: ArchetypeId; label: string; until: number; durationMs: number } | null = null;
  // v2.2 Phase 2: rejection feedback — a shaken tile and a flashing HUD
  // icon, both with a performance.now expiry.
  public rejectTile: { owner: 'player' | 'enemy'; col: number; row: number; until: number } | null = null;
  public rejectFlash: { kind: 'skill' | 'dash' | 'discard'; playerNum: 1 | 2; until: number } | null = null;
  private awakeningCutinShown: boolean = false;
  private wasSkillReady: boolean = true;
  private wasSkillReady2: boolean = true;
  private inputBuffer: Record<1 | 2, { action: 'launch' | 'skill' | 'dash' | 'discard'; until: number } | null> = { 1: null, 2: null };
  private lastLaunchable: Record<1 | 2, { col: number; row: number; at: number } | null> = { 1: null, 2: null };

  // v2.2 Phase 2: is the battle-start countdown still running?
  public isCountingDown(): boolean {
    return this.status === 'playing' && performance.now() < this.countdownEndAt;
  }

  // v2.2 Phase 2: load/save SFX volume + shake toggle.
  // Optimization (2.1): effect quality rides in the same record.
  private loadSettings() {
    try {
      const raw = localStorage.getItem('gss_settings_v1');
      if (!raw) return;
      const s = JSON.parse(raw) as { volume?: unknown; shakeEnabled?: unknown; effectQuality?: unknown };
      if (typeof s.volume === 'number') soundManager.setVolume(s.volume);
      if (typeof s.shakeEnabled === 'boolean') this.shakeEnabled = s.shakeEnabled;
      if (s.effectQuality === 'high' || s.effectQuality === 'medium' || s.effectQuality === 'low') {
        this.effectQuality = s.effectQuality;
        this.particleSystem.setQuality(s.effectQuality);
      }
    } catch {
      // Corrupt settings: keep defaults.
    }
  }

  public saveSettings() {
    try {
      localStorage.setItem(
        'gss_settings_v1',
        JSON.stringify({
          volume: soundManager.getVolume(),
          shakeEnabled: this.shakeEnabled,
          effectQuality: this.effectQuality,
        })
      );
    } catch {
      // Storage unavailable: settings stay in memory only.
    }
  }

  public toggleShake(): boolean {
    this.shakeEnabled = !this.shakeEnabled;
    this.saveSettings();
    this.triggerStateUpdate();
    return this.shakeEnabled;
  }

  public setSfxVolume(v: number) {
    soundManager.setVolume(v);
    this.saveSettings();
    this.triggerStateUpdate();
  }

  // Optimization (2.1): pause-menu effect quality — applies immediately
  // to the particle pool and persists in gss_settings_v1.
  public setEffectQuality(q: EffectQuality) {
    this.effectQuality = q;
    this.particleSystem.setQuality(q);
    this.saveSettings();
    this.triggerStateUpdate();
  }

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
  // enemy core is 250, or 400 in the final boss stage.
  public playerCore: CoreState = { hp: 250, maxHp: 250, collapsed: false, crack: 0 };
  public enemyCore: CoreState = { hp: 250, maxHp: 250, collapsed: false, crack: 0 };

  // v2.2 90-second shrink zone. Hotfix (2026-11-21): the zone is
  // symmetric around each board's center (cols 4-6, rows 2-4, 1-indexed)
  // — no character-position anchors, no anchor exchange. Both sides
  // compute the same center from the board geometry, so online stays in
  // sync without a packet. Rects are the current safe zones in canvas
  // coordinates.
  public shrinkPhase: ShrinkPhase = 'idle';
  public shrinkAnchor: { x: number; y: number } | null = null;
  public shrinkAnchor2: { x: number; y: number } | null = null;
  public shrinkRect: ShrinkRect | null = null;
  public shrinkRect2: ShrinkRect | null = null;
  private shrinkWarned: boolean = false;
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

  // --- GRID ROYALE (v2.4) -------------------------------------------------
  // No board tiles or 20 Hz movement are synced; only the 4 lightweight
  // packets (royale_fire / royale_incoming / royale_status / royale_ko).
  public royalePlayers: RoyalePlayerInfo[] = [];
  public royaleMyId: string | null = null;
  public royaleTargetMode: RoyaleTargetMode = 'random';
  public royaleTargetingIds: string[] = [];
  public royaleKos: number = 0;
  public royaleDamageBuff: number = 0; // +10% per KO, max 5 stacks
  public royaleKillFeed: { text: string; color: string }[] = [];
  public royaleRank: number | null = null;
  public royaleAliveCount: number = 0;
  public royaleEliminated: boolean = false;
  // Columns with an incoming projectile warning (spawn in 0.4s).
  public royaleWarnings: { col: number; until: number }[] = [];
  public lastHitBy: string | null = null;
  private royalePendingIncoming: { packet: RoyaleIncomingPacket; spawnAt: number }[] = [];
  private royaleLastStatusSent: { hp: number; coreHp: number; targetMode: RoyaleTargetMode; alive: boolean; kos: number } | null = null;
  // How many alive players currently target me (gang-up compensation).
  public royaleTargetedByCount: number = 0;

  // --- ARCADE 3종 (메가 보스 / 오더 러시 / 코어 디펜스) --------------------
  // mode === 'arcade'일 때만 동작. 기존 모드와는 상태가 완전히 분리된다.
  public arcadeMode: ArcadeModeId | null = null;
  public arcadeRecords: ArcadeRecords = loadArcadeRecords();
  public arcadeResult: ArcadeResult | null = null;
  public get isArcade(): boolean {
    return this.mode === 'arcade';
  }
  // 메가 보스: 상단 적 보드 자리에 있는 초대형 보스.
  public megaBossHp: number = MEGA_BOSS_MAX_HP;
  public megaBarrier: boolean = true;
  public megaGroggyUntil: number = 0; // gameTime 기준
  public megaOrder: WeaknessOrder | null = null;
  public megaOrderDeadline: number = 0; // gameTime 기준
  public megaOrderSuccess: number = 0;
  public megaOrderFail: number = 0;
  public megaLaserCols: number[] = [];
  public megaLaserFireAt: number = 0; // gameTime 기준
  public megaLaserArmed: boolean = false;
  // 오더 러시: 60초 미션 타임어택.
  public rushTimeLeft: number = RUSH_START_SEC;
  public rushScore: number = 0;
  public rushCombo: number = 0;
  public rushComboMax: number = 0;
  public rushOrdersDone: number = 0;
  public rushMissions: RushMission[] = [];
  private rushCounted: Set<string> = new Set();
  // 코어 디펜스: 상단에서 하강하는 운석.
  public defenseMeteors: ArcadeMeteor[] = [];
  public defenseSpawnTimer: number = 0;
  public defenseWave: number = 1;
  public defenseDestroyed: number = 0;
  private defenseOvercharged: Set<string> = new Set();

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
    this.loadSettings();

    const pStartX = this.renderer.playerOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const pStartY = this.renderer.playerOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.player = new PlayerCharacter(pStartX, pStartY, false);

    const eStartX = this.renderer.enemyOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const eStartY = this.renderer.enemyOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.enemy = new AIController(eStartX, eStartY);
    this.resetCores();

    // v2.2 counter-overcharge: a clash winner's launcher gets -1.0s skill
    // cooldown and the win is counted for the result screen.
    // v2.2 Phase 2: a 6+ cell clash win also fires a 35ms micro-hitstop
    // + a small shake (big-block collision feedback).
    this.projectileMgr.onClashWin = (winnerOwner, winnerCells = 0) => {
      this.stats.clashesWon++;
      if (winnerOwner === 'player') {
        this.player.skillCooldownRemaining = Math.max(0, this.player.skillCooldownRemaining - 1.0);
      } else if (this.player2) {
        this.player2.skillCooldownRemaining = Math.max(0, this.player2.skillCooldownRemaining - 1.0);
      }
      if (winnerCells >= 6) {
        this.hitstopTimer = Math.max(this.hitstopTimer, 0.035);
        this.screenShake = Math.max(this.screenShake, 0.25);
      }
    };

    // v2.2 Phase 2: the server broadcasts the rematch vote count; show it
    // on the result screen (1/2, 2/2).
    networkManager.onRematchUpdate = (votes) => {
      this.rematchVotes = votes;
      this.triggerStateUpdate();
    };
  }

  // v2.2 Phase 2: transient Phase 2 state reset + 1.5s start countdown.
  // Called by every battle start (single / online / royale / rematch).
  private beginBattle() {
    this.countdownEndAt = performance.now() + COUNTDOWN_MS;
    this.slowmoTimer = 0;
    this.pendingResult = null;
    this.defeatCause = null;
    this.cutin = null;
    this.rejectTile = null;
    this.rejectFlash = null;
    this.inputBuffer = { 1: null, 2: null };
    this.lastLaunchable = { 1: null, 2: null };
    this.rematchVotes = 0;
    this.rematchRequested = false;
    this.wasSkillReady = true;
    this.wasSkillReady2 = true;
    this.awakeningCutinShown = false;
    // Optimization (2.2): each battle starts at full particle quality;
    // the frame defense re-latches only if this battle actually runs slow.
    this.frameDefense.reset();
    this.particleSystem.setAutoDegraded(false);
  }

  // v2.2 Phase 2: decisive-moment slow motion. The battle keeps running
  // at 0.25x for 0.8s, then flips to the pending result (the result
  // modal opens only after the slow-mo, so the defeat cause lines up
  // with the moment the player sees it).
  private beginSlowmo(result: 'victory' | 'defeat' | 'stage_clear', cause?: DefeatCause) {
    if (this.status !== 'playing') return;
    this.pendingResult = result;
    this.defeatCause = result === 'defeat' ? cause ?? null : null;
    this.status = 'slowmo';
    this.slowmoTimer = SLOWMO_DURATION_S;
    this.triggerStateUpdate();
  }

  // v2.2: reset both rear cores and the whole shrink-zone state. Called on
  // every battle start (and from the constructor for the title screen).
  private resetCores() {
    const enemyCoreHp =
      this.mode === 'multi' || this.mode === 'royale' || this.mode === 'arcade'
        ? 250
        : STAGES[this.currentStage - 1].coreHp;
    this.playerCore = { hp: 250, maxHp: 250, collapsed: false, crack: 0 };
    this.enemyCore = { hp: enemyCoreHp, maxHp: enemyCoreHp, collapsed: false, crack: 0 };
    this.shrinkPhase = 'idle';
    this.shrinkAnchor = null;
    this.shrinkAnchor2 = null;
    this.shrinkRect = null;
    this.shrinkRect2 = null;
    this.shrinkWarned = false;
    this.shrinkDmgAcc = 0;
    this.shrinkDmgAcc2 = 0;
  }

  // v2.2: apply damage to a rear core, update its crack stage, and trigger
  // the 50% collapse (outer columns lock, characters pushed inward).
  private setCoreHp(side: 'player' | 'enemy', newHp: number) {
    const core = side === 'player' ? this.playerCore : this.enemyCore;
    // Clamped both ways: KO rewards must not push the core above its max
    // (spec: +40, cap 250), and damage must not push it below 0.
    core.hp = Math.max(0, Math.min(core.maxHp, newHp));
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
    // v2.2 Phase 2: a core hitting 50% fires a 35ms micro-hitstop + a
    // shake (the collapse is a big-board event, like a 6+ collision).
    this.hitstopTimer = Math.max(this.hitstopTimer, 0.035);
    this.screenShake = Math.max(this.screenShake, 0.3);
    const originX = side === 'player' ? this.renderer.playerOriginX : this.renderer.enemyOriginX;
    const step = this.renderer.cellW + this.renderer.gap;
    const centerX = (col: number) => originX + col * step + this.renderer.cellW / 2;

    if (side === 'player') {
      const c = this.player;
      c.releaseGrabOnCollapsedColumn();
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
      c.releaseGrabOnCollapsedColumn();
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

  // Hotfix (2026-11-21): the shrink zone is symmetric — its center is
  // the center of the board's middle 3x3 area (0-based col 4, row 2;
  // 1-indexed cols 4-6, rows 2-4). Both sides compute it from geometry
  // alone, so online needs no anchor exchange and both clients see the
  // same zone.
  private boardCenterAnchor(originX: number, originY: number): { x: number; y: number } {
    const stepX = this.renderer.cellW + this.renderer.gap;
    const stepY = this.renderer.cellH + this.renderer.gap;
    return {
      x: originX + 4 * stepX + this.renderer.cellW / 2,
      y: originY + 2 * stepY + this.renderer.cellH / 2,
    };
  }

  // GRID ROYALE (v2.4): clear all royale state so a duel / single battle
  // never inherits a stale player list, KO buff or rank.
  private resetRoyaleState() {
    this.royalePlayers = [];
    this.royaleMyId = null;
    this.royaleTargetMode = 'random';
    this.royaleTargetingIds = [];
    this.royaleKos = 0;
    this.royaleDamageBuff = 0;
    this.royaleKillFeed = [];
    this.royaleRank = null;
    this.royaleAliveCount = 0;
    this.royaleEliminated = false;
    this.royaleWarnings = [];
    this.lastHitBy = null;
    this.royalePendingIncoming = [];
    this.royaleLastStatusSent = null;
    this.royaleTargetedByCount = 0;
  }

  private startShrink() {
    this.shrinkPhase = 'shrinking';
    // Hotfix (2026-11-21): symmetric shrink — both anchors are the board
    // centers. No character-position anchor, no 'sudden_death_anchor'
    // exchange: the zone is identical on both clients by construction.
    this.shrinkAnchor = this.boardCenterAnchor(this.renderer.playerOriginX, this.renderer.playerOriginY);
    if (this.mode === 'royale') {
      // Royale has no opponent board: only my own board shrinks.
      this.shrinkAnchor2 = null;
      this.shrinkRect2 = null;
    } else {
      this.shrinkAnchor2 = this.boardCenterAnchor(this.renderer.enemyOriginX, this.renderer.enemyOriginY);
    }
    this.shrinkRect = this.boardRect(this.renderer.playerOriginX, this.renderer.playerOriginY, this.playerBoard);
    this.shrinkRect2 = this.mode === 'royale' ? null : this.boardRect(this.renderer.enemyOriginX, this.renderer.enemyOriginY, this.enemyBoard);
    this.particleSystem.addFloatingText(960, 500, '수축 존 시작!', '#FF4444', 24);
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
    this.shrinkRect = this.shrinkRectFor(this.shrinkAnchor, fullP, t);
    if (this.mode === 'royale') {
      this.shrinkRect2 = null;
    } else {
      const fullE = this.boardRect(this.renderer.enemyOriginX, this.renderer.enemyOriginY, this.enemyBoard);
      this.shrinkRect2 = this.shrinkRectFor(this.shrinkAnchor2, fullE, t);
    }
    if (t >= 45) this.shrinkPhase = 'closed';
    // Lock every tile whose center lies outside its side's safe rect.
    this.applyShrinkLocks(this.playerBoard, this.shrinkRect, this.renderer.playerOriginX, this.renderer.playerOriginY);
    if (this.mode !== 'royale') {
      this.applyShrinkLocks(this.enemyBoard, this.shrinkRect2, this.renderer.enemyOriginX, this.renderer.enemyOriginY);
    }
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
    if (this.mode === 'royale') {
      // Royale has no opponent character on my screen; only my own board
      // shrinks (every survivor shrinks on their own board at the same 90s
      // mark — the zones are per-client, not synced).
      return;
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
    this.joystickVector = null;
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

    // v2.2 Phase 2: all battle input is frozen during the start countdown
    // (Escape/P still work so the player can pause out of it).
    if (this.isCountingDown() && e.code !== 'Escape' && e.code !== 'KeyP') return;

    // Number keys 1~7 to instant switch archetype (P1 in single/boss mode).
    // In royale, 1~4 are the targeting modes instead (see below).
    if ((this.mode === 'single' || this.mode === 'boss') && ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].includes(e.code)) {
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

    // GRID ROYALE (v2.4): 1~4 switch the targeting mode live. The server
    // resolves the actual target per fire; this only changes the mode.
    if (this.mode === 'royale' && this.status === 'playing') {
      const targetModes: RoyaleTargetMode[] = ['random', 'ko', 'counter', 'leader'];
      const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (idx >= 0) {
        e.preventDefault();
        this.setRoyaleTargetMode(targetModes[idx]);
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
    this.joystickVector = null;
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
    this.resetRoyaleState();
    this.arcadeMode = null;
    this.mode = mode;
    this.status = 'playing';
    this.gameTime = 0;
    this.battleStartAt = performance.now();
    this.pauseAccum = 0;
    this.pausedAt = 0;
    this.beginBattle();

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
    this.battleStartAt = performance.now();
    this.pauseAccum = 0;
    this.pausedAt = 0;
    this.beginBattle();
    this.networkSyncTimer = 0;
    this.boardSyncTimer = 0;
    this.boardHashStreak = 0;
    this.boardSyncPending = false;
    this.peerDisconnectHandled = false;
    this.resetRoyaleState();
    this.arcadeMode = null;
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
        this.beginSlowmo('victory');
        this.particleSystem.addFloatingText(960, 540, 'OPPONENT DISCONNECTED!', '#FF3366', 22);
        soundManager.playVictory();
        this.triggerStateUpdate();
      }
    };

    soundManager.playSwitch();
    this.triggerStateUpdate();
  }

  // --- GRID ROYALE (v2.4) -----------------------------------------------
  // Up to 8 players, warp-portal combat. No board tiles or 20 Hz movement
  // are synced — only the 4 lightweight packets. My board is mine alone
  // (seeded from the server seed); the top board is replaced by the portal.
  public startRoyaleGame(players: RoyalePlayerInfo[], myId: string, seed: number = 7777777) {
    this.isOnline = true;
    this.onlineRole = 'p1';
    this.onlineRoomCode = networkManager.royaleRoomCode;
    this.mode = 'royale';
    this.status = 'playing';
    this.gameTime = 0;
    this.battleStartAt = performance.now();
    this.pauseAccum = 0;
    this.pausedAt = 0;
    this.beginBattle();
    this.networkSyncTimer = 0;
    this.boardSyncTimer = 0;
    this.boardHashStreak = 0;
    this.boardSyncPending = false;
    this.peerDisconnectHandled = false;
    this.resetRoyaleState();
    this.arcadeMode = null;
    this.royalePlayers = players.map((p) => ({ ...p, targetingIds: [...p.targetingIds] }));
    this.royaleMyId = myId;
    this.royaleAliveCount = this.royalePlayers.filter((p) => p.alive).length;
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

    // My own board only; the seed needs no cross-client agreement.
    this.playerBoard.reset(Math.abs(seed) || 7777777);
    this.enemyBoard.reset();
    this.projectileMgr.clear();
    this.particleSystem.clear();

    const me = this.royalePlayers.find((p) => p.id === myId);
    const pStartX = this.renderer.playerOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const pStartY = this.renderer.playerOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.player.reset(pStartX, pStartY);
    this.player.setArchetype(me?.archetype ?? 'lancer');
    this.player2 = null;

    networkManager.onRoyaleIncoming = (packet) => this.handleRoyaleIncoming(packet);
    networkManager.onRoyaleStatus = (packet) => this.handleRoyaleStatus(packet);
    networkManager.onRoyaleKo = (packet) => this.handleRoyaleKo(packet);

    this.sendRoyaleStatusIfChanged(true);
    soundManager.playSwitch();
    this.triggerStateUpdate();
  }

  public setRoyaleTargetMode(mode: RoyaleTargetMode) {
    if (this.mode !== 'royale' || this.status !== 'playing') return;
    if (this.royaleTargetMode === mode) return;
    this.royaleTargetMode = mode;
    this.sendRoyaleStatusIfChanged(true);
    const label = mode === 'random' ? '무작위' : mode === 'ko' ? '마무리' : mode === 'counter' ? '카운터' : '선두';
    this.particleSystem.addFloatingText(this.player.x, this.player.y - 40, `타겟: ${label}`, '#FFD166', 16);
    this.triggerStateUpdate();
  }

  // --- ARCADE 3종 ------------------------------------------------------------
  // 타이틀 아케이드 탭에서 직접 진입한다. 아키타입 선택을 거치지 않고
  // 표준 기체(랜서 외형, 패시브 없음)로 고정된다. AI 적·온라인·수축 존·
  // 후방 코어(메가/러시)는 동작하지 않는다.
  public startArcade(mode: ArcadeModeId) {
    this.isOnline = false;
    this.onlineRole = 'p1';
    this.onlineRoomCode = null;
    this.networkSyncTimer = 0;
    this.boardSyncTimer = 0;
    this.boardHashStreak = 0;
    this.boardSyncPending = false;
    this.peerDisconnectHandled = false;
    this.resetRoyaleState();
    this.mode = 'arcade';
    this.arcadeMode = mode;
    this.currentStage = 1;
    this.status = 'playing';
    this.gameTime = 0;
    this.battleStartAt = performance.now();
    this.pauseAccum = 0;
    this.pausedAt = 0;
    this.beginBattle();
    this.campaignRun = null;
    this.lastNoContinue = null;
    this.renderer.stageId = 1;
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

    this.playerBoard.reset();
    this.enemyBoard.reset();
    this.projectileMgr.clear();
    this.particleSystem.clear();
    this.resetArcadeState(mode);

    const pStartX = this.renderer.playerOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const pStartY = this.renderer.playerOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.player.reset(pStartX, pStartY);
    // 표준 기체: 랜서 외형으로 고정하고, 발사 시 'standard' 아키타입으로
    // 넘겨 랜서 패시브(스피어 탄속 2배·내구도 +1)가 적용되지 않게 한다.
    // 스킬은 handlePlayerSkill에서 아케이드 분기로 막는다.
    this.player.setArchetype('lancer');
    this.player2 = null;

    // AI 적은 업데이트·렌더링하지 않지만, 호밍 투사체의 조준점(상단
    // 중앙)과 enemy.isFinalBoss 각성 컷인 가드가 읽는 상태는 안전하게
    // 세팅해 둔다.
    const eStartX = this.renderer.enemyOriginX + (GRID_COLS * (this.renderer.cellW + this.renderer.gap)) / 2;
    const eStartY = this.renderer.enemyOriginY + (GRID_ROWS * (this.renderer.cellH + this.renderer.gap)) / 2;
    this.enemy.reset(eStartX, eStartY, 1);

    this.arcadeRecords = loadArcadeRecords();
    this.arcadeResult = null;
    soundManager.playSwitch();
    this.triggerStateUpdate();
  }

  private resetArcadeState(mode: ArcadeModeId) {
    this.megaBossHp = MEGA_BOSS_MAX_HP;
    this.megaBarrier = true;
    this.megaGroggyUntil = 0;
    this.megaOrder = null;
    this.megaOrderDeadline = 0;
    this.megaOrderSuccess = 0;
    this.megaOrderFail = 0;
    this.megaLaserCols = [];
    this.megaLaserFireAt = 0;
    this.megaLaserArmed = false;
    this.rushTimeLeft = RUSH_START_SEC;
    this.rushScore = 0;
    this.rushCombo = 0;
    this.rushComboMax = 0;
    this.rushOrdersDone = 0;
    this.rushMissions = [
      randomRushMission(0),
      randomRushMission(0),
      randomRushMission(0),
    ];
    this.rushCounted.clear();
    this.defenseMeteors = [];
    this.defenseSpawnTimer = 1.2;
    this.defenseWave = 1;
    this.defenseDestroyed = 0;
    this.defenseOvercharged.clear();
    if (mode === 'mega') this.issueMegaOrder();
  }

  // 메가 보스: 새 약점 지령을 뽑고 7초 제한을 건다. 그로기 중에는
  // 지령이 없어 타이머가 돌지 않는다 (그로기 종료 시 새로 뽑는다).
  private issueMegaOrder() {
    this.megaOrder = randomWeaknessOrder();
    this.megaOrderDeadline = this.gameTime + MEGA_ORDER_SEC;
  }

  // 코어 디펜스: 웨이브별 속도·크기·색상으로 운석 1개를 상단에서 생성.
  private spawnMeteor() {
    const wave = this.defenseWave;
    const { w, h } = meteorSizeForRoll(Math.random());
    const color = TILE_COLORS[Math.floor(Math.random() * TILE_COLORS.length)];
    const col = Math.floor(Math.random() * (GRID_COLS - w + 1));
    const stepX = this.renderer.cellW + this.renderer.gap;
    const stepY = this.renderer.cellH + this.renderer.gap;
    const cells: ArcadeMeteor['cells'] = [];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        cells.push({ relCol: c, relRow: r, hp: METEOR_CELL_HP, maxHp: METEOR_CELL_HP, destroyed: false });
      }
    }
    this.defenseMeteors.push({
      id: `meteor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      col,
      w,
      h,
      x: this.renderer.enemyOriginX + col * stepX,
      y: this.renderer.enemyOriginY - h * stepY,
      color,
      cells,
      speed: meteorFallSpeed(wave),
    });
  }

  private royaleMyInfo(): RoyalePlayerInfo | undefined {
    return this.royalePlayers.find((p) => p.id === this.royaleMyId);
  }

  private royaleName(id: string): string {
    return this.royalePlayers.find((p) => p.id === id)?.name ?? '플레이어';
  }

  // Send my status when anything the room needs changed (HP/core, target
  // mode, elimination, KO count). Never per-frame.
  private sendRoyaleStatusIfChanged(force: boolean = false) {
    if (this.mode !== 'royale' || !this.royaleMyId) return;
    const snap = {
      hp: Math.round(this.player.hp),
      coreHp: Math.round(this.playerCore.hp),
      targetMode: this.royaleTargetMode,
      alive: !this.royaleEliminated,
      kos: this.royaleKos,
    };
    const last = this.royaleLastStatusSent;
    if (
      !force &&
      last &&
      last.hp === snap.hp &&
      last.coreHp === snap.coreHp &&
      last.targetMode === snap.targetMode &&
      last.alive === snap.alive &&
      last.kos === snap.kos
    ) {
      return;
    }
    this.royaleLastStatusSent = snap;
    networkManager.sendRoyaleStatus({
      playerId: this.royaleMyId,
      hp: snap.hp,
      coreHp: snap.coreHp,
      targetMode: snap.targetMode,
      targetingIds: this.royaleTargetingIds,
      alive: snap.alive,
      kos: snap.kos,
      killerId: snap.alive ? null : this.lastHitBy,
    });
  }

  private handleRoyaleIncoming(packet: RoyaleIncomingPacket) {
    if (this.mode !== 'royale' || this.status !== 'playing') return;
    const cols = packet.cells.map((c) => c.col);
    const warnCol = cols.length > 0 ? Math.min(...cols) : 4;
    // 0.4s warning line at the portal, then the projectile spawns.
    this.royaleWarnings.push({ col: warnCol, until: this.gameTime + ROYALE_INCOMING_WARNING_SEC });
    this.royalePendingIncoming.push({
      packet,
      spawnAt: this.gameTime + ROYALE_INCOMING_WARNING_SEC,
    });
    this.lastHitBy = packet.fromPlayerId;
  }

  private spawnRoyaleIncoming(packet: RoyaleIncomingPacket) {
    // Rebuild the sender's projectile verbatim: the packet carries the
    // final per-cell damage / HP / speed, so nothing is recomputed here.
    const cluster: Cluster = {
      id: `royale_in_${Date.now()}_${Math.random()}`,
      color: packet.color,
      shapeType: packet.shape,
      shapeTitle: '',
      isActivePad: true,
      tiles: packet.cells.map((c) => ({ col: c.col, row: 0 })),
    };
    const proj = this.projectileMgr.createProjectile(
      'enemy',
      cluster,
      this.renderer.playerOriginX,
      this.renderer.enemyOriginY,
      this.renderer.cellW,
      this.renderer.cellH,
      this.renderer.gap,
      'standard'
    );
    packet.cells.forEach((c, i) => {
      const cell = proj.cells[i];
      if (cell) {
        cell.hp = c.hp;
        cell.maxHp = Math.max(c.hp, cell.maxHp);
      }
    });
    proj.damagePerCell = packet.cells[0]?.damage ?? proj.damagePerCell;
    proj.vy = Math.abs(packet.speed);
    proj.speedMultiplier = Math.abs(packet.speed) / 560;
    proj.fromPlayerId = packet.fromPlayerId;
    soundManager.playLaunch(packet.color, packet.cells.length, packet.shape);
  }

  private handleRoyaleStatus(packet: RoyaleStatusPacket) {
    if (this.mode !== 'royale') return;
    const p = this.royalePlayers.find((x) => x.id === packet.playerId);
    if (p) {
      p.hp = packet.hp;
      p.coreHp = packet.coreHp;
      p.targetMode = packet.targetMode;
      p.targetingIds = [...packet.targetingIds];
      p.alive = packet.alive;
      p.kos = packet.kos;
    }
    this.royaleAliveCount = this.royalePlayers.filter((x) => x.alive).length;
    if (packet.playerId === this.royaleMyId) {
      this.royaleTargetingIds = [...packet.targetingIds];
    }
    // Gang-up compensation: 3+ players targeting me speeds my refill.
    this.royaleTargetedByCount = this.royalePlayers.filter(
      (x) => x.alive && x.id !== this.royaleMyId && x.targetingIds.includes(this.royaleMyId ?? '')
    ).length;
    this.triggerStateUpdate();
  }

  private handleRoyaleKo(packet: RoyaleKoPacket) {
    if (this.mode !== 'royale') return;
    const victim = this.royalePlayers.find((x) => x.id === packet.victimId);
    const killer = packet.killerId ? this.royalePlayers.find((x) => x.id === packet.killerId) : undefined;
    if (victim) {
      victim.alive = false;
      victim.rank = packet.rank;
    }
    if (killer) killer.kos++;
    this.royaleAliveCount = packet.aliveCount;
    const feedText = killer
      ? `${killer.name} → ${victim?.name ?? '플레이어'} 처치 (#${packet.rank}위 탈락)`
      : `${victim?.name ?? '플레이어'} 탈락 (#${packet.rank}위)`;
    this.royaleKillFeed.unshift({ text: feedText, color: killer ? '#FF6B6B' : '#94A3B8' });
    this.royaleKillFeed = this.royaleKillFeed.slice(0, 2);

    if (packet.victimId === this.royaleMyId) {
      // My own elimination (the server already ranked me; my defeat
      // screen was shown when my HP hit 0 — this fills in the rank).
      this.royaleRank = packet.rank;
      this.royaleEliminated = true;
      // Usually the local HP-0 check already started the slow-mo; only
      // start it here if the ko packet arrived first.
      this.beginSlowmo('defeat', this.player.hp <= 0 ? 'KO' : 'CORE DESTROYED');
      soundManager.playDefeat();
      this.triggerStateUpdate();
      return;
    }

    if (packet.killerId === this.royaleMyId) {
      // KO rewards: HP +20 (cap 100), core +40 (cap 250), +10% damage
      // (max 5 stacks, +50%).
      this.royaleKos++;
      this.royaleDamageBuff = Math.min(ROYALE_KO_DMG_BUFF_MAX, this.royaleDamageBuff + 1);
      this.player.hp = Math.min(100, this.player.hp + ROYALE_KO_HP_REWARD);
      this.setCoreHp('player', this.playerCore.hp + ROYALE_KO_CORE_REWARD);
      this.particleSystem.addFloatingText(this.player.x, this.player.y - 50, 'KO! +20 HP · +40 코어 · +10% 데미지', '#FFD166', 18);
      this.particleSystem.addShockwave(this.player.x, this.player.y, 120, '#FFD166');
      this.sendRoyaleStatusIfChanged(true);
    }

    // Last one standing wins.
    if (packet.aliveCount <= 1 && !this.royaleEliminated && this.status === 'playing') {
      this.royaleRank = 1;
      this.beginSlowmo('victory');
      soundManager.playVictory();
      this.triggerStateUpdate();
    }
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
          dmgMult?: number;
          speedMult?: number;
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
        const remoteProj = this.projectileMgr.createProjectile(
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
        // v2.2 balance: apply the sender's launch buff multipliers verbatim
        // (transporter swap-link / speedster fire buff) so both sides deal
        // the exact same damage/speed.
        if (d.dmgMult && d.dmgMult !== 1) {
          remoteProj.damagePerCell = Math.round(remoteProj.damagePerCell * d.dmgMult);
        }
        if (d.speedMult && d.speedMult !== 1) {
          remoteProj.vy *= d.speedMult;
          remoteProj.speedMultiplier *= d.speedMult;
        }
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
        this.enemyBoard.launchCluster(mapped, MONOCHROME_ABSORB_REFILL_SEC);
        const gain =
          typeof d.shieldGain === 'number' ? d.shieldGain : MONOCHROME_ABSORB_GAIN;
        this.player2.shield = Math.min(MONOCHROME_SHIELD_MAX, this.player2.shield + gain);
        this.particleSystem.addFloatingText(
          this.player2.x,
          this.player2.y - 30,
          gain > 0 ? `+${gain} SHIELD ABSORBED!` : 'ABSORB COOLDOWN',
          '#33CCFF',
          16
        );
        break;
      }
      case 'skill': {
        const d = action.data as {
          archetypeId: ArchetypeId;
          col: number;
          row: number;
          effect?: SkillEffect;
          dir?: { x: number; y: number };
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
          effect,
          // Hotfix (2026-11-21): blink direction from the sender's packet
          // (speedster); the local copy's moveDir is stale for the peer.
          d.dir ?? null
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
    // Same battle-start reset as startGame/startOnlineGame/startRoyaleGame:
    // without it the next stage skipped the 1.5s entry countdown, kept the
    // previous stage's battleStartAt (BATTLE TIME accumulated across
    // stages) and kept the previous stage's stats (damageDealt etc.).
    this.gameTime = 0;
    this.battleStartAt = performance.now();
    this.pauseAccum = 0;
    this.pausedAt = 0;
    this.beginBattle();
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
  // v2.2 Phase 2: input buffer (100ms) + launch grace (60ms) + rejection
  // feedback. Handlers below return success; a failed local press is
  // buffered once and retried next frame (no feedback on the retry).
  private tryBufferedAction(action: 'launch' | 'skill' | 'dash' | 'discard', playerNum: 1 | 2): boolean {
    switch (action) {
      case 'launch':
        return this.handlePlayerLaunch(playerNum, true, true);
      case 'skill':
        return this.handlePlayerSkill(playerNum, true, true);
      case 'dash':
        return this.handlePlayerDash(playerNum, true, true);
      case 'discard':
        return this.handlePlayerDiscard(playerNum, true, true);
    }
  }

  private flushInputBuffers() {
    const now = performance.now();
    ([1, 2] as const).forEach((pn) => {
      const buf = this.inputBuffer[pn];
      if (!buf) return;
      if (now > buf.until) {
        this.inputBuffer[pn] = null;
        return;
      }
      if (this.tryBufferedAction(buf.action, pn)) this.inputBuffer[pn] = null;
    });
  }

  private bufferInput(action: 'launch' | 'skill' | 'dash' | 'discard', playerNum: 1 | 2) {
    this.inputBuffer[playerNum] = { action, until: performance.now() + INPUT_BUFFER_MS };
  }

  // v2.2 Phase 2: failed launch — the tile shakes, a low buzz plays, and
  // a "3+" popup marks the spot. Buffered for 100ms in case a refill
  // completes the cluster.
  private rejectLaunchFeedback(playerNum: 1 | 2, actor: PlayerCharacter) {
    const owner = playerNum === 1 ? 'player' : 'enemy';
    this.rejectTile = { owner, col: actor.currentCol, row: actor.currentRow, until: performance.now() + 300 };
    soundManager.playReject();
    this.particleSystem.addFloatingText(actor.x, actor.y - 40, '3+', '#FF6666', 15);
    this.bufferInput('launch', playerNum);
    this.triggerStateUpdate();
  }

  // v2.2 Phase 2: skill/dash/discard pressed on cooldown or with an empty
  // magazine — the HUD icon flashes red (GameHUD reads rejectFlash).
  private rejectActionFeedback(kind: 'skill' | 'dash' | 'discard', playerNum: 1 | 2) {
    this.rejectFlash = { kind, playerNum, until: performance.now() + 300 };
    soundManager.playReject();
    this.bufferInput(kind, playerNum);
    this.triggerStateUpdate();
  }

  // v2.2 Phase 2: remember the last launchable 3+ cluster under the actor
  // so a launch pressed up to 60ms after stepping off it still fires.
  private trackLaunchablePad(playerNum: 1 | 2) {
    const actor = playerNum === 1 ? this.player : this.player2;
    const board = playerNum === 1 ? this.playerBoard : this.enemyBoard;
    if (!actor) return;
    const cluster = board.getClusterAt(actor.currentCol, actor.currentRow);
    if (cluster && cluster.isActivePad && cluster.tiles.length >= 3) {
      this.lastLaunchable[playerNum] = { col: actor.currentCol, row: actor.currentRow, at: performance.now() };
    }
  }

  // v2.2 Phase 2: the cluster a grace-period launch should fire, if the
  // actor stepped off a launchable 3+ cluster within the last 60ms.
  private graceCluster(playerNum: 1 | 2): Cluster | null {
    const last = this.lastLaunchable[playerNum];
    if (!last || performance.now() - last.at > LAUNCH_GRACE_MS) return null;
    const board = playerNum === 1 ? this.playerBoard : this.enemyBoard;
    const cluster = board.getClusterAt(last.col, last.row);
    return cluster && cluster.isActivePad && cluster.tiles.length >= 3 ? cluster : null;
  }

  // v2.2 Phase 2: portrait cut-in (skill cast / combo 7+ / boss awakening).
  public showCutin(portrait: ArchetypeId, label: string, ms: number) {
    this.cutin = { portrait, label, until: performance.now() + ms, durationMs: ms };
  }

  // v2.2 Phase 2: combo-7 portrait cut-in (fires once per climb to 7).
  private comboCutin(count: number, portrait: ArchetypeId) {
    if (count === 7) this.showCutin(portrait, 'COMBO x7', 1200);
  }

  public handlePlayerLaunch(playerNum: 1 | 2 = 1, broadcast: boolean = true, fromBuffer: boolean = false): boolean {
    if (this.status !== 'playing' || this.isCountingDown()) return false;

    const actor = playerNum === 1 ? this.player : this.player2;
    const board = playerNum === 1 ? this.playerBoard : this.enemyBoard;
    const ownerStr = playerNum === 1 ? 'player' : 'enemy';
    const originX = playerNum === 1 ? this.renderer.playerOriginX : this.renderer.enemyOriginX;
    const originY = playerNum === 1 ? this.renderer.playerOriginY : this.renderer.enemyOriginY;

    if (!actor) return false;
    let cluster = board.getClusterAt(actor.currentCol, actor.currentRow);
    // v2.2 Phase 2: launch grace — stepped off a launchable 3+ cluster
    // within 60ms? Fire that cluster instead of failing.
    if ((!cluster || !cluster.isActivePad) && !fromBuffer) {
      const graced = this.graceCluster(playerNum);
      if (graced) cluster = graced;
    }
    if (!cluster) {
      if (!fromBuffer) this.rejectLaunchFeedback(playerNum, actor);
      return false;
    }

    // Monochrome special rule
    // Hotfix (2026-11-21): absorbed tiles refill in 1.0s (was 0.5s), and
    // shield gain has a 2.0s internal cooldown — absorbing during the
    // cooldown still evaporates the cluster but grants no shield.
    if (actor.archetypeId === 'monochrome' && cluster.color !== 'red') {
      const shieldGain =
        actor.absorbCooldownRemaining <= 0 ? MONOCHROME_ABSORB_GAIN : 0;
      if (shieldGain > 0) {
        actor.absorbCooldownRemaining = MONOCHROME_ABSORB_COOLDOWN_SEC;
      }
      if (this.isOnline && broadcast && playerNum === 1) {
        networkManager.sendAction('absorb', {
          tiles: cluster.tiles.map((t) => ({ col: t.col, row: t.row })),
          shieldGain,
        });
      }
      board.launchCluster(cluster, MONOCHROME_ABSORB_REFILL_SEC);
      actor.shield = Math.min(MONOCHROME_SHIELD_MAX, actor.shield + shieldGain);
      soundManager.playSkill('monochrome');
      this.particleSystem.addFloatingText(
        actor.x,
        actor.y - 30,
        shieldGain > 0 ? `+${shieldGain} SHIELD ABSORBED!` : 'ABSORB COOLDOWN',
        '#33CCFF',
        16
      );
      this.particleSystem.addShockwave(actor.x, actor.y, 70, '#33CCFF');
      this.triggerStateUpdate();
      return true;
    }

    if (!cluster.isActivePad) {
      if (!fromBuffer) this.rejectLaunchFeedback(playerNum, actor);
      return false;
    }

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

    // v2.2 balance: transporter swap-link / speedster fire buffs — the
    // first launch within 1.5s of a swap (transporter) or blink/dash
    // (speedster) is buffed. Consumed here; the multipliers travel in the
    // launch packet so the remote side applies the exact same damage/speed
    // instead of recomputing (its copy of the buff state lags by latency).
    let buffDmgMult = 1;
    let buffSpeedMult = 1;
    if (actor.swapBuffRemaining > 0) {
      buffDmgMult *= TRANSPORTER_SWAP_DMG_MULT;
      actor.swapBuffRemaining = 0;
    }
    if (actor.speedBuffRemaining > 0) {
      buffDmgMult *= SPEEDSTER_FIRE_DMG_MULT;
      buffSpeedMult *= SPEEDSTER_FIRE_SPEED_MULT;
      actor.speedBuffRemaining = 0;
    }

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
        dmgMult: buffDmgMult,
        speedMult: buffSpeedMult,
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
      // 아케이드 표준 기체는 'standard'로 넘겨 직업 패시브(랜서 스피어
      // 강화·웨이브 월 가속·모노크롬 적색 2배 등)가 전혀 붙지 않게 한다.
      this.isArcade ? 'standard' : actor.archetypeId,
      actor.overdriveActive,
      frontline
    );

    // v2.2 balance: apply the launch buffs computed above.
    if (buffDmgMult !== 1) {
      proj.damagePerCell = Math.round(proj.damagePerCell * buffDmgMult);
    }
    if (buffSpeedMult !== 1) {
      proj.vy *= buffSpeedMult;
      proj.speedMultiplier *= buffSpeedMult;
    }

    // GRID ROYALE: KO damage buff (+10% per KO, max +50%) applies to my
    // launches; the buffed damage is what the portal packet carries.
    if (this.mode === 'royale' && playerNum === 1 && this.royaleDamageBuff > 0) {
      proj.damagePerCell = Math.round(
        proj.damagePerCell * (1 + ROYALE_KO_DMG_BUFF_STEP * this.royaleDamageBuff)
      );
    }

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

    // Launched tiles are gone — the grace memory must not fire the same
    // cluster twice.
    this.lastLaunchable[playerNum] = null;
    this.triggerStateUpdate();
    return true;
  }

  // Player Skill
  public handlePlayerSkill(playerNum: 1 | 2 = 1, broadcast: boolean = true, fromBuffer: boolean = false): boolean {
    if (this.status !== 'playing' || this.isCountingDown()) return false;

    // 아케이드 표준 기체는 스킬이 없다. Q/Ctrl 입력은 거부 피드백만 준다.
    if (this.isArcade) {
      if (!fromBuffer) this.rejectActionFeedback('skill', playerNum);
      return false;
    }

    const actor = playerNum === 1 ? this.player : this.player2;
    const board = playerNum === 1 ? this.playerBoard : this.enemyBoard;
    const originX = playerNum === 1 ? this.renderer.playerOriginX : this.renderer.enemyOriginX;
    const originY = playerNum === 1 ? this.renderer.playerOriginY : this.renderer.enemyOriginY;
    const ownerStr = playerNum === 1 ? 'player' : 'enemy';

    if (!actor) return false;

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
        const beam = this.projectileMgr.createSniperBeam(
          ownerStr,
          actor.currentCol,
          originX,
          originY,
          this.renderer.cellW,
          this.renderer.cellH,
          this.renderer.gap
        );
        if (this.mode === 'royale' && this.royaleDamageBuff > 0) {
          beam.damagePerCell = Math.round(
            beam.damagePerCell * (1 + ROYALE_KO_DMG_BUFF_STEP * this.royaleDamageBuff)
          );
        }
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
        // Hotfix (2026-11-21): the peer's copy of this character has a
        // stale moveDir, so the blink direction travels with the packet
        // (speedster only — the only skill that uses it).
        ...(actor.archetypeId === 'speedster'
          ? { dir: { x: actor.moveDir.x, y: actor.moveDir.y } }
          : {}),
      });
    }

    if (activated) {
      // v2.2 Phase 2: portrait cut-in on a skill cast (1.0s).
      this.showCutin(actor.archetypeId, ARCHETYPES[actor.archetypeId].skillName, 1000);
      this.triggerStateUpdate();
      return true;
    }
    // A Transporter grab cancel is a successful action, not a rejection.
    if (grabCanceled) return true;
    if (!fromBuffer) this.rejectActionFeedback('skill', playerNum);
    return false;
  }

  // Player Discard (3-stack magazine, 0.45s refill)
  public handlePlayerDiscard(playerNum: 1 | 2 = 1, broadcast: boolean = true, fromBuffer: boolean = false): boolean {
    if (this.status !== 'playing' || this.isCountingDown()) return false;

    const actor = playerNum === 1 ? this.player : this.player2;
    const board = playerNum === 1 ? this.playerBoard : this.enemyBoard;
    if (!actor) return false;

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
      return true;
    }
    if (!fromBuffer) this.rejectActionFeedback('discard', playerNum);
    return false;
  }

  // Player Dash (i-frame evasion)
  public handlePlayerDash(playerNum: 1 | 2 = 1, broadcast: boolean = true, fromBuffer: boolean = false): boolean {
    if (this.status !== 'playing' || this.isCountingDown()) return false;

    const actor = playerNum === 1 ? this.player : this.player2;
    if (!actor) return false;

    // Execute first, broadcast only on success: a dash on cooldown must
    // not make the remote copy dash (and go invincible) for free.
    const success = actor.performDash(this.particleSystem);
    if (success) {
      if (this.isOnline && broadcast && playerNum === 1) {
        networkManager.sendAction('dash', {});
      }
      this.triggerStateUpdate();
      return true;
    }
    if (!fromBuffer) this.rejectActionFeedback('dash', playerNum);
    return false;
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
      // Hotfix (2026-11-21): same absorb nerf as the player — 1.0s refill,
      // +8 shield, 2.0s internal cooldown on the gain.
      const shieldGain =
        this.enemy.absorbCooldownRemaining <= 0 ? MONOCHROME_ABSORB_GAIN : 0;
      if (shieldGain > 0) {
        this.enemy.absorbCooldownRemaining = MONOCHROME_ABSORB_COOLDOWN_SEC;
      }
      this.enemyBoard.launchCluster(cluster, MONOCHROME_ABSORB_REFILL_SEC);
      this.enemy.shield = Math.min(MONOCHROME_SHIELD_MAX, this.enemy.shield + shieldGain);
      soundManager.playSkill('monochrome');
      this.particleSystem.addFloatingText(
        this.enemy.x,
        this.enemy.y - 30,
        shieldGain > 0 ? `+${shieldGain} SHIELD ABSORBED!` : 'ABSORB COOLDOWN',
        '#33CCFF',
        16
      );
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
    const aiProj = this.projectileMgr.createProjectile(
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
    // v2.2 balance: consume the AI's launch buffs (transporter swap-link /
    // speedster blink) on its next launch, same rule as the player.
    if (this.enemy.swapBuffRemaining > 0) {
      aiProj.damagePerCell = Math.round(aiProj.damagePerCell * TRANSPORTER_SWAP_DMG_MULT);
      this.enemy.swapBuffRemaining = 0;
    }
    if (this.enemy.speedBuffRemaining > 0) {
      aiProj.damagePerCell = Math.round(aiProj.damagePerCell * SPEEDSTER_FIRE_DMG_MULT);
      aiProj.vy *= SPEEDSTER_FIRE_SPEED_MULT;
      aiProj.speedMultiplier *= SPEEDSTER_FIRE_SPEED_MULT;
      this.enemy.speedBuffRemaining = 0;
    }
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
        // Optimization (2.2): feed real frame times to the auto frame
        // defense while the battle runs (countdown included — rendering
        // still happens). Tab-switch spikes are filtered inside.
        this.frameDefense.update(rawDt);
        const degraded = this.frameDefense.degraded;
        if (degraded !== this.particleSystem.autoDegraded) {
          this.particleSystem.setAutoDegraded(degraded);
        }
        // v2.2 Phase 2: the 1.5s start countdown freezes the battle (the
        // canvas still renders the 3-2-1-FIGHT overlay).
        if (this.isCountingDown()) {
          // Frozen: no update, no input.
        } else if (this.hitstopTimer > 0) {
          this.hitstopTimer -= dt;
          // Hotfix (2026-11-21): a dash pressed during hitstop must not
          // be swallowed. The input buffer window is wall-clock, but
          // update() (and flushInputBuffers) does not run while the game
          // is frozen — so a chained hitstop could expire a buffered
          // dash before it is ever retried. Freeze the window with the
          // game: extend each buffered input by the wall time spent
          // frozen. The in-progress dash itself is already safe — its
          // duration only ticks inside update(), which is skipped here.
          for (const pn of [1, 2] as const) {
            const buf = this.inputBuffer[pn];
            if (buf) buf.until += rawDt * 1000;
          }
        } else {
          this.update(dt);
        }
      } else if (this.status === 'slowmo') {
        // v2.2 Phase 2: decisive-moment slow motion — the world keeps
        // running at 0.25x in real time, then flips to the pending result.
        this.slowmoTimer -= rawDt;
        if (this.slowmoTimer > 0) {
          this.update(dt * SLOWMO_TIMESCALE);
        } else {
          this.status = this.pendingResult ?? 'defeat';
          this.pendingResult = null;
          this.slowmoTimer = 0;
          this.triggerStateUpdate();
        }
      }

      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  private update(dt: number) {
    this.gameTime += dt;
    // Result-screen BATTLE TIME is wall-clock match time (see
    // battleStartAt): gameTime is the gameplay clock and must keep
    // driving shrink/AI timing exactly as before. ESC-pause dwell is
    // excluded via pauseAccum; the campaign no-continue record is
    // unaffected (it uses its own Date.now() run clock in campaign.ts).
    this.stats.gameDuration =
      this.battleStartAt > 0 ? (performance.now() - this.battleStartAt - this.pauseAccum) / 1000 : this.gameTime;

    // v2.2 Phase 2: retry buffered inputs (100ms window), remember
    // launchable pads for the 60ms launch grace, and chime once when a
    // skill finishes cooling down.
    this.flushInputBuffers();
    this.trackLaunchablePad(1);
    if (this.player2) this.trackLaunchablePad(2);
    const skillReady = this.player.skillCooldownRemaining <= 0;
    if (skillReady && !this.wasSkillReady) soundManager.playSkillReady();
    this.wasSkillReady = skillReady;
    if (this.player2) {
      const ready2 = this.player2.skillCooldownRemaining <= 0;
      if (ready2 && !this.wasSkillReady2) soundManager.playSkillReady();
      this.wasSkillReady2 = ready2;
    }
    // v2.2 Phase 2: boss awakening portrait cut-in (once per battle).
    if (this.enemy.isFinalBoss && this.enemy.awakened && !this.awakeningCutinShown) {
      this.awakeningCutinShown = true;
      this.showCutin('sniper', 'OMNI-AWAKENING', 1500);
    }

    // Mid-battle disconnect detection. The server notifies the remaining
    // player via peer_left, but if the lobby modal overwrote the callback
    // (it re-registers its handlers on every render), the notification
    // would only update hidden lobby state. Polling the connection flags
    // here guarantees the battle ends with a result either way.
    // (Royale has no single opponent to poll: only my own socket matters.)
    if (this.isOnline && this.mode !== 'royale' && this.status === 'playing' && !this.peerDisconnectHandled) {
      if (!networkManager.isConnected) {
        this.peerDisconnectHandled = true;
        this.beginSlowmo('defeat', 'CONNECTION LOST');
        this.particleSystem.addFloatingText(960, 540, 'CONNECTION LOST', '#FF3366', 22);
        soundManager.playDefeat();
        this.triggerStateUpdate();
        return;
      }
      if (!networkManager.opponentConnected) {
        this.peerDisconnectHandled = true;
        this.beginSlowmo('victory');
        this.particleSystem.addFloatingText(960, 540, 'OPPONENT DISCONNECTED!', '#FF3366', 22);
        soundManager.playVictory();
        this.triggerStateUpdate();
        return;
      }
    }
    if (this.isOnline && this.mode === 'royale' && this.status === 'playing' && !this.peerDisconnectHandled) {
      if (!networkManager.isConnected) {
        this.peerDisconnectHandled = true;
        this.beginSlowmo('defeat', 'CONNECTION LOST');
        this.particleSystem.addFloatingText(960, 540, 'CONNECTION LOST', '#FF3366', 22);
        soundManager.playDefeat();
        this.triggerStateUpdate();
        return;
      }
    }

    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - dt * 2);
    }

    // v2.2 90-second shrink zone: warn at 80s, anchor at 90s, then close.
    // 아케이드에서는 수축 존이 동작하지 않는다.
    if (!this.isArcade && !this.shrinkWarned && this.gameTime >= 80) {
      this.shrinkWarned = true;
      this.shrinkPhase = 'warning';
      // 80s warning banner: drawn in the neutral zone (Y 404..636) so it
      // never covers either board. It rises ~31px over its 0.9s life
      // (35px/s), ending at ~468 — clear of the watermark (baseline 525)
      // and both boards (enemy bottom 384, player top 656).
      this.particleSystem.addFloatingText(960, 500, '10초 후 수축 존 시작! (중앙으로 모여라!)', '#FF4444', 22);
      this.triggerStateUpdate();
    }
    if (!this.isArcade && this.shrinkPhase === 'warning' && this.gameTime >= 90) {
      this.startShrink();
    }
    if (!this.isArcade && (this.shrinkPhase === 'shrinking' || this.shrinkPhase === 'closed')) {
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
    // Royale gang-up compensation: 3+ players targeting me speeds my
    // refill by 15%.
    const gangupMult =
      this.mode === 'royale' && this.royaleTargetedByCount >= ROYALE_GANGUP_THRESHOLD
        ? ROYALE_GANGUP_REFILL_MULT
        : 1.0;
    // 아케이드 코어 디펜스 붕괴 시 리필 가속은 기획서 수치 20%
    // (DEFENSE_COLLAPSE_REFILL_MULT = 1.2, 기존 모드 1.3이 아님).
    const collapseRefillMult = this.playerCore.collapsed
      ? this.isArcade
        ? DEFENSE_COLLAPSE_REFILL_MULT
        : 1.3
      : 1.0;
    const playerCDMult =
      (this.player.archetypeId === 'speedster' ? 1.5 : 1.0) * collapseRefillMult * gangupMult;
    const isSniper = this.player.archetypeId === 'sniper';
    const playerRefilled = this.playerBoard.update(dt, playerCDMult, isSniper);

    const enemyCDMult =
      (this.player2?.archetypeId === 'speedster' ||
      (this.mode !== 'multi' && this.enemy.archetypes.includes('speedster'))
        ? 1.5
        : 1.0) * (this.enemyCore.collapsed ? 1.3 : 1.0);
    // v2.3: offline, the enemy board uses the AI's archetypes (sniper
    // 1-2 cell launches, speedster refill); online/local 2P it uses P2's.
    // Royale has no opponent board on my screen: skip its update.
    // Arcade too: the top area is the boss / empty / meteor sky.
    const isEnemySniper =
      this.mode === 'multi'
        ? this.player2?.archetypeId === 'sniper'
        : this.enemy.archetypes.includes('sniper');
    const enemyRefilled =
      this.mode === 'royale' || this.isArcade
        ? false
        : this.enemyBoard.update(dt, enemyCDMult, isEnemySniper);

    this.refillSoundTimer -= dt;
    if ((playerRefilled || enemyRefilled) && this.refillSoundTimer <= 0) {
      this.refillSoundTimer = 0.05;
      soundManager.playRefill();
    }

    // Player Movement & Online Position Sync
    if (this.isOnline && this.mode === 'royale') {
      // Royale: local movement only. No 20 Hz move sync, no board hash —
      // the 4 lightweight packets carry everything.
      this.player.analogMove = this.joystickVector;
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
    } else if (this.isOnline) {
      this.player.analogMove = this.joystickVector;
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
      this.player.analogMove = this.joystickVector;
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
      } else if (!this.isArcade) {
        // 아케이드: AI 적은 움직이지 않는다 (호밍 조준점용 위치만 유지).
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
    // the characters' current positions). Arcade has no shrink zone.
    if (!this.isArcade && (this.shrinkPhase === 'shrinking' || this.shrinkPhase === 'closed')) {
      this.applyShrinkDamage(dt);
    }

    // Projectiles & Particles update
    const target2X = this.player2 ? this.player2.x : this.enemy.x;
    this.projectileMgr.update(dt, this.particleSystem, this.player.x, target2X);
    this.particleSystem.update(dt);

    // GRID ROYALE: portal warps, pending incoming spawns, warning lines.
    if (this.mode === 'royale') {
      this.updateRoyalePortal();
    }

    // ARCADE: 모드별 타이머·운석 하강·레이저 발사를 진행한다.
    if (this.isArcade) {
      this.updateArcade(dt);
    }

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

    // Check Projectile Impacts (아케이드는 전용 판정으로 대체: 보스·
    // 목표 라인·운석. 적 캐릭터/코어는 존재하지 않는다).
    if (this.isArcade) {
      this.resolveArcadeImpacts();
    } else {
      this.resolveBoardAndCharacterImpacts();
    }

    // Check Win / Loss condition (v2.2: a destroyed rear core also ends
    // the battle immediately).
    // GRID ROYALE: my own elimination is detected locally (HP/core 0) and
    // reported via royale_status; the server answers with royale_ko, which
    // fills in the rank. Victory is decided by the ko broadcast
    // (aliveCount 1), not here.
    // ARCADE: 모드별 종료 조건 (보스 격파 / 타이머 종료 / 생존 실패).
    if (this.isArcade) {
      this.checkArcadeEnd();
    } else if (this.mode === 'royale') {
      if (!this.royaleEliminated && (this.player.hp <= 0 || this.playerCore.hp <= 0) && this.status === 'playing') {
        this.royaleEliminated = true;
        this.beginSlowmo('defeat', this.player.hp <= 0 ? 'KO' : 'CORE DESTROYED');
        soundManager.playDefeat();
        this.sendRoyaleStatusIfChanged(true);
        this.triggerStateUpdate();
      }
    } else if (this.mode === 'multi' && this.player2) {
      if ((this.player2.hp <= 0 || this.enemyCore.hp <= 0) && this.status === 'playing') {
        this.beginSlowmo('victory'); // I Won!
        soundManager.playVictory();
        this.triggerStateUpdate();
      } else if ((this.player.hp <= 0 || this.playerCore.hp <= 0) && this.status === 'playing') {
        this.beginSlowmo('defeat', this.player.hp <= 0 ? 'KO' : 'CORE DESTROYED'); // I Lost!
        soundManager.playDefeat();
        this.triggerStateUpdate();
      }
    } else {
      // Single Mode or Boss Mode
      if ((this.enemy.hp <= 0 || this.enemyCore.hp <= 0) && this.status === 'playing') {
        if (this.mode === 'single' && this.currentStage < 30) {
          this.beginSlowmo('stage_clear');
          recordStageClear(this.currentStage);
          soundManager.playStageClear();
        } else {
          // Final boss beaten (campaign stage 30 or boss rush).
          this.beginSlowmo('victory');
          recordStageClear(30);
          this.lastNoContinue = tryRecordNoContinue(this.campaignRun);
          this.campaignRun = null;
          soundManager.playVictory();
        }
        this.triggerStateUpdate();
      } else if ((this.player.hp <= 0 || this.playerCore.hp <= 0) && this.status === 'playing') {
        this.beginSlowmo('defeat', this.player.hp <= 0 ? 'KO' : 'CORE DESTROYED');
        // A defeat breaks the live no-continue run (retrying = continue).
        if (this.campaignRun) this.campaignRun = markRunBroken(this.campaignRun);
        soundManager.playDefeat();
        this.triggerStateUpdate();
      }
    }

    // Royale: report HP/core/target changes (never per-frame).
    if (this.mode === 'royale') {
      this.sendRoyaleStatusIfChanged();
    }
  }

  // GRID ROYALE (v2.4): portal crossing, incoming spawns, warning expiry.
  private updateRoyalePortal() {
    const now = this.gameTime;
    this.royaleWarnings = this.royaleWarnings.filter((w) => w.until > now);
    const due = this.royalePendingIncoming.filter((p) => p.spawnAt <= now);
    if (due.length > 0) {
      this.royalePendingIncoming = this.royalePendingIncoming.filter((p) => p.spawnAt > now);
      for (const { packet } of due) this.spawnRoyaleIncoming(packet);
    }
    // My projectiles crossing the portal warp to the resolved target.
    const cellW = this.renderer.cellW;
    const gap = this.renderer.gap;
    for (let i = this.projectileMgr.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectileMgr.projectiles[i];
      if (p.owner !== 'player') continue;
      if (p.y > ROYALE_PORTAL_Y) continue;
      this.projectileMgr.projectiles.splice(i, 1);
      const liveCells = p.cells.filter((c) => !c.destroyed);
      if (liveCells.length === 0) continue;
      const cells = liveCells.map((c) => {
        const cx = p.x + c.relCol * (cellW + gap) + cellW / 2;
        const col = Math.max(
          0,
          Math.min(GRID_COLS - 1, Math.floor((cx - this.renderer.playerOriginX) / (cellW + gap)))
        );
        return { col, hp: c.hp, damage: p.damagePerCell };
      });
      networkManager.sendRoyaleFire({
        targetMode: this.royaleTargetMode,
        color: p.color,
        shape: p.shapeType,
        cells,
        speed: Math.abs(p.vy),
        isFrontline: p.frontline ?? false,
        ignoreCounter: !!p.isBeam,
      });
    }
  }

  // --- ARCADE: 모드별 진행·판정·종료 ----------------------------------------
  // update()에서 매 프레임 호출된다 (수축 존·AI·온라인 코드는 아케이드에서
  // 이미 분기로 막혀 있다).

  private updateArcade(dt: number) {
    if (this.arcadeMode === 'mega') {
      this.updateMegaBoss();
    } else if (this.arcadeMode === 'rush') {
      this.rushTimeLeft -= dt;
      if (this.rushTimeLeft < 0) this.rushTimeLeft = 0;
    } else if (this.arcadeMode === 'defense') {
      this.updateDefense(dt);
    }
  }

  // 메가 보스: 약점 지령 제한 시간 + 그로기 종료 + 레이저 발사.
  private updateMegaBoss() {
    const now = this.gameTime;
    // 그로기 종료: 배리어 재생성 + 다음 지령.
    if (!this.megaBarrier && now >= this.megaGroggyUntil) {
      this.megaBarrier = true;
      this.issueMegaOrder();
      this.particleSystem.addFloatingText(960, 300, '배리어 재생성!', '#33CCFF', 18);
      this.triggerStateUpdate();
    }
    // 지령 제한 시간 초과: 레이저 패턴 + 다음 지령.
    if (this.megaBarrier && this.megaOrder && now >= this.megaOrderDeadline) {
      this.megaOrderFail++;
      this.fireMegaLaserTelegraph();
      this.issueMegaOrder();
      this.triggerStateUpdate();
    }
    // 레이저 발사 시점: 예고된 열에 서 있으면 25 피해 (대시 무적 회피).
    if (this.megaLaserArmed && now >= this.megaLaserFireAt) {
      this.megaLaserArmed = false;
      const cols = this.megaLaserCols;
      this.megaLaserCols = [];
      const step = this.renderer.cellW + this.renderer.gap;
      for (const col of cols) {
        const x = this.renderer.playerOriginX + col * step + this.renderer.cellW / 2;
        this.particleSystem.addLaserBeam(
          x,
          this.renderer.playerOriginY - 40,
          x,
          this.renderer.playerOriginY + GRID_ROWS * step,
          '#FF2244',
          22
        );
      }
      soundManager.playHit(false);
      if (cols.includes(this.player.currentCol)) {
        const before = this.player.hp;
        this.player.takeDamage(MEGA_LASER_DMG, true);
        const dealt = Math.max(0, before - this.player.hp);
        if (dealt > 0) {
          this.stats.damageTaken += dealt;
          this.player.knockbackY = 180;
          this.hitstopTimer = 0.05;
          this.screenShake = 0.3;
          this.particleSystem.addFloatingText(this.player.x, this.player.y - 20, `-${dealt} LASER!`, '#FF2244', 18);
        }
      }
      this.triggerStateUpdate();
    }
  }

  // 파훼 실패 시 3~4개 열을 무작위로 골라 1.2초 예고선을 띄운다.
  private fireMegaLaserTelegraph() {
    const count =
      MEGA_LASER_MIN_COLS + Math.floor(Math.random() * (MEGA_LASER_MAX_COLS - MEGA_LASER_MIN_COLS + 1));
    const cols = new Set<number>();
    while (cols.size < count) cols.add(Math.floor(Math.random() * GRID_COLS));
    this.megaLaserCols = [...cols];
    this.megaLaserFireAt = this.gameTime + MEGA_LASER_TELEGRAPH_SEC;
    this.megaLaserArmed = true;
    this.particleSystem.addFloatingText(960, 500, '파훼 실패! 레이저 경고!', '#FF2244', 20);
    soundManager.playBossWarning();
  }

  // 코어 디펜스: 웨이브 상승 + 운석 생성 + 하강 + 하단 통과(코어 피해).
  private updateDefense(dt: number) {
    this.defenseWave = defenseWaveFor(this.gameTime);
    this.defenseSpawnTimer -= dt;
    if (this.defenseSpawnTimer <= 0) {
      this.defenseSpawnTimer = meteorSpawnIntervalSec(this.defenseWave);
      this.spawnMeteor();
    }
    const stepY = this.renderer.cellH + this.renderer.gap;
    const boardBottom =
      this.renderer.playerOriginY + GRID_ROWS * stepY - this.renderer.gap;
    for (let i = this.defenseMeteors.length - 1; i >= 0; i--) {
      const m = this.defenseMeteors[i];
      m.y += m.speed * dt;
      const meteorBottom = m.y + m.h * stepY - this.renderer.gap;
      if (meteorBottom > boardBottom) {
        // 하단 보드를 통과해 뒤로 빠지면 후방 코어 피해 (남은 HP × 5).
        const remaining = meteorRemainingHp(m);
        this.defenseMeteors.splice(i, 1);
        if (remaining > 0) {
          const dmg = remaining * DEFENSE_CORE_DMG_PER_HP;
          this.damageCore('player', dmg);
          this.stats.damageTaken += dmg;
          this.hitstopTimer = 0.05;
          this.screenShake = 0.3;
          this.particleSystem.addFloatingText(
            this.renderer.playerOriginX + 4 * (this.renderer.cellW + this.renderer.gap) + this.renderer.cellW / 2,
            boardBottom + 30,
            `CORE -${dmg}!`,
            '#FF0055',
            20
          );
          this.triggerStateUpdate();
        }
      }
    }
  }

  private resolveArcadeImpacts() {
    if (this.arcadeMode === 'mega') {
      this.resolveMegaHits();
    } else if (this.arcadeMode === 'rush') {
      this.resolveRushCrossings();
    } else if (this.arcadeMode === 'defense') {
      this.resolveDefenseImpacts();
    }
  }

  // 메가 보스: 내 투사체 셀이 보스 영역(상단 보드 자리)에 닿으면 명중.
  // 배리어 중 20%, 그로기 중 250% 데미지. 지령 조건 충족 명중은 그로기 발동.
  private resolveMegaHits() {
    const cellW = this.renderer.cellW;
    const cellH = this.renderer.cellH;
    const gap = this.renderer.gap;
    const bossBottom = this.renderer.enemyOriginY + GRID_ROWS * (cellH + gap) - gap;
    const bossLeft = this.renderer.enemyOriginX;
    const bossRight = bossLeft + GRID_COLS * (cellW + gap) - gap;

    for (let i = this.projectileMgr.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectileMgr.projectiles[i];
      if (p.owner !== 'player') continue;
      for (const cell of p.cells) {
        if (cell.destroyed) continue;
        const cellCenterX = p.x + cell.relCol * (cellW + gap) + cellW / 2;
        const cellCenterY = p.y + cell.relRow * (cellH + gap) + cellH / 2;
        if (cellCenterY > bossBottom || cellCenterX < bossLeft || cellCenterX > bossRight) continue;

        const broke =
          this.megaBarrier &&
          this.megaOrder !== null &&
          matchesWeakness(this.megaOrder, {
            color: p.color,
            shapeType: p.shapeType,
            cells: p.cells.length,
            frontline: !!p.frontline,
          });
        // Hotfix (2026-11-21): one projectile awards at most +1 combo,
        // however many of its cells connect (the damage multiplier below
        // still uses the current combo — only the increment is gated).
        if (!p.comboAwarded) {
          p.comboAwarded = true;
          this.comboCount++;
          this.comboTimer = 4.0;
          this.comboMax = Math.max(this.comboMax, this.comboCount);
          this.stats.maxCombo = this.comboMax;
          this.comboCutin(this.comboCount, this.player.archetypeId);
        }
        const mult = this.comboMultiplier;
        const dmgMult = this.megaBarrier ? MEGA_BARRIER_MULT : MEGA_GROGGY_MULT;
        const finalDmg = Math.max(1, Math.round(p.damagePerCell * mult * dmgMult));
        this.megaBossHp = Math.max(0, this.megaBossHp - finalDmg);
        this.stats.damageDealt += finalDmg;
        cell.destroyed = true;

        this.hitstopTimer = 0.05;
        this.screenShake = 0.25;
        soundManager.playHit(true, this.comboCount);
        this.particleSystem.emitBlockDestruction(cellCenterX, cellCenterY, p.glowColor, 20);
        this.particleSystem.addFloatingText(
          cellCenterX,
          cellCenterY - 10,
          this.megaBarrier ? `-${finalDmg}` : `-${finalDmg} GROGGY!`,
          this.megaBarrier ? '#94A3B8' : '#FFD166',
          18
        );

        if (broke) {
          this.megaOrderSuccess++;
          this.megaBarrier = false;
          this.megaGroggyUntil = this.gameTime + MEGA_GROGGY_SEC;
          this.megaOrder = null;
          this.particleSystem.addShockwave(960, 232, 200, '#FFD166');
          this.particleSystem.addFloatingText(960, 300, '약점 파훼! 그로기 5초!', '#FFD166', 22);
          soundManager.playStageClear();
        }
        this.triggerStateUpdate();
      }
    }
  }

  // 오더 러시: 내 투사체가 목표 라인(Y ≤ 80)을 통과하면 미션 판정.
  // 달성 시 +3.0초·콤보 +1·점수 100×콤보 배율. 미션 외 발사는 콤보 유지.
  private resolveRushCrossings() {
    const cellW = this.renderer.cellW;
    const cellH = this.renderer.cellH;
    const gap = this.renderer.gap;
    for (const p of this.projectileMgr.projectiles) {
      if (p.owner !== 'player' || this.rushCounted.has(p.id)) continue;
      const crossed = p.cells.some(
        (c) => !c.destroyed && p.y + c.relRow * (cellH + gap) + cellH / 2 <= RUSH_GOAL_Y
      );
      if (!crossed) continue;
      this.rushCounted.add(p.id);
      const mission = this.rushMissions[0];
      if (
        mission &&
        matchesMission(mission, {
          color: p.color,
          shapeType: p.shapeType,
          cells: p.cells.length,
          frontline: !!p.frontline,
        })
      ) {
        this.rushCombo++;
        this.rushComboMax = Math.max(this.rushComboMax, this.rushCombo);
        this.rushOrdersDone++;
        const gain = Math.round(RUSH_BASE_SCORE * comboMultFor(this.rushCombo));
        this.rushScore += gain;
        this.rushTimeLeft += RUSH_BONUS_SEC;
        this.rushMissions.shift();
        this.rushMissions.push(randomRushMission(this.rushOrdersDone));
        this.particleSystem.addFloatingText(
          960,
          500,
          `미션 달성! +${gain}점 · +${RUSH_BONUS_SEC.toFixed(1)}초`,
          '#FFD166',
          20
        );
        soundManager.playStageClear();
        this.triggerStateUpdate();
      }
    }
  }

  // 코어 디펜스: 투사체 셀 ↔ 운석 셀 충돌(상성 2배) + 운석 격파 시
  // 카운터 오버차지 + 운석-캐릭터 접촉 피해.
  private resolveDefenseImpacts() {
    const cellW = this.renderer.cellW;
    const cellH = this.renderer.cellH;
    const gap = this.renderer.gap;
    const kills: { meteor: ArcadeMeteor; killer: ShapeProjectile }[] = [];

    for (const p of this.projectileMgr.projectiles) {
      if (p.owner !== 'player') continue;
      for (const cell of p.cells) {
        if (cell.destroyed) continue;
        const cx = p.x + cell.relCol * (cellW + gap);
        const cy = p.y + cell.relRow * (cellH + gap);
        let consumed = false;
        for (const m of this.defenseMeteors) {
          if (consumed) break;
          for (const mc of m.cells) {
            if (mc.destroyed) continue;
            const mx = m.x + mc.relCol * (cellW + gap);
            const my = m.y + mc.relRow * (cellH + gap);
            const overlapX = Math.max(0, Math.min(cx + cellW, mx + cellW) - Math.max(cx, mx));
            const overlapY = Math.max(0, Math.min(cy + cellH, my + cellH) - Math.max(cy, my));
            if (overlapX <= 8 || overlapY <= 8) continue;
            // 상성(청→적→황→청) 명중 시 데미지 2배.
            const counter = p.color === counterColorOf(m.color);
            mc.hp -= p.damagePerCell * (counter ? 2 : 1);
            cell.destroyed = true;
            consumed = true;
            soundManager.playClash();
            if (mc.hp <= 0) {
              mc.destroyed = true;
              this.particleSystem.emitBlockDestruction(mx + cellW / 2, my + cellH / 2, p.glowColor, 12);
              if (m.cells.every((c) => c.destroyed)) {
                kills.push({ meteor: m, killer: p });
              }
            }
            break;
          }
        }
      }
    }

    // 격파 처리: 카운터 오버차지 (남은 셀 가속 1회 + 디스카드 1스택 즉시 충전).
    for (const { meteor, killer } of kills) {
      const idx = this.defenseMeteors.indexOf(meteor);
      if (idx < 0) continue;
      this.defenseMeteors.splice(idx, 1);
      this.defenseDestroyed++;
      if (!this.defenseOvercharged.has(killer.id)) {
        this.defenseOvercharged.add(killer.id);
        killer.vy *= 1.4;
      }
      if (this.player.discardStacks < 3) {
        this.player.discardStacks = Math.min(3, this.player.discardStacks + 1);
        this.player.discardRecharge = 0;
      }
      this.particleSystem.addShockwave(meteor.x + 60, meteor.y + 30, 90, '#FFFFFF');
      this.particleSystem.addFloatingText(
        meteor.x + 60,
        meteor.y,
        '카운터 오버차지! 디스카드 +1',
        '#00FFAA',
        16
      );
      soundManager.playSkillReady();
      this.triggerStateUpdate();
    }

    // 운석-캐릭터 접촉: 15 피해 (0.15초 연속 명중 보호는 takeDamage가 처리).
    for (const m of this.defenseMeteors) {
      for (const mc of m.cells) {
        if (mc.destroyed) continue;
        const cx = m.x + mc.relCol * (cellW + gap) + cellW / 2;
        const cy = m.y + mc.relRow * (cellH + gap) + cellH / 2;
        const dist = Math.hypot(cx - this.player.x, cy - this.player.y);
        if (dist < this.player.radius + cellW / 2) {
          const before = this.player.hp;
          this.player.takeDamage(METEOR_TOUCH_DMG, true);
          const dealt = Math.max(0, before - this.player.hp);
          if (dealt > 0) {
            this.stats.damageTaken += dealt;
            this.player.knockbackY = 180;
            mc.destroyed = true;
            this.hitstopTimer = 0.05;
            this.screenShake = 0.3;
            this.particleSystem.emitBlockDestruction(cx, cy, '#FF5500', 16);
            this.particleSystem.addFloatingText(this.player.x, this.player.y - 20, `-${dealt} HIT!`, '#FF3366', 18);
            this.player.invincibleTimer = Math.max(this.player.invincibleTimer, 0.15);
            this.triggerStateUpdate();
          }
        }
      }
    }
  }

  // --- ARCADE: 종료 판정 + 기록 ------------------------------------------------

  private checkArcadeEnd() {
    if (this.status !== 'playing') return;
    if (this.arcadeMode === 'mega') {
      if (this.megaBossHp <= 0) {
        this.finishMegaVictory();
      } else if (this.player.hp <= 0) {
        this.finishArcadeDefeat('KO');
      }
    } else if (this.arcadeMode === 'rush') {
      if (this.rushTimeLeft <= 0) {
        this.finishRushEnd();
      }
    } else if (this.arcadeMode === 'defense') {
      if (this.player.hp <= 0) {
        this.finishArcadeDefeat('KO');
      } else if (this.playerCore.hp <= 0) {
        this.finishArcadeDefeat('CORE DESTROYED');
      }
    }
  }

  private finishMegaVictory() {
    const timeSec = this.stats.gameDuration;
    this.arcadeRecords = recordMegaClear(timeSec, this.comboMax);
    const total = this.megaOrderSuccess + this.megaOrderFail;
    const rate = total > 0 ? Math.round((this.megaOrderSuccess / total) * 100) : 100;
    this.arcadeResult = {
      mode: 'mega',
      title: '메가 보스 격파!',
      lines: [
        {
          label: '클리어 타임',
          value: formatArcadeTime(timeSec),
          best:
            this.arcadeRecords.megaBoss.bestTimeSec !== null
              ? `BEST ${formatArcadeTime(this.arcadeRecords.megaBoss.bestTimeSec)}`
              : undefined,
        },
        {
          label: '최대 콤보',
          value: `${this.comboMax}`,
          best: `BEST ${this.arcadeRecords.megaBoss.maxCombo}`,
        },
        { label: '파훼 성공률', value: `${rate}% (${this.megaOrderSuccess}/${total})` },
        { label: '클리어 횟수', value: `${this.arcadeRecords.megaBoss.clearCount}회` },
        { label: '플레이 시간', value: formatArcadeTime(timeSec) },
      ],
    };
    this.beginSlowmo('victory');
    soundManager.playVictory();
    this.triggerStateUpdate();
  }

  private finishRushEnd() {
    this.arcadeRecords = recordRushRun(this.rushScore, this.rushOrdersDone, this.rushComboMax);
    this.arcadeResult = {
      mode: 'rush',
      title: '오더 러시 종료!',
      lines: [
        {
          label: '최종 점수',
          value: `${this.rushScore.toLocaleString()}점`,
          best: `BEST ${this.arcadeRecords.orderRush.bestScore.toLocaleString()}점`,
        },
        {
          label: '미션 달성',
          value: `${this.rushOrdersDone}개`,
          best: `BEST ${this.arcadeRecords.orderRush.maxOrders}개`,
        },
        {
          label: '최대 콤보',
          value: `${this.rushComboMax}`,
          best: `BEST ${this.arcadeRecords.orderRush.maxCombo}`,
        },
        { label: '플레이 시간', value: formatArcadeTime(this.stats.gameDuration) },
      ],
    };
    this.beginSlowmo('victory');
    soundManager.playVictory();
    this.triggerStateUpdate();
  }

  private finishArcadeDefeat(cause: DefeatCause) {
    // 디펜스는 종료 시점에 기록을 저장한다 (메가 패배는 기록 없음).
    if (this.arcadeMode === 'defense') {
      this.arcadeRecords = recordDefenseRun(
        this.defenseWave,
        this.stats.gameDuration,
        this.defenseDestroyed
      );
      this.arcadeResult = {
        mode: 'defense',
        title: '코어 디펜스 종료',
        lines: [
          {
            label: '도달 웨이브',
            value: `WAVE ${this.defenseWave}`,
            best: `BEST WAVE ${this.arcadeRecords.meteorDefense.bestWave}`,
          },
          {
            label: '생존 시간',
            value: formatArcadeTime(this.stats.gameDuration),
            best: `BEST ${formatArcadeTime(this.arcadeRecords.meteorDefense.bestSurviveSec)}`,
          },
          {
            label: '운석 격파',
            value: `${this.defenseDestroyed}개`,
            best: `BEST ${this.arcadeRecords.meteorDefense.maxDestroyed}개`,
          },
        ],
      };
    } else {
      // 메가 보스 패배: 기록 저장 없이 이번 판 결과만 표시.
      const total = this.megaOrderSuccess + this.megaOrderFail;
      const rate = total > 0 ? Math.round((this.megaOrderSuccess / total) * 100) : 0;
      this.arcadeResult = {
        mode: 'mega',
        title: '메가 보스전 패배',
        lines: [
          { label: '보스 남은 HP', value: `${Math.round(this.megaBossHp)} / ${MEGA_BOSS_MAX_HP}` },
          { label: '최대 콤보', value: `${this.comboMax}` },
          { label: '파훼 성공률', value: `${rate}% (${this.megaOrderSuccess}/${total})` },
          { label: '플레이 시간', value: formatArcadeTime(this.stats.gameDuration) },
        ],
      };
    }
    this.beginSlowmo('defeat', cause);
    soundManager.playDefeat();
    this.triggerStateUpdate();
  }

  // Pure physical collision damage: ONLY direct character hits take damage (Back wall damage DELETED)
  private resolveBoardAndCharacterImpacts() {
    const gap = this.renderer.gap;
    const cellW = this.renderer.cellW;
    const cellH = this.renderer.cellH;
    const targetOpponent = this.player2 || this.enemy;

    for (let i = this.projectileMgr.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectileMgr.projectiles[i];

      // 1. My projectile flying towards opponent. (Royale: my projectiles
      // never hit a character/core locally — they warp through the portal,
      // handled in updateRoyalePortal before this runs.)
      if (p.owner === 'player' && this.mode !== 'royale') {
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
            // Consecutive hit combo scaling (v2.2 balance: a sniper 1-2
            // cell snipe does not raise the combo or refresh its timer —
            // the hit still deals damage at the current multiplier).
            // Hotfix (2026-11-21): one projectile awards at most +1
            // combo, however many of its cells connect.
            if (countsForCombo(p.archetypeId, p.cells.length, p.isBeam) && !p.comboAwarded) {
              p.comboAwarded = true;
              this.comboCount++;
              this.comboTimer = 4.0;
              this.comboMax = Math.max(this.comboMax, this.comboCount);
              this.stats.maxCombo = this.comboMax;
              this.comboCutin(this.comboCount, this.player.archetypeId);
            }

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

        // 1b. Rear core hit: a cell that passed through the central 5
        // columns (3-7) and behind the enemy board strikes the core.
        // Combo and frontline bonuses apply; red/yellow status effects do not.
        for (const cell of p.cells) {
          if (cell.destroyed) continue;
          const cellLeft = p.x + cell.relCol * (cellW + gap);
          const cellTop = p.y + cell.relRow * (cellH + gap);
          const cellCenterX = cellLeft + cellW / 2;
          const cellCenterY = cellTop + cellH / 2;
          const col = Math.floor((cellCenterX - this.renderer.enemyOriginX) / (cellW + gap));
          if (cellCenterY < this.renderer.enemyOriginY && col >= 2 && col <= 6) {
            // v2.2 balance: a sniper 1-2 cell snipe does not raise the
            // combo or refresh its timer (damage still applies).
            // Hotfix (2026-11-21): one projectile awards at most +1
            // combo, however many of its cells connect.
            if (countsForCombo(p.archetypeId, p.cells.length, p.isBeam) && !p.comboAwarded) {
              p.comboAwarded = true;
              this.comboCount++;
              this.comboTimer = 4.0;
              this.comboMax = Math.max(this.comboMax, this.comboCount);
              this.stats.maxCombo = this.comboMax;
              this.comboCutin(this.comboCount, this.player.archetypeId);
            }
            const mult = this.comboMultiplier;
            // 90s+ core hits deal double damage.
            const coreMult = this.gameTime >= 90 ? 2 : 1;
            // v2.2: sniper 1-2 cell projectiles deal 50% to the core.
            // Hotfix (2026-11-21): one core hit deals at most 60.
            const finalDmg = Math.min(
              MAX_CORE_HIT_DMG,
              Math.round(
                p.damagePerCell * mult * coreMult * sniperCoreDamageMult(p.archetypeId, p.cells.length)
              )
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
              const meteorDmg = Math.min(MAX_CORE_HIT_DMG, Math.round(15 * mult));
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
            // Second-side combo (local/online 2P and royale incoming
            // only). In local 2P the damage scales with it; online, the
            // attacker's own client is the damage authority for its combo,
            // so this side keeps the unscaled value and the 'hit' packet
            // syncs HP. In royale the damage is already final in the
            // packet, and my HP is reported via royale_status.
            let dmg = p.damagePerCell;
            if (this.mode === 'multi' || this.mode === 'royale') {
              // v2.2 balance: a sniper 1-2 cell snipe does not raise the
              // combo or refresh its timer (damage still scales with the
              // current streak).
              // Hotfix (2026-11-21): one projectile awards at most +1
              // combo, however many of its cells connect.
              if (countsForCombo(p.archetypeId, p.cells.length, p.isBeam) && !p.comboAwarded) {
                p.comboAwarded = true;
                this.combo2Count++;
                this.combo2Timer = 4.0;
                this.combo2Max = Math.max(this.combo2Max, this.combo2Count);
                if (this.combo2Count === 7 && this.player2) this.showCutin(this.player2.archetypeId, 'COMBO x7', 1200);
              }
              if (!this.isOnline) {
                dmg = Math.round(p.damagePerCell * this.combo2Multiplier);
              }
            }
            // v2.2 anti-instant-kill: one direct hit deals at most 35.
            dmg = Math.min(MAX_SINGLE_HIT_DMG, dmg);
            if (p.fromPlayerId) this.lastHitBy = p.fromPlayerId;
            this.player.takeDamage(dmg, true);
            this.stats.damageTaken += dmg;
            this.player.knockbackY = 180;
            cell.destroyed = true;

            this.hitstopTimer = 0.05;
            this.screenShake = 0.3;
            this.particleSystem.emitBlockDestruction(cellCenterX, cellCenterY, p.glowColor, 20);
            this.particleSystem.addFloatingText(this.player.x, this.player.y - 20, `-${dmg} HIT!`, '#FF3366', 18);

            if (this.isOnline && this.mode !== 'royale') {
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

        // 2b. Rear core hit on my core (central 5 columns, behind my board).
        for (const cell of p.cells) {
          if (cell.destroyed) continue;
          const cellLeft = p.x + cell.relCol * (cellW + gap);
          const cellTop = p.y + cell.relRow * (cellH + gap);
          const cellCenterX = cellLeft + cellW / 2;
          const cellCenterY = cellTop + cellH / 2;
          const col = Math.floor((cellCenterX - this.renderer.playerOriginX) / (cellW + gap));
          const boardBottom = this.renderer.playerOriginY + GRID_ROWS * (cellH + gap) - gap;
          if (cellCenterY > boardBottom && col >= 2 && col <= 6) {
            let dmg = p.damagePerCell;
            if (this.mode === 'multi' || this.mode === 'royale') {
              // v2.2 balance: a sniper 1-2 cell snipe does not raise the
              // combo or refresh its timer (damage still scales with the
              // current streak).
              // Hotfix (2026-11-21): one projectile awards at most +1
              // combo, however many of its cells connect.
              if (countsForCombo(p.archetypeId, p.cells.length, p.isBeam) && !p.comboAwarded) {
                p.comboAwarded = true;
                this.combo2Count++;
                this.combo2Timer = 4.0;
                this.combo2Max = Math.max(this.combo2Max, this.combo2Count);
                if (this.combo2Count === 7 && this.player2) this.showCutin(this.player2.archetypeId, 'COMBO x7', 1200);
              }
              if (!this.isOnline) {
                dmg = Math.round(p.damagePerCell * this.combo2Multiplier);
              }
            }
            const coreMult = this.gameTime >= 90 ? 2 : 1;
            // v2.2: sniper 1-2 cell projectiles deal 50% to the core.
            // Hotfix (2026-11-21): one core hit deals at most 60.
            const finalDmg = Math.min(
              MAX_CORE_HIT_DMG,
              Math.round(dmg * coreMult * sniperCoreDamageMult(p.archetypeId, p.cells.length))
            );
            if (p.fromPlayerId) this.lastHitBy = p.fromPlayerId;
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
            // (Royale reports HP via royale_status instead.)
            if (this.isOnline && this.mode !== 'royale') {
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
    this.resetRoyaleState();
    this.arcadeMode = null;
    this.arcadeResult = null;
    this.defenseMeteors = [];
    this.megaLaserCols = [];
    this.megaLaserArmed = false;
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
      // Mark the pause start so the dwell can be excluded from BATTLE
      // TIME on resume (update() does not run while paused, so the wall
      // clock would otherwise count the whole pause as battle time).
      this.pausedAt = performance.now();
    } else if (this.status === 'paused') {
      this.status = 'playing';
      if (this.pausedAt > 0) {
        this.pauseAccum += performance.now() - this.pausedAt;
        this.pausedAt = 0;
      }
    }
    this.triggerStateUpdate();
  }

  public restartCurrentBattle(broadcastRematch: boolean = true) {
    if (this.mode === 'royale') {
      // No rematch in royale: back to the title (a new room starts a new
      // game). The GameOverModal's restart button lands here.
      this.returnToTitle();
      return;
    }
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
    } else if (this.mode === 'arcade') {
      this.startArcade(this.arcadeMode ?? 'mega');
    }
  }

  private render() {
    if (!this.ctx) return;
    const now = performance.now();
    const cutin = this.cutin && now < this.cutin.until ? this.cutin : null;
    // 아케이드 렌더 상태 (한 덩어리로 전달; null이면 기존 모드와 동일).
    const arcadeRender: ArcadeRenderState | null = this.isArcade
      ? {
          mode: this.arcadeMode ?? 'mega',
          bossHp: this.megaBossHp,
          bossMaxHp: MEGA_BOSS_MAX_HP,
          barrier: this.megaBarrier,
          groggyUntil: this.megaGroggyUntil,
          order: this.megaOrder,
          orderDeadline: this.megaOrderDeadline,
          laserCols: this.megaLaserArmed ? this.megaLaserCols : [],
          meteors: this.defenseMeteors,
        }
      : null;
    this.renderer.render(
      this.ctx,
      this.playerBoard,
      this.enemyBoard,
      this.player,
      this.enemy,
      this.player2,
      this.projectileMgr,
      this.particleSystem,
      // v2.2 Phase 2: the pause-menu shake toggle gates the shake here so
      // every shake source respects it at once.
      this.shakeEnabled ? this.screenShake : 0,
      this.gameTime,
      this.playerCore,
      this.enemyCore,
      this.shrinkRect,
      this.shrinkRect2,
      this.shrinkPhase,
      this.mode === 'royale',
      this.royaleWarnings,
      cutin,
      arcadeRender
    );

    // v2.2 Phase 2: start-countdown overlay (3-2-1-FIGHT) above the canvas.
    if (this.isCountingDown()) {
      const elapsed = now - (this.countdownEndAt - COUNTDOWN_MS);
      const label = countdownLabel(elapsed);
      const ctx = this.ctx;
      ctx.save();
      ctx.font = '900 120px "Chakra Petch", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(3, 6, 12, 0.9)';
      ctx.lineWidth = 10;
      ctx.strokeText(label, 960, 540);
      ctx.fillStyle = label === 'FIGHT!' ? '#FFD166' : '#FFFFFF';
      ctx.fillText(label, 960, 540);
      ctx.restore();
      return;
    }

    // v2.2 Phase 2: FTUE ghost hints — stage 1, first 5 seconds only,
    // translucent pills over the player board, fading out at the end.
    if (this.status === 'playing' && this.mode === 'single' && this.currentStage === 1 && this.gameTime < 5) {
      const alpha = Math.max(0, Math.min(0.85, ((5 - this.gameTime) / 1.5) * 0.85));
      if (alpha > 0.01) {
        const ctx = this.ctx;
        const ox = this.renderer.playerOriginX;
        const oy = this.renderer.playerOriginY;
        const totalW = GRID_COLS * (this.renderer.cellW + this.renderer.gap) - this.renderer.gap;
        const totalH = GRID_ROWS * (this.renderer.cellH + this.renderer.gap) - this.renderer.gap;
        const hints: [string, number][] = [
          ['WASD 이동', ox + totalW * 0.18],
          ['SPACE 발사', ox + totalW * 0.5],
          ['X 디스카드', ox + totalW * 0.82],
        ];
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '700 20px "Chakra Petch", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const [text, cx] of hints) {
          const w = ctx.measureText(text).width + 32;
          const cy = oy + totalH / 2;
          const rx = cx - w / 2;
          const ry = cy - 20;
          const r = 20;
          ctx.beginPath();
          ctx.moveTo(rx + r, ry);
          ctx.arcTo(rx + w, ry, rx + w, ry + 40, r);
          ctx.arcTo(rx + w, ry + 40, rx, ry + 40, r);
          ctx.arcTo(rx, ry + 40, rx, ry, r);
          ctx.arcTo(rx, ry, rx + w, ry, r);
          ctx.closePath();
          ctx.fillStyle = 'rgba(3, 6, 12, 0.72)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 255, 170, 0.55)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(text, cx, cy + 1);
        }
        ctx.restore();
      }
    }
  }

  private triggerStateUpdate() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback();
    }
  }
}
