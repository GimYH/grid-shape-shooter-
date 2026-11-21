// 아케이드 확장 3종 (메가 보스 / 오더 러시 / 코어 디펜스) — 순수 로직 + 기록 저장.
// GameEngine/Renderer가 이 모듈의 상수·판정 함수·기록 헬퍼를 가져다 쓴다.
// 이 파일은 portrait .jpg나 브라우저 전용 API를 import하지 않으므로
// tsx 테스트에서 직접 import할 수 있다 (campaign.ts와 같은 패턴).

import { ShapePatternType, TileColor } from '../types/game';

export type ArcadeModeId = 'mega' | 'rush' | 'defense';

export const ARCADE_MODE_META: {
  id: ArcadeModeId;
  nameKo: string;
  name: string;
  desc: string;
  accent: string;
}[] = [
  {
    id: 'mega',
    nameKo: '메가 보스 레이드',
    name: 'MEGA BOSS',
    desc: '배리어를 두른 초대형 보스 · 약점 지령을 파훼해 그로기로 폭딜',
    accent: '#FF3366',
  },
  {
    id: 'rush',
    nameKo: '오더 러시',
    name: 'ORDER RUSH',
    desc: '60초 미션 타임어택 · 주문에 맞는 형상을 쏴 목표 라인을 통과',
    accent: '#FFCC00',
  },
  {
    id: 'defense',
    nameKo: '코어 디펜스',
    name: 'METEOR DEFENSE',
    desc: '3색 상성으로 운석을 요격해 후방 코어를 지키는 생존 디펜스',
    accent: '#33CCFF',
  },
];

// --- 공통 ------------------------------------------------------------------

// 기존 콤보 배율 규칙과 동일 (GameEngine.comboMultiplier):
// 1콤보 이하는 1.0, 이후 1콤보당 +0.2, 상한 3.0.
export function comboMultFor(count: number): number {
  if (count <= 1) return 1.0;
  return Math.min(3.0, 1.0 + (count - 1) * 0.2);
}

// 3색 상성 사이클 (청→적→황→청): 인자가 이기는 색을 돌려준다.
export function counterColorOf(color: TileColor): TileColor {
  return color === 'red' ? 'blue' : color === 'yellow' ? 'red' : 'yellow';
}

// 투사체 판정에 필요한 최소 정보 (발사 시점의 클러스터 기준).
export interface ArcadeProjectileInfo {
  color: TileColor;
  shapeType: ShapePatternType;
  cells: number; // 발사 당시 타일 수 (cells.length)
  frontline: boolean;
}

// --- 메가 보스 ---------------------------------------------------------------

export const MEGA_BOSS_MAX_HP = 1000;
export const MEGA_BARRIER_MULT = 0.2; // 배리어 유지 중 받는 데미지 20%
export const MEGA_GROGGY_MULT = 2.5; // 그로기 중 받는 데미지 2.5배
export const MEGA_ORDER_SEC = 7.0; // 약점 지령 제한 시간
export const MEGA_GROGGY_SEC = 5.0; // 파훼 성공 시 그로기 지속 시간
export const MEGA_LASER_TELEGRAPH_SEC = 1.2; // 레이저 발사 전 예고선 시간
export const MEGA_LASER_DMG = 25;
export const MEGA_LASER_MIN_COLS = 3;
export const MEGA_LASER_MAX_COLS = 4;

export type WeaknessOrder =
  | { kind: 'color'; color: TileColor }
  | { kind: 'shape'; shape: ShapePatternType } // 'spear' | 'wall' | 'homing'
  | { kind: 'frontline' }
  | { kind: 'bigblock' };

export function weaknessOrderLabel(order: WeaknessOrder): string {
  switch (order.kind) {
    case 'color':
      return order.color === 'red'
        ? '적색 3칸 이상 명중'
        : order.color === 'blue'
        ? '청색 3칸 이상 명중'
        : '황색 3칸 이상 명중';
    case 'shape':
      return order.shape === 'spear'
        ? '세로 스피어(3칸) 명중'
        : order.shape === 'wall'
        ? '가로 월(3칸) 명중'
        : '호밍 코어(2×2) 명중';
    case 'frontline':
      return '전선(1~2행)에서 발사 명중';
    case 'bigblock':
      return '5칸 이상 대형 블록 명중';
  }
}

const WEAKNESS_POOL: WeaknessOrder[] = [
  { kind: 'color', color: 'red' },
  { kind: 'color', color: 'blue' },
  { kind: 'color', color: 'yellow' },
  { kind: 'shape', shape: 'spear' },
  { kind: 'shape', shape: 'wall' },
  { kind: 'shape', shape: 'homing' },
  { kind: 'frontline' },
  { kind: 'bigblock' },
];

export function randomWeaknessOrder(): WeaknessOrder {
  return WEAKNESS_POOL[Math.floor(Math.random() * WEAKNESS_POOL.length)];
}

// 약점 지령 판정 (투사체 명중 시점의 색상/모양/발사 행 기준).
export function matchesWeakness(order: WeaknessOrder, proj: ArcadeProjectileInfo): boolean {
  switch (order.kind) {
    case 'color':
      return proj.color === order.color && proj.cells >= 3;
    case 'shape':
      if (order.shape === 'homing') return proj.shapeType === 'homing';
      return proj.shapeType === order.shape && proj.cells >= 3;
    case 'frontline':
      return proj.frontline;
    case 'bigblock':
      return proj.cells >= 5;
  }
}

// --- 오더 러시 ---------------------------------------------------------------

export const RUSH_START_SEC = 60.0;
export const RUSH_BONUS_SEC = 3.0; // 미션 달성 시 추가 시간
export const RUSH_BASE_SCORE = 100; // 점수 = 100 × 콤보 배율
export const RUSH_GOAL_Y = 80; // 목표 라인 Y 좌표

export type RushMission =
  | { kind: 'color'; color: TileColor; minCells: number }
  | { kind: 'shape'; shape: ShapePatternType; color?: TileColor; minCells: number }
  | { kind: 'frontline'; minCells: number }
  | { kind: 'megablock'; minCells: number };

export function missionLabel(m: RushMission): string {
  const colorKo = (c: TileColor) => (c === 'red' ? '적색' : c === 'blue' ? '청색' : '황색');
  switch (m.kind) {
    case 'color':
      return `${colorKo(m.color)} ${m.minCells}칸 이상`;
    case 'shape': {
      const shapeKo =
        m.shape === 'spear' ? '세로 스피어' : m.shape === 'wall' ? '가로 월' : m.shape === 'homing' ? '호밍 코어(2×2)' : '메테오 버스트';
      return m.color ? `${colorKo(m.color)} ${shapeKo}` : shapeKo;
    }
    case 'frontline':
      return '전선(1~2행) 발사';
    case 'megablock':
      return `${m.minCells}칸 이상 메가 블록`;
  }
}

// 미션 난이도 단계: 달성 횟수(회차) 기준. 1~5회차 → 1단계, 6~15회차 → 2단계, 16회차~ → 3단계.
export function rushMissionTier(completions: number): 1 | 2 | 3 {
  if (completions >= 15) return 3;
  if (completions >= 5) return 2;
  return 1;
}

function randomRushMissionTier1(): RushMission {
  const roll = Math.floor(Math.random() * 5);
  if (roll <= 2) {
    const colors: TileColor[] = ['red', 'blue', 'yellow'];
    return { kind: 'color', color: colors[roll], minCells: 3 };
  }
  return roll === 3
    ? { kind: 'shape', shape: 'wall', minCells: 3 }
    : { kind: 'shape', shape: 'spear', minCells: 3 };
}

function randomRushMissionTier2(): RushMission {
  const colors: TileColor[] = ['red', 'blue', 'yellow'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const roll = Math.floor(Math.random() * 4);
  if (roll === 0) return { kind: 'shape', shape: 'wall', color, minCells: 3 };
  if (roll === 1) return { kind: 'shape', shape: 'spear', color, minCells: 3 };
  if (roll === 2) return { kind: 'shape', shape: 'homing', minCells: 4 };
  return { kind: 'frontline', minCells: 3 };
}

function randomRushMissionTier3(): RushMission {
  const colors: TileColor[] = ['red', 'blue', 'yellow'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  return Math.random() < 0.5
    ? { kind: 'shape', shape: 'meteor', color, minCells: 5 }
    : { kind: 'megablock', minCells: 6 };
}

export function randomRushMission(completions: number): RushMission {
  const tier = rushMissionTier(completions);
  if (tier === 3) return randomRushMissionTier3();
  if (tier === 2) return randomRushMissionTier2();
  return randomRushMissionTier1();
}

export function matchesMission(m: RushMission, proj: ArcadeProjectileInfo): boolean {
  switch (m.kind) {
    case 'color':
      return proj.color === m.color && proj.cells >= m.minCells;
    case 'shape':
      if (m.color !== undefined && proj.color !== m.color) return false;
      if (m.shape === 'homing') return proj.shapeType === 'homing';
      return proj.shapeType === m.shape && proj.cells >= m.minCells;
    case 'frontline':
      return proj.frontline && proj.cells >= m.minCells;
    case 'megablock':
      return proj.cells >= m.minCells;
  }
}

// --- 코어 디펜스 (운석) -------------------------------------------------------

export const DEFENSE_CORE_MAX_HP = 250;
export const METEOR_CELL_HP = 6; // 운석 셀 HP (일반 투사체 1셀 피해 3~4로는 1방에 안 깨짐, 상성 2배면 6~8로 1방 격파)
export const METEOR_TOUCH_DMG = 15; // 운석-캐릭터 접촉 피해
export const DEFENSE_CORE_DMG_PER_HP = 5; // 하단 통과 시 코어 피해 = 운석 남은 HP × 5
export const DEFENSE_WAVE_SEC = 20; // 웨이브 상승 간격
export const DEFENSE_COLLAPSE_REFILL_MULT = 1.2; // 코어 50% 이하 붕괴 시 리필 가속 (기존 1.3이 아닌 기획서 수치 20%)

export interface ArcadeMeteorCell {
  relCol: number;
  relRow: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

export interface ArcadeMeteor {
  id: string;
  col: number; // 0-based 시작 열
  w: number; // 셀 단위 너비 (1~3)
  h: number; // 셀 단위 높이 (1~2)
  x: number; // px (좌상단)
  y: number; // px (좌상단)
  color: TileColor;
  cells: ArcadeMeteorCell[];
  speed: number; // px/s
}

export function defenseWaveFor(gameTimeSec: number): number {
  return Math.floor(Math.max(0, gameTimeSec) / DEFENSE_WAVE_SEC) + 1;
}

// 웨이브가 오를수록 빨라지고 자주 나온다. 속도 상한 150px/s, 생성 간격 하한 0.9초.
export function meteorFallSpeed(wave: number): number {
  return Math.min(150, 55 + 9 * Math.max(0, wave - 1));
}

export function meteorSpawnIntervalSec(wave: number): number {
  return Math.max(0.9, 2.2 * Math.pow(0.92, Math.max(0, wave - 1)));
}

// 운석 크기 분포: 1×1 40%, 2×1 25%, 2×2 20%, 3×2 15%.
export function meteorSizeForRoll(roll: number): { w: number; h: number } {
  if (roll < 0.4) return { w: 1, h: 1 };
  if (roll < 0.65) return { w: 2, h: 1 };
  if (roll < 0.85) return { w: 2, h: 2 };
  return { w: 3, h: 2 };
}

export function meteorRemainingHp(m: ArcadeMeteor): number {
  let sum = 0;
  for (const c of m.cells) if (!c.destroyed) sum += c.hp;
  return sum;
}

// --- 렌더러에 넘기는 아케이드 상태 (한 덩어리로 전달) ------------------------

export interface ArcadeRenderState {
  mode: ArcadeModeId;
  // 메가 보스
  bossHp: number;
  bossMaxHp: number;
  barrier: boolean;
  groggyUntil: number; // gameTime 기준
  order: WeaknessOrder | null;
  orderDeadline: number; // gameTime 기준
  // 레이저 예고 (발사 전 1.2초간 표시할 열 목록)
  laserCols: number[];
  // 코어 디펜스
  meteors: ArcadeMeteor[];
}

// --- 결과 화면용 --------------------------------------------------------------

export interface ArcadeResultLine {
  label: string;
  value: string;
  best?: string;
}

export interface ArcadeResult {
  mode: ArcadeModeId;
  title: string;
  lines: ArcadeResultLine[];
}

// --- 기록 저장 (localStorage gss_arcade_records_v1) ---------------------------

export interface ArcadeRecords {
  megaBoss: { bestTimeSec: number | null; maxCombo: number; clearCount: number };
  orderRush: { bestScore: number; maxOrders: number; maxCombo: number };
  meteorDefense: { bestWave: number; bestSurviveSec: number; maxDestroyed: number };
}

export const ARCADE_STORAGE_KEY = 'gss_arcade_records_v1';

export function defaultArcadeRecords(): ArcadeRecords {
  return {
    megaBoss: { bestTimeSec: null, maxCombo: 0, clearCount: 0 },
    orderRush: { bestScore: 0, maxOrders: 0, maxCombo: 0 },
    meteorDefense: { bestWave: 0, bestSurviveSec: 0, maxDestroyed: 0 },
  };
}

let memoryRecords: ArcadeRecords | null = null;

function cloneRecords(r: ArcadeRecords): ArcadeRecords {
  return {
    megaBoss: { ...r.megaBoss },
    orderRush: { ...r.orderRush },
    meteorDefense: { ...r.meteorDefense },
  };
}

export function loadArcadeRecords(): ArcadeRecords {
  if (memoryRecords) return cloneRecords(memoryRecords);
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(ARCADE_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as ArcadeRecords;
      const d = defaultArcadeRecords();
      return {
        megaBoss: {
          bestTimeSec: typeof parsed.megaBoss?.bestTimeSec === 'number' ? parsed.megaBoss.bestTimeSec : null,
          maxCombo: Math.max(0, parsed.megaBoss?.maxCombo ?? 0),
          clearCount: Math.max(0, parsed.megaBoss?.clearCount ?? 0),
        },
        orderRush: {
          bestScore: Math.max(0, parsed.orderRush?.bestScore ?? 0),
          maxOrders: Math.max(0, parsed.orderRush?.maxOrders ?? 0),
          maxCombo: Math.max(0, parsed.orderRush?.maxCombo ?? 0),
        },
        meteorDefense: {
          bestWave: Math.max(0, parsed.meteorDefense?.bestWave ?? 0),
          bestSurviveSec: Math.max(0, parsed.meteorDefense?.bestSurviveSec ?? 0),
          maxDestroyed: Math.max(0, parsed.meteorDefense?.maxDestroyed ?? 0),
        },
      };
    }
  } catch {
    // 손상된 저장값: 새로 시작.
  }
  return defaultArcadeRecords();
}

export function saveArcadeRecords(r: ArcadeRecords): void {
  memoryRecords = cloneRecords(r);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ARCADE_STORAGE_KEY, JSON.stringify(r));
    }
  } catch {
    // 저장소 차단/가득 참: 세션 내 메모리 복사본으로 계속 동작.
  }
}

export function recordMegaClear(timeSec: number, maxCombo: number): ArcadeRecords {
  const r = loadArcadeRecords();
  r.megaBoss.clearCount += 1;
  r.megaBoss.maxCombo = Math.max(r.megaBoss.maxCombo, maxCombo);
  if (r.megaBoss.bestTimeSec === null || timeSec < r.megaBoss.bestTimeSec) {
    r.megaBoss.bestTimeSec = timeSec;
  }
  saveArcadeRecords(r);
  return r;
}

export function recordRushRun(score: number, orders: number, maxCombo: number): ArcadeRecords {
  const r = loadArcadeRecords();
  r.orderRush.bestScore = Math.max(r.orderRush.bestScore, score);
  r.orderRush.maxOrders = Math.max(r.orderRush.maxOrders, orders);
  r.orderRush.maxCombo = Math.max(r.orderRush.maxCombo, maxCombo);
  saveArcadeRecords(r);
  return r;
}

export function recordDefenseRun(wave: number, surviveSec: number, destroyed: number): ArcadeRecords {
  const r = loadArcadeRecords();
  r.meteorDefense.bestWave = Math.max(r.meteorDefense.bestWave, wave);
  r.meteorDefense.bestSurviveSec = Math.max(r.meteorDefense.bestSurviveSec, surviveSec);
  r.meteorDefense.maxDestroyed = Math.max(r.meteorDefense.maxDestroyed, destroyed);
  saveArcadeRecords(r);
  return r;
}

// M:SS (60초 미만은 0:SS, 1시간 이상은 H:MM:SS).
export function formatArcadeTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
