import React from 'react';
import { GameEngine } from '../game/GameEngine';
import { ARCHETYPE_LIST, ARCHETYPES } from '../game/archetypes';
import { ArchetypeId, CoreState } from '../types/game';
import { STAGES } from '../game/stages';
import { soundManager } from '../audio/soundManager';
import { ARCHETYPE_PORTRAITS } from '../assets/portraits';
import { networkManager } from '../game/NetworkManager';
import {
  Shield,
  Zap,
  Volume2,
  VolumeX,
  Code2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Flame,
  Target,
  Layers,
  Trash2,
  Swords,
  Crown,
  Home,
  Share2,
  Check,
} from 'lucide-react';

interface GameHUDProps {
  engine: GameEngine;
  onOpenGodotModal: () => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

// v2.2: 1920x1080 three-column cockpit HUD. Left 420px = P1 cockpit,
// right 420px = opponent panel (or the mirrored P2 cockpit in local 2P),
// center top = 56px slim bar with the shrink countdown.
export const GameHUD: React.FC<GameHUDProps> = ({
  engine,
  onOpenGodotModal,
  onTogglePause,
  onRestart,
  onReturnToTitle,
}) => {
  const player = engine.player;
  const player2 = engine.player2;
  const enemy = engine.enemy;
  const isMulti = engine.mode === 'multi';
  const isLocal2P = isMulti && !engine.isOnline;
  const stageInfo = STAGES[Math.min(engine.currentStage - 1, STAGES.length - 1)];

  const currentArchetype = ARCHETYPES[player.archetypeId];
  // Opponent face: P2's archetype in local versus, the remote player's
  // archetype online, sniper art as the generic face for the stage AI/boss.
  const opponentArchetypeId =
    isMulti && player2 ? player2.archetypeId : engine.isOnline ? networkManager.opponentArchetype : null;
  const opponentPortrait = opponentArchetypeId ? ARCHETYPE_PORTRAITS[opponentArchetypeId] : ARCHETYPE_PORTRAITS.sniper;
  const p2Archetype = player2 ? ARCHETYPES[player2.archetypeId] : null;

  const [muted, setMuted] = React.useState(soundManager.isMuted());
  const [copied, setCopied] = React.useState(false);

  // 500ms re-render tick: the shrink countdown and cooldown bars need to
  // move even when no action fires a state update.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(id);
  }, []);

  // v2.2 Phase 2: rejection flash — the icon of a skill/dash/discard
  // pressed on cooldown (or with an empty magazine) flashes red for 0.3s.
  const rejectFlash = (kind: 'skill' | 'dash' | 'discard', playerNum: 1 | 2) =>
    !!engine.rejectFlash &&
    engine.rejectFlash.kind === kind &&
    engine.rejectFlash.playerNum === playerNum &&
    performance.now() < engine.rejectFlash.until;

  // Cluster currently under player
  const currentCluster = engine.playerBoard.getClusterAt(player.currentCol, player.currentRow);
  const currentCluster2 = isLocal2P && player2 ? engine.enemyBoard.getClusterAt(player2.currentCol, player2.currentRow) : null;

  const handleMuteToggle = () => {
    const isMuted = soundManager.toggleMute();
    setMuted(isMuted);
  };

  const copyInviteLink = () => {
    if (!engine.onlineRoomCode) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${engine.onlineRoomCode}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSelectArchetype = (id: ArchetypeId) => {
    player.setArchetype(id);
  };

  // P1 Skill cooldown calculation
  const maxCD = currentArchetype.skillCooldown;
  const curCD = player.skillCooldownRemaining;
  const skillReady = curCD <= 0;
  const cdPercent = skillReady ? 100 : Math.round(((maxCD - curCD) / maxCD) * 100);

  // P2 Skill cooldown calculation (if multi mode)
  const p2MaxCD = p2Archetype?.skillCooldown || 5;
  const p2CurCD = player2?.skillCooldownRemaining || 0;
  const p2SkillReady = p2CurCD <= 0;
  const p2CdPercent = p2SkillReady ? 100 : Math.round(((p2MaxCD - p2CurCD) / p2MaxCD) * 100);

  // Shrink countdown label for the slim top bar.
  const t = engine.gameTime;
  const shrinkLabel =
    engine.shrinkPhase === 'idle'
      ? `수축 ${Math.max(0, Math.ceil(90 - t))}초 후`
      : engine.shrinkPhase === 'warning'
      ? `수축 존 시작 ${Math.max(0, Math.ceil(90 - t))}초 전! (중앙으로 모여라)`
      : engine.shrinkPhase === 'shrinking'
      ? `수축 진행 중 ${Math.floor(t - 90)}초`
      : '수축 완료';

  const hpBar = (hp: number, maxHp: number, shield: number, tone: 'cyan' | 'red') => (
    <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700/60 relative mt-1">
      <div
        className={`h-full rounded-full transition-all duration-150 ${
          tone === 'cyan'
            ? 'bg-gradient-to-r from-emerald-500 via-cyan-400 to-cyan-300'
            : 'bg-gradient-to-r from-red-600 via-rose-500 to-amber-500'
        }`}
        style={{ width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` }}
      />
      {shield > 0 && (
        <div
          className="absolute top-0.5 left-0.5 h-full bg-cyan-200/80 rounded-full border-r border-white animate-pulse"
          style={{ width: `${Math.min(100, shield)}%` }}
        />
      )}
    </div>
  );

  const coreBar = (core: CoreState) => (
    <div className="mt-1.5">
      <div className="flex justify-between items-center text-[10px]">
        <span className="font-bold text-rose-300 tracking-wider flex items-center gap-1">
          <Shield className="w-3 h-3" />
          CORE
        </span>
        <span className="font-mono text-slate-300 tabular-nums">
          {Math.round(core.hp)}/{core.maxHp}
        </span>
      </div>
      <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-rose-900/60 mt-0.5">
        <div
          className={`h-full rounded-full transition-all duration-150 ${
            core.crack >= 2 ? 'bg-red-500 animate-pulse' : 'bg-gradient-to-r from-rose-600 to-rose-400'
          }`}
          style={{ width: `${Math.max(0, (core.hp / core.maxHp) * 100)}%` }}
        />
      </div>
    </div>
  );

  const discardCard = (stacks: number, recharge: number, keys: string, playerNum: 1 | 2 = 1) => (
    <div
      className={`mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between bg-cyan-950/20 px-2 py-1 rounded-full border ${
        rejectFlash('discard', playerNum)
          ? 'reject-shake ring-2 ring-red-500 bg-red-950/50 border-red-500'
          : 'border-cyan-800/40'
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-cyan-300 font-bold">
        <Trash2 className="w-3 h-3 text-cyan-400" />
        <span>[{keys}] 타일 버리기</span>
      </div>
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`w-2.5 h-2.5 rounded-full border ${
              i < stacks ? 'bg-cyan-400 border-cyan-300' : 'bg-slate-800 border-slate-600'
            }`}
          />
        ))}
        <span className="text-[9px] font-mono text-cyan-400 bg-cyan-900/60 px-1 py-0.5 rounded ml-1">
          {stacks}/3 · 1.2s/스택
        </span>
      </div>
    </div>
  );

  const skillCard = (
    name: string,
    keys: string,
    cur: number,
    max: number,
    ready: boolean,
    percent: number,
    flash: boolean = false
  ) => (
    <div
      className={`mt-2 pt-2 border-t border-slate-800/80 rounded-xl px-1 ${
        flash ? 'reject-shake ring-2 ring-red-500 bg-red-950/50' : ''
      }`}
    >
      <div className="flex justify-between items-center text-xs mb-1">
        <span className="font-bold flex items-center gap-1.5 text-slate-200 text-[11px]">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className="break-keep">[{keys}] {name}</span>
        </span>
        <span
          className={`font-bold font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0 ml-2 ${
            ready ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40 animate-pulse' : 'text-amber-400'
          }`}
        >
          {ready ? `READY [${keys}]` : `${cur.toFixed(1)}s`}
        </span>
      </div>
      <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700/50">
        <div
          className={`h-full transition-all duration-100 ${
            ready ? 'bg-emerald-400 shadow-md shadow-emerald-400/50' : 'bg-amber-400'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );

  const dashCard = (char: typeof player, keys: string, playerNum: 1 | 2 = 1) => (
    <div
      className={`mt-2 pt-2 border-t border-slate-800/80 rounded-xl px-1 ${
        rejectFlash('dash', playerNum) ? 'reject-shake ring-2 ring-red-500 bg-red-950/50' : ''
      }`}
    >
      <div className="flex justify-between items-center text-xs mb-1">
        <span className="font-bold flex items-center gap-1.5 text-slate-200 text-[11px]">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>[{keys}] DASH (회피)</span>
        </span>
        <span
          className={`font-bold font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0 ml-2 ${
            char.dashCooldownRemaining <= 0
              ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/40 animate-pulse'
              : 'text-slate-400'
          }`}
        >
          {char.dashCooldownRemaining <= 0 ? `READY [${keys}]` : `${char.dashCooldownRemaining.toFixed(1)}s`}
        </span>
      </div>
      <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700/50">
        <div
          className={`h-full transition-all duration-100 ${
            char.dashCooldownRemaining <= 0 ? 'bg-cyan-400 shadow-md shadow-cyan-400/50' : 'bg-cyan-600/70'
          }`}
          style={{
            width: `${
              char.dashCooldownRemaining <= 0
                ? 100
                : Math.round(((char.dashCooldownMax - char.dashCooldownRemaining) / char.dashCooldownMax) * 100)
            }%`,
          }}
        />
      </div>
    </div>
  );

  const clusterPreview = (cluster: typeof currentCluster, col: number, row: number) => (
    <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-3 shadow-lg backdrop-blur-md my-2">
      <div className="text-xs font-bold text-slate-300 mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-cyan-400" />
          FOOTPAD CLUSTER PREVIEW
        </span>
        <span className="text-[10px] text-slate-500 font-mono">
          [{col}, {row}]
        </span>
      </div>
      {cluster ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Size &amp; Status:</span>
            <span
              className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                cluster.isActivePad
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/50'
                  : 'bg-slate-900 text-slate-400'
              }`}
            >
              {cluster.tiles.length} TILES · {cluster.isActivePad ? 'PRIMED (LAUNCHABLE)' : 'IDLE (< 3)'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Shape Bonus:</span>
            <span className="font-bold text-cyan-300 text-[11px]">{cluster.shapeTitle}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Color Trait:</span>
            <span
              className="font-bold text-[11px] uppercase"
              style={{ color: cluster.color === 'red' ? '#FF3366' : cluster.color === 'blue' ? '#33CCFF' : '#FFCC00' }}
            >
              {cluster.color === 'red' ? 'Fast + Red Contamination' : cluster.color === 'blue' ? 'High Durability Barrier' : 'Slow Opponent + Mutation'}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-center py-2 text-xs text-slate-500">
          Standing on Empty Cooldown Floor (Movement -30%)
        </div>
      )}
    </div>
  );

  const comboBlock = (count: number, timer: number, mult: number, label: string) =>
    count > 0 ? (
      <div className="crack-bg bg-slate-950/85 border border-amber-500/50 rounded-3xl p-3 shadow-lg backdrop-blur-md my-2">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="text-xs font-black tracking-widest text-white">
            {label} COMBO <span className="text-amber-400 font-mono text-sm">{count}</span>
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-xs font-black text-emerald-400 font-mono">x{mult.toFixed(1)} DMG</span>
        </div>
        <div className="w-full h-1 bg-slate-900 rounded-full mt-2 overflow-hidden border border-amber-500/30">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-75"
            style={{ width: `${Math.min(100, (timer / 4.0) * 100)}%` }}
          />
        </div>
      </div>
    ) : (
      <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-3 shadow-lg backdrop-blur-md my-2 text-center text-xs text-slate-500">
        {label} 콤보 없음 — 적중 시 콤보가 쌓입니다 (4.0초 유지)
      </div>
    );

  return (
    <div className="absolute inset-0 pointer-events-none z-10 font-['Chakra_Petch']">
      {/* Center top slim bar (56px): utilities + shrink countdown + stage/room */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-14 flex items-center gap-2.5 bg-slate-950/90 backdrop-blur-md border border-cyan-500/50 border-t-0 px-4 rounded-b-2xl shadow-2xl shadow-cyan-950/70 pointer-events-auto">
        <button
          onClick={onReturnToTitle}
          title="타이틀 화면으로 나가기"
          className="flex items-center gap-1.5 text-xs font-bold bg-rose-950/70 hover:bg-rose-900/90 text-rose-300 border border-rose-500/50 px-2.5 py-1 rounded-full transition-all cursor-pointer"
        >
          <Home className="w-3.5 h-3.5" />
          <span>홈으로</span>
        </button>

        <div className="h-4 w-px bg-slate-700" />

        <div className="flex items-center gap-2">
          {enemy.isBoss && !isMulti ? (
            <span className="flex items-center gap-1.5 text-xs font-black tracking-wider text-rose-400 uppercase animate-pulse whitespace-nowrap">
              <Crown className="w-4 h-4 text-amber-400" />
              FINAL BOSS: OMNI-OVERLORD [HP {enemy.maxHp}]
            </span>
          ) : enemy.isSectorBoss && !isMulti ? (
            <span className="flex items-center gap-1.5 text-xs font-black tracking-wider text-purple-300 uppercase whitespace-nowrap">
              <Crown className="w-4 h-4 text-purple-300" />
              섹터 보스: {stageInfo?.nameKo || `STAGE ${engine.currentStage}`}
            </span>
          ) : isMulti ? (
            <span className="flex items-center gap-1.5 text-xs font-black tracking-wider text-amber-300 uppercase whitespace-nowrap">
              <Swords className="w-4 h-4 text-amber-400" />
              {engine.isOnline ? 'ONLINE 1v1 DUEL' : 'LOCAL 2P DUEL'}
            </span>
          ) : (
            <span className="text-xs font-bold tracking-widest text-cyan-400 uppercase flex items-center gap-1.5 whitespace-nowrap">
              <Sparkles className="w-3.5 h-3.5 text-cyan-300 animate-pulse" />
              {stageInfo?.nameKo || `STAGE ${engine.currentStage}/30`}
            </span>
          )}
        </div>

        <div className="h-4 w-px bg-slate-700" />

        {/* 90s shrink countdown */}
        <span
          className={`text-xs font-black tabular-nums whitespace-nowrap px-2 py-0.5 rounded-full border ${
            engine.shrinkPhase === 'warning'
              ? 'text-red-300 bg-red-950/70 border-red-500/60 animate-pulse'
              : engine.shrinkPhase === 'shrinking' || engine.shrinkPhase === 'closed'
              ? 'text-red-300 bg-red-950/50 border-red-500/40'
              : 'text-slate-300 bg-slate-900/70 border-slate-700'
          }`}
        >
          {shrinkLabel}
        </span>

        {engine.isOnline && engine.onlineRoomCode && (
          <>
            <div className="h-4 w-px bg-slate-700" />
            <div className="flex items-center gap-1.5 bg-cyan-950/80 px-2 py-0.5 rounded-full border border-cyan-500/40 text-xs">
              <span className="text-slate-400">ROOM:</span>
              <span className="font-mono font-bold text-amber-300">{engine.onlineRoomCode}</span>
              <button
                onClick={copyInviteLink}
                title="1:1 초대 링크 복사"
                className="ml-1 text-[10px] font-bold text-cyan-300 hover:text-white flex items-center gap-1 bg-cyan-800/40 hover:bg-cyan-700/60 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Share2 className="w-3 h-3" />}
                <span>{copied ? '복사됨!' : '초대'}</span>
              </button>
            </div>
          </>
        )}

        {engine.isOnline && networkManager.pingMs != null && (
          <>
            <div className="h-4 w-px bg-slate-700" />
            <span className="text-[11px] font-mono font-bold text-emerald-300 whitespace-nowrap tabular-nums">
              핑 {networkManager.pingMs}ms
            </span>
          </>
        )}

        <div className="h-4 w-px bg-slate-700" />

        <button
          onClick={handleMuteToggle}
          title={muted ? '소리 켜기' : '소리 끄기'}
          className="p-1 hover:text-cyan-400 text-slate-300 transition-colors cursor-pointer"
        >
          {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
        {!engine.isOnline && (
          <button
            onClick={onTogglePause}
            title={engine.status === 'paused' ? '재개' : '일시정지 (ESC)'}
            className="p-1 hover:text-cyan-400 text-slate-300 transition-colors cursor-pointer"
          >
            {engine.status === 'paused' ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4" />}
          </button>
        )}
        <button
          onClick={onRestart}
          title="재시작 / 재도전"
          className="p-1 hover:text-cyan-400 text-slate-300 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-slate-700" />
        <button
          onClick={onOpenGodotModal}
          className="flex items-center gap-1.5 text-xs font-semibold bg-cyan-600/30 hover:bg-cyan-500/40 text-cyan-300 border border-cyan-400/50 px-2 py-0.5 rounded-full transition-all hover:scale-105 cursor-pointer"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Spec</span>
        </button>
      </div>

      {/* LEFT: P1 cockpit (420px) */}
      <div className="absolute left-4 top-[72px] bottom-4 w-[420px] flex flex-col pointer-events-auto select-none">
        <div className="crack-bg bg-slate-950/90 border border-cyan-500/50 rounded-3xl p-3 shadow-xl shadow-cyan-950/50 backdrop-blur-md">
          <div className="flex items-center gap-3 mb-2">
            <img
              src={ARCHETYPE_PORTRAITS[player.archetypeId]}
              alt="Operator Portrait"
              className="w-[88px] h-[88px] rounded-2xl object-cover border border-cyan-400/60 shadow-md shadow-cyan-950/60 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span className="text-[11px] font-black text-cyan-300 tracking-wider">
                    {isMulti ? (engine.onlineRole === 'p2' ? 'YOU (P2/GUEST)' : 'YOU (P1/HOST)') : 'PLAYER OPERATOR'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-base font-bold tabular-nums text-white">{Math.round(player.hp)}</span>
                  <span className="text-[10px] text-slate-400">/100</span>
                </div>
              </div>
              {hpBar(player.hp, 100, player.shield, 'cyan')}
              {coreBar(engine.playerCore)}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-300 font-semibold uppercase">CLASS ARCHETYPE</span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase"
                style={{ backgroundColor: `${currentArchetype.color}25`, color: currentArchetype.color }}
              >
                {currentArchetype.nameKo} · {currentArchetype.name}
              </span>
            </div>
            <p className="text-[10px] text-slate-300 mt-1 leading-snug break-keep">
              <span className="text-cyan-400 font-bold">PASSIVE:</span>{' '}
              {currentArchetype.passiveDesc}
            </p>
          </div>

          {skillCard(currentArchetype.skillName, 'Q/K', curCD, maxCD, skillReady, cdPercent, rejectFlash('skill', 1))}
          {dashCard(player, 'Shift/C', 1)}
          {discardCard(player.discardStacks, player.discardRecharge, 'X/E/L', 1)}
        </div>

        {clusterPreview(currentCluster, player.currentCol, player.currentRow)}

        {!isMulti && (
          <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-2.5 backdrop-blur-md">
            <div className="text-[11px] font-bold text-slate-300 mb-2 flex items-center justify-between">
              <span>SWITCH ARCHETYPE [1~7]</span>
              <span className="text-[10px] text-cyan-400">7 Classes</span>
            </div>
            <div className="grid grid-cols-1 gap-1">
              {ARCHETYPE_LIST.map((arch, idx) => {
                const isSelected = player.archetypeId === arch.id;
                return (
                  <button
                    key={arch.id}
                    onClick={() => handleSelectArchetype(arch.id)}
                    className={`flex items-center justify-between px-2 py-1 rounded text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-950/80 border border-cyan-400/80 text-white shadow-sm shadow-cyan-500/40'
                        : 'bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center font-mono"
                        style={{ backgroundColor: `${arch.color}30`, color: arch.color }}
                      >
                        {idx + 1}
                      </span>
                      <span className="text-xs font-semibold">{arch.nameKo}</span>
                      <span className="text-[10px] text-slate-400">({arch.name})</span>
                    </div>
                    <span
                      className="text-[9px] font-bold tracking-wider px-1 py-0.5 rounded"
                      style={{ backgroundColor: `${arch.color}25`, color: arch.color }}
                    >
                      {arch.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-2.5 text-[10px] text-slate-300 backdrop-blur-md mt-auto break-keep">
          <div className="font-bold text-[11px] text-slate-300 mb-1 flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-cyan-400" />
            조작 가이드
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {isLocal2P ? (
              <>
                <div><span className="text-cyan-300 font-mono font-bold">[WASD]</span> P1 이동</div>
                <div><span className="text-white font-mono font-bold">[Space]</span> P1 공격</div>
                <div><span className="text-emerald-300 font-mono font-bold">[Shift좌]</span> P1 대시</div>
                <div><span className="text-amber-300 font-mono font-bold">[Ctrl좌]</span> P1 스킬</div>
              </>
            ) : (
              <>
                <div><span className="text-cyan-300 font-mono font-bold">[방향키/WASD]</span> 이동</div>
                <div><span className="text-white font-mono font-bold">[Space]</span> 공격</div>
                <div><span className="text-emerald-300 font-mono font-bold">[Shift]</span> 대시(회피)</div>
                <div><span className="text-amber-300 font-mono font-bold">[Ctrl]</span> 스킬</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: opponent panel (420px) — mirrored P2 cockpit in local 2P */}
      <div className="absolute right-4 top-[72px] bottom-4 w-[420px] flex flex-col pointer-events-auto select-none">
        {isLocal2P && player2 ? (
          <>
            <div
              className="crack-bg bg-slate-950/90 border border-red-500/50 rounded-3xl p-3 shadow-xl shadow-red-950/50 backdrop-blur-md"
            >
              <div className="flex items-center gap-3 mb-2">
                <img
                  src={ARCHETYPE_PORTRAITS[player2.archetypeId]}
                  alt="P2 Portrait"
                  className="w-[88px] h-[88px] rounded-2xl object-cover border border-rose-500/60 shadow-md shadow-rose-950/60 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                      <span className="text-[11px] font-black text-red-400 tracking-wider">PLAYER 2 (TOP)</span>
                    </div>
                    <div className="text-right">
                      <span className="text-base font-bold tabular-nums text-white">{Math.round(player2.hp)}</span>
                      <span className="text-[10px] text-slate-400">/100</span>
                    </div>
                  </div>
                  {hpBar(player2.hp, 100, player2.shield, 'red')}
                  {coreBar(engine.enemyCore)}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-300 font-semibold uppercase">CLASS ARCHETYPE</span>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase"
                    style={{ backgroundColor: `${p2Archetype?.color}25`, color: p2Archetype?.color || '#FF3366' }}
                  >
                    {p2Archetype?.nameKo} · {p2Archetype?.name}
                  </span>
                </div>
                <p className="text-[10px] text-slate-300 mt-1 leading-snug break-keep">
                  <span className="text-rose-400 font-bold">PASSIVE:</span>{' '}
                  {p2Archetype?.passiveDesc}
                </p>
              </div>
              {p2Archetype &&
                skillCard(p2Archetype.skillName, 'Ctrl우', p2CurCD, p2MaxCD, p2SkillReady, p2CdPercent, rejectFlash('skill', 2))}
              {dashCard(player2, 'Shift우', 2)}
              {discardCard(player2.discardStacks, player2.discardRecharge, '/', 2)}
            </div>

            {clusterPreview(currentCluster2, player2.currentCol, player2.currentRow)}
            {comboBlock(engine.combo2Count, engine.combo2Timer, engine.combo2Multiplier, 'P2')}

            <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-2.5 text-[10px] text-slate-300 backdrop-blur-md mt-auto break-keep">
              <div className="font-bold text-[11px] text-slate-300 mb-1 flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-rose-400" />
                P2 조작 가이드
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                <div><span className="text-rose-300 font-mono font-bold">[방향키]</span> P2 이동</div>
                <div><span className="text-white font-mono font-bold">[Enter]</span> P2 공격</div>
                <div><span className="text-emerald-300 font-mono font-bold">[Shift우]</span> P2 대시</div>
                <div><span className="text-amber-300 font-mono font-bold">[Ctrl우]</span> P2 스킬</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div
              className={`crack-bg bg-slate-950/90 border rounded-3xl p-3 shadow-xl backdrop-blur-md ${
                enemy.isBoss && !isMulti
                  ? 'border-rose-500/80 shadow-rose-950/60'
                  : 'border-red-500/50 shadow-red-950/50'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <img
                  src={opponentPortrait}
                  alt="Opponent Portrait"
                  className="w-[88px] h-[88px] rounded-2xl object-cover border border-rose-500/60 shadow-md shadow-rose-950/60 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                      <span
                        className={`text-[11px] font-black tracking-wider ${
                          enemy.isBoss && !isMulti ? 'text-rose-400' : 'text-red-400'
                        }`}
                      >
                        {engine.isOnline
                          ? (engine.onlineRole === 'p1' ? 'OPPONENT (P2/GUEST)' : 'OPPONENT (P1/HOST)')
                          : isMulti
                          ? 'PLAYER 2 (TOP)'
                          : enemy.isBoss
                          ? 'OMNI-OVERLORD [BOSS]'
                          : enemy.isSectorBoss
                          ? `섹터 보스 · STAGE ${engine.currentStage}`
                          : `STAGE ${engine.currentStage} HOSTILE`}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-base font-bold tabular-nums text-white">
                        {Math.round(isMulti && player2 ? player2.hp : enemy.hp)}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        /{isMulti && player2 ? 100 : enemy.maxHp}
                      </span>
                    </div>
                  </div>
                  {hpBar(
                    isMulti && player2 ? player2.hp : enemy.hp,
                    isMulti && player2 ? 100 : enemy.maxHp,
                    isMulti && player2 ? player2.shield : 0,
                    'red'
                  )}
                  {coreBar(engine.enemyCore)}
                </div>
              </div>

              {isMulti && player2 ? (
                <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-300">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-300 font-semibold uppercase">OPPONENT CLASS:</span>
                    <span
                      className="font-bold px-1.5 py-0.5 rounded uppercase"
                      style={{ backgroundColor: `${p2Archetype?.color}25`, color: p2Archetype?.color || '#FF3366' }}
                    >
                      {p2Archetype?.nameKo || '상대'} ({p2Archetype?.name})
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-300 mt-1 break-keep">
                    {p2Archetype?.passiveDesc}
                  </p>
                </div>
              ) : (
                <div className="flex justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-800/80">
                  <span>{enemy.isBoss ? 'BOSS TRAIT:' : 'TACTICAL AI:'}</span>
                  <span className="text-amber-300 font-semibold text-right break-keep">
                    {enemy.isBoss
                      ? '7종 스킬 순환: 크림슨 스트라이크 · 타이드 플러드 · 옴니 빔 · 크로마 퓨전 · 오버드라이브 서지 · 퀀텀 리라이트 · 페이즈 블링크'
                      : enemy.archetypes.length >= 2
                      ? '하이브리드 AI: 두 직업 패시브 + 스킬 교차 사용'
                      : engine.currentStage >= 3
                      ? 'Dynamic Evasion & Intercept + Core Defense'
                      : 'Basic Cluster Strike'}
                  </span>
                </div>
              )}
            </div>

            {comboBlock(engine.comboCount, engine.comboTimer, engine.comboMultiplier, 'MY')}
          </>
        )}
      </div>
    </div>
  );
};
