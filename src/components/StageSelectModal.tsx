import React, { useEffect, useState } from 'react';
import { Lock, Check, Trophy, Crown, X, ChevronRight } from 'lucide-react';
import { STAGES, SECTOR_NAMES } from '../game/stages';
import { ARCHETYPES } from '../game/archetypes';
import { loadCampaignProgress, formatClearTime } from '../game/campaign';
import { CampaignProgress } from '../types/game';

interface StageSelectModalProps {
  isOpen: boolean;
  onSelectStage: (stage: number) => void;
  onClose: () => void;
}

export const StageSelectModal: React.FC<StageSelectModalProps> = ({
  isOpen,
  onSelectStage,
  onClose,
}) => {
  const [sector, setSector] = useState<number>(1);
  const [progress, setProgress] = useState<CampaignProgress>({ maxCleared: 0, noContinue: null });

  useEffect(() => {
    if (isOpen) {
      const p = loadCampaignProgress();
      setProgress(p);
      // Open on the sector of the next stage to clear.
      const next = Math.min(p.maxCleared + 1, 30);
      setSector(STAGES[next - 1].sector);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const stages = STAGES.filter((s) => s.sector === sector);
  const highestUnlocked = progress.maxCleared + 1;

  return (
    <div className="absolute inset-0 z-40 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 font-['Chakra_Petch'] select-none">
      <div className="crack-bg bg-slate-900 border border-cyan-500/60 rounded-[28px] p-6 sm:p-8 max-w-2xl w-full shadow-2xl shadow-cyan-950/70 flex flex-col items-center text-center max-h-[92%] overflow-y-auto">
        <div className="flex items-center justify-between w-full mb-1">
          <h2 className="text-2xl sm:text-3xl font-black tracking-wider uppercase text-white">
            STAGE SELECT
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-slate-300 mb-4">
          스테이지를 선택해 바로 도전하세요. 클리어한 다음 스테이지까지 해금됩니다.
        </p>

        {/* No-continue badge */}
        {progress.noContinue && (
          <div className="w-full flex items-center justify-center gap-2 mb-4 px-3 py-2 rounded-2xl bg-amber-500/15 border border-amber-400/60 text-amber-300 text-xs font-bold">
            <Trophy className="w-4 h-4" />
            <span>노컨티뉴 클리어 달성! (1~30스테이지 · {formatClearTime(progress.noContinue.timeSec)})</span>
          </div>
        )}

        {/* Sector tabs */}
        <div className="flex gap-2 w-full mb-4">
          {[1, 2, 3, 4, 5].map((n) => {
            const clearedInSector = STAGES.filter((s) => s.sector === n && s.id <= progress.maxCleared).length;
            return (
              <button
                key={n}
                onClick={() => setSector(n)}
                className={`flex-1 py-2 rounded-2xl text-xs font-bold transition-all cursor-pointer border ${
                  sector === n
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                    : 'bg-slate-950/80 text-slate-300 border-slate-800 hover:border-cyan-500/50'
                }`}
              >
                <span className="block">섹터 {n}</span>
                <span className="block text-[10px] font-semibold opacity-80">{SECTOR_NAMES[n]}</span>
                <span className="block text-[10px] font-mono opacity-70">{clearedInSector}/6 클리어</span>
              </button>
            );
          })}
        </div>

        {/* Stage list */}
        <div className="flex flex-col gap-2.5 w-full">
          {stages.map((s) => {
            const unlocked = s.id <= highestUnlocked;
            const cleared = s.id <= progress.maxCleared;
            return (
              <button
                key={s.id}
                disabled={!unlocked}
                onClick={() => onSelectStage(s.id)}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                  !unlocked
                    ? 'bg-slate-950/50 border-slate-800 opacity-50 cursor-not-allowed'
                    : s.isFinalBoss
                    ? 'bg-rose-950/40 border-rose-500/60 hover:border-rose-400 cursor-pointer hover:scale-[1.01]'
                    : s.isSectorBoss
                    ? 'bg-purple-950/40 border-purple-500/60 hover:border-purple-400 cursor-pointer hover:scale-[1.01]'
                    : 'bg-slate-950/80 border-slate-800 hover:border-cyan-400/60 cursor-pointer hover:scale-[1.01]'
                }`}
              >
                <span
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-base shrink-0 ${
                    s.isFinalBoss
                      ? 'bg-rose-500/20 text-rose-300'
                      : s.isSectorBoss
                      ? 'bg-purple-500/20 text-purple-300'
                      : 'bg-cyan-500/15 text-cyan-300'
                  }`}
                >
                  {s.id}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white break-keep">{s.nameKo}</span>
                    {s.isFinalBoss && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-rose-500 text-white flex items-center gap-0.5">
                        <Crown className="w-3 h-3" /> 최종 보스
                      </span>
                    )}
                    {s.isSectorBoss && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-purple-500 text-white">
                        섹터 보스
                      </span>
                    )}
                    {cleared && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 flex items-center gap-0.5">
                        <Check className="w-3 h-3" /> 클리어
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-0.5 break-keep">{s.desc}</span>
                  <span className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {s.archetypes.length === 0 ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">
                        기본 AI
                      </span>
                    ) : s.archetypes.length === 7 ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/50">
                        7종 통합
                      </span>
                    ) : (
                      s.archetypes.map((a) => (
                        <span
                          key={a}
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
                          style={{
                            backgroundColor: `${ARCHETYPES[a].color}25`,
                            color: ARCHETYPES[a].color,
                          }}
                        >
                          {ARCHETYPES[a].nameKo}
                        </span>
                      ))
                    )}
                    <span className="text-[10px] text-slate-400 font-mono">
                      HP {s.hp} · 코어 {s.coreHp} · 난이도 {s.aiLevel}
                    </span>
                  </span>
                </span>
                {unlocked ? (
                  <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
                ) : (
                  <Lock className="w-5 h-5 text-slate-500 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-400 mt-4 break-keep">
          1~30스테이지를 패배 없이 연속 클리어하면 노컨티뉴 배지와 클리어 타임이 기록됩니다.
        </p>
      </div>
    </div>
  );
};
