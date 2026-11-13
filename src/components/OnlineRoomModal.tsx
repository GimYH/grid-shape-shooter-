import React, { useState, useEffect } from 'react';
import { networkManager } from '../game/NetworkManager';
import { ARCHETYPE_LIST, ARCHETYPES } from '../game/archetypes';
import { ArchetypeId } from '../types/game';
import {
  Globe,
  Copy,
  Check,
  Users,
  Play,
  X,
  Sparkles,
  Swords,
  Shield,
  Zap,
  ArrowRight,
  Loader2,
} from 'lucide-react';

interface OnlineRoomModalProps {
  isOpen: boolean;
  initialRoomCode?: string;
  onClose: () => void;
  onStartOnlineBattle: (
    role: 'p1' | 'p2',
    roomCode: string,
    p1Arch: ArchetypeId,
    p2Arch: ArchetypeId,
    seed?: number
  ) => void;
}

export const OnlineRoomModal: React.FC<OnlineRoomModalProps> = ({
  isOpen,
  initialRoomCode = '',
  onClose,
  onStartOnlineBattle,
}) => {
  const [tab, setTab] = useState<'create' | 'join'>(initialRoomCode ? 'join' : 'create');
  const [myArchetype, setMyArchetype] = useState<ArchetypeId>('lancer');
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode);
  const [currentRoomCode, setCurrentRoomCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [opponentReady, setOpponentReady] = useState(false);
  const [opponentArchetype, setOpponentArchetype] = useState<ArchetypeId>('wave');
  const [role, setRole] = useState<'p1' | 'p2' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    if (initialRoomCode) {
      setRoomCodeInput(initialRoomCode);
      setTab('join');
    }
  }, [initialRoomCode]);

  useEffect(() => {
    networkManager.onRoomCreated = (code) => {
      setCurrentRoomCode(code);
      setRole(networkManager.role || 'p1');
      setIsReady(false);
      setOpponentConnected(false);
      setOpponentReady(false);
      setIsConnecting(false);
    };

    networkManager.onRoomJoined = (code, oppArch) => {
      setCurrentRoomCode(code);
      setRole(networkManager.role || 'p2');
      setIsReady(false);
      setOpponentConnected(true);
      if (oppArch) setOpponentArchetype(oppArch);
      setIsConnecting(false);
    };

    networkManager.onPeerJoined = (oppArch) => {
      setOpponentConnected(true);
      setOpponentReady(false);
      if (oppArch) setOpponentArchetype(oppArch);
    };

    networkManager.onPeerArchetypeSelected = (arch) => {
      setOpponentArchetype(arch);
      // The server clears the peer's Ready on a class change; mirror it.
      setOpponentReady(false);
    };

    networkManager.onPeerReady = (ready) => {
      setOpponentReady(ready);
    };

    networkManager.onPeerLeft = () => {
      setOpponentConnected(false);
      setOpponentReady(false);
      setIsReady(false);
    };

    networkManager.onError = (msg) => {
      setErrorMessage(msg);
      setIsConnecting(false);
    };

    networkManager.onBattleStart = (seed, p1Arch, p2Arch) => {
      const activeRole = networkManager.role || role || 'p1';
      const activeRoomCode = networkManager.roomCode || currentRoomCode || '';
      onStartOnlineBattle(activeRole, activeRoomCode, p1Arch, p2Arch, seed);
    };

    return () => {
      // Don't disconnect if entering battle
    };
  }, [currentRoomCode, role, onStartOnlineBattle]);

  if (!isOpen) return null;

  const handleCreateRoom = async () => {
    setErrorMessage(null);
    setIsConnecting(true);
    try {
      await networkManager.createRoom(myArchetype);
    } catch {
      setErrorMessage('서버 연결 실패. 네트워크 상태를 확인하세요.');
      setIsConnecting(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!roomCodeInput.trim()) {
      setErrorMessage('방 코드를 입력하세요.');
      return;
    }
    setErrorMessage(null);
    setIsConnecting(true);
    try {
      await networkManager.joinRoom(roomCodeInput.trim(), myArchetype);
    } catch {
      setErrorMessage('방 접속 실패. 코드를 다시 확인하세요.');
      setIsConnecting(false);
    }
  };

  const handleToggleReady = () => {
    const nextReady = !isReady;
    setIsReady(nextReady);
    networkManager.setReady(nextReady);
  };

  const handleSelectArchetype = (arch: ArchetypeId) => {
    setMyArchetype(arch);
    // Changing class invalidates Ready on both sides (server enforces it
    // too); clear the local flag so the button state matches.
    setIsReady(false);
    if (currentRoomCode) {
      networkManager.selectArchetype(arch);
    }
  };

  const inviteUrl = currentRoomCode
    ? `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`
    : '';

  const handleCopyLink = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExitRoom = () => {
    networkManager.disconnect();
    setCurrentRoomCode(null);
    setRole(null);
    setIsReady(false);
    setOpponentConnected(false);
    setOpponentReady(false);
    setErrorMessage(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 font-['Chakra_Petch'] select-none">
      <div className="crack-bg bg-slate-900 border border-cyan-500/50 rounded-[28px] max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl shadow-cyan-950/80 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
              <Globe className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide uppercase flex items-center gap-2">
                온라인 1:1 대전 네트워크 (Online 1v1 Battle)
              </h2>
              <p className="text-xs text-slate-400">
                1:1 초대 링크 공유를 통한 실시간 크로스 네트워크 듀얼
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              handleExitRoom();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto">
          {errorMessage && (
            <div className="mb-4 p-3 rounded-2xl bg-rose-950/60 border border-rose-500/60 text-xs text-rose-300 font-semibold flex items-center justify-between">
              <span>{errorMessage}</span>
              <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white">✕</button>
            </div>
          )}

          {!currentRoomCode ? (
            /* Mode 1: Create or Join Lobby View */
            <div className="space-y-6">
              {/* Tab Selector */}
              <div className="flex bg-slate-950 p-1 rounded-full border border-slate-800 max-w-sm mx-auto">
                <button
                  onClick={() => setTab('create')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    tab === 'create'
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  방 만들기 (Host)
                </button>
                <button
                  onClick={() => setTab('join')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    tab === 'join'
                      ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  초대 코드로 참가 (Join)
                </button>
              </div>

              {/* Archetype Picker */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-2 uppercase tracking-wider">
                  내 캐릭터 선택 (Select Your Archetype)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ARCHETYPE_LIST.map((arch) => {
                    const isSel = myArchetype === arch.id;
                    return (
                      <button
                        key={arch.id}
                        onClick={() => handleSelectArchetype(arch.id)}
                        className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer ${
                          isSel
                            ? 'bg-cyan-950/80 border-cyan-400 shadow-sm shadow-cyan-500/40 text-white'
                            : 'bg-slate-950/60 hover:bg-slate-800/60 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold">{arch.nameKo}</span>
                          <span
                            className="text-[9px] px-1 rounded uppercase font-bold"
                            style={{ backgroundColor: `${arch.color}30`, color: arch.color }}
                          >
                            {arch.badge}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 block truncate">{arch.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {tab === 'create' ? (
                /* Create Room Card */
                <div className="crack-bg bg-slate-950/70 border border-slate-800 rounded-2xl p-5 text-center">
                  <h3 className="text-sm font-bold text-white mb-1">
                    새 1:1 대전 방을 생성합니다
                  </h3>
                  <p className="text-xs text-slate-400 mb-4 max-w-md mx-auto">
                    방 생성 후 생성된 <strong>초대 링크</strong>를 복사하여 친구에게 메신저나 채팅으로 전달하면 즉시 입장할 수 있습니다.
                  </p>
                  <button
                    onClick={handleCreateRoom}
                    disabled={isConnecting}
                    className="px-6 py-3 rounded-full crack-overlay bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-bold text-xs tracking-wider uppercase inline-flex items-center gap-2 shadow-lg shadow-cyan-500/30 transition-all hover:scale-102 active:scale-98 cursor-pointer disabled:opacity-50"
                  >
                    {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                    <span>방 생성 및 초대 링크 발급</span>
                  </button>
                </div>
              ) : (
                /* Join Room Card */
                <div className="crack-bg bg-slate-950/70 border border-slate-800 rounded-2xl p-5 text-center">
                  <h3 className="text-sm font-bold text-white mb-1">
                    초대 코드를 입력하세요
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">
                    친구가 공유해준 6자리 방 코드를 입력하거나 초대 링크를 브라우저 주소창에 붙여넣으세요.
                  </p>
                  <div className="flex gap-2 max-w-sm mx-auto mb-4">
                    <input
                      type="text"
                      value={roomCodeInput}
                      onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                      placeholder="예: 7A9B2X"
                      maxLength={8}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-full px-4 py-2 text-center text-sm font-mono font-bold tracking-widest text-cyan-300 uppercase focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      onClick={handleJoinRoom}
                      disabled={isConnecting}
                      className="px-5 py-2 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : '참가하기'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Mode 2: Room Matchmaking & Ready View */
            <div className="space-y-6">
              {/* Room Code & Invite Link Bar */}
              <div className="crack-bg bg-slate-950 border border-cyan-500/40 rounded-2xl p-4">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold">
                      BATTLE ROOM CODE
                    </span>
                    <span className="text-2xl font-black font-mono text-cyan-400 tracking-widest">
                      {currentRoomCode}
                    </span>
                  </div>

                  {/* 1-Click Copy Invite Link Button */}
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={handleCopyLink}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-full crack-overlay bg-gradient-to-r from-cyan-500/25 to-emerald-500/25 hover:from-cyan-500/35 hover:to-emerald-500/35 text-cyan-300 border border-cyan-400/60 text-xs font-bold tracking-wide transition-all hover:scale-102 active:scale-98 cursor-pointer shadow-md shadow-cyan-950/60"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      <span>{copied ? '초대 링크 복사됨!' : '🔗 1:1 초대 링크 복사'}</span>
                    </button>

                    <button
                      onClick={handleExitRoom}
                      className="px-3 py-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs transition-colors cursor-pointer"
                    >
                      방 나가기
                    </button>
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded-lg truncate font-mono">
                  {inviteUrl}
                </div>
              </div>

              {/* Matchup Duel Cards (P1 vs P2) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Me */}
                <div className="crack-bg bg-slate-950/80 border border-cyan-500/50 rounded-2xl p-4 relative overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                      {role === 'p1' ? 'PLAYER 1 (HOST - YOU)' : 'PLAYER 2 (GUEST - YOU)'}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        isReady ? 'bg-emerald-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {isReady ? 'READY' : 'WAITING'}
                    </span>
                  </div>

                  <h4 className="text-lg font-bold text-white mb-1">
                    {ARCHETYPES[myArchetype].nameKo}
                  </h4>
                  <p className="text-xs text-slate-300 mb-3">{ARCHETYPES[myArchetype].title}</p>

                  <div className="text-[11px] text-slate-400 space-y-1">
                    <div>
                      <span className="text-cyan-400 font-bold">스킬:</span> {ARCHETYPES[myArchetype].skillName}
                    </div>
                  </div>
                </div>

                {/* Opponent */}
                <div
                  className={`border rounded-2xl p-4 relative overflow-hidden transition-all ${
                    opponentConnected
                      ? 'bg-slate-950/80 border-rose-500/50'
                      : 'bg-slate-950/40 border-slate-800 border-dashed flex flex-col items-center justify-center text-center'
                  }`}
                >
                  {opponentConnected ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                          {role === 'p1' ? 'PLAYER 2 (OPPONENT)' : 'PLAYER 1 (OPPONENT)'}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                            opponentReady ? 'bg-emerald-500 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {opponentReady ? 'READY' : 'WAITING'}
                        </span>
                      </div>

                      <h4 className="text-lg font-bold text-white mb-1">
                        {ARCHETYPES[opponentArchetype].nameKo}
                      </h4>
                      <p className="text-xs text-slate-300 mb-3">{ARCHETYPES[opponentArchetype].title}</p>

                      <div className="text-[11px] text-slate-400 space-y-1">
                        <div>
                          <span className="text-rose-400 font-bold">스킬:</span>{' '}
                          {ARCHETYPES[opponentArchetype].skillName}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="py-6">
                      <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-2" />
                      <span className="text-xs font-bold text-slate-300 block mb-1">
                        상대방 접속 대기 중...
                      </span>
                      <span className="text-[11px] text-slate-500 max-w-xs block leading-tight">
                        상단 [초대 링크 복사]를 눌러 링크를 친구에게 공유하세요.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Ready CTA */}
              <div className="pt-2 text-center">
                <button
                  onClick={handleToggleReady}
                  disabled={!opponentConnected}
                  className={`px-8 py-3.5 rounded-full crack-overlay font-bold text-sm tracking-wider uppercase transition-all shadow-xl cursor-pointer ${
                    !opponentConnected
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : isReady
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/30'
                      : 'bg-gradient-to-r from-emerald-500 to-cyan-400 hover:from-emerald-400 hover:to-cyan-300 text-slate-950 shadow-emerald-500/30 hover:scale-105 active:scale-95'
                  }`}
                >
                  {isReady ? '출격 준비 취소 (Cancel Ready)' : '출격 준비 완료 (Ready for Battle)'}
                </button>
                {opponentConnected && !opponentReady && (
                  <p className="text-xs text-slate-400 mt-2">
                    양측 모두 [출격 준비 완료]를 누르면 대전이 즉시 시작됩니다!
                  </p>
                )}
                {opponentConnected && isReady && opponentReady && (
                  <p className="text-xs text-emerald-400 font-bold mt-2 animate-pulse">
                    모든 플레이어 준비 완료! 대전 전장으로 진입합니다...
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
