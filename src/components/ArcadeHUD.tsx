import React from 'react';
import { GameEngine } from '../game/GameEngine';
import { formatArcadeTime, missionLabel, weaknessOrderLabel } from '../game/arcade';
import { soundManager } from '../audio/soundManager';
import { ARCHETYPE_PORTRAITS } from '../assets/portraits';
import {
  Shield,
  Zap,
  Volume2,
  VolumeX,
  Pause,
  Play,
  RotateCcw,
  Flame,
  Target,
  Layers,
  Trash2,
  Sparkles,
  Crown,
  Home,
  Timer,
  Skull,
  Trophy,
} from 'lucide-react';

interface ArcadeHUDProps {
  engine: GameEngine;
  onTogglePause: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

// 아케이드 3종 전용 HUD: 16:9 3단 레이아웃을 재활용한다.
// 좌 420 = 표준 기체 콕핏 (스킬 카드·직업 전환 없음), 중 1080 = 모드별
// 상단 정보 + 지령/미션 배너, 우 420 = 현재 기록 + BEST 비교.
export const ArcadeHUD: React.FC<ArcadeHUDProps> = ({
  engine,
  onTogglePause,
  onRestart,
  onReturnToTitle,
}) => {
  const player = engine.player;
  const mode = engine.arcadeMode ?? 'mega';
  const records = engine.arcadeRecords;
  const [muted, setMuted] = React.useState(soundManager.isMuted());

  // 500ms re-render tick: 타이머·게이지가 멈추지 않고 움직이게 한다.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 500);
    return () => clearInterval(id);
  }, []);

  const handleMuteToggle = () => {
    const isMuted = soundManager.toggleMute();
    setMuted(isMuted);
  };

  // 표준 기체: 랜서 외형이 자리만 빌려준다 (새 이미지 자산 없음).
  const standardPortrait = ARCHETYPE_PORTRAITS.lancer;
  const currentCluster = engine.playerBoard.getClusterAt(player.currentCol, player.currentRow);

  const hpBar = (hp: number, maxHp: number, shield: number, tone: 'cyan' | 'red') => (
    <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700/60 relative mt-1">
      <div
        className={`h-full rounded-full transition-all duration-150 ${
          tone === 'cyan'
            ? 'bg-gradient-to-r from-emerald-500 via-cyan-400 to-cyan-300'
            : 'bg-gradient-to-r from-red-600 via-rose-500 to-amber-500'
        }`}
        style={{ width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` }}
      />
      {shield > 0 && (
        <div
          className="absolute top-0.5 left-0.5 h-full bg-cyan-200/80 rounded-full border-r border-white animate-pulse"
          style={{ width: `${Math.min(100, shield)}%` }}
        />
      )}
    </div>
  );

  const coreBar = () => (
    <div className="mt-1.5">
      <div className="flex justify-between items-center text-[10px]">
        <span className="font-bold text-rose-300 tracking-wider flex items-center gap-1">
          <Shield className="w-3 h-3" />
          CORE
        </span>
        <span className="font-mono text-slate-300 tabular-nums">
          {Math.round(engine.playerCore.hp)}/{engine.playerCore.maxHp}
        </span>
      </div>
      <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-rose-900/60 mt-0.5">
        <div
          className={`h-full rounded-full transition-all duration-150 ${
            engine.playerCore.crack >= 2 ? 'bg-red-500 animate-pulse' : 'bg-gradient-to-r from-rose-600 to-rose-400'
          }`}
          style={{ width: `${Math.max(0, (engine.playerCore.hp / engine.playerCore.maxHp) * 100)}%` }}
        />
      </div>
    </div>
  );

  const dashCard = () => (
    <div className="mt-2 pt-2 border-t border-slate-800/80 rounded-xl px-1">
      <div className="flex justify-between items-center text-xs mb-1">
        <span className="font-bold flex items-center gap-1.5 text-slate-200 text-[11px]">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>[Shift/C] DASH (회피)</span>
        </span>
        <span
          className={`font-bold font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0 ml-2 ${
            player.dashCooldownRemaining <= 0
              ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/40 animate-pulse'
              : 'text-slate-400'
          }`}
        >
          {player.dashCooldownRemaining <= 0 ? 'READY [Shift/C]' : `${player.dashCooldownRemaining.toFixed(1)}s`}
        </span>
      </div>
      <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-700/50">
        <div
          className={`h-full transition-all duration-100 ${
            player.dashCooldownRemaining <= 0 ? 'bg-cyan-400 shadow-md shadow-cyan-400/50' : 'bg-cyan-600/70'
          }`}
          style={{
            width: `${
              player.dashCooldownRemaining <= 0
                ? 100
                : Math.round(((player.dashCooldownMax - player.dashCooldownRemaining) / player.dashCooldownMax) * 100)
            }%`,
          }}
        />
      </div>
    </div>
  );

  const discardCard = () => (
    <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between bg-cyan-950/20 px-2 py-1 rounded-full border border-cyan-800/40">
      <div className="flex items-center gap-1.5 text-[11px] text-cyan-300 font-bold">
        <Trash2 className="w-3 h-3 text-cyan-400" />
        <span>[X/E/L] 타일 버리기</span>
      </div>
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`w-2.5 h-2.5 rounded-full border ${
              i < player.discardStacks ? 'bg-cyan-400 border-cyan-300' : 'bg-slate-800 border-slate-600'
            }`}
          />
        ))}
        <span className="text-[9px] font-mono text-cyan-400 bg-cyan-900/60 px-1 py-0.5 rounded ml-1">
          {player.discardStacks}/3 · 1.2s/스택
        </span>
      </div>
    </div>
  );

  const clusterPreview = () => (
    <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-3 shadow-lg backdrop-blur-md my-2">
      <div className="text-xs font-bold text-slate-300 mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-cyan-400" />
          FOOTPAD CLUSTER PREVIEW
        </span>
        <span className="text-[10px] text-slate-500 font-mono">
          [{player.currentCol}, {player.currentRow}]
        </span>
      </div>
      {currentCluster ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Size &amp; Status:</span>
            <span
              className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                currentCluster.isActivePad
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/50'
                  : 'bg-slate-900 text-slate-400'
              }`}
            >
              {currentCluster.tiles.length} TILES · {currentCluster.isActivePad ? 'PRIMED (LAUNCHABLE)' : 'IDLE (< 3)'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Shape Bonus:</span>
            <span className="font-bold text-cyan-300 text-[11px]">{currentCluster.shapeTitle}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Color Trait:</span>
            <span
              className="font-bold text-[11px] uppercase"
              style={{
                color: currentCluster.color === 'red' ? '#FF3366' : currentCluster.color === 'blue' ? '#33CCFF' : '#FFCC00',
              }}
            >
              {currentCluster.color === 'red'
                ? 'Fast + Red Contamination'
                : currentCluster.color === 'blue'
                ? 'High Durability Barrier'
                : 'Slow Opponent + Mutation'}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-center py-2 text-xs text-slate-500">
          Standing on Empty Cooldown Floor (Movement -30%)
        </div>
      )}
    </div>
  );

  const modeLabel =
    mode === 'mega' ? '메가 보스 레이드' : mode === 'rush' ? '오더 러시' : '코어 디펜스';
  const modeAccent = mode === 'mega' ? '#FF3366' : mode === 'rush' ? '#FFCC00' : '#33CCFF';
  const groggy = mode === 'mega' && !engine.megaBarrier;
  const orderRemain =
    mode === 'mega' && engine.megaOrder ? Math.max(0, engine.megaOrderDeadline - engine.gameTime) : 0;
  const breakTotal = engine.megaOrderSuccess + engine.megaOrderFail;
  const breakRate = breakTotal > 0 ? Math.round((engine.megaOrderSuccess / breakTotal) * 100) : 100;

  const statRow = (label: string, value: string, best?: string) => (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/70 last:border-b-0">
      <span className="text-[11px] text-slate-400 font-semibold">{label}</span>
      <span className="text-right">
        <span className="text-sm font-bold font-mono text-white tabular-nums">{value}</span>
        {best && <span className="block text-[10px] font-mono text-amber-400/90 tabular-nums">{best}</span>}
      </span>
    </div>
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-10 font-['Chakra_Petch']">
      {/* Center top slim bar (56px) */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-14 flex items-center gap-2.5 bg-slate-950/90 backdrop-blur-md border border-cyan-500/50 border-t-0 px-4 rounded-b-2xl shadow-2xl shadow-cyan-950/70 pointer-events-auto">
        <button
          onClick={onReturnToTitle}
          title="타이틀 화면으로 나가기"
          className="flex items-center gap-1.5 text-xs font-bold bg-rose-950/70 hover:bg-rose-900/90 text-rose-300 border border-rose-500/50 px-2.5 py-1 rounded-full transition-all cursor-pointer"
        >
          <Home className="w-3.5 h-3.5" />
          <span>홈으로</span>
        </button>

        <div className="h-4 w-px bg-slate-700" />

        <span
          className="text-xs font-black tracking-widest uppercase flex items-center gap-1.5 whitespace-nowrap"
          style={{ color: modeAccent }}
        >
          {mode === 'mega' ? (
            <Crown className="w-4 h-4 text-rose-400" />
          ) : mode === 'rush' ? (
            <Timer className="w-4 h-4 text-amber-400" />
          ) : (
            <Shield className="w-4 h-4 text-cyan-400" />
          )}
          아케이드 · {modeLabel}
        </span>

        <div className="h-4 w-px bg-slate-700" />

        {/* 모드별 중앙 정보 */}
        {mode === 'mega' && (
          <span className="text-xs font-black tabular-nums whitespace-nowrap px-2 py-0.5 rounded-full border border-rose-500/50 bg-rose-950/50 text-rose-200">
            BOSS {Math.round(engine.megaBossHp)}/1000 · {groggy ? '그로기 ×2.5' : '배리어 (피해 20%)'}
          </span>
        )}
        {mode === 'rush' && (
          <span className="text-xs font-black tabular-nums whitespace-nowrap px-2 py-0.5 rounded-full border border-amber-500/50 bg-amber-950/50 text-amber-200">
            남은 시간 {engine.rushTimeLeft.toFixed(1)}초 · 점수 {engine.rushScore.toLocaleString()}
          </span>
        )}
        {mode === 'defense' && (
          <span className="text-xs font-black tabular-nums whitespace-nowrap px-2 py-0.5 rounded-full border border-cyan-500/50 bg-cyan-950/50 text-cyan-200">
            WAVE {engine.defenseWave} · 생존 {formatArcadeTime(engine.stats.gameDuration)} · 격파 {engine.defenseDestroyed}
          </span>
        )}

        <div className="h-4 w-px bg-slate-700" />

        <button
          onClick={handleMuteToggle}
          title={muted ? '소리 켜기' : '소리 끄기'}
          className="p-1 hover:text-cyan-400 text-slate-300 transition-colors cursor-pointer"
        >
          {muted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <button
          onClick={onTogglePause}
          title={engine.status === 'paused' ? '재개' : '일시정지 (ESC)'}
          className="p-1 hover:text-cyan-400 text-slate-300 transition-colors cursor-pointer"
        >
          {engine.status === 'paused' ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4" />}
        </button>
        <button
          onClick={onRestart}
          title="재시작 / 재도전"
          className="p-1 hover:text-cyan-400 text-slate-300 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Center mode banner (below the slim bar): order / missions / wave */}
      <div className="absolute top-[68px] left-1/2 -translate-x-1/2 pointer-events-none">
        {mode === 'mega' && (
          <div className="crack-bg bg-slate-950/85 border border-rose-500/50 rounded-2xl px-4 py-2 shadow-lg backdrop-blur-md text-center">
            {groggy ? (
              <span className="text-sm font-black text-amber-300 animate-pulse">
                그로기! 받는 피해 ×2.5 · {(engine.megaGroggyUntil - engine.gameTime).toFixed(1)}초 남음
              </span>
            ) : engine.megaOrder ? (
              <>
                <span className="text-sm font-black text-amber-300">
                  약점 지령: {weaknessOrderLabel(engine.megaOrder)}
                </span>
                <span className="text-xs font-mono text-slate-300 tabular-nums ml-2">
                  {orderRemain.toFixed(1)}초 · 파훼 {engine.megaOrderSuccess}/{breakTotal} ({breakRate}%)
                </span>
                <div className="h-1.5 w-72 bg-slate-900 rounded-full overflow-hidden border border-amber-500/40 mt-1.5 mx-auto">
                  <div
                    className={`h-full transition-all duration-100 ${orderRemain > 2 ? 'bg-amber-400' : 'bg-red-500'}`}
                    style={{ width: `${Math.max(0, Math.min(100, (orderRemain / 7) * 100))}%` }}
                  />
                </div>
              </>
            ) : (
              <span className="text-sm font-black text-cyan-300">배리어 재생성 중…</span>
            )}
          </div>
        )}
        {mode === 'rush' && (
          <div className="flex items-start gap-2">
            {engine.rushMissions.map((m, i) => (
              <div
                key={`${i}-${missionLabel(m)}`}
                className={`rounded-2xl px-3 py-2 shadow-lg backdrop-blur-md text-center border ${
                  i === 0
                    ? 'crack-bg bg-amber-950/85 border-amber-400/70 min-w-[220px]'
                    : 'bg-slate-950/80 border-slate-700/70 min-w-[150px] opacity-80'
                }`}
              >
                <div className={`text-[10px] font-bold tracking-wider ${i === 0 ? 'text-amber-300' : 'text-slate-400'}`}>
                  {i === 0 ? '현재 미션' : `다음 미션 ${i}`}
                </div>
                <div className={`font-black ${i === 0 ? 'text-base text-white' : 'text-xs text-slate-200'} break-keep`}>
                  {missionLabel(m)}
                </div>
                {i === 0 && (
                  <div className="text-[10px] font-mono text-amber-400 tabular-nums">콤보 {engine.rushCombo} · 배율 ×{engine.rushCombo <= 1 ? '1.0' : Math.min(3.0, 1.0 + (engine.rushCombo - 1) * 0.2).toFixed(1)}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {mode === 'defense' && (
          <div className="crack-bg bg-slate-950/85 border border-cyan-500/50 rounded-2xl px-4 py-2 shadow-lg backdrop-blur-md text-center">
            <span className="text-xs font-bold text-cyan-300">
              상성: 청→적→황→청 · 카운터 명중 시 피해 2배 · 격파 시 카운터 오버차지
            </span>
            <div className="h-1.5 w-72 bg-slate-900 rounded-full overflow-hidden border border-cyan-500/40 mt-1.5 mx-auto">
              <div
                className="h-full bg-cyan-400 transition-all duration-100"
                style={{ width: `${(((engine.gameTime % 20) / 20) * 100).toFixed(0)}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-slate-400 tabular-nums">
              다음 웨이브까지 {Math.max(0, 20 - (engine.gameTime % 20)).toFixed(0)}초
            </span>
          </div>
        )}
      </div>

      {/* LEFT: standard craft cockpit (420px) */}
      <div className="absolute left-4 top-[72px] bottom-4 w-[420px] flex flex-col pointer-events-auto select-none">
        <div className="crack-bg bg-slate-950/90 border border-cyan-500/50 rounded-3xl p-3 shadow-xl shadow-cyan-950/50 backdrop-blur-md">
          <div className="flex items-center gap-3 mb-2">
            <img
              src={standardPortrait}
              alt="표준 기체"
              className="w-[88px] h-[88px] rounded-2xl object-cover border border-cyan-400/60 shadow-md shadow-cyan-950/60 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span className="text-[11px] font-black text-cyan-300 tracking-wider">표준 기체 · STANDARD</span>
                </div>
                <div className="text-right">
                  <span className="text-base font-bold tabular-nums text-white">{Math.round(player.hp)}</span>
                  <span className="text-[10px] text-slate-400">/100</span>
                </div>
              </div>
              {hpBar(player.hp, 100, player.shield, 'cyan')}
              {mode === 'defense' && coreBar()}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-300 font-semibold uppercase">CLASS ARCHETYPE</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase bg-cyan-500/20 text-cyan-300">
                표준 기체 · 패시브 없음
              </span>
            </div>
            <p className="text-[10px] text-slate-300 mt-1 leading-snug break-keep">
              <span className="text-cyan-400 font-bold">스킬 없음:</span> 아케이드는 스킬·직업 전환 없이
              이동 420 · 대시 1.6초 · 디스카드 3스택으로 동일 조건에서 겨룹니다.
            </p>
          </div>

          {dashCard()}
          {discardCard()}
        </div>

        {clusterPreview()}

        {mode === 'mega' && engine.comboCount > 0 && (
          <div className="crack-bg bg-slate-950/85 border border-amber-500/50 rounded-3xl p-3 shadow-lg backdrop-blur-md my-2">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400 animate-pulse" />
              <span className="text-xs font-black tracking-widest text-white">
                MY COMBO <span className="text-amber-400 font-mono text-sm">{engine.comboCount}</span>
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-xs font-black text-emerald-400 font-mono">x{engine.comboMultiplier.toFixed(1)} DMG</span>
            </div>
            <div className="w-full h-1 bg-slate-900 rounded-full mt-2 overflow-hidden border border-amber-500/30">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-75"
                style={{ width: `${Math.min(100, (engine.comboTimer / 4.0) * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-2.5 text-[10px] text-slate-300 backdrop-blur-md mt-auto break-keep">
          <div className="font-bold text-[11px] text-slate-300 mb-1 flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-cyan-400" />
            조작 가이드
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <div><span className="text-cyan-300 font-mono font-bold">[방향키/WASD]</span> 이동</div>
            <div><span className="text-white font-mono font-bold">[Space]</span> 공격</div>
            <div><span className="text-emerald-300 font-mono font-bold">[Shift]</span> 대시(회피)</div>
            <div><span className="text-amber-300 font-mono font-bold">[X/E]</span> 타일 버리기</div>
          </div>
        </div>
      </div>

      {/* RIGHT: current run + BEST (420px) */}
      <div className="absolute right-4 top-[72px] bottom-4 w-[420px] flex flex-col pointer-events-auto select-none">
        <div className="crack-bg bg-slate-950/90 border border-amber-500/50 rounded-3xl p-3 shadow-xl shadow-amber-950/50 backdrop-blur-md">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-black tracking-widest text-white">현재 기록</span>
          </div>
          {mode === 'mega' && (
            <>
              {statRow('보스 HP', `${Math.round(engine.megaBossHp)} / 1000`)}
              {statRow('클리어 타임', formatArcadeTime(engine.stats.gameDuration),
                records.megaBoss.bestTimeSec !== null ? `BEST ${formatArcadeTime(records.megaBoss.bestTimeSec)}` : 'BEST 없음')}
              {statRow('최대 콤보', `${engine.comboMax}`, `BEST ${records.megaBoss.maxCombo}`)}
              {statRow('파훼 성공률', `${breakRate}% (${engine.megaOrderSuccess}/${breakTotal})`)}
              {statRow('클리어 횟수', `${records.megaBoss.clearCount}회`)}
            </>
          )}
          {mode === 'rush' && (
            <>
              {statRow('점수', `${engine.rushScore.toLocaleString()}점`, `BEST ${records.orderRush.bestScore.toLocaleString()}점`)}
              {statRow('미션 달성', `${engine.rushOrdersDone}개`, `BEST ${records.orderRush.maxOrders}개`)}
              {statRow('현재 콤보', `${engine.rushCombo}`, `최대 BEST ${records.orderRush.maxCombo}`)}
              {statRow('남은 시간', `${engine.rushTimeLeft.toFixed(1)}초`)}
            </>
          )}
          {mode === 'defense' && (
            <>
              {statRow('도달 웨이브', `WAVE ${engine.defenseWave}`, `BEST WAVE ${records.meteorDefense.bestWave}`)}
              {statRow('생존 시간', formatArcadeTime(engine.stats.gameDuration),
                `BEST ${formatArcadeTime(records.meteorDefense.bestSurviveSec)}`)}
              {statRow('운석 격파', `${engine.defenseDestroyed}개`, `BEST ${records.meteorDefense.maxDestroyed}개`)}
              {statRow('코어 HP', `${Math.round(engine.playerCore.hp)} / 250`)}
            </>
          )}
        </div>

        <div className="crack-bg bg-slate-950/85 border border-slate-800 rounded-3xl p-3 backdrop-blur-md mt-2 text-[11px] text-slate-300 break-keep">
          <div className="flex items-center gap-1.5 font-bold text-slate-200 mb-1">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            BEST 기록은 이 기기(localStorage)에 저장됩니다
          </div>
          <p className="text-slate-400 leading-snug">
            {mode === 'mega' && '보스 HP 1000을 0으로 만들면 승리. 배리어 중엔 피해 20%, 약점 지령 파훼 시 5초 그로기(×2.5). 지령 실패 시 레이저가 떨어집니다.'}
            {mode === 'rush' && '미션에 맞는 형상을 쏴 목표 라인(Y ≤ 80)을 통과시키면 +3.0초·콤보 +1·점수 100×콤보 배율. 미션 외 발사는 콤보가 유지됩니다.'}
            {mode === 'defense' && '상성(청→적→황→청)으로 요격하면 피해 2배. 운석 격파 시 카운터 오버차지(남은 셀 가속 + 디스카드 1스택). 운석이 캐릭터에 닿으면 15 피해, 뒤로 빠지면 코어 피해(남은 HP × 5).'}
          </p>
          <p className="text-slate-500 leading-snug mt-1 flex items-center gap-1">
            <Skull className="w-3 h-3 shrink-0" />
            {mode === 'defense'
              ? '코어 HP 50% 이하에서 좌·우 1열 붕괴 + 리필 20% 가속.'
              : '아케이드에는 수축 존이 없습니다.'}
          </p>
        </div>
      </div>
    </div>
  );
};
