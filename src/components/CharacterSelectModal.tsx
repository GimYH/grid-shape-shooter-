import React, { useState } from 'react';
import { ARCHETYPE_LIST } from '../game/archetypes';
import { ArchetypeId, GameMode } from '../types/game';
import { STAGES } from '../game/stages';
import { Swords, Shield, Zap, Crosshair, Play, Sparkles, Check, ArrowRight } from 'lucide-react';
import { ARCHETYPE_PORTRAITS } from '../assets/portraits';

interface CharacterSelectModalProps {
  isOpen: boolean;
  gameMode: GameMode;
  stageNum: number;
  onDeploy: (p1Archetype: ArchetypeId, p2Archetype: ArchetypeId) => void;
  onClose: () => void;
}

export const CharacterSelectModal: React.FC<CharacterSelectModalProps> = ({
  isOpen,
  gameMode,
  stageNum,
  onDeploy,
  onClose,
}) => {
  const [selectedP1, setSelectedP1] = useState<ArchetypeId>('lancer');
  const [selectedP2, setSelectedP2] = useState<ArchetypeId>('wave');
  const [activeTab, setActiveTab] = useState<'p1' | 'p2'>('p1');

  if (!isOpen) return null;

  const currentConfig = ARCHETYPE_LIST.find((a) => a.id === (activeTab === 'p1' ? selectedP1 : selectedP2)) || ARCHETYPE_LIST[0];
  const stageInfo = STAGES[Math.min(stageNum - 1, STAGES.length - 1)];

  const handleConfirm = () => {
    onDeploy(selectedP1, selectedP2);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 font-['Chakra_Petch'] select-none">
      <div className="crack-bg bg-slate-900 border border-cyan-500/50 rounded-[28px] max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl shadow-cyan-950/80 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
              <h2 className="text-lg font-bold text-white tracking-wide uppercase">
                OPERATOR ARCHETYPE SELECTION
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {gameMode === 'single'
                ? `CAMPAIGN MISSION · ${stageInfo?.nameKo} (STAGE ${stageNum}/5)`
                : gameMode === 'boss'
                ? 'BOSS RUSH · OMNI-OVERLORD FINAL SHOWDOWN'
                : 'LOCAL 2-PLAYER VERSUS DUEL (P1 VS P2)'}
            </p>
          </div>

          {gameMode === 'multi' && (
            <div className="flex bg-slate-950 p-1 rounded-full border border-slate-800">
              <button
                onClick={() => setActiveTab('p1')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  activeTab === 'p1'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                P1 (Bottom Grid)
              </button>
              <button
                onClick={() => setActiveTab('p2')}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  activeTab === 'p2'
                    ? 'bg-rose-500 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                P2 (Top Grid)
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 p-6 overflow-y-auto">
          {/* Left Column: Archetypes Grid (7 Cards) */}
          <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ARCHETYPE_LIST.map((arch) => {
              const isSelected = (activeTab === 'p1' ? selectedP1 : selectedP2) === arch.id;
              return (
                <button
                  key={arch.id}
                  onClick={() => {
                    if (activeTab === 'p1') setSelectedP1(arch.id);
                    else setSelectedP2(arch.id);
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all relative overflow-hidden flex flex-col justify-between sm:last:col-span-2 ${
                    isSelected
                      ? 'bg-slate-950 border-cyan-400 shadow-md shadow-cyan-500/30 scale-[1.02]'
                      : 'bg-slate-950/60 hover:bg-slate-800/60 border-slate-800'
                  }`}
                >
                  {/* Accent Line */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: arch.color }}
                  />

                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-bold text-white block">{arch.nameKo}</span>
                      <span className="text-[10px] text-slate-400 tracking-wider uppercase font-mono">
                        {arch.name}
                      </span>
                    </div>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
                      style={{ backgroundColor: `${arch.color}25`, color: arch.color }}
                    >
                      {arch.badge}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 leading-tight line-clamp-2">
                    {arch.title}
                  </p>

                  <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
                    <span className="text-slate-400">Skill CD:</span>
                    <span className="font-mono font-bold text-amber-300">
                      {arch.skillCooldown}s
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Column: Detailed Inspector Card */}
          <div className="md:col-span-5 crack-bg bg-slate-950 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <img
                  src={ARCHETYPE_PORTRAITS[currentConfig.id]}
                  alt={currentConfig.nameKo}
                  className="w-14 h-14 rounded-2xl object-cover border-2 shadow-lg"
                  style={{ borderColor: currentConfig.color }}
                />
                <div>
                  <h3 className="text-lg font-bold text-white">{currentConfig.nameKo}</h3>
                  <span className="text-xs text-cyan-400 tracking-wider font-semibold">
                    {currentConfig.title}
                  </span>
                </div>
              </div>

              {/* Passive Description */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 mb-3">
                <span className="text-[11px] font-bold text-cyan-400 tracking-wider flex items-center gap-1 mb-1">
                  <Shield className="w-3.5 h-3.5" />
                  PASSIVE TRAIT
                </span>
                <p className="text-xs text-slate-200 leading-relaxed break-keep text-pretty">
                  {currentConfig.passiveDesc}
                </p>
              </div>

              {/* Active Skill Description */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-amber-400 tracking-wider flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" />
                    [Ctrl] ACTIVE SKILL
                  </span>
                  <span className="text-xs font-mono font-bold text-amber-300">
                    CD {currentConfig.skillCooldown}s
                  </span>
                </div>
                <h4 className="text-xs font-bold text-white mb-1">{currentConfig.skillName}</h4>
                <p className="text-xs text-slate-300 leading-relaxed break-keep text-pretty">
                  {currentConfig.skillDesc}
                </p>
              </div>

              {/* Discard Tip */}
              <div className="text-[11px] text-slate-400 bg-cyan-950/30 border border-cyan-800/40 rounded-2xl p-2.5 break-keep text-pretty">
                <span className="font-bold text-cyan-300">💡 DISCARD 전술: </span>
                패가 꼬였을 때 <kbd className="px-1 py-0.5 bg-slate-800 text-white rounded font-mono">[X]</kbd> 또는 <kbd className="px-1 py-0.5 bg-slate-800 text-white rounded font-mono">[E]</kbd> 키를 누르면 0.7초 만에 발밑 타일을 빠르게 버리고 새 타일을 뽑을 수 있습니다.
              </div>
            </div>

            {/* Launch CTA */}
            <div className="mt-5 pt-4 border-t border-slate-800 flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-3 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 py-3 rounded-full crack-overlay bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 transition-all hover:scale-102 active:scale-98 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Deploy Operator</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
