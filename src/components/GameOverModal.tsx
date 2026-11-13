import React from 'react';
import { GameStats } from '../types/game';
import { RotateCcw, Trophy, Skull, Zap, Swords } from 'lucide-react';

interface GameOverModalProps {
  status: 'victory' | 'defeat';
  stats: GameStats;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({ status, stats, onRestart, onReturnToTitle }) => {
  const isVictory = status === 'victory';

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
        <p className="text-xs text-slate-400 mb-6">
          {isVictory
            ? '상대 진영을 격파하고 그리드 지배권을 확보했습니다.'
            : '플레이어 HP가 소진되었습니다. 다시 도전하거나 전술을 재정비하세요.'}
        </p>

        {/* Battle Stats Grid */}
        <div className="grid grid-cols-2 gap-3 w-full mb-6 text-left">
          <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
            <span className="text-[11px] text-slate-400 block mb-0.5">DAMAGE DEALT</span>
            <span className="text-xl font-bold font-mono text-cyan-400 tabular-nums">
              {stats.damageDealt}
            </span>
          </div>

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

        {/* Buttons */}
        <div className="flex flex-col gap-2.5 w-full">
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
