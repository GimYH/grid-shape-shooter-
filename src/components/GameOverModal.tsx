import React, { useMemo } from 'react';
import { DefeatCause, GameStats } from '../types/game';
import { ArcadeResult } from '../game/arcade';
import { loadCampaignProgress, formatClearTime } from '../game/campaign';
import { RotateCcw, Trophy, Skull, Zap, Swords } from 'lucide-react';

interface GameOverModalProps {
  status: 'victory' | 'defeat';
  stats: GameStats;
  // GRID ROYALE (v2.4): final rank (1 = winner). When set, the restart
  // button is hidden — a royale game has no rematch, only a new room.
  rank?: number | null;
  // v2.2 Phase 2: how the battle was lost (defeat only).
  defeatCause?: DefeatCause | null;
  // v2.2 Phase 2: online rematch votes so far (0-2), shown when > 0.
  rematchVotes?: number;
  isOnline?: boolean;
  // ARCADE: 모드별 결과 라인 (있으면 표준 스탯 그리드 대신 표시).
  arcade?: ArcadeResult | null;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({ status, stats, rank, defeatCause, rematchVotes, isOnline, arcade, onRestart, onReturnToTitle }) => {
  const isVictory = status === 'victory';
  // v2.3: a career no-continue badge, if one was ever earned.
  const noContinue = useMemo(
    () => (isVictory ? loadCampaignProgress().noContinue : null),
    [isVictory]
  );

  return (
    <div className="absolute inset-0 z-40 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 font-['Chakra_Petch'] select-none">
      <div
        className={`crack-bg bg-slate-900 border rounded-[28px] p-6 sm:p-8 max-w-md w-full shadow-2xl flex flex-col items-center text-center ${
          isVictory
            ? 'border-emerald-500/60 shadow-emerald-950/70'
            : 'border-rose-500/60 shadow-rose-950/70'
        }`}
      >
        {/* Icon Header */}
        <div
          className={`w-16 h-16 rounded-3xl flex items-center justify-center mb-4 border ${
            isVictory
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-lg shadow-emerald-500/30'
              : 'bg-rose-500/20 text-rose-400 border-rose-500/50 shadow-lg shadow-rose-500/30'
          }`}
        >
          {isVictory ? <Trophy className="w-8 h-8" /> : <Skull className="w-8 h-8" />}
        </div>

        <h2 className="text-2xl sm:text-3xl font-black tracking-wider uppercase mb-1">
          {isVictory ? 'VICTORY ACHIEVED' : 'OPERATOR DEFEATED'}
        </h2>
        {rank != null && (
          <div className="px-4 py-1.5 rounded-full bg-fuchsia-500/20 border border-fuchsia-400/60 text-fuchsia-300 text-lg font-black tabular-nums mb-2">
            #{rank}위
          </div>
        )}
        <p className="text-xs text-slate-400 mb-6">
          {arcade
            ? arcade.title
            : isVictory
            ? '상대 진영을 격파하고 그리드 지배권을 확보했습니다.'
            : '플레이어 HP가 소진되었습니다. 다시 도전하거나 전술을 재정비하세요.'}
        </p>

        {/* ARCADE: 모드별 결과 라인 (표준 스탯 그리드 대신 표시) */}
        {arcade && (
          <div className="grid grid-cols-2 gap-3 w-full mb-6 text-left">
            {arcade.lines.map((line) => (
              <div key={line.label} className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
                <span className="text-[11px] text-slate-400 block mb-0.5">{line.label}</span>
                <span className="text-xl font-bold font-mono text-cyan-400 tabular-nums break-keep">
                  {line.value}
                </span>
                {line.best && (
                  <span className="block text-[11px] font-mono text-amber-400 tabular-nums mt-0.5">
                    {line.best}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* v2.2 Phase 2: defeat cause */}
        {!isVictory && defeatCause && (
          <div className="w-full mb-4 px-3 py-2 rounded-2xl bg-rose-500/15 border border-rose-400/60 text-rose-300 text-sm font-bold break-keep">
            {defeatCause === 'KO'
              ? '격추 패배 — 캐릭터 HP 소진'
              : defeatCause === 'CORE DESTROYED'
                ? '코어 파괴 패배 — 후방 코어 소진'
                : '연결 끊김 — 상대와 연결이 끊겼습니다'}
          </div>
        )}

        {/* v2.2 Phase 2: online rematch vote */}
        {isOnline && (rematchVotes ?? 0) > 0 && (
          <div className="w-full mb-4 px-3 py-2 rounded-2xl bg-cyan-500/15 border border-cyan-400/60 text-cyan-300 text-sm font-bold break-keep">
            재경기 투표 {rematchVotes}/2 — 상대의 선택을 기다리는 중…
          </div>
        )}

        {/* v2.3: no-continue badge (career record) */}
        {isVictory && noContinue && (
          <div className="w-full flex items-center justify-center gap-2 mb-4 px-3 py-2 rounded-2xl bg-amber-500/15 border border-amber-400/60 text-amber-300 text-xs font-bold break-keep">
            <Trophy className="w-4 h-4 shrink-0" />
            노컨티뉴 클리어 달성! (1~30스테이지 · {formatClearTime(noContinue.timeSec)})
          </div>
        )}

        {/* Battle Stats Grid (아케이드가 아닐 때만 표시) */}
        {!arcade && (
          <>
        <div className="grid grid-cols-3 gap-3 w-full mb-3 text-left">
          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block mb-0.5">DAMAGE TAKEN</span>
            <span className="text-xl font-bold font-mono text-rose-400 tabular-nums">
              {stats.damageTaken}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block mb-0.5">SHAPES LAUNCHED</span>
            <span className="text-xl font-bold font-mono text-amber-400 tabular-nums">
              {stats.shapesLaunched}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block mb-0.5">MAX CLUSTER SIZE</span>
            <span className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
              {stats.maxClusterSize} TILES
            </span>
          </div>
        </div>

        {/* v3.0 Phase 2: bottom 4-cell number grid — clear time, max
            combo, neutral wins, damage dealt. */}
        <div className="grid grid-cols-4 gap-3 w-full mb-6 text-left">
          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block mb-0.5">클리어 타임</span>
            <span className="text-lg font-bold font-mono text-white tabular-nums">
              {`${Math.floor(stats.gameDuration / 60)}:${String(Math.floor(stats.gameDuration % 60)).padStart(2, '0')}`}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block mb-0.5">최대 콤보</span>
            <span className="text-lg font-bold font-mono text-amber-400 tabular-nums">
              {stats.maxCombo}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block mb-0.5">중립 승리</span>
            <span className="text-lg font-bold font-mono text-cyan-400 tabular-nums">
              {stats.clashesWon}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block mb-0.5">가한 데미지</span>
            <span className="text-lg font-bold font-mono text-cyan-400 tabular-nums">
              {stats.damageDealt}
            </span>
          </div>
        </div>
          </>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-2.5 w-full">
          {rank == null && (
            <button
              onClick={onRestart}
              className={`w-full py-3.5 rounded-full crack-overlay font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2 transition-all hover:scale-102 active:scale-98 shadow-lg cursor-pointer ${
                isVictory
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/30'
                  : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/30'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>다시 대전하기 / 재도전</span>
            </button>
          )}

          <button
            onClick={onReturnToTitle}
            className="w-full py-2.5 rounded-full font-semibold text-xs text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition-colors cursor-pointer"
          >
            홈 (타이틀 화면)으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
};
