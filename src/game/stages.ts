import { AiLevel, StageConfig } from '../types/game';

// v2.3: 5 sectors x 6 stages = 30 stages. Composition: tutorial 1 +
// single-archetype 7 + hybrid 21 + final boss 1. Every stage is data-only;
// AIController reads archetypes / aiLevel / hp / coreHp directly, and the
// difficulty numbers come from aiLevelStats() (linear interpolation).
export const STAGES: StageConfig[] = [
  // ---- Sector 1: 틸 실험실 (aiLevel 1) ----
  {
    id: 1, sector: 1, name: 'Proto-AI Grid', nameKo: '스테이지 1: 프로토-AI',
    desc: '기본적인 3칸 클러스터를 느린 주기로 사출합니다. 조작감과 바닥 버리기(L 키)를 숙달하기 좋습니다.',
    archetypes: [], hp: 100, coreHp: 200, aiLevel: 1, isBoss: false,
  },
  {
    id: 2, sector: 1, name: 'Crimson Lancer', nameKo: '스테이지 2: 크림슨 랜서',
    desc: '세로 스피어를 앞세우는 관통형 AI. 전선 1~2행에서 쏘는 붉은 창을 조심하세요.',
    archetypes: ['lancer'], hp: 100, coreHp: 250, aiLevel: 1, isBoss: false,
  },
  {
    id: 3, sector: 1, name: 'Tide Sentinel', nameKo: '스테이지 3: 타이드 센티널',
    desc: '가로 월을 쌓아 중앙 3열을 지키는 장벽형 AI. 청색 블록을 먼저 깨뜨리세요.',
    archetypes: ['wave'], hp: 100, coreHp: 250, aiLevel: 1, isBoss: false,
  },
  {
    id: 4, sector: 1, name: 'Rapid Sniper', nameKo: '스테이지 4: 래피드 스나이퍼',
    desc: '1~2칸 낱개 타일도 즉시 사출하는 속공형 AI. 같은 열에 오래 서 있지 마세요.',
    archetypes: ['sniper'], hp: 100, coreHp: 250, aiLevel: 1, isBoss: false,
  },
  {
    id: 5, sector: 1, name: 'Vector Hunter', nameKo: '스테이지 5: 벡터 헌터',
    desc: '황색 타일 위를 질주하며 위협을 피해 다니는 기동형 AI. 대형 블록을 노립니다.',
    archetypes: ['speedster'], hp: 100, coreHp: 250, aiLevel: 1, isBoss: false,
  },
  {
    id: 6, sector: 1, name: 'Spear Aegis', nameKo: '스테이지 6: 스피어 이지스 [섹터 보스]',
    desc: '랜서와 웨이브의 하이브리드. 창과 방벽을 번갈아 쓰며 섹터 1의 문을 지킵니다.',
    archetypes: ['lancer', 'wave'], hp: 130, coreHp: 280, aiLevel: 1,
    isSectorBoss: true, isBoss: false,
  },
  // ---- Sector 2: 벡터 선 (aiLevel 2) ----
  {
    id: 7, sector: 2, name: 'Quantum Swapper', nameKo: '스테이지 7: 퀀텀 스왑퍼',
    desc: '타일을 맞바꿔 5칸 이상 클러스터를 완성하는 전술형 AI. 스왑 각을 읽으세요.',
    archetypes: ['transporter'], hp: 100, coreHp: 250, aiLevel: 2, isBoss: false,
  },
  {
    id: 8, sector: 2, name: 'Chroma Painter', nameKo: '스테이지 8: 크로마 페인터',
    desc: '십자 5칸을 최다 색상으로 통일해 빅 블록을 만드는 합체형 AI.',
    archetypes: ['painter'], hp: 100, coreHp: 250, aiLevel: 2, isBoss: false,
  },
  {
    id: 9, sector: 2, name: 'Blood Monochrome', nameKo: '스테이지 9: 블러드 모노크롬',
    desc: '적색만 사출하는 광전사. 청·황색을 흡수해 실드를 쌓습니다.',
    archetypes: ['monochrome'], hp: 110, coreHp: 250, aiLevel: 2, isBoss: false,
  },
  {
    id: 10, sector: 2, name: 'Hawkeye Blink', nameKo: '스테이지 10: 호크아이 블링크',
    desc: '스나이퍼와 스피드스터의 하이브리드. 정렬 저격과 블링크 회피를 병행합니다.',
    archetypes: ['sniper', 'speedster'], hp: 110, coreHp: 250, aiLevel: 2, isBoss: false,
  },
  {
    id: 11, sector: 2, name: 'Volt Lancer', nameKo: '스테이지 11: 볼트 랜서',
    desc: '랜서와 스피드스터의 하이브리드. 전선에서 쏘는 고속 스피어가 위협적입니다.',
    archetypes: ['lancer', 'speedster'], hp: 110, coreHp: 250, aiLevel: 2, isBoss: false,
  },
  {
    id: 12, sector: 2, name: 'Phantom Shifter', nameKo: '스테이지 12: 팬텀 시프터 [섹터 보스]',
    desc: '트랜스포터와 스피드스터의 하이브리드. 스왑과 블링크로 종잡을 수 없이 움직입니다.',
    archetypes: ['transporter', 'speedster'], hp: 140, coreHp: 300, aiLevel: 2,
    isSectorBoss: true, isBoss: false,
  },
  // ---- Sector 3: 파란 요새 (aiLevel 3) ----
  {
    id: 13, sector: 3, name: 'Aegis Sniper', nameKo: '스테이지 13: 이지스 스나이퍼',
    desc: '웨이브와 스나이퍼의 하이브리드. 방벽 뒤에서 정렬 저격을 노립니다.',
    archetypes: ['wave', 'sniper'], hp: 120, coreHp: 280, aiLevel: 3, isBoss: false,
  },
  {
    id: 14, sector: 3, name: 'Quantum Barrier', nameKo: '스테이지 14: 퀀텀 배리어',
    desc: '웨이브와 트랜스포터의 하이브리드. 스왑으로 방벽을 재배치합니다.',
    archetypes: ['wave', 'transporter'], hp: 120, coreHp: 280, aiLevel: 3, isBoss: false,
  },
  {
    id: 15, sector: 3, name: 'Surge Runner', nameKo: '스테이지 15: 서지 러너',
    desc: '웨이브와 스피드스터의 하이브리드. 빠른 월 사출과 황색 질주를 겸합니다.',
    archetypes: ['wave', 'speedster'], hp: 120, coreHp: 280, aiLevel: 3, isBoss: false,
  },
  {
    id: 16, sector: 3, name: 'Piercing Lancer', nameKo: '스테이지 16: 피어싱 창병',
    desc: '랜서와 스나이퍼의 하이브리드. 관통 스피어와 정렬 빔을 교차 사용합니다.',
    archetypes: ['lancer', 'sniper'], hp: 120, coreHp: 280, aiLevel: 3, isBoss: false,
  },
  {
    id: 17, sector: 3, name: 'Mirage Sniper', nameKo: '스테이지 17: 미라지 저격수',
    desc: '스나이퍼와 트랜스포터의 하이브리드. 스왑으로 저격 각을 만듭니다.',
    archetypes: ['sniper', 'transporter'], hp: 120, coreHp: 280, aiLevel: 3, isBoss: false,
  },
  {
    id: 18, sector: 3, name: 'Aqua Fortress', nameKo: '스테이지 18: 아쿠아 포트리스 [섹터 보스]',
    desc: '웨이브와 페인터의 하이브리드. 청색 방벽과 색상 통일로 요새를 굳힙니다.',
    archetypes: ['wave', 'painter'], hp: 160, coreHp: 330, aiLevel: 3,
    isSectorBoss: true, isBoss: false,
  },
  // ---- Sector 4: 보라 코어 (aiLevel 4) ----
  {
    id: 19, sector: 4, name: 'Scarlet Artist', nameKo: '스테이지 19: 스칼렛 아티스트',
    desc: '랜서와 페인터의 하이브리드. 적색 창과 색상 통일로 빅 블록을 노립니다.',
    archetypes: ['lancer', 'painter'], hp: 130, coreHp: 300, aiLevel: 4, isBoss: false,
  },
  {
    id: 20, sector: 4, name: 'Quantum Lancer', nameKo: '스테이지 20: 퀀텀 란서',
    desc: '랜서와 트랜스포터의 하이브리드. 스왑으로 스피어 각을 만듭니다.',
    archetypes: ['lancer', 'transporter'], hp: 130, coreHp: 300, aiLevel: 4, isBoss: false,
  },
  {
    id: 21, sector: 4, name: 'Prism Sniper', nameKo: '스테이지 21: 프리즘 스나이퍼',
    desc: '스나이퍼와 페인터의 하이브리드. 색상 통일로 저격 라인을 만듭니다.',
    archetypes: ['sniper', 'painter'], hp: 130, coreHp: 300, aiLevel: 4, isBoss: false,
  },
  {
    id: 22, sector: 4, name: 'Prism Architect', nameKo: '스테이지 22: 프리즘 아키텍트',
    desc: '페인터와 트랜스포터의 하이브리드. 보드 전체를 설계하듯 다시 짭니다.',
    archetypes: ['painter', 'transporter'], hp: 140, coreHp: 300, aiLevel: 4, isBoss: false,
  },
  {
    id: 23, sector: 4, name: 'Hyper Canvas', nameKo: '스테이지 23: 하이퍼 캔버스',
    desc: '페인터와 스피드스터의 하이브리드. 빠른 색상 통일과 대형 블록 파밍.',
    archetypes: ['painter', 'speedster'], hp: 140, coreHp: 300, aiLevel: 4, isBoss: false,
  },
  {
    id: 24, sector: 4, name: 'Blood Deadeye', nameKo: '스테이지 24: 블러드 데드아이 [섹터 보스]',
    desc: '모노크롬과 스나이퍼의 하이브리드. 적색 광전사의 정렬 저격이 치명적입니다.',
    archetypes: ['monochrome', 'sniper'], hp: 180, coreHp: 350, aiLevel: 4,
    isSectorBoss: true, isBoss: false,
  },
  // ---- Sector 5: 적·흑 왕좌 (aiLevel 5) ----
  {
    id: 25, sector: 5, name: 'Crimson Shifter', nameKo: '스테이지 25: 크림슨 쉬프터',
    desc: '모노크롬과 트랜스포터의 하이브리드. 적색 흡수와 스왑을 병행합니다.',
    archetypes: ['monochrome', 'transporter'], hp: 150, coreHp: 320, aiLevel: 5, isBoss: false,
  },
  {
    id: 26, sector: 5, name: 'Blood Runner', nameKo: '스테이지 26: 블러드 러너',
    desc: '모노크롬과 스피드스터의 하이브리드. 적색 질주와 블링크 회피.',
    archetypes: ['monochrome', 'speedster'], hp: 150, coreHp: 320, aiLevel: 5, isBoss: false,
  },
  {
    id: 27, sector: 5, name: 'Blood Fortress', nameKo: '스테이지 27: 블러드 포트리스',
    desc: '모노크롬과 웨이브의 하이브리드. 적색 방벽으로 코어를 사수합니다.',
    archetypes: ['monochrome', 'wave'], hp: 160, coreHp: 350, aiLevel: 5, isBoss: false,
  },
  {
    id: 28, sector: 5, name: 'Crimson Berserker', nameKo: '스테이지 28: 크림슨 버서커',
    desc: '모노크롬과 랜서의 하이브리드. 적색 스피어의 화력이 극에 달합니다.',
    archetypes: ['monochrome', 'lancer'], hp: 160, coreHp: 350, aiLevel: 5, isBoss: false,
  },
  {
    id: 29, sector: 5, name: 'Scarlet Overlord', nameKo: '스테이지 29: 스칼렛 오버로드',
    desc: '모노크롬과 페인터의 하이브리드. 적색 통일 빅 블록이 왕좌를 지킵니다.',
    archetypes: ['monochrome', 'painter'], hp: 180, coreHp: 350, aiLevel: 5, isBoss: false,
  },
  {
    id: 30, sector: 5, name: 'OMNI-OVERLORD [FINAL BOSS]', nameKo: '파이널 보스: 옴니-오버로드',
    desc: '7종 스킬 완전 탑재. HP 또는 코어 50% 이하에서 2페이즈 각성(OMNI-AWAKENING)합니다.',
    archetypes: ['lancer', 'wave', 'sniper', 'painter', 'transporter', 'speedster', 'monochrome'],
    hp: 250, coreHp: 400, aiLevel: 5,
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

// v2.3: difficulty numbers are a linear interpolation over aiLevel 1..5.
export function aiLevelStats(level: AiLevel): AiLevelStats {
  const t = level - 1; // 0..4
  return {
    reaction: 0.75 - 0.125 * t, // 0.75, 0.625, 0.5, 0.375, 0.25
    moveSpeed: 260 + 40 * t, // 260, 300, 340, 380, 420
    launchWait: 1.0 - 0.125 * t, // 1.0, 0.875, 0.75, 0.625, 0.5
    noise: level <= 1 ? 0.25 : level === 2 ? 0.15 : level === 3 ? 0.07 : 0,
  };
}
