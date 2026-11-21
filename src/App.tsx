import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameEngine, GameStatus } from './game/GameEngine';
import { GameHUD } from './components/GameHUD';
import { RoyaleHUD } from './components/RoyaleHUD';
import { RoyalePlayerInfo } from './game/royale';
import { TitleScreen } from './components/TitleScreen';
import { GameOverModal } from './components/GameOverModal';
import { StageClearModal } from './components/StageClearModal';
import { StageSelectModal } from './components/StageSelectModal';
import { CharacterSelectModal } from './components/CharacterSelectModal';
import { OnlineRoomModal } from './components/OnlineRoomModal';
import { GodotExportModal } from './components/GodotExportModal';
import { OnscreenControls } from './components/OnscreenControls';
import { MobileJoystickControls } from './components/MobileJoystickControls';
import { ArchetypeId, GameMode } from './types/game';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameStatus, setGameStatus] = useState<GameStatus>('title');
  const [selectedMode, setSelectedMode] = useState<GameMode>('single');
  const [stageNum, setStageNum] = useState<number>(1);
  const [showGodotModal, setShowGodotModal] = useState<boolean>(false);
  const [showCharSelect, setShowCharSelect] = useState<boolean>(false);
  const [showStageSelect, setShowStageSelect] = useState<boolean>(false);
  const [showOnlineModal, setShowOnlineModal] = useState<boolean>(false);
  const [onlineModalMode, setOnlineModalMode] = useState<'duel' | 'royale'>('duel');
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');
  const [, setTick] = useState(0);

  // Check URL query parameters for invite link ?room=CODE[&mode=royale]
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam) {
        setInitialRoomCode(roomParam.toUpperCase());
        setOnlineModalMode(params.get('mode') === 'royale' ? 'royale' : 'duel');
        setShowOnlineModal(true);
      }
    } catch {
      // Ignore
    }
  }, []);

  // Initialize GameEngine once
  useEffect(() => {
    const engine = new GameEngine(() => {
      setGameStatus(engine.status);
      setStageNum(engine.currentStage);
      setTick((t) => (t + 1) % 1000);
    });
    engineRef.current = engine;

    if (canvasRef.current) {
      engine.init(canvasRef.current);
    }

    return () => {
      engine.destroy();
    };
  }, []);

  // 16:9 Responsive scale calculation
  const [scale, setScale] = useState(1);
  // Mobile portrait joystick: shown only when the viewport is taller than
  // wide (ratio only, touch device or not). Rotations/resizes switch it
  // immediately. stageBottom is the measured bottom edge of the 16:9
  // stage container, used to park the controls in the letterbox band
  // below the stage instead of on top of the canvas.
  const [isPortrait, setIsPortrait] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth
  );
  const [stageBottom, setStageBottom] = useState(0);
  // Temporary portrait scroll-down: on phones the 100vh container can be
  // taller than the visible viewport (browser toolbar), so the joystick
  // band's bottom is clipped and the page can't scroll (overflow-hidden).
  // The button shifts the stage + band up by the hidden amount.
  const [scrollShift, setScrollShift] = useState(0);
  const [scrollOverflow, setScrollOverflow] = useState(0);

  useEffect(() => {
    const measureOverflow = () => {
      const containerH =
        containerRef.current?.getBoundingClientRect().height ?? window.innerHeight;
      const visibleH = window.visualViewport?.height ?? window.innerHeight;
      const overflow = Math.max(0, Math.round(containerH - visibleH));
      setScrollOverflow(overflow);
      if (overflow === 0) setScrollShift(0);
    };

    const handleResize = () => {
      if (!containerRef.current) return;
      const windowW = window.innerWidth;
      const windowH = window.innerHeight;

      const targetW = 1920;
      const targetH = 1080;

      const scaleX = windowW / targetW;
      const scaleY = windowH / targetH;
      const nextScale = Math.min(scaleX, scaleY);
      setScale(nextScale);
      setIsPortrait(windowH > windowW);
      if (windowH <= windowW) setScrollShift(0);
      measureOverflow();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', measureOverflow);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', measureOverflow);
    };
  }, []);

  // Measure the stage container's actual position (transform-aware) so
  // the mobile controls sit in the real letterbox band below it.
  // Skip while shifted: getBoundingClientRect would return the shifted
  // bottom and feed back into the band position.
  useEffect(() => {
    if (scrollShift > 0) return;
    const measure = () => {
      if (stageRef.current) {
        setStageBottom(stageRef.current.getBoundingClientRect().bottom);
      }
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [scale, isPortrait, gameStatus, scrollShift]);

  // A stale shift must never offset the title screen or result modals.
  useEffect(() => {
    if (gameStatus !== 'playing' && gameStatus !== 'paused') setScrollShift(0);
  }, [gameStatus]);

  const handleSelectMode = (mode: GameMode) => {
    setSelectedMode(mode);
    if (mode === 'single') {
      // v2.3: pick a stage first (unlocked stages only), then a character.
      setShowStageSelect(true);
      return;
    }
    setStageNum(mode === 'boss' ? 30 : 1);
    setShowCharSelect(true);
  };

  const handleSelectStage = (stage: number) => {
    setStageNum(stage);
    setShowStageSelect(false);
    setShowCharSelect(true);
  };

  const handleRestartCampaign = () => {
    setSelectedMode('single');
    setStageNum(1);
    setShowCharSelect(true);
  };

  const handleDeployCharacter = (p1Arch: ArchetypeId, p2Arch: ArchetypeId) => {
    setShowCharSelect(false);
    engineRef.current?.startGame(selectedMode, stageNum, p1Arch, p2Arch);
    setGameStatus('playing');
  };

  // Stable identity on purpose: OnlineRoomModal's effect depends on this
  // callback, and a fresh function every App render would make the modal
  // re-register its network handlers mid-battle, overwriting the engine's
  // onPeerLeft handler. With useCallback the modal registers once.
  const handleStartOnlineBattle = useCallback(
    (
      role: 'p1' | 'p2',
      roomCode: string,
      p1Arch: ArchetypeId,
      p2Arch: ArchetypeId,
      seed: number = Date.now()
    ) => {
      setShowOnlineModal(false);
      engineRef.current?.startOnlineGame(role, roomCode, p1Arch, p2Arch, seed);
      setGameStatus('playing');
    },
    []
  );

  // GRID ROYALE (v2.4): same stability requirement as the duel callback —
  // OnlineRoomModal's effect depends on it.
  const handleStartRoyaleBattle = useCallback(
    (players: RoyalePlayerInfo[], myId: string, seed: number) => {
      setShowOnlineModal(false);
      engineRef.current?.startRoyaleGame(players, myId, seed);
      setGameStatus('playing');
    },
    []
  );

  const handleNextStage = () => {
    engineRef.current?.advanceToNextStage();
    setStageNum(engineRef.current?.currentStage || 1);
    setGameStatus('playing');
  };

  const handleTogglePause = () => {
    if (!engineRef.current) return;
    // togglePause() itself blocks pausing during online battles.
    engineRef.current.togglePause();
    setGameStatus(engineRef.current.status);
  };

  const handleRestart = () => {
    if (engineRef.current) {
      engineRef.current.restartCurrentBattle();
      setGameStatus(engineRef.current.status);
    }
  };

  const handleReturnToTitle = () => {
    if (engineRef.current) {
      engineRef.current.returnToTitle();
    }
    setGameStatus('title');
  };

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen bg-[#07090F] flex items-center justify-center overflow-hidden"
    >
      {/* 16:9 Letterboxed Game Container */}
      <div
        ref={stageRef}
        className="relative shadow-2xl bg-slate-950 overflow-hidden"
        style={{
          width: '1920px',
          height: '1080px',
          transform: `translateY(${-scrollShift}px) scale(${scale})`,
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
      >
        {/* Isolated Canvas for 60fps Game Loop */}
        <canvas
          ref={canvasRef}
          width={1920}
          height={1080}
          className="absolute inset-0 block w-full h-full"
        />

        {/* Title Screen */}
        {gameStatus === 'title' && (
          <TitleScreen
            onSelectMode={handleSelectMode}
            onOpenOnlineModal={() => {
              setOnlineModalMode('duel');
              setShowOnlineModal(true);
            }}
            onOpenRoyaleModal={() => {
              setOnlineModalMode('royale');
              setShowOnlineModal(true);
            }}
            onOpenGodotModal={() => setShowGodotModal(true)}
          />
        )}

        {/* Online 1v1 Room Lobby Modal (duel + GRID ROYALE) */}
        <OnlineRoomModal
          isOpen={showOnlineModal}
          initialRoomCode={initialRoomCode}
          mode={onlineModalMode}
          onClose={() => setShowOnlineModal(false)}
          onStartOnlineBattle={handleStartOnlineBattle}
          onStartRoyaleBattle={handleStartRoyaleBattle}
        />

        {/* Stage Select (Single Campaign, v2.3) */}
        <StageSelectModal
          isOpen={showStageSelect}
          onSelectStage={handleSelectStage}
          onClose={() => setShowStageSelect(false)}
        />

        {/* Offline Character Selection Screen */}
        <CharacterSelectModal
          isOpen={showCharSelect}
          gameMode={selectedMode}
          stageNum={stageNum}
          onDeploy={handleDeployCharacter}
          onClose={() => setShowCharSelect(false)}
        />

        {/* Active HUD & In-Game UI */}
        {(gameStatus === 'playing' || gameStatus === 'paused') && engineRef.current && (
          <>
            {engineRef.current.mode === 'royale' ? (
              <RoyaleHUD
                engine={engineRef.current}
                onOpenGodotModal={() => setShowGodotModal(true)}
                onRestart={handleRestart}
                onReturnToTitle={handleReturnToTitle}
              />
            ) : (
              <GameHUD
                engine={engineRef.current}
                onOpenGodotModal={() => setShowGodotModal(true)}
                onTogglePause={handleTogglePause}
                onRestart={handleRestart}
                onReturnToTitle={handleReturnToTitle}
              />
            )}
            {/* Virtual Controls for Touch Screens (landscape/tablet only;
                portrait uses the joystick controls below the stage) */}
            {!isPortrait && <OnscreenControls engine={engineRef.current} />}
          </>
        )}

        {/* Pause Overlay */}
        {gameStatus === 'paused' && (
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm z-30 flex flex-col items-center justify-center font-['Chakra_Petch']">
            <h2 className="text-4xl font-black text-cyan-400 tracking-widest uppercase mb-4">
              SIMULATION PAUSED
            </h2>
            <p className="text-slate-300 text-sm mb-6">Press [Esc] or [P] to resume operation</p>
            <div className="flex gap-4">
              <button
                onClick={handleTogglePause}
                className="px-6 py-2.5 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase cursor-pointer"
              >
                Resume
              </button>
              <button
                onClick={handleReturnToTitle}
                className="px-6 py-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
              >
                Return to Title
              </button>
            </div>
          </div>
        )}

        {/* Stage Clear Modal (Campaign Progression) */}
        {gameStatus === 'stage_clear' && engineRef.current && (
          <StageClearModal
            stageNum={engineRef.current.currentStage}
            stats={engineRef.current.stats}
            runActive={!!engineRef.current.campaignRun && !engineRef.current.campaignRun.broken}
            onNextStage={handleNextStage}
            onRestartCampaign={handleRestartCampaign}
            onReturnToTitle={handleReturnToTitle}
          />
        )}

        {/* Game Over Modal (Victory / Defeat) */}
        {(gameStatus === 'victory' || gameStatus === 'defeat') && engineRef.current && (
          <GameOverModal
            status={gameStatus}
            stats={engineRef.current.stats}
            rank={engineRef.current.mode === 'royale' ? engineRef.current.royaleRank : null}
            onRestart={handleRestart}
            onReturnToTitle={handleReturnToTitle}
          />
        )}

        {/* Commercial Architecture Godot 4.x / Steam Specs Modal */}
        <GodotExportModal
          isOpen={showGodotModal}
          onClose={() => setShowGodotModal(false)}
        />
      </div>

      {/* Mobile portrait joystick controls: rendered OUTSIDE the scaled
          stage container, in the letterbox band below the stage, so the
          buttons stay full-size on a phone. Portrait only; landscape and
          desktop keep the keyboard + OnscreenControls above. */}
      {(gameStatus === 'playing' || gameStatus === 'paused') &&
        engineRef.current &&
        isPortrait &&
        stageBottom > 0 && (
          <MobileJoystickControls
            engine={engineRef.current}
            stageBottom={stageBottom}
            shift={scrollShift}
          />
        )}

      {/* Temporary portrait scroll-down button: shown only when the
          joystick band is actually clipped below the visible fold.
          Tapping shifts the stage + band up so the controls come into
          view; tapping again restores the layout. */}
      {(gameStatus === 'playing' || gameStatus === 'paused') &&
        isPortrait &&
        scrollOverflow > 20 && (
          <button
            onClick={() => setScrollShift((s) => (s > 0 ? 0 : scrollOverflow))}
            className="absolute top-2 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-slate-900/85 border border-cyan-400/60 text-cyan-300 text-sm font-bold tracking-wide shadow-lg active:scale-95 transition-all cursor-pointer font-['Chakra_Petch']"
            style={{ touchAction: 'manipulation' }}
            aria-label={scrollShift > 0 ? '위로 스크롤' : '아래로 스크롤'}
          >
            {scrollShift > 0 ? '위로 ↑' : '아래로 ↓'}
          </button>
        )}
    </div>
  );
}
