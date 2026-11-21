import React from 'react';
import { GameEngine } from '../game/GameEngine';
import { Crosshair, Zap, Wind, Trash2 } from 'lucide-react';

interface MobileJoystickControlsProps {
  engine: GameEngine;
  /** Bottom edge of the 16:9 stage container, in px from the viewport top. */
  stageBottom: number;
}

// Joystick deadzone on stick deflection (matches the gamepad 0.3 style
// threshold, tightened for a thumb stick).
const JOYSTICK_DEADZONE = 0.15;

/**
 * Mobile portrait-only controls. Rendered OUTSIDE the scaled 16:9 stage
 * container, in the letterbox band below the stage, so the buttons stay
 * full-size on a phone instead of shrinking with the stage scale.
 *
 * Left thumb: floating virtual joystick. The base appears where the finger
 * lands; dragging gives an 8-way direction (snapped to 45 degrees) and
 * the drag distance scales movement speed. Releasing returns to center
 * and stops movement. Right thumb: FIRE / SKILL / DASH / DISCARD cluster.
 * Pointer events are tracked per pointerId, so the stick and the buttons
 * work at the same time under multi-touch.
 */
export const MobileJoystickControls: React.FC<MobileJoystickControlsProps> = ({
  engine,
  stageBottom,
}) => {
  const bandRef = React.useRef<HTMLDivElement | null>(null);
  const [bandHeight, setBandHeight] = React.useState(0);
  // Joystick state: base center (zone-relative px) + knob offset.
  const [base, setBase] = React.useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const stickPointerId = React.useRef<number | null>(null);
  const baseRef = React.useRef<{ x: number; y: number } | null>(null);

  // Joystick geometry adapts to the letterbox band height so the stick
  // never overflows a short band (near-square portrait windows).
  const baseR = bandHeight > 0 ? Math.max(44, Math.min(62, (bandHeight - 36) / 2)) : 62;
  const knobR = Math.round(baseR * 0.45);
  const maxDrag = Math.round(baseR * 0.78);

  // Measure the letterbox band height (stage bottom -> viewport bottom).
  React.useEffect(() => {
    const measure = () => {
      if (bandRef.current) {
        setBandHeight(bandRef.current.getBoundingClientRect().height);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stageBottom]);

  // Safety: never leave a stale stick vector behind when the controls hide.
  React.useEffect(() => {
    return () => {
      engine.joystickVector = null;
    };
  }, [engine]);

  const writeVector = React.useCallback(
    (dx: number, dy: number) => {
      const dist = Math.hypot(dx, dy);
      const mag = Math.min(1, dist / maxDrag);
      if (mag < JOYSTICK_DEADZONE) {
        engine.joystickVector = { x: 0, y: 0 };
        return;
      }
      // Snap direction to the nearest of 8 ways (45-degree steps).
      const angle = Math.atan2(dy, dx);
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      engine.joystickVector = {
        x: Math.cos(snapped) * mag,
        y: Math.sin(snapped) * mag,
      };
    },
    [engine, maxDrag]
  );

  const onStickDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerId.current !== null) return; // one stick finger at a time
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    stickPointerId.current = e.pointerId;
    baseRef.current = p;
    setBase(p);
    setKnob({ x: 0, y: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onStickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickPointerId.current || !baseRef.current) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    let dx = e.clientX - rect.left - baseRef.current.x;
    let dy = e.clientY - rect.top - baseRef.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxDrag) {
      dx = (dx / dist) * maxDrag;
      dy = (dy / dist) * maxDrag;
    }
    setKnob({ x: dx, y: dy });
    writeVector(dx, dy);
  };

  const endStick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stickPointerId.current) return;
    stickPointerId.current = null;
    baseRef.current = null;
    setBase(null);
    setKnob({ x: 0, y: 0 });
    engine.joystickVector = null;
  };

  const dashReady = engine.player.dashCooldownRemaining <= 0;
  const skillReady = engine.player.skillCooldownRemaining <= 0;

  return (
    <div
      ref={bandRef}
      className="absolute left-0 right-0 z-20 select-none font-['Chakra_Petch']"
      style={{ top: stageBottom, bottom: 0, touchAction: 'none' }}
    >
      {/* Hint line */}
      <div className="absolute top-1 left-0 right-0 text-center pointer-events-none">
        <span className="text-[11px] font-semibold text-slate-500 tracking-wide">
          왼쪽 조그로 이동 · 오른쪽 버튼으로 공격
        </span>
      </div>

      <div className="absolute inset-0 flex items-stretch justify-between px-3 pb-3 pt-6">
        {/* Left thumb: floating virtual joystick */}
        <div
          className="relative flex-1"
          style={{ touchAction: 'none' }}
          onPointerDown={onStickDown}
          onPointerMove={onStickMove}
          onPointerUp={endStick}
          onPointerCancel={endStick}
          onContextMenu={(e) => e.preventDefault()}
        >
          {base === null && (
            <div
              className="absolute rounded-full border-2 border-dashed border-cyan-500/40 bg-slate-950/40 flex items-center justify-center"
              style={{
                width: baseR * 2,
                height: baseR * 2,
                left: 8,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            >
              <span className="text-[11px] font-bold text-cyan-400/70">조그</span>
            </div>
          )}
          {base !== null && (
            <>
              <div
                className="absolute rounded-full border-2 border-cyan-500/60 bg-slate-950/50"
                style={{
                  width: baseR * 2,
                  height: baseR * 2,
                  left: base.x - baseR,
                  top: base.y - baseR,
                }}
              />
              <div
                className="absolute rounded-full bg-cyan-400 shadow-lg shadow-cyan-500/50 border-2 border-cyan-200"
                style={{
                  width: knobR * 2,
                  height: knobR * 2,
                  left: base.x + knob.x - knobR,
                  top: base.y + knob.y - knobR,
                }}
              />
            </>
          )}
        </div>

        {/* Right thumb: action cluster */}
        <div className="flex items-end gap-2.5 pb-1" style={{ touchAction: 'none' }}>
          {/* Discard (3-stack magazine) */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              engine.handlePlayerDiscard(1);
            }}
            onContextMenu={(e) => e.preventDefault()}
            className="w-14 h-14 min-w-14 min-h-14 rounded-full bg-purple-500/25 border border-purple-400/80 flex flex-col items-center justify-center text-purple-300 shadow-lg shadow-purple-950/50 active:scale-95 transition-all cursor-pointer"
            aria-label="타일 버리기"
          >
            <Trash2 className="w-5 h-5" />
            <span className="text-[9px] font-bold mt-0.5">버리기 {engine.player.discardStacks}/3</span>
          </button>

          {/* Dash */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              engine.handlePlayerDash(1);
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-14 h-14 min-w-14 min-h-14 rounded-full flex flex-col items-center justify-center border transition-all active:scale-95 cursor-pointer ${
              dashReady
                ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300 shadow-lg shadow-emerald-950/60'
                : 'bg-slate-900/60 border-slate-700 text-slate-400'
            }`}
            aria-label="대시"
          >
            <Wind className="w-5 h-5" />
            <span className="text-[9px] font-bold mt-0.5">
              {dashReady ? '대시' : `${engine.player.dashCooldownRemaining.toFixed(1)}초`}
            </span>
          </button>

          {/* Skill */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              engine.handlePlayerSkill(1);
            }}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-16 h-16 min-w-16 min-h-16 rounded-full flex flex-col items-center justify-center border transition-all active:scale-95 cursor-pointer ${
              skillReady
                ? 'bg-amber-500/25 border-amber-400 text-amber-300 shadow-lg shadow-amber-950/50'
                : 'bg-slate-900/60 border-slate-700 text-slate-400'
            }`}
            aria-label="스킬"
          >
            <Zap className="w-6 h-6" />
            <span className="text-[10px] font-bold mt-0.5">
              {skillReady ? '스킬' : `${engine.player.skillCooldownRemaining.toFixed(1)}초`}
            </span>
          </button>

          {/* Launch (largest) */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              engine.handlePlayerLaunch(1);
            }}
            onContextMenu={(e) => e.preventDefault()}
            className="w-20 h-20 min-w-20 min-h-20 rounded-2xl bg-gradient-to-b from-cyan-400 to-cyan-600 text-slate-950 font-black flex flex-col items-center justify-center shadow-xl shadow-cyan-500/50 active:scale-95 transition-all cursor-pointer border border-cyan-200"
            aria-label="발사"
          >
            <Crosshair className="w-8 h-8 text-slate-950 animate-pulse" />
            <span className="text-xs font-black mt-0.5 tracking-wider">발사</span>
          </button>
        </div>
      </div>
    </div>
  );
};
