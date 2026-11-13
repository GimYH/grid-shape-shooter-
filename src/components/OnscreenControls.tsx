import React from 'react';
import { GameEngine } from '../game/GameEngine';
import { Crosshair, Zap, Wind, Trash2, Smartphone, Eye, EyeOff } from 'lucide-react';

interface OnscreenControlsProps {
  engine: GameEngine;
}

export const OnscreenControls: React.FC<OnscreenControlsProps> = ({ engine }) => {
  const [activeDirs, setActiveDirs] = React.useState<Record<string, boolean>>({});
  const [showControls, setShowControls] = React.useState<boolean>(() => {
    // Auto-enable if touch screen detected or mobile viewport
    if (typeof window !== 'undefined') {
      return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 1024;
    }
    return false;
  });

  const handleDirStart = (code: string) => {
    engine.keys[code] = true;
    setActiveDirs((prev) => ({ ...prev, [code]: true }));
  };

  const handleDirEnd = (code: string) => {
    engine.keys[code] = false;
    setActiveDirs((prev) => ({ ...prev, [code]: false }));
  };

  const dashReady = engine.player.dashCooldownRemaining <= 0;

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-20 font-['Chakra_Petch']">
      {/* On-screen Controls Toggle Button (Top Right corner) */}
      <div className="absolute top-3 right-4 pointer-events-auto">
        <button
          onClick={() => setShowControls((prev) => !prev)}
          title={showControls ? '가상 터치 버튼 숨기기' : '가상 터치 버튼 켜기'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-md border transition-all cursor-pointer ${
            showControls
              ? 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300 shadow-md shadow-cyan-950/60'
              : 'bg-slate-950/70 border-slate-700/60 text-slate-400 hover:text-white'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>{showControls ? 'TOUCH: ON' : 'TOUCH: OFF'}</span>
          {showControls ? <Eye className="w-3 h-3 text-cyan-400" /> : <EyeOff className="w-3 h-3 text-slate-500" />}
        </button>
      </div>

      {showControls && (
        <>
          {/* Mobile Virtual D-Pad (Bottom Left) - lifted cleanly above bottom edge */}
          <div className="absolute bottom-5 left-5 pointer-events-auto flex flex-col items-center gap-1.5 p-2 bg-slate-950/80 backdrop-blur-md border border-cyan-500/30 rounded-2xl shadow-xl shadow-cyan-950/50">
            <button
              onTouchStart={() => handleDirStart('KeyW')}
              onTouchEnd={() => handleDirEnd('KeyW')}
              onMouseDown={() => handleDirStart('KeyW')}
              onMouseUp={() => handleDirEnd('KeyW')}
              className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg border cursor-pointer active:scale-95 transition-all ${
                activeDirs['KeyW']
                  ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-md shadow-cyan-400/50'
                  : 'bg-slate-900/90 text-cyan-400 border-cyan-500/40 hover:bg-slate-800'
              }`}
            >
              ▲
            </button>
            <div className="flex gap-2">
              <button
                onTouchStart={() => handleDirStart('KeyA')}
                onTouchEnd={() => handleDirEnd('KeyA')}
                onMouseDown={() => handleDirStart('KeyA')}
                onMouseUp={() => handleDirEnd('KeyA')}
                className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg border cursor-pointer active:scale-95 transition-all ${
                  activeDirs['KeyA']
                    ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-md shadow-cyan-400/50'
                    : 'bg-slate-900/90 text-cyan-400 border-cyan-500/40 hover:bg-slate-800'
                }`}
              >
                ◀
              </button>
              <button
                onTouchStart={() => handleDirStart('KeyS')}
                onTouchEnd={() => handleDirEnd('KeyS')}
                onMouseDown={() => handleDirStart('KeyS')}
                onMouseUp={() => handleDirEnd('KeyS')}
                className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg border cursor-pointer active:scale-95 transition-all ${
                  activeDirs['KeyS']
                    ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-md shadow-cyan-400/50'
                    : 'bg-slate-900/90 text-cyan-400 border-cyan-500/40 hover:bg-slate-800'
                }`}
              >
                ▼
              </button>
              <button
                onTouchStart={() => handleDirStart('KeyD')}
                onTouchEnd={() => handleDirEnd('KeyD')}
                onMouseDown={() => handleDirStart('KeyD')}
                onMouseUp={() => handleDirEnd('KeyD')}
                className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg border cursor-pointer active:scale-95 transition-all ${
                  activeDirs['KeyD']
                    ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-md shadow-cyan-400/50'
                    : 'bg-slate-900/90 text-cyan-400 border-cyan-500/40 hover:bg-slate-800'
                }`}
              >
                ▶
              </button>
            </div>
          </div>

          {/* Mobile Action Buttons (Bottom Right): Dash, Discard, Skill, Launch */}
          <div className="absolute bottom-5 right-5 pointer-events-auto flex items-end gap-2.5 p-2 bg-slate-950/80 backdrop-blur-md border border-cyan-500/30 rounded-2xl shadow-xl shadow-cyan-950/50">
            {/* Dash Button */}
            <button
              onClick={() => engine.handlePlayerDash(1)}
              className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center border transition-all active:scale-95 cursor-pointer ${
                dashReady
                  ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300 shadow-lg shadow-emerald-950/60'
                  : 'bg-slate-900/60 border-slate-700 text-slate-500'
              }`}
            >
              <Wind className="w-5 h-5" />
              <span className="text-[9px] font-bold mt-0.5 font-mono">
                {dashReady ? '[Shift]' : `${engine.player.dashCooldownRemaining.toFixed(1)}s`}
              </span>
            </button>

            {/* Discard Button (Fast 0.7s Reload) */}
            <button
              onClick={() => engine.handlePlayerDiscard(1)}
              className="w-14 h-14 rounded-xl bg-purple-500/25 hover:bg-purple-500/40 border border-purple-400/80 flex flex-col items-center justify-center text-purple-300 shadow-lg shadow-purple-950/50 active:scale-95 transition-all cursor-pointer"
            >
              <Trash2 className="w-5 h-5" />
              <span className="text-[9px] font-bold mt-0.5">[X] FLUSH</span>
            </button>

            {/* Skill Button */}
            <button
              onClick={() => engine.handlePlayerSkill(1)}
              className="w-16 h-16 rounded-xl bg-amber-500/25 hover:bg-amber-500/45 border border-amber-400/80 flex flex-col items-center justify-center text-amber-300 shadow-lg shadow-amber-950/50 active:scale-95 transition-all cursor-pointer"
            >
              <Zap className="w-6 h-6" />
              <span className="text-[10px] font-bold mt-0.5">[Ctrl] SKILL</span>
            </button>

            {/* Launch Fire Button */}
            <button
              onClick={() => engine.handlePlayerLaunch(1)}
              className="w-18 h-18 px-3 rounded-xl bg-gradient-to-b from-cyan-400 to-cyan-600 hover:from-cyan-300 hover:to-cyan-500 text-slate-950 font-black flex flex-col items-center justify-center shadow-xl shadow-cyan-500/50 active:scale-95 transition-all cursor-pointer border border-cyan-200"
            >
              <Crosshair className="w-8 h-8 text-slate-950 animate-pulse" />
              <span className="text-xs font-black mt-0.5 tracking-wider">[Space] FIRE</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

