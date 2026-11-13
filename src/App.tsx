import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GameEngine, GameStatus } from './game/GameEngine';
import { GameHUD } from './components/GameHUD';
import { TitleScreen } from './components/TitleScreen';
import { GameOverModal } from './components/GameOverModal';
import { StageClearModal } from './components/StageClearModal';
import { CharacterSelectModal } from './components/CharacterSelectModal';
import { OnlineRoomModal } from './components/OnlineRoomModal';
import { GodotExportModal } from './components/GodotExportModal';
import { OnscreenControls } from './components/OnscreenControls';
import { ArchetypeId, GameMode } from './types/game';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameStatus, setGameStatus] = useState<GameStatus>('title');
  const [selectedMode, setSelectedMode] = useState<GameMode>('single');
  const [stageNum, setStageNum] = useState<number>(1);
  const [showGodotModal, setShowGodotModal] = useState<boolean>(false);
  const [showCharSelect, setShowCharSelect] = useState<boolean>(false);
  const [showOnlineModal, setShowOnlineModal] = useState<boolean>(false);
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');
  const [, setTick] = useState(0);

  // Check URL query parameters for invite link ?room=CODE
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam) {
        setInitialRoomCode(roomParam.toUpperCase());
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

  useEffect(() => {
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
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleSelectMode = (mode: GameMode) => {
    setSelectedMode(mode);
    setStageNum(mode === 'boss' ? 5 : 1);
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
      className="relative w-screen h-screen bg-black flex items-center justify-center overflow-hidden"
    >
      {/* 16:9 Letterboxed Game Container */}
      <div
        className="relative shadow-2xl bg-slate-950 overflow-hidden"
        style={{
          width: '1920px',
          height: '1080px',
          transform: `scale(${scale})`,
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
            onOpenOnlineModal={() => setShowOnlineModal(true)}
            onOpenGodotModal={() => setShowGodotModal(true)}
          />
        )}

        {/* Online 1v1 Room Lobby Modal */}
        <OnlineRoomModal
          isOpen={showOnlineModal}
          initialRoomCode={initialRoomCode}
          onClose={() => setShowOnlineModal(false)}
          onStartOnlineBattle={handleStartOnlineBattle}
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
            <GameHUD
              engine={engineRef.current}
              onOpenGodotModal={() => setShowGodotModal(true)}
              onTogglePause={handleTogglePause}
              onRestart={handleRestart}
              onReturnToTitle={handleReturnToTitle}
            />
            {/* Virtual Controls for Touch Screens */}
            <OnscreenControls engine={engineRef.current} />
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
                className="px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold uppercase cursor-pointer"
              >
                Resume
              </button>
              <button
                onClick={handleReturnToTitle}
                className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
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
            onNextStage={handleNextStage}
            onRestartCampaign={() => handleSelectMode('single')}
            onReturnToTitle={handleReturnToTitle}
          />
        )}

        {/* Game Over Modal (Victory / Defeat) */}
        {(gameStatus === 'victory' || gameStatus === 'defeat') && engineRef.current && (
          <GameOverModal
            status={gameStatus}
            stats={engineRef.current.stats}
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
    </div>
  );
}
