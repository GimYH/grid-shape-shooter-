import React from 'react';
import { GameEngine } from '../game/GameEngine';
import { ARCHETYPE_LIST, ARCHETYPES } from '../game/archetypes';
import { ArchetypeId, CoreState } from '../types/game';
import { STAGES } from '../game/stages';
import { soundManager } from '../audio/soundManager';
import { networkManager } from '../game/NetworkManager';
import {
  Shield,
  Volume2,
  VolumeX,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Flame,
  Swords,
  Crown,
  Home,
  Share2,
  Check,
} from 'lucide-react';

interface GameHUDProps {
  engine: GameEngine;
  onTogglePause: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

// v2.2: 1920x1080 three-column cockpit HUD. Left 420px = P1 cockpit,
// right 420px = opponent panel (or the mirrored P2 cockpit in local 2P),
// center top = 56px slim bar with the shrink countdown.
export const GameHUD: React.FC<GameHUDProps> = ({
  engine,
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
  // Opponent archetype: P2's in local versus, the remote player's
  // online. The fighter glyph on the board + the name chip identify it —
  // the cockpit portraits were removed in v3.0 Phase 2 (Zone 3: portraits
  // show only as skill/combo-7/boss-awakening cut-ins).
  const opponentArchetypeId =
    isMulti && player2 ? player2.archetypeId : engine.isOnline ? networkManager.opponentArchetype : null;
  const opponentArchetype = opponentArchetypeId ? ARCHETYPES[opponentArchetypeId] : null;
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

  // v3.0 Phase 2 Zone 2: shrink timer lives at the right end of the
  // neutral zone as one big MM:SS number (the slim-bar pill is gone).

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

  // v3.0 Phase 2 Zone 2: shrink timer lives at the right end of the
  // neutral zone as one big MM:SS number (the slim-bar pill is gone).
  const t = engine.gameTime;
  const shrinkPhase = engine.shrinkPhase;
  const shrinkRemaining = Math.max(0, Math.ceil(90 - t));
  const shrinkMmSs = `${String(Math.floor(shrinkRemaining / 60)).padStart(2, '0')}:${String(shrinkRemaining % 60).padStart(2, '0')}`;
  const shrinkElapsed = Math.max(0, Math.floor(t - 90));
  const shrinkElapsedMmSs = `${String(Math.floor(shrinkElapsed / 60)).padStart(2, '0')}:${String(shrinkElapsed % 60).padStart(2, '0')}`;

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

  // v3.0 Phase 2 Zone 2: board-corner action icons — one compact chip
  // per action (skill / dash / discard) with its cooldown or stack
  // count. The old cockpit cards are gone; the canvas character HUD
  // already carries HP + discard pips, so these chips only add cooldowns.
  const actionChip = (
    label: string,
    keys: string,
    ready: boolean,
    value: string,
    flash: boolean,
    tone: 'amber' | 'cyan'
  ) => (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-bold backdrop-blur-md ${
        flash
          ? 'reject-shake ring-2 ring-red-500 bg-red-950/70 border-red-500 text-red-200'
          : ready
          ? 'bg-slate-950/85 border-slate-600 text-slate-100'
          : 'bg-slate-950/70 border-slate-800 text-slate-500'
      }`}
    >
      <span className={tone === 'amber' ? 'text-amber-400' : 'text-cyan-400'}>{label}</span>
      <span className="font-mono text-[10px] text-slate-400">[{keys}]</span>
      <span className={`font-mono tabular-nums ${ready ? 'text-emerald-400' : ''}`}>{value}</span>
    </div>
  );

  const actionRow = (playerNum: 1 | 2) => {
    const char = playerNum === 1 ? player : player2;
    if (!char) return null;
    const arch = playerNum === 1 ? currentArchetype : p2Archetype;
    if (!arch) return null;
    const skillReady = char.skillCooldownRemaining <= 0;
    const dashReady = char.dashCooldownRemaining <= 0;
    return (
      <div className="flex items-center gap-1.5">
        {actionChip(
          '스킬',
          playerNum === 1 ? 'Q' : 'Ctrl우',
          skillReady,
          skillReady ? 'READY' : `${char.skillCooldownRemaining.toFixed(1)}s`,
          rejectFlash('skill', playerNum),
          'amber'
        )}
        {actionChip(
          '대시',
          playerNum === 1 ? 'Shift' : 'Shift우',
          dashReady,
          dashReady ? 'READY' : `${char.dashCooldownRemaining.toFixed(1)}s`,
          rejectFlash('dash', playerNum),
          'cyan'
        )}
        {actionChip(
          '버리기',
          playerNum === 1 ? 'X' : '/',
          char.discardStacks > 0,
          `${char.discardStacks}/3`,
          rejectFlash('discard', playerNum),
          'cyan'
        )}
      </div>
    );
  };

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
    ) : null;

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

        {/* v3.0 Phase 2 Zone 2: the shrink timer moved out of the slim
            bar — it now sits big at the right end of the neutral zone. */}

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
      </div>

      {/* LEFT: P1 cockpit (420px) — v3.0 Phase 2 Zone 3: portrait,
          passive text, action cards, cluster preview and the key guide
          are gone. Only the numeric HP/core readout + class chip stay;
          cooldowns live in the board-corner icon row below. */}
      <div className="absolute left-4 top-[72px] bottom-4 w-[420px] flex flex-col pointer-events-auto select-none">
        <div className="crack-bg bg-slate-950/90 border border-cyan-500/50 rounded-3xl p-3 shadow-xl shadow-cyan-950/50 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span className="text-[11px] font-black text-cyan-300 tracking-wider">
                {isMulti ? (engine.onlineRole === 'p2' ? 'YOU (P2/GUEST)' : 'YOU (P1/HOST)') : 'PLAYER OPERATOR'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-base font-bold tabular-nums text-white">{Math.round(player.hp)}</span>
              <span className="text-[10px] text-slate-400">/{player.maxHp}</span>
            </div>
          </div>
          {hpBar(player.hp, player.maxHp, player.shield, 'cyan')}
          {coreBar(engine.playerCore)}
          <div className="pt-2 mt-2 border-t border-slate-800/80 flex items-center justify-between">
            <span className="text-[10px] text-slate-300 font-semibold uppercase">CLASS ARCHETYPE</span>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase"
              style={{ backgroundColor: `${currentArchetype.color}25`, color: currentArchetype.color }}
            >
              {currentArchetype.nameKo} · {currentArchetype.name}
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT: opponent panel (420px) — v3.0 Phase 2 Zone 3: same
          trim as the P1 cockpit (no portrait, no passive/trait text, no
          action cards, no key guide). */}
      <div className="absolute right-4 top-[72px] bottom-4 w-[420px] flex flex-col pointer-events-auto select-none">
        {isLocal2P && player2 ? (
          <div className="crack-bg bg-slate-950/90 border border-red-500/50 rounded-3xl p-3 shadow-xl shadow-red-950/50 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span className="text-[11px] font-black text-red-400 tracking-wider">PLAYER 2 (TOP)</span>
              </div>
              <div className="text-right">
                <span className="text-base font-bold tabular-nums text-white">{Math.round(player2.hp)}</span>
                <span className="text-[10px] text-slate-400">/{player2.maxHp}</span>
              </div>
            </div>
            {hpBar(player2.hp, player2.maxHp, player2.shield, 'red')}
            {coreBar(engine.enemyCore)}
            <div className="pt-2 mt-2 border-t border-slate-800/80 flex items-center justify-between">
              <span className="text-[10px] text-slate-300 font-semibold uppercase">CLASS ARCHETYPE</span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase"
                style={{ backgroundColor: `${p2Archetype?.color}25`, color: p2Archetype?.color || '#FF3366' }}
              >
                {p2Archetype?.nameKo} · {p2Archetype?.name}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`crack-bg bg-slate-950/90 border rounded-3xl p-3 shadow-xl backdrop-blur-md ${
                enemy.isBoss && !isMulti
                  ? 'border-rose-500/80 shadow-rose-950/60'
                  : 'border-red-500/50 shadow-red-950/50'
              }`}
            >
              <div className="flex items-center justify-between">
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
                    /{isMulti && player2 ? player2.maxHp : enemy.maxHp}
                  </span>
                </div>
              </div>
              {hpBar(
                isMulti && player2 ? player2.hp : enemy.hp,
                isMulti && player2 ? player2.maxHp : enemy.maxHp,
                isMulti && player2 ? player2.shield : 0,
                'red'
              )}
              {coreBar(engine.enemyCore)}
              {opponentArchetype && (
                <div className="pt-2 mt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[10px] text-slate-300 font-semibold uppercase">OPPONENT CLASS</span>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase"
                    style={{ backgroundColor: `${opponentArchetype.color}25`, color: opponentArchetype.color }}
                  >
                    {opponentArchetype.nameKo} · {opponentArchetype.name}
                  </span>
                </div>
              )}
            </div>

            {comboBlock(engine.comboCount, engine.comboTimer, engine.comboMultiplier, 'MY')}
          </>
        )}
        {isLocal2P && player2 && comboBlock(engine.combo2Count, engine.combo2Timer, engine.combo2Multiplier, 'P2')}
      </div>

      {/* v3.0 Phase 2 Zone 2: shrink timer — one big MM:SS number at the
          right end of the neutral zone (y 404-636, above the cut-in band
          at 455+). Red pulse + one warning line during 80-90s. */}
      <div className="absolute pointer-events-none select-none" style={{ left: 1300, top: 408, width: 196 }}>
        <div
          className={`text-right font-black tabular-nums leading-none ${
            shrinkPhase === 'warning'
              ? 'text-red-400 animate-pulse text-[40px]'
              : shrinkPhase === 'shrinking' || shrinkPhase === 'closed'
              ? 'text-red-300 text-[40px]'
              : 'text-slate-100 text-[40px]'
          }`}
          style={{ textShadow: '0 0 12px rgba(0,0,0,0.9)' }}
        >
          {shrinkPhase === 'shrinking' ? shrinkElapsedMmSs : shrinkPhase === 'closed' ? '00:00' : shrinkMmSs}
        </div>
        <div className="text-right text-[11px] font-bold text-slate-300 mt-1" style={{ textShadow: '0 0 8px rgba(0,0,0,0.9)' }}>
          {shrinkPhase === 'warning'
            ? '10초 후 중앙 수축 시작'
            : shrinkPhase === 'shrinking'
            ? '수축 진행 중'
            : shrinkPhase === 'closed'
            ? '수축 완료'
            : '수축까지'}
        </div>
      </div>

      {/* v3.0 Phase 2 Zone 2: board-corner action icons — P1 at the
          bottom-left corner of my board (below the core bar, which spans
          the central 5 columns only). */}
      <div className="absolute pointer-events-none select-none" style={{ left: 424, top: 990 }}>
        {actionRow(1)}
      </div>

      {/* Local 2P: P2's icons mirrored at the top-right corner of the top
          board (below the slim bar, right of the enemy core bar). */}
      {isLocal2P && player2 && (
        <div className="absolute pointer-events-none select-none" style={{ left: 1330, top: 52 }}>
          {actionRow(2)}
        </div>
      )}

      {/* v3.0 Phase 2 Zone 2: 1-7 mini archetype strip — single/boss
          only, at the bottom-left next to the action icons. */}
      {!isMulti && (
        <div className="absolute pointer-events-auto select-none flex items-center gap-1" style={{ left: 780, top: 990 }}>
          {ARCHETYPE_LIST.map((arch, idx) => {
            const isSelected = player.archetypeId === arch.id;
            return (
              <button
                key={arch.id}
                onClick={() => handleSelectArchetype(arch.id)}
                title={`${arch.nameKo} [${idx + 1}]`}
                className={`w-8 h-8 rounded-lg text-[11px] font-black font-mono flex items-center justify-center border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-950/90 border-cyan-400 text-white shadow-md shadow-cyan-500/40'
                    : 'bg-slate-950/80 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                }`}
                style={isSelected ? { boxShadow: `0 0 10px ${arch.color}66` } : undefined}
              >
                <span style={{ color: isSelected ? arch.color : undefined }}>{idx + 1}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
