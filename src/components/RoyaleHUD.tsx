import React, { useState } from 'react';
import { GameEngine } from '../game/GameEngine';
import { ARCHETYPES } from '../game/archetypes';
import { ARCHETYPE_PORTRAITS } from '../assets/portraits';
import {
  ROYALE_MAX_PLAYERS,
  ROYALE_TARGET_MODES,
  royaleTargetModeLabel,
} from '../game/royale';
import { soundManager } from '../audio/soundManager';
import {
  Crown,
  Crosshair,
  Home,
  RotateCcw,
  Skull,
  Swords,
  Target,
  Volume2,
  VolumeX,
  Zap,
  Wind,
  Trash2,
  Code2,
} from 'lucide-react';

interface RoyaleHUDProps {
  engine: GameEngine;
  onReturnToTitle: () => void;
  onRestart: () => void;
  onOpenGodotModal: () => void;
}

// GRID ROYALE (v2.4) HUD: same 1920x1080 three-column cockpit as the duel
// HUD (left 420 / center 1080 / right 420). Left: my cockpit + targeting
// buttons + KO buff. Center top: survivors, shrink timer, kill feed.
// Right: the other (up to 7) players' mini status cards.
export const RoyaleHUD: React.FC<RoyaleHUDProps> = ({
  engine,
  onReturnToTitle,
  onRestart,
  onOpenGodotModal,
}) => {
  const [muted, setMuted] = useState(soundManager.isMuted());
  const player = engine.player;
  const me = engine.royalePlayers.find((p) => p.id === engine.royaleMyId);
  const others = engine.royalePlayers
    .filter((p) => p.id !== engine.royaleMyId)
    .sort((a, b) => (a.alive === b.alive ? 0 : a.alive ? -1 : 1));
  const myTargetId = engine.royaleTargetingIds[0] ?? null;
  const myTarget = engine.royalePlayers.find((p) => p.id === myTargetId);

  const shrinkLabel =
    engine.shrinkPhase === 'warning'
      ? `수축 ${Math.max(0, Math.ceil(90 - engine.gameTime))}초 후`
      : engine.shrinkPhase === 'shrinking'
      ? '수축 중!'
      : engine.shrinkPhase === 'closed'
      ? '존 폐쇄'
      : `수축 ${Math.max(0, Math.ceil(90 - engine.gameTime))}초 후`;

  const handleMuteToggle = () => {
    setMuted(soundManager.toggleMute());
  };

  const copyInviteLink = () => {
    if (!engine.onlineRoomCode) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${engine.onlineRoomCode}&mode=royale`;
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  const bar = (value: number, max: number, color: string) => (
    <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, backgroundColor: color }}
      />
    </div>
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-10 font-['Chakra_Petch']">
      {/* Center top slim bar: title + survivors + shrink timer + room */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-14 flex items-center gap-2.5 bg-slate-950/90 backdrop-blur-md border border-fuchsia-500/50 border-t-0 px-4 rounded-b-2xl shadow-2xl shadow-fuchsia-950/70 pointer-events-auto">
        <button
          onClick={onReturnToTitle}
          title="타이틀 화면으로 나가기"
          className="flex items-center gap-1.5 text-xs font-bold bg-rose-950/70 hover:bg-rose-900/90 text-rose-300 border border-rose-500/50 px-2.5 py-1 rounded-full transition-all cursor-pointer"
        >
          <Home className="w-3.5 h-3.5" />
          <span>홈으로</span>
        </button>

        <div className="h-4 w-px bg-slate-700" />

        <span className="flex items-center gap-1.5 text-xs font-black tracking-wider text-fuchsia-300 uppercase whitespace-nowrap">
          <Crown className="w-4 h-4 text-amber-400" />
          GRID ROYALE
        </span>

        <div className="h-4 w-px bg-slate-700" />

        <span className="text-xs font-black tabular-nums whitespace-nowrap px-2 py-0.5 rounded-full border text-white bg-slate-900/70 border-slate-700">
          생존자 {engine.royaleAliveCount}/{ROYALE_MAX_PLAYERS}
        </span>

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

        {engine.onlineRoomCode && (
          <>
            <div className="h-4 w-px bg-slate-700" />
            <button
              onClick={copyInviteLink}
              title="배틀로얄 초대 링크 복사"
              className="flex items-center gap-1.5 bg-fuchsia-950/80 px-2 py-0.5 rounded-full border border-fuchsia-500/40 text-xs cursor-pointer hover:bg-fuchsia-900/80 transition-colors"
            >
              <span className="text-slate-400">ROOM:</span>
              <span className="font-mono font-bold text-amber-300">{engine.onlineRoomCode}</span>
            </button>
          </>
        )}

        <div className="h-4 w-px bg-slate-700" />

        <button
          onClick={handleMuteToggle}
          title={muted ? '소리 켜기' : '소리 끄기'}
          className="p-1 hover:text-fuchsia-400 text-slate-300 transition-colors cursor-pointer"
        >
          {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <button
          onClick={onRestart}
          title="타이틀로 나가기"
          className="p-1 hover:text-fuchsia-400 text-slate-300 transition-colors cursor-pointer"
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

      {/* Kill feed (latest 2, center top under the slim bar) */}
      {engine.royaleKillFeed.length > 0 && (
        <div className="absolute top-[64px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
          {engine.royaleKillFeed.map((line, i) => (
            <div
              key={`${line.text}-${i}`}
              className="px-3 py-1 rounded-full bg-slate-950/85 border border-slate-700 text-[11px] font-bold whitespace-nowrap"
              style={{ color: line.color, opacity: i === 0 ? 1 : 0.65 }}
            >
              <Skull className="w-3 h-3 inline mr-1 -mt-0.5" />
              {line.text}
            </div>
          ))}
        </div>
      )}

      {/* LEFT: my cockpit (420px) */}
      <div className="absolute left-4 top-[72px] bottom-4 w-[420px] flex flex-col gap-3 pointer-events-auto select-none overflow-y-auto">
        <div className="crack-bg bg-slate-950/90 border border-fuchsia-500/50 rounded-3xl p-3 shadow-xl shadow-fuchsia-950/50 backdrop-blur-md">
          <div className="flex items-center gap-3 mb-2">
            <img
              src={ARCHETYPE_PORTRAITS[player.archetypeId]}
              alt="Operator Portrait"
              className="w-[88px] h-[88px] rounded-2xl object-cover border border-fuchsia-400/60 shadow-md shadow-fuchsia-950/60 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-fuchsia-300 tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-fuchsia-400 animate-ping" />
                  YOU · {me?.name ?? '플레이어'}
                </span>
                <span className="text-right">
                  <span className="text-base font-bold tabular-nums text-white">{Math.round(player.hp)}</span>
                  <span className="text-[10px] text-slate-400">/100</span>
                </span>
              </div>
              {bar(player.hp, 100, '#E879F9')}
              <div className="flex justify-between items-center text-xs mt-1.5 mb-1">
                <span className="text-[11px] font-bold text-slate-300">코어</span>
                <span className="tabular-nums text-white font-bold">
                  {Math.round(engine.playerCore.hp)}
                  <span className="text-[10px] text-slate-400">/{engine.playerCore.maxHp}</span>
                </span>
              </div>
              {bar(engine.playerCore.hp, engine.playerCore.maxHp, '#FF0055')}
              <div className="flex items-center justify-between mt-2 text-[11px]">
                <span className="text-slate-400">
                  직업: <span className="font-bold text-white">{ARCHETYPES[player.archetypeId].nameKo}</span>
                </span>
                <span className="font-bold text-amber-300">
                  콤보 x{engine.comboCount} ({engine.comboMultiplier.toFixed(1)}배)
                </span>
              </div>
            </div>
          </div>

          {/* KO buff badge */}
          <div className="mt-2 flex items-center justify-between bg-amber-500/10 border border-amber-400/50 rounded-2xl px-3 py-2">
            <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
              <Swords className="w-4 h-4" />
              KO x{engine.royaleKos}
            </span>
            <span className="text-xs font-bold text-amber-200 tabular-nums">
              +{engine.royaleDamageBuff * 10}% DMG
            </span>
          </div>

          {/* Skill / dash / discard status (display only; actions come from keys / touch controls) */}
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-2">
              <Zap className="w-4 h-4 mx-auto text-amber-300" />
              <div className="text-[10px] font-bold text-slate-300 mt-1">스킬</div>
              <div className="text-[11px] font-bold tabular-nums text-white">
                {player.skillCooldownRemaining > 0 ? `${player.skillCooldownRemaining.toFixed(1)}초` : '준비됨'}
              </div>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-2">
              <Wind className="w-4 h-4 mx-auto text-emerald-300" />
              <div className="text-[10px] font-bold text-slate-300 mt-1">대시</div>
              <div className="text-[11px] font-bold tabular-nums text-white">
                {player.dashCooldownRemaining > 0 ? `${player.dashCooldownRemaining.toFixed(1)}초` : '준비됨'}
              </div>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-2">
              <Trash2 className="w-4 h-4 mx-auto text-purple-300" />
              <div className="text-[10px] font-bold text-slate-300 mt-1">버리기</div>
              <div className="text-[11px] font-bold tabular-nums text-white">{player.discardStacks}/3</div>
            </div>
          </div>
        </div>

        {/* Targeting buttons [1~4] */}
        <div className="crack-bg bg-slate-950/90 border border-slate-700 rounded-3xl p-3 shadow-xl backdrop-blur-md">
          <div className="text-[11px] font-black text-slate-300 tracking-wider mb-2 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-fuchsia-300" />
            타겟팅
            {myTarget && (
              <span className="ml-auto font-bold text-amber-300 normal-case tracking-normal">
                조준 중: {myTarget.name}
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {ROYALE_TARGET_MODES.map((t) => {
              const active = engine.royaleTargetMode === t.mode;
              return (
                <button
                  key={t.mode}
                  onClick={() => engine.setRoyaleTargetMode(t.mode)}
                  title={t.descKo}
                  className={`py-2 rounded-2xl border text-center transition-all cursor-pointer active:scale-95 ${
                    active
                      ? 'bg-fuchsia-500/25 border-fuchsia-400 text-white shadow-lg shadow-fuchsia-950/50'
                      : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span className="block text-[10px] font-mono font-bold text-slate-400">[{t.key}]</span>
                  <span className="block text-xs font-black mt-0.5">{t.labelKo}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500 mt-2 break-keep">
            현재 모드: {royaleTargetModeLabel(engine.royaleTargetMode)} — 포탈을 통과하는 투사체가 이 기준으로 타겟에게 전달됩니다.
          </p>
        </div>

        {engine.royaleTargetedByCount >= 3 && (
          <div className="bg-emerald-500/10 border border-emerald-400/50 rounded-2xl px-3 py-2 text-xs font-bold text-emerald-300 break-keep">
            다굴 보정 발동 중: {engine.royaleTargetedByCount}명이 나를 노리는 중 — 타일 리필 15% 가속
          </div>
        )}
      </div>

      {/* RIGHT: other players' mini cards (2-col grid, up to 7) */}
      <div className="absolute right-4 top-[72px] bottom-4 w-[420px] pointer-events-auto select-none overflow-y-auto">
        <div className="text-[11px] font-black text-slate-300 tracking-wider mb-2 px-1">
          참가자 ({engine.royalePlayers.length}명)
        </div>
        <div className="grid grid-cols-2 gap-2">
          {others.map((p) => {
            const arch = ARCHETYPES[p.archetype];
            const targetingMe = p.alive && p.targetingIds.includes(engine.royaleMyId ?? '');
            const isMyTarget = p.alive && myTargetId === p.id;
            return (
              <div
                key={p.id}
                className={`rounded-2xl p-2.5 border backdrop-blur-md ${
                  !p.alive
                    ? 'bg-slate-950/60 border-slate-800 opacity-60'
                    : targetingMe
                    ? 'bg-slate-950/90 border-red-500 animate-pulse'
                    : isMyTarget
                    ? 'bg-slate-950/90 border-amber-400 shadow-lg shadow-amber-950/50'
                    : 'bg-slate-950/85 border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-xs font-bold text-white truncate flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: arch.color }}
                    />
                    <span className="truncate">{p.name}</span>
                    {p.isBot && (
                      <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400 font-bold shrink-0">BOT</span>
                    )}
                  </span>
                  <span className="text-[10px] font-black text-amber-300 shrink-0">KO {p.kos}</span>
                </div>
                <div className="text-[10px] text-slate-400 mb-1.5">
                  {arch.nameKo} · {arch.badge}
                </div>
                {p.alive ? (
                  <>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-slate-400">HP</span>
                      <span className="tabular-nums font-bold text-white">{Math.round(p.hp)}</span>
                    </div>
                    {bar(p.hp, 100, arch.color)}
                    <div className="flex justify-between text-[10px] mb-0.5 mt-1">
                      <span className="text-slate-400">코어</span>
                      <span className="tabular-nums font-bold text-white">{Math.round(p.coreHp)}</span>
                    </div>
                    {bar(p.coreHp, 250, '#FF0055')}
                  </>
                ) : (
                  <div className="text-center text-xs font-black text-slate-500 py-1">
                    OUT (#{p.rank ?? '?'})
                  </div>
                )}
                {targetingMe && (
                  <div className="mt-1.5 text-center text-[10px] font-black text-red-400 tracking-wider">
                    TARGETING YOU
                  </div>
                )}
                {isMyTarget && (
                  <div className="mt-1.5 text-center text-[10px] font-black text-amber-300 tracking-wider flex items-center justify-center gap-1">
                    <Crosshair className="w-3 h-3" />
                    조준 중
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
