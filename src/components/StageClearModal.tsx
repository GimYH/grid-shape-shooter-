import React from 'react';
import { GameStats } from '../types/game';
import { STAGES } from '../game/stages';
import { Trophy, ArrowRight, RotateCcw, Sparkles, Skull, Swords } from 'lucide-react';

interface StageClearModalProps {
  stageNum: number;
  stats: GameStats;
  onNextStage: () => void;
  onRestartCampaign: () => void;
  onReturnToTitle: () => void;
}

export const StageClearModal: React.FC<StageClearModalProps> = ({
  stageNum,
  stats,
  onNextStage,
  onRestartCampaign,
  onReturnToTitle,
}) => {
  const isFinalBossBeaten = stageNum >= 5;
  const nextStageInfo = STAGES[Math.min(stageNum, STAGES.length - 1)];

  return (
    <div className="absolute inset-0 z-40 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 font-['Chakra_Petch'] select-none">
      <div className="bg-slate-900 border border-emerald-500/60 rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl shadow-emerald-950/70 flex flex-col items-center text-center">
        {/* Header Icon */}
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/30">
          <Trophy className="w-8 h-8" />
        </div>

        <h2 className="text-2xl sm:text-3xl font-black tracking-wider uppercase text-white mb-1">
          {isFinalBossBeaten ? 'CAMPAIGN CONQUERED!' : `STAGE ${stageNum} CLEARED!`}
        </h2>

        <p className="text-xs text-slate-300 mb-6">
          {isFinalBossBeaten
            ? 'Omni-Overlord 최종 보스를 격파하였습니다! 전설적인 승리를 축하합니다!'
            : `적 방어선을 돌파하였습니다. 스테이지 ${stageNum + 1}로 진격할 준비가 되었습니다.`}
        </p>

        {/* Next Stage Warning / Preview */}
        {!isFinalBossBeaten && nextStageInfo && (
          <div
            className={`w-full p-3.5 rounded-xl border mb-6 text-left ${
              nextStageInfo.isBoss
                ? 'bg-rose-950/40 border-rose-500/60 shadow-lg shadow-rose-950/50'
                : 'bg-slate-950/80 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                className={`text-[11px] font-bold tracking-wider ${
                  nextStageInfo.isBoss ? 'text-rose-400' : 'text-cyan-400'
                }`}
              >
                {nextStageInfo.isBoss ? '⚠️ WARNING: NEXT IS FINAL BOSS' : 'NEXT TARGET ASSIGNMENT'}
              </span>
              <span className="text-xs font-mono font-bold text-amber-300">
                HP {nextStageInfo.enemyHp}
              </span>
            </div>
            <h3 className="text-sm font-bold text-white mb-1">{nextStageInfo.nameKo}</h3>
            <p className="text-xs text-slate-300 leading-snug">{nextStageInfo.desc}</p>
          </div>
        )}

        {/* Stage Stats Summary */}
        <div className="grid grid-cols-2 gap-2.5 w-full mb-6 text-left">
          <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-slate-400 block">DAMAGE DEALT</span>
            <span className="text-base font-bold font-mono text-cyan-400 tabular-nums">
              {stats.damageDealt}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-slate-400 block">SHAPES LAUNCHED</span>
            <span className="text-base font-bold font-mono text-amber-400 tabular-nums">
              {stats.shapesLaunched}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-slate-400 block">TILES DISCARDED</span>
            <span className="text-base font-bold font-mono text-purple-400 tabular-nums">
              {stats.tilesDiscarded || 0}
            </span>
          </div>

          <div className="bg-slate-950/80 border border-slate-800 p-2.5 rounded-lg">
            <span className="text-[10px] text-slate-400 block">MAX CLUSTER SIZE</span>
            <span className="text-base font-bold font-mono text-emerald-400 tabular-nums">
              {stats.maxClusterSize} TILES
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-2.5 w-full">
          {!isFinalBossBeaten ? (
            <button
              onClick={onNextStage}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-400 hover:from-emerald-400 hover:to-cyan-300 text-slate-950 font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30 transition-all hover:scale-102 active:scale-98 cursor-pointer"
            >
              <span>다음 스테이지 ({stageNum + 1})로 이동</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onRestartCampaign}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-400 hover:from-amber-400 hover:to-rose-300 text-slate-950 font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg shadow-amber-500/30 transition-all hover:scale-102 active:scale-98 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>캠페인 처음부터 다시하기</span>
            </button>
          )}

          <button
            onClick={onReturnToTitle}
            className="w-full py-2.5 rounded-xl font-semibold text-xs text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 transition-colors cursor-pointer"
          >
            홈 (타이틀 화면)으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
};
