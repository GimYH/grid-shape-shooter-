import React, { useEffect } from 'react';
import { Play, Sparkles, Swords, Zap, Code2, Crown, Users, Globe } from 'lucide-react';
import { GameMode } from '../types/game';
import arenaBanner from '../assets/images/cyber_arena_banner_1794503925161.jpg';

interface TitleScreenProps {
  onSelectMode: (mode: GameMode) => void;
  onOpenOnlineModal: () => void;
  onOpenGodotModal: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  onSelectMode,
  onOpenOnlineModal,
  onOpenGodotModal,
}) => {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onSelectMode('single');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onSelectMode]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-md select-none font-['Chakra_Petch'] overflow-hidden">
      {/* Background Cyber Arena Key Art with Ambient Glow */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={arenaBanner}
          alt="Cyber Arena Grid"
          className="w-full h-full object-cover opacity-25 filter blur-[1px] scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-slate-950/90" />
        <div className="absolute inset-0 bg-radial-gradient from-transparent via-slate-950/70 to-slate-950" />
      </div>

      {/* Background ambient neon aura */}
      <div className="absolute w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute w-[400px] h-[400px] bg-rose-500/10 rounded-full blur-[100px] pointer-events-none -translate-y-24" />

      {/* Floating glass shards (shattering motif, decorative only) */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute left-[8%] top-[18%] shard-float opacity-70 drop-shadow-[0_0_12px_rgba(51,204,255,0.5)]">
          <svg width="46" height="46" viewBox="0 0 46 46"><polygon points="23,2 44,32 10,40" fill="rgba(51,204,255,0.35)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" /></svg>
        </div>
        <div className="absolute right-[10%] top-[24%] shard-float-rev opacity-60 drop-shadow-[0_0_12px_rgba(255,51,102,0.5)]" style={{ animationDelay: '-2s' }}>
          <svg width="34" height="34" viewBox="0 0 34 34"><polygon points="17,2 32,26 4,28" fill="rgba(255,51,102,0.3)" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" /></svg>
        </div>
        <div className="absolute left-[16%] bottom-[16%] shard-float-rev opacity-50 drop-shadow-[0_0_10px_rgba(0,255,170,0.5)]" style={{ animationDelay: '-4s' }}>
          <svg width="28" height="28" viewBox="0 0 28 28"><polygon points="14,2 26,22 3,24" fill="rgba(0,255,170,0.3)" stroke="rgba(255,255,255,0.4)" strokeWidth="1" /></svg>
        </div>
        <div className="absolute right-[16%] bottom-[22%] shard-float opacity-60 drop-shadow-[0_0_10px_rgba(255,204,0,0.5)]" style={{ animationDelay: '-1s' }}>
          <svg width="38" height="38" viewBox="0 0 38 38"><polygon points="19,3 35,30 5,33" fill="rgba(255,204,0,0.28)" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" /></svg>
        </div>
        <div className="absolute left-[42%] top-[10%] shard-float opacity-40" style={{ animationDelay: '-3s' }}>
          <svg width="22" height="22" viewBox="0 0 22 22"><polygon points="11,2 20,18 3,19" fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.4)" strokeWidth="1" /></svg>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-4 max-w-3xl">
        {/* Bespoke SVG Title Lockup */}
        <div className="mb-3">
          <svg
            className="w-80 sm:w-96 h-auto drop-shadow-[0_0_25px_rgba(51,204,255,0.6)]"
            viewBox="0 0 400 90"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="neonGrad" x1="0" y1="0" x2="400" y2="90" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#33CCFF" />
                <stop offset="50%" stopColor="#00FFAA" />
                <stop offset="100%" stopColor="#FF3366" />
              </linearGradient>
            </defs>
            <text
              x="200"
              y="45"
              textAnchor="middle"
              className="font-black italic tracking-widest"
              fill="url(#neonGrad)"
              style={{ fontSize: '38px', fontFamily: '"Chakra Petch", sans-serif' }}
            >
              GRID SHAPE
            </text>
            <text
              x="200"
              y="80"
              textAnchor="middle"
              className="font-bold tracking-[0.35em]"
              fill="#FFFFFF"
              style={{ fontSize: '26px', fontFamily: '"Chakra Petch", sans-serif' }}
            >
              SHOOTER
            </text>
            <polygon points="18,42 36,28 46,50 28,60" fill="url(#neonGrad)" opacity="0.55" />
            <polygon points="382,42 364,28 354,50 372,60" fill="url(#neonGrad)" opacity="0.55" />
          </svg>
        </div>

        <div className="inline-flex items-center gap-2 bg-slate-900/80 border border-cyan-500/30 px-3 py-1 rounded-full text-xs font-semibold text-cyan-300 mb-5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          Real-Time 8x4 Grid Action Puzzle · Online 1v1 Link Battles Ready
        </div>

        <p className="text-slate-300 text-xs sm:text-sm max-w-lg leading-relaxed mb-6">
          3칸 이상 연결된 발판을 밟고 거대 형상 투사체를 사출하세요. 대시(Shift)로 적의 탄환을 회피하고, 패가 꼬였을 땐 디스카드(X/E)로 0.7초 만에 바닥을 리로드하여 승리하세요!
        </p>

        {/* 4 Core Game Modes Grid (Local 2P restored) */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5 w-full max-w-3xl mb-6">
          {/* 1. Single Campaign */}
          <button
            onClick={() => onSelectMode('single')}
            className="p-4 rounded-[22px] crack-overlay bg-gradient-to-b from-cyan-500/25 to-slate-950/80 hover:from-cyan-500/40 hover:to-slate-900 border border-cyan-400/60 text-white flex flex-col items-center justify-center shadow-lg shadow-cyan-950/50 hover:scale-105 active:scale-95 transition-all cursor-pointer group"
          >
            <Play className="w-7 h-7 text-cyan-300 group-hover:scale-110 transition-transform mb-1.5 fill-cyan-300/30" />
            <span className="text-sm font-bold tracking-wide">싱글 캠페인</span>
            <span className="text-[11px] text-cyan-300 mt-0.5">5 Stages & Final Boss</span>
          </button>

          {/* 2. Online 1:1 Link Invite Battle (Highlighted!) */}
          <button
            onClick={onOpenOnlineModal}
            className="p-4 rounded-[22px] crack-overlay bg-gradient-to-b from-emerald-500/35 to-cyan-500/20 hover:from-emerald-500/45 hover:to-cyan-500/30 border-2 border-emerald-400 text-white flex flex-col items-center justify-center shadow-xl shadow-emerald-950/70 hover:scale-105 active:scale-95 transition-all cursor-pointer group relative overflow-hidden"
          >
            <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full bg-emerald-400 text-slate-950 font-black text-[9px] uppercase tracking-wider">
              1:1 LINK
            </div>
            <Globe className="w-7 h-7 text-emerald-300 group-hover:scale-110 transition-transform mb-1.5 animate-pulse" />
            <span className="text-sm font-bold tracking-wide text-emerald-300">온라인 1:1 대전</span>
            <span className="text-[11px] text-emerald-400 font-semibold mt-0.5">초대 링크 공유 · 자동 매칭</span>
          </button>

          {/* 3. Local 2-Player Versus (same keyboard) */}
          <button
            onClick={() => onSelectMode('multi')}
            className="p-4 rounded-[22px] crack-overlay bg-gradient-to-b from-amber-500/25 to-slate-950/80 hover:from-amber-500/40 hover:to-slate-900 border border-amber-400/60 text-white flex flex-col items-center justify-center shadow-lg shadow-amber-950/50 hover:scale-105 active:scale-95 transition-all cursor-pointer group"
          >
            <Users className="w-7 h-7 text-amber-300 group-hover:scale-110 transition-transform mb-1.5" />
            <span className="text-sm font-bold tracking-wide">로컬 2인 대전</span>
            <span className="text-[11px] text-amber-300 mt-0.5">1P(WASD) vs 2P(방향키)</span>
          </button>

          {/* 4. Boss Rush */}
          <button
            onClick={() => onSelectMode('boss')}
            className="p-4 rounded-[22px] crack-overlay bg-gradient-to-b from-rose-500/25 to-slate-950/80 hover:from-rose-500/40 hover:to-slate-900 border border-rose-400/60 text-white flex flex-col items-center justify-center shadow-lg shadow-rose-950/50 hover:scale-105 active:scale-95 transition-all cursor-pointer group"
          >
            <Crown className="w-7 h-7 text-rose-400 group-hover:scale-110 transition-transform mb-1.5" />
            <span className="text-sm font-bold tracking-wide">최종 보스전</span>
            <span className="text-[11px] text-rose-300 mt-0.5">OMNI-OVERLORD [HP 200]</span>
          </button>
        </div>

        <button
          onClick={onOpenGodotModal}
          className="mb-5 px-4 py-1.5 rounded-full bg-slate-900/90 hover:bg-slate-800 border border-slate-700 hover:border-cyan-400/50 text-slate-300 font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer"
        >
          <Code2 className="w-3.5 h-3.5 text-cyan-400" />
          <span>Godot 4.x / Steam Engine Specs</span>
        </button>

        {/* User requested Key guide line */}
        <div className="text-xs font-mono text-slate-300 crack-bg bg-slate-900/70 border border-slate-800 px-4 py-2 rounded-full tracking-wider flex flex-wrap items-center justify-center gap-3 gap-y-1 break-keep">
          <span className="whitespace-nowrap"><strong className="text-cyan-400">[방향키/WASD]</strong> 이동</span>
          <span>•</span>
          <span className="whitespace-nowrap"><strong className="text-cyan-300">[Space]</strong> 공격(발사)</span>
          <span>•</span>
          <span className="whitespace-nowrap"><strong className="text-emerald-400">[Shift]</strong> 대시(회피)</span>
          <span>•</span>
          <span className="whitespace-nowrap"><strong className="text-amber-400">[Ctrl]</strong> 스킬</span>
          <span>•</span>
          <span className="whitespace-nowrap"><strong className="text-purple-400">[X/E]</strong> 타일 버리기(0.7s)</span>
        </div>
      </div>
    </div>
  );
};
