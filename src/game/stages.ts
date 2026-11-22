import { AiLevel, StageConfig } from '../types/game';

// v3.0 Phase 3: 5 sectors x 6 stages = 30 stages (v3.0 체력 기준).
// Composition: tutorial 1 + single-archetype 7 + hybrid 21 + final boss 1.
// Every stage is data-only; AIController reads archetypes / aiLevel / hp /
// coreHp directly, and the difficulty numbers come from aiLevelStats()
// (linear interpolation).
export const STAGES: StageConfig[] = [
  // ---- Sector 1: 틸 실험실 (aiLevel 1) ----
  {
    id: 1, sector: 1, name: 'Proto-AI Grid', nameKo: '스테이지 1: 프로토-AI',
    desc: '기본적인 3칸 클러스터를 느린 주기로 사출합니다. 조작감과 바닥 버리기(L 키)를 숙달하기 좋습니다.',
    archetypes: [], hp: 120, coreHp: 240, aiLevel: 1, isBoss: false,
  },
  {
    id: 2, sector: 1, name: 'Crimson Vanguard', nameKo: '스테이지 2: 크림슨 뱅가드',
    desc: '세로 스피어를 앞세우는 관통형 AI. 전선 1~2행에서 쏘는 붉은 창을 조심하세요.',
    archetypes: ['lancer'], hp: 120, coreHp: 300, aiLevel: 1, isBoss: false,
  },
  {
    id: 3, sector: 1, name: 'Cobalt Wall', nameKo: '스테이지 3: 코발트 월',
    desc: '가로 월을 쌓아 중앙 5열을 지키는 장벽형 AI. 청색 블록을 먼저 깨뜨리세요.',
    archetypes: ['wave'], hp: 120, coreHp: 300, aiLevel: 1, isBoss: false,
  },
  {
    id: 4, sector: 1, name: 'Emerald Sight', nameKo: '스테이지 4: 에메랄드 사이트',
    desc: '1~2칸 낱개 타일도 즉시 사출하는 속공형 AI. 같은 열에 오래 서 있지 마세요.',
    archetypes: ['sniper'], hp: 120, coreHp: 300, aiLevel: 1, isBoss: false,
  },
  {
    id: 5, sector: 1, name: 'Volt Runner', nameKo: '스테이지 5: 볼트 러너',
    desc: '황색 타일 위를 질주하며 위협을 피해 다니는 기동형 AI. 대형 블록을 노립니다.',
    archetypes: ['speedster'], hp: 120, coreHp: 300, aiLevel: 1, isBoss: false,
  },
  {
    id: 6, sector: 1, name: 'Spear Aegis', nameKo: '스테이지 6: 스피어 이지스 [섹터 보스]',
    desc: '랜서와 웨이브의 하이브리드. 창과 방벽을 번갈아 쓰며 섹터 1의 문을 지킵니다.',
    archetypes: ['lancer', 'wave'], hp: 150, coreHp: 340, aiLevel: 1,
    isSectorBoss: true, isBoss: false,
  },
  // ---- Sector 2: 벡터 선 (aiLevel 2) ----
  {
    id: 7, sector: 2, name: 'Quantum Broker', nameKo: '스테이지 7: 퀀텀 브로커',
    desc: '타일을 맞바꿔 4칸 이상 클러스터를 완성하는 전술형 AI. 스왑 각을 읽으세요.',
    archetypes: ['transporter'], hp: 120, coreHp: 300, aiLevel: 2, isBoss: false,
  },
  {
    id: 8, sector: 2, name: 'Prism Artist', nameKo: '스테이지 8: 프리즘 아티스트',
    desc: '십자 5칸을 최다 색상으로 통일해 빅 블록을 만드는 합체형 AI.',
    archetypes: ['painter'], hp: 120, coreHp: 300, aiLevel: 2, isBoss: false,
  },
  {
    id: 9, sector: 2, name: 'Scarlet Shadow', nameKo: '스테이지 9: 스칼렛 섀도우',
    desc: '적색만 사출하는 광전사. 청·황색을 흡수해 실드를 쌓습니다.',
    archetypes: ['monochrome'], hp: 130, coreHp: 300, aiLevel: 2, isBoss: false,
  },
  {
    id: 10, sector: 2, name: 'Flash Shot', nameKo: '스테이지 10: 플래시 샷',
    desc: '스나이퍼와 스피드스터의 하이브리드. 정렬 저격과 블링크 회피를 병행합니다.',
    archetypes: ['sniper', 'speedster'], hp: 130, coreHp: 300, aiLevel: 2, isBoss: false,
  },
  {
    id: 11, sector: 2, name: 'Blitz Lance', nameKo: '스테이지 11: 블리츠 랜스',
    desc: '랜서와 스피드스터의 하이브리드. 전선에서 쏘는 고속 스피어가 위협적입니다.',
    archetypes: ['lancer', 'speedster'], hp: 130, coreHp: 300, aiLevel: 2, isBoss: false,
  },
  {
    id: 12, sector: 2, name: 'Phantom Shifter', nameKo: '스테이지 12: 팬텀 시프터 [섹터 보스]',
    desc: '트랜스포터와 스피드스터의 하이브리드. 스왑과 블링크로 종잡을 수 없이 움직입니다.',
    archetypes: ['transporter', 'speedster'], hp: 170, coreHp: 360, aiLevel: 2,
    isSectorBoss: true, isBoss: false,
  },
  // ---- Sector 3: 파란 요새 (aiLevel 3) ----
  {
    id: 13, sector: 3, name: 'Aegis Beam', nameKo: '스테이지 13: 에이지스 빔',
    desc: '웨이브와 스나이퍼의 하이브리드. 방벽 뒤에서 정렬 저격을 노립니다.',
    archetypes: ['wave', 'sniper'], hp: 140, coreHp: 330, aiLevel: 3, isBoss: false,
  },
  {
    id: 14, sector: 3, name: 'Shift Barrier', nameKo: '스테이지 14: 시프트 배리어',
    desc: '웨이브와 트랜스포터의 하이브리드. 스왑으로 방벽을 재배치합니다.',
    archetypes: ['wave', 'transporter'], hp: 140, coreHp: 330, aiLevel: 3, isBoss: false,
  },
  {
    id: 15, sector: 3, name: 'Pulse Tide', nameKo: '스테이지 15: 펄스 타이드',
    desc: '웨이브와 스피드스터의 하이브리드. 빠른 월 사출과 황색 질주를 겸합니다.',
    archetypes: ['wave', 'speedster'], hp: 140, coreHp: 330, aiLevel: 3, isBoss: false,
  },
  {
    id: 16, sector: 3, name: 'Piercing Spike', nameKo: '스테이지 16: 피어싱 스파이크',
    desc: '랜서와 스나이퍼의 하이브리드. 관통 스피어와 정렬 빔을 교차 사용합니다.',
    archetypes: ['lancer', 'sniper'], hp: 140, coreHp: 330, aiLevel: 3, isBoss: false,
  },
  {
    id: 17, sector: 3, name: 'Warp Deadeye', nameKo: '스테이지 17: 워프 데드아이',
    desc: '스나이퍼와 트랜스포터의 하이브리드. 스왑으로 저격 각을 만듭니다.',
    archetypes: ['sniper', 'transporter'], hp: 140, coreHp: 330, aiLevel: 3, isBoss: false,
  },
  {
    id: 18, sector: 3, name: 'Aqua Fortress', nameKo: '스테이지 18: 아쿠아 포트리스 [섹터 보스]',
    desc: '웨이브와 페인터의 하이브리드. 청색 방벽과 색상 통일로 요새를 굳힙니다.',
    archetypes: ['wave', 'painter'], hp: 190, coreHp: 400, aiLevel: 3,
    isSectorBoss: true, isBoss: false,
  },
  // ---- Sector 4: 보라 코어 (aiLevel 4) ----
  {
    id: 19, sector: 4, name: 'Crimson Brush', nameKo: '스테이지 19: 크림슨 브러시',
    desc: '랜서와 페인터의 하이브리드. 적색 창과 색상 통일로 빅 블록을 노립니다.',
    archetypes: ['lancer', 'painter'], hp: 150, coreHp: 360, aiLevel: 4, isBoss: false,
  },
  {
    id: 20, sector: 4, name: 'Phase Impaler', nameKo: '스테이지 20: 페이즈 임팔러',
    desc: '랜서와 트랜스포터의 하이브리드. 스왑으로 스피어 각을 만듭니다.',
    archetypes: ['lancer', 'transporter'], hp: 150, coreHp: 360, aiLevel: 4, isBoss: false,
  },
  {
    id: 21, sector: 4, name: 'Chroma Lock-on', nameKo: '스테이지 21: 크로마 록온',
    desc: '스나이퍼와 페인터의 하이브리드. 색상 통일로 저격 라인을 만듭니다.',
    archetypes: ['sniper', 'painter'], hp: 150, coreHp: 360, aiLevel: 4, isBoss: false,
  },
  {
    id: 22, sector: 4, name: 'Palette Shifter', nameKo: '스테이지 22: 팔레트 시프터',
    desc: '페인터와 트랜스포터의 하이브리드. 보드 전체를 설계하듯 다시 짭니다.',
    archetypes: ['painter', 'transporter'], hp: 160, coreHp: 360, aiLevel: 4, isBoss: false,
  },
  {
    id: 23, sector: 4, name: 'Neon Blur', nameKo: '스테이지 23: 네온 블러',
    desc: '페인터와 스피드스터의 하이브리드. 빠른 색상 통일과 대형 블록 파밍.',
    archetypes: ['painter', 'speedster'], hp: 160, coreHp: 360, aiLevel: 4, isBoss: false,
  },
  {
    id: 24, sector: 4, name: 'Blood Deadeye', nameKo: '스테이지 24: 블러드 데드아이 [섹터 보스]',
    desc: '모노크롬과 스나이퍼의 하이브리드. 적색 광전사의 정렬 저격이 치명적입니다.',
    archetypes: ['monochrome', 'sniper'], hp: 210, coreHp: 420, aiLevel: 4,
    isSectorBoss: true, isBoss: false,
  },
  // ---- Sector 5: 적·흑 왕좌 (aiLevel 5) ----
  {
    id: 25, sector: 5, name: 'Abyss Swap', nameKo: '스테이지 25: 어비스 스왑',
    desc: '모노크롬과 트랜스포터의 하이브리드. 적색 흡수와 스왑을 병행합니다.',
    archetypes: ['monochrome', 'transporter'], hp: 170, coreHp: 380, aiLevel: 5, isBoss: false,
  },
  {
    id: 26, sector: 5, name: 'Crimson Dash', nameKo: '스테이지 26: 크림슨 대시',
    desc: '모노크롬과 스피드스터의 하이브리드. 적색 질주와 블링크 회피.',
    archetypes: ['monochrome', 'speedster'], hp: 170, coreHp: 380, aiLevel: 5, isBoss: false,
  },
  {
    id: 27, sector: 5, name: 'Blood Barrier', nameKo: '스테이지 27: 블러드 배리어',
    desc: '모노크롬과 웨이브의 하이브리드. 적색 방벽으로 코어를 사수합니다.',
    archetypes: ['monochrome', 'wave'], hp: 180, coreHp: 400, aiLevel: 5, isBoss: false,
  },
  {
    id: 28, sector: 5, name: 'Impaler Overload', nameKo: '스테이지 28: 임팔러 오버로드',
    desc: '모노크롬과 랜서의 하이브리드. 적색 스피어의 화력이 극에 달합니다.',
    archetypes: ['monochrome', 'lancer'], hp: 180, coreHp: 400, aiLevel: 5, isBoss: false,
  },
  {
    id: 29, sector: 5, name: 'Scarlet Canvas', nameKo: '스테이지 29: 스칼렛 캔버스',
    desc: '모노크롬과 페인터의 하이브리드. 적색 통일 빅 블록이 왕좌를 지킵니다.',
    archetypes: ['monochrome', 'painter'], hp: 200, coreHp: 420, aiLevel: 5, isBoss: false,
  },
  {
    id: 30, sector: 5, name: 'OMNI-OVERLORD [FINAL BOSS]', nameKo: '파이널 보스: 옴니-오버로드',
    desc: '7종 스킬 완전 탑재. HP 또는 코어 50% 이하에서 2페이즈 각성(OMNI-AWAKENING)합니다.',
    archetypes: ['lancer', 'wave', 'sniper', 'painter', 'transporter', 'speedster', 'monochrome'],
    hp: 300, coreHp: 500, aiLevel: 5,
    isFinalBoss: true, isBoss: true, bossSkillInterval: 3.5,
  },
];

export const MAX_STAGES = STAGES.length;

export function getStage(id: number): StageConfig {
  return STAGES[Math.max(0, Math.min(id - 1, STAGES.length - 1))];
}

export const SECTOR_NAMES: Record<number, string> = {
  1: '틸 실험실',
  2: '벡터 선',
  3: '파란 요새',
  4: '보라 코어',
  5: '적·흑 왕좌',
};

// Background accent per sector (shared theme; even stages and sector
// bosses add a tint overlay on top in the renderer).
export const SECTOR_THEMES: Record<number, { accent: string; grid: string }> = {
  1: { accent: '#14B8A6', grid: 'rgba(45, 212, 191, 0.12)' },
  2: { accent: '#60A5FA', grid: 'rgba(96, 165, 250, 0.12)' },
  3: { accent: '#3B82F6', grid: 'rgba(59, 130, 246, 0.12)' },
  4: { accent: '#A855F7', grid: 'rgba(168, 85, 247, 0.12)' },
  5: { accent: '#EF4444', grid: 'rgba(239, 68, 68, 0.12)' },
};

export interface AiLevelStats {
  reaction: number; // decision interval, seconds
  moveSpeed: number; // px/s
  launchWait: number; // seconds before the AI may launch again
  // Random score noise (human-like mistakes): L1 ±25%, L2 ±15%, L3 ±7%,
  // L4/L5 0 (optimal play only). Linear endpoints are spec'd; the L3
  // value is a judgement call between them.
  noise: number;
}

// v3.0 Phase 3: difficulty numbers are a linear interpolation over
// aiLevel 1..5 (spec endpoints: reaction 0.75->0.25s, move 260->420,
// launch wait 1.0->0.45s).
export function aiLevelStats(level: AiLevel): AiLevelStats {
  const t = level - 1; // 0..4
  return {
    reaction: 0.75 - 0.125 * t, // 0.75, 0.625, 0.5, 0.375, 0.25
    moveSpeed: 260 + 40 * t, // 260, 300, 340, 380, 420
    launchWait: 1.0 - 0.1375 * t, // 1.0, 0.8625, 0.725, 0.5875, 0.45
    noise: level <= 1 ? 0.25 : level === 2 ? 0.15 : level === 3 ? 0.07 : 0,
  };
}
