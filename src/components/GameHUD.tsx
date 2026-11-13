import React from 'react';
import { GameEngine } from '../game/GameEngine';
import { ARCHETYPE_LIST, ARCHETYPES } from '../game/archetypes';
import { ArchetypeId } from '../types/game';
import { STAGES } from '../game/stages';
import { soundManager } from '../audio/soundManager';
import lancerPortrait from '../assets/images/cyber_operator_lancer_1794503890682.jpg';
import sniperPortrait from '../assets/images/cyber_operator_sniper_1794503906250.jpg';
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
  const stageInfo = STAGES[Math.min(engine.currentStage - 1, STAGES.length - 1)];

  const currentArchetype = ARCHETYPES[player.archetypeId];
  const p2Archetype = player2 ? ARCHETYPES[player2.archetypeId] : null;

  const [muted, setMuted] = React.useState(soundManager.isMuted());
  const [copied, setCopied] = React.useState(false);

  // Cluster currently under player
  const currentCluster = engine.playerBoard.getClusterAt(player.currentCol, player.currentRow);

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

  return (
    <div className="absolute inset-0 pointer-events-none flex justify-between p-4 z-10 font-['Chakra_Petch']">
      {/* Top Center HUD Utility Bar & Navigation */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2.5 bg-slate-950/90 backdrop-blur-md border border-cyan-500/50 px-4 py-1.5 rounded-full shadow-2xl shadow-cyan-950/70 pointer-events-auto">
        {/* Home / Return to Title */}
        <button
          onClick={onReturnToTitle}
          title="타이틀 화면으로 나가기"
          className="flex items-center gap-1.5 text-xs font-bold bg-rose-950/70 hover:bg-rose-900/90 text-rose-300 border border-rose-500/50 px-2.5 py-1 rounded-full transition-all cursor-pointer"
        >
          <Home className="w-3.5 h-3.5" />
          <span>홈으로</span>
        </button>

        <div className="h-4 w-px bg-slate-700" />

        {/* Mode & Stage Banner */}
        <div className="flex items-center gap-2">
          {enemy.isBoss && !isMulti ? (
            <span className="flex items-center gap-1.5 text-xs font-black tracking-wider text-rose-400 uppercase animate-pulse">
              <Crown className="w-4 h-4 text-amber-400" />
              FINAL BOSS: OMNI-OVERLORD [HP 200]
            </span>
          ) : isMulti ? (
            <span className="flex items-center gap-1.5 text-xs font-black tracking-wider text-amber-300 uppercase">
              <Swords className="w-4 h-4 text-amber-400" />
              {engine.isOnline ? 'ONLINE 1v1 DUEL' : 'LOCAL 2P DUEL'}
            </span>
          ) : (
            <span className="text-xs font-bold tracking-widest text-cyan-400 uppercase flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-300 animate-pulse" />
              {stageInfo?.nameKo || `STAGE ${engine.currentStage}/5`}
            </span>
          )}
        </div>

        {/* Online Room Code & 1-Click Copy */}
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

      {/* Combo Multiplier HUD (Center Top below utility bar) */}
      {engine.comboCount > 0 && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center animate-bounce-subtle">
          <div className="flex items-center gap-2 bg-slate-950/90 border border-amber-500/60 px-4 py-1 rounded-full shadow-lg shadow-amber-950/70 backdrop-blur-md">
            <Flame className="w-4 h-4 text-amber-400 animate-pulse" />
            <span className="text-xs font-black tracking-widest text-white">
              COMBO <span className="text-amber-400 font-mono text-sm">{engine.comboCount}</span>
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-xs font-black text-emerald-400 font-mono">
              x{engine.comboMultiplier.toFixed(1)} DMG
            </span>
          </div>
          {/* Combo Decay Progress Bar */}
          <div className="w-28 h-1 bg-slate-900 rounded-full mt-1 overflow-hidden border border-amber-500/30">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-75"
              style={{ width: `${Math.min(100, (engine.comboTimer / 3.5) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* LEFT HUD (Player 1 Panel - 320px width) */}
      <div className="w-[310px] flex flex-col justify-between pointer-events-auto select-none">
        {/* Top: Player 1 HP & Vitals */}
        <div className="crack-bg bg-slate-950/90 border border-cyan-500/50 rounded-3xl p-3 shadow-xl shadow-cyan-950/50 backdrop-blur-md">
          <div className="flex items-center gap-2.5 mb-2">
            <img
              src={lancerPortrait}
              alt="Operator Portrait"
              className="w-10 h-10 rounded-2xl object-cover border border-cyan-400/60 shadow-md shadow-cyan-950/60"
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

              {/* HP Bar */}
              <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700/60 relative mt-1">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-cyan-300 rounded-full transition-all duration-150"
                  style={{ width: `${Math.max(0, player.hp)}%` }}
                />
                {player.shield > 0 && (
                  <div
                    className="absolute top-0.5 left-0.5 h-full bg-cyan-200/80 rounded-full border-r border-white animate-pulse"
                    style={{ width: `${Math.min(100, player.shield)}%` }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Active Class Info */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-semibold uppercase">CLASS ARCHETYPE</span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase"
                style={{ backgroundColor: `${currentArchetype.color}25`, color: currentArchetype.color }}
              >
                {currentArchetype.nameKo} · {currentArchetype.name}
              </span>
            </div>
            <p className="text-[10px] text-slate-300 mt-1 leading-snug">
              <span className="text-cyan-400 font-bold">PASSIVE: </span>
              {currentArchetype.passiveDesc}
            </p>
          </div>

          {/* Active Skill Bar & Cooldown */}
          <div className="mt-2 pt-2 border-t border-slate-800/80">
            <div className="flex justify-between items-center text-xs mb-1">
              <span className="font-bold flex items-center gap-1.5 text-slate-200 text-[11px]">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>[Ctrl] {currentArchetype.skillName}</span>
              </span>
              <span
                className={`font-bold font-mono text-[10px] px-1.5 py-0.5 rounded ${
                  skillReady ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40 animate-pulse' : 'text-amber-400'
                }`}
              >
                {skillReady ? 'READY [Ctrl]' : `${curCD.toFixed(1)}s`}
              </span>
            </div>

            <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700/50">
              <div
                className={`h-full transition-all duration-100 ${
                  skillReady ? 'bg-emerald-400 shadow-md shadow-emerald-400/50' : 'bg-amber-400'
                }`}
                style={{ width: `${cdPercent}%` }}
              />
            </div>
          </div>

          {/* Dash Gauge & Cooldown */}
          <div className="mt-2 pt-2 border-t border-slate-800/80">
            <div className="flex justify-between items-center text-xs mb-1">
              <span className="font-bold flex items-center gap-1.5 text-slate-200 text-[11px]">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>[Shift] DASH (회피)</span>
              </span>
              <span
                className={`font-bold font-mono text-[10px] px-1.5 py-0.5 rounded ${
                  player.dashCooldownRemaining <= 0
                    ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/40 animate-pulse'
                    : 'text-slate-400'
                }`}
              >
                {player.dashCooldownRemaining <= 0 ? 'READY [Shift]' : `${player.dashCooldownRemaining.toFixed(1)}s`}
              </span>
            </div>

            <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700/50">
              <div
                className={`h-full transition-all duration-100 ${
                  player.dashCooldownRemaining <= 0
                    ? 'bg-cyan-400 shadow-md shadow-cyan-400/50'
                    : 'bg-cyan-600/70'
                }`}
                style={{
                  width: `${
                    player.dashCooldownRemaining <= 0
                      ? 100
                      : Math.round(
                          ((player.dashCooldownMax - player.dashCooldownRemaining) /
                            player.dashCooldownMax) *
                            100
                        )
                  }%`,
                }}
              />
            </div>
          </div>

          {/* Tactical Discard Feature Badge */}
          <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between bg-cyan-950/20 px-2 py-1 rounded-full border border-cyan-800/40">
            <div className="flex items-center gap-1.5 text-[11px] text-cyan-300 font-bold">
              <Trash2 className="w-3 h-3 text-cyan-400" />
              <span>[X/E] 타일 버리기</span>
            </div>
            <span className="text-[9px] font-mono text-cyan-400 bg-cyan-900/60 px-1 py-0.5 rounded">
              0.7s 리로드
            </span>
          </div>
        </div>

        {/* Bottom Left: Controls Guide - Compact & Sleek */}
        <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-2.5 text-[10px] text-slate-400 backdrop-blur-md mb-2">
          <div className="font-bold text-[11px] text-slate-300 mb-1 flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-cyan-400" />
            조작 가이드
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {isMulti && !engine.isOnline ? (
              <>
                <div><span className="text-cyan-300 font-mono font-bold">[WASD]</span> P1 이동</div>
                <div><span className="text-white font-mono font-bold">[Space]</span> P1 공격</div>
                <div><span className="text-emerald-300 font-mono font-bold">[Shift좌]</span> P1 대시</div>
                <div><span className="text-amber-300 font-mono font-bold">[Ctrl좌]</span> P1 스킬</div>
                <div><span className="text-rose-300 font-mono font-bold">[방향키]</span> P2 이동</div>
                <div><span className="text-white font-mono font-bold">[Enter]</span> P2 공격</div>
                <div><span className="text-emerald-300 font-mono font-bold">[Shift우]</span> P2 대시</div>
                <div><span className="text-amber-300 font-mono font-bold">[Ctrl우]</span> P2 스킬</div>
                <div className="col-span-2"><span className="text-purple-300 font-mono font-bold">[X/E] P1 · [/] P2</span> 타일 버리기</div>
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

      {/* RIGHT HUD (Opponent / P2 Panel - 310px width) */}
      <div className="w-[310px] flex flex-col justify-between pointer-events-auto select-none">
        {/* Top: Enemy HP / P2 HP */}
        <div
          className={`crack-bg bg-slate-950/90 border rounded-3xl p-3 shadow-xl backdrop-blur-md ${
            enemy.isBoss && !isMulti
              ? 'border-rose-500/80 shadow-rose-950/60'
              : 'border-red-500/50 shadow-red-950/50'
          }`}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <img
              src={sniperPortrait}
              alt="Opponent Portrait"
              className="w-10 h-10 rounded-2xl object-cover border border-rose-500/60 shadow-md shadow-rose-950/60"
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

              {/* Opponent HP Bar */}
              <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700/60 mt-1">
                <div
                  className={`h-full rounded transition-all duration-150 ${
                    enemy.isBoss && !isMulti
                      ? 'bg-gradient-to-r from-purple-600 via-rose-500 to-amber-400'
                      : 'bg-gradient-to-r from-red-600 via-rose-500 to-amber-500'
                  }`}
                  style={{
                    width: `${Math.max(
                      0,
                      ((isMulti && player2 ? player2.hp : enemy.hp) /
                        (isMulti && player2 ? 100 : enemy.maxHp)) *
                        100
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Opponent Class trait */}
          {isMulti && player2 ? (
            <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-300">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 font-semibold uppercase">OPPONENT CLASS:</span>
                <span
                  className="font-bold px-1.5 py-0.5 rounded uppercase"
                  style={{ backgroundColor: `${p2Archetype?.color}25`, color: p2Archetype?.color || '#FF3366' }}
                >
                  {p2Archetype?.nameKo || '상대'} ({p2Archetype?.name})
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                {p2Archetype?.passiveDesc}
              </p>
            </div>
          ) : (
            <div className="flex justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-800/80">
              <span>{enemy.isBoss ? 'BOSS TRAIT:' : 'TACTICAL AI:'}</span>
              <span className="text-amber-300 font-semibold">
                {enemy.isBoss
                  ? 'Casts All 7 Archetype Skills'
                  : engine.currentStage >= 3
                  ? 'Dynamic Evasion & Intercept'
                  : 'Basic Cluster Strike'}
              </span>
            </div>
          )}
        </div>

        {/* Center: Live Cluster Preview Under Feet */}
        <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-3 shadow-lg backdrop-blur-md my-2">
          <div className="text-xs font-bold text-slate-300 mb-1 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5 text-cyan-400" />
              FOOTPAD CLUSTER PREVIEW
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              [{player.currentCol}, {player.currentRow}]
            </span>
          </div>

          {currentCluster ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Size & Status:</span>
                <span
                  className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                    currentCluster.isActivePad
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/50'
                      : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {currentCluster.tiles.length} TILES · {currentCluster.isActivePad ? 'PRIMED (LAUNCHABLE)' : 'IDLE (< 3)'}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Shape Bonus:</span>
                <span className="font-bold text-cyan-300 text-[11px]">{currentCluster.shapeTitle}</span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Color Trait:</span>
                <span
                  className="font-bold text-[11px] uppercase"
                  style={{ color: currentCluster.color === 'red' ? '#FF3366' : currentCluster.color === 'blue' ? '#33CCFF' : '#FFCC00' }}
                >
                  {currentCluster.color === 'red' ? 'Fast + Red Contamination' : currentCluster.color === 'blue' ? 'High Durability Barrier' : 'Slow Opponent + Mutation'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-2 text-xs text-slate-500">
              Standing on Empty Cooldown Floor (Movement -30%)
            </div>
          )}
        </div>

        {/* Bottom: 7 Character Archetype Quick Switcher (In Single / Boss Mode) */}
        {!isMulti && (
          <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-2.5 backdrop-blur-md">
            <div className="text-[11px] font-bold text-slate-400 mb-2 flex items-center justify-between">
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
      </div>
    </div>
  );
};
