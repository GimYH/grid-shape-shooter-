import { GridBoard, BoardSnapshot, GRID_COLS, GRID_ROWS } from './GridEngine';
import { PlayerCharacter } from './CharacterController';
import { AIController } from './AIController';
import { ProjectileManager } from './ProjectileManager';
import { ParticleSystem } from './ParticleSystem';
import { CanvasRenderer } from './Renderer';
import { soundManager } from '../audio/soundManager';
import { ArchetypeId, Cluster, GameMode, GameStats, SkillEffect } from '../types/game';
import { ARCHETYPES } from './archetypes';
import { STAGES } from './stages';
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

  public get comboMultiplier(): number {
    if (this.comboCount <= 1) return 1.0;
    return Math.min(3.0, 1.0 + (this.comboCount - 1) * 0.2);
  }

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
      this.currentStage = 5;
    } else if (mode === 'multi') {
      this.currentStage = 1;
    } else {
      this.currentStage = stage;
    }

    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboMax = 0;

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
      if (this.currentStage === 5) {
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
          !!d.overdrive
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
        this.enemyBoard.discardTile(d.col, GRID_ROWS - 1 - d.row, 0.7);
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
    this.currentStage = Math.min(5, this.currentStage + 1);
    this.status = 'playing';
    this.comboCount = 0;
    this.comboTimer = 0;

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

    if (this.currentStage === 5) {
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
      actor.overdriveActive
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

  // Player Discard (Fast 0.7s tile flush)
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
    this.projectileMgr.createProjectile(
      'enemy',
      cluster,
      this.renderer.enemyOriginX,
      this.renderer.enemyOriginY,
      this.renderer.cellW,
      this.renderer.cellH,
      this.renderer.gap,
      'standard',
      this.enemy.isBossOverdrive
    );
    this.enemyBoard.launchCluster(cluster);
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

    // Grid cooldown recovery
    const playerCDMult = this.player.archetypeId === 'speedster' ? 1.5 : 1.0;
    const isSniper = this.player.archetypeId === 'sniper';
    this.playerBoard.update(dt, playerCDMult, isSniper);

    const enemyCDMult = this.player2?.archetypeId === 'speedster' ? 1.5 : 1.0;
    const isEnemySniper = this.player2?.archetypeId === 'sniper';
    this.enemyBoard.update(dt, enemyCDMult, isEnemySniper);

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
          }
        );
      }
    }

    // Projectiles & Particles update
    const target2X = this.player2 ? this.player2.x : this.enemy.x;
    this.projectileMgr.update(dt, this.particleSystem, this.player.x, target2X);
    this.particleSystem.update(dt);

    // Combo streak decay timer (3.5s timeout)
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

    // Check Projectile Impacts
    this.resolveBoardAndCharacterImpacts();

    // Check Win / Loss condition
    if (this.mode === 'multi' && this.player2) {
      if (this.player2.hp <= 0 && this.status === 'playing') {
        this.status = 'victory'; // I Won!
        soundManager.playVictory();
        this.triggerStateUpdate();
      } else if (this.player.hp <= 0 && this.status === 'playing') {
        this.status = 'defeat'; // I Lost!
        soundManager.playDefeat();
        this.triggerStateUpdate();
      }
    } else {
      // Single Mode or Boss Mode
      if (this.enemy.hp <= 0 && this.status === 'playing') {
        if (this.mode === 'single' && this.currentStage < 5) {
          this.status = 'stage_clear';
          soundManager.playStageClear();
        } else {
          this.status = 'victory';
          soundManager.playVictory();
        }
        this.triggerStateUpdate();
      } else if (this.player.hp <= 0 && this.status === 'playing') {
        this.status = 'defeat';
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
            // Consecutive hit combo scaling
            this.comboCount++;
            this.comboTimer = 3.5;
            this.comboMax = Math.max(this.comboMax, this.comboCount);
            this.stats.maxCombo = this.comboMax;

            const mult = this.comboMultiplier;
            const finalDmg = Math.round(p.damagePerCell * mult);
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
                opTile.cooldownRemaining = 2.0;
              }
            }
            if (p.shapeType === 'meteor' && !p.isMeteorExploding) {
              p.isMeteorExploding = true;
              const meteorDmg = Math.round(15 * mult);
              targetOpponent.takeDamage(meteorDmg, true);
              this.stats.damageDealt += meteorDmg;
              this.particleSystem.addShockwave(cellCenterX, cellCenterY, 160, '#FF5500');
              this.particleSystem.addFloatingText(targetOpponent.x, targetOpponent.y - 50, `METEOR -${meteorDmg} AOE!`, '#FF5500', 20);
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
            const dmg = p.damagePerCell;
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
                pTile.cooldownRemaining = 2.0;
              }
            }
            if (p.color === 'yellow') {
              this.player.slowTimer = 2.0;
              this.playerBoard.contaminateAt(this.player.currentCol, this.player.currentRow);
            }
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
    this.playerBoard.reset();
    this.enemyBoard.reset();
    this.projectileMgr.clear();
    this.particleSystem.clear();
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
      this.startGame('boss', 5, this.player.archetypeId);
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
      this.gameTime
    );
  }

  private triggerStateUpdate() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback();
    }
  }
}
