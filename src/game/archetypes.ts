import { ArchetypeConfig, ArchetypeId } from '../types/game';

// v2.2 밸런스 패치 (2026-11-21): 아키타입 수치의 단일 출처. 플레이어·AI·
// 최종 보스가 모두 이 상수를 공유하므로, 수치 변경은 여기서만 하면 된다.
// (쿨다운은 아래 ARCHETYPES의 skillCooldown 필드가 단일 출처.)
// v3.0 Phase 1 (2026-11-22): 코어 전투 규칙 리워크 — 기본 체력, 전선·
// 상성·오버차지 배율, 스피드스터 분리 버프(블링크/대시) 상수도 여기에 둔다.

export const DEFAULT_PLAYER_HP = 120;
export const DEFAULT_CORE_HP = 300;
export const FRONTLINE_DMG_MULT = 1.2;
export const FRONTLINE_SPEED_MULT = 1.15;
export const MONOCHROME_RED_DMG_MULT = 1.15;
export const MONOCHROME_OVERDRIVE_MULT = 1.35;
// v3.0: Blood Overdrive self-damage on cast (6 HP; not spent at 10 HP
// or less).
export const MONOCHROME_SELF_DAMAGE = 6;
export const SNIPER_BIG_HIT_DMG_MULT = 1.1;
export const SNIPER_CORE_DMG_MULT = 0.4;
export const CLASH_ADVANTAGE_MULT = 1.75;
export const OVERCHARGE_SPEED_MULT = 1.35;
export const PAINTER_BIG_SPEED_MULT = 1.1;
export const SPEEDSTER_MOVE_SPEED = 460;
export const SPEEDSTER_DASH_COOLDOWN = 1.1;
export const SPEEDSTER_DASH_BUFF_SEC = 1.0;
export const SPEEDSTER_DASH_SPEED_MULT = 1.1;

export const LANCER_SPEAR_SPEED_MULT = 1.4;
export const SPEAR_SPEED_MULT = 1.8; // 스피어 기본 배율 (랜서 외)
export const MONOCHROME_SHIELD_MAX = 25;
// Hotfix (2026-11-21): monochrome absorb nerf — +8 shield per absorb,
// absorbed tiles refill in 1.0s, and shield gain has a 2.0s internal
// cooldown (absorbing during the cooldown still evaporates the cluster
// but grants no shield).
export const MONOCHROME_ABSORB_GAIN = 8;
export const MONOCHROME_ABSORB_REFILL_SEC = 1.0;
export const MONOCHROME_ABSORB_COOLDOWN_SEC = 2.0;
export const MONOCHROME_BLUE_CLASH_TAKEN_MULT = 1.5;
export const WAVE_WALL_CELL_HP_BONUS = 1;
export const TRANSPORTER_SWAP_BUFF_SEC = 1.5;
export const TRANSPORTER_SWAP_DMG_MULT = 1.15;
// v3.0: 스피드스터 버프 분리 — 블링크는 데미지 버프(1.5초, 3칸+ 발사
// +20%), 대시는 탄속 버프(1.0초, 첫 발사 탄속 +10%). 구 버프
// (블링크·대시 공통 +15% 속도·데미지)는 폐기됐다.
export const SPEEDSTER_FIRE_BUFF_SEC = 1.5;
export const SPEEDSTER_FIRE_DMG_MULT = 1.2;

export const ARCHETYPES: Record<ArchetypeId, ArchetypeConfig> = {
  lancer: {
    id: 'lancer',
    name: 'Lancer',
    nameKo: '랜서',
    title: '세로 특화 관통형',
    color: '#FF3366',
    accentHex: '#FF3366',
    badge: 'SPEAR',
    stats: { firepower: 4, mobility: 3, defense: 2 },
    skillName: '크림슨 랜스 (Crimson Lance)',
    skillCooldown: 4.8,
    passiveDesc: '세로 3칸 이상(스피어) 사출 시 탄속 1.40배 & 블록 내구도 +1',
    skillDesc: '현재 위치한 세로 열의 활성 타일 최대 3개를 즉시 적색(Red)으로 변환',
  },
  wave: {
    id: 'wave',
    name: 'Wave',
    nameKo: '웨이브',
    title: '가로 특화 장벽형',
    color: '#33CCFF',
    accentHex: '#33CCFF',
    badge: 'SHIELD',
    stats: { firepower: 3, mobility: 2, defense: 5 },
    skillName: '타이드 서지 (Tide Surge)',
    skillCooldown: 4.5,
    passiveDesc: '가로 3칸 이상(월) 사출 시 탄속 2배 & 셀 내구도 +1',
    skillDesc: '현재 위치한 가로 행의 빈칸 최대 3개를 즉시 청색(Blue)으로 리필',
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    nameKo: '스나이퍼',
    title: '1칸 속공 견제형',
    color: '#00FFAA',
    accentHex: '#00FFAA',
    badge: 'RAPID',
    stats: { firepower: 4, mobility: 3, defense: 2 },
    skillName: '피어싱 빔 (Piercing Beam)',
    skillCooldown: 4.2,
    passiveDesc: '3칸 미만의 1~2칸 낱개 타일도 즉시 사출 가능 (초고속 견제, 단 낱개 명중은 콤보를 쌓지 않음). 3칸+ 적중 시 데미지 +10%',
    skillDesc: '0.35초 조준선 예고 후 현재 열(Column)로 상대 보드까지 관통하는 빔 사출 (데미지 24)',
  },
  painter: {
    id: 'painter',
    name: 'Painter',
    nameKo: '페인터',
    title: '색상 조작 합체형',
    color: '#FF8800',
    accentHex: '#FF8800',
    badge: 'COLOR',
    stats: { firepower: 3, mobility: 2, defense: 3 },
    skillName: '크로마 인퓨전 (Chroma Infusion)',
    skillCooldown: 5.2,
    passiveDesc: '타일 사출 시 10% 확률로 십자 5칸을 보드 내 최다 색상으로 통일(쿨다운 해제). 5칸+ 발사 시 탄속 +10%',
    skillDesc: '발밑 타일 색으로 상하좌우 인접 활성 타일 최대 3개를 변환',
  },
  transporter: {
    id: 'transporter',
    name: 'Transporter',
    nameKo: '트랜스포터',
    title: '타일 스왑 전술형',
    color: '#B57EDC',
    accentHex: '#B57EDC',
    badge: 'SWAP',
    stats: { firepower: 2, mobility: 5, defense: 2 },
    skillName: '퀀텀 스왑 (Quantum Swap)',
    skillCooldown: 2.5,
    passiveDesc: '기본 이동 속도 +15% 증가. 스왑 직후 1.5초 내 4칸+ 클러스터 발사 시 데미지 +15% (보라색 링 표시)',
    skillDesc: '1회 눌러 발밑 타일 색상을 포획(Grab)하고, 다른 타일에서 눌러 맞바꿈(Swap)',
  },
  speedster: {
    id: 'speedster',
    name: 'Speedster',
    nameKo: '스피드스터',
    title: '가속 난사 기동형',
    color: '#FFCC00',
    accentHex: '#FFCC00',
    badge: 'SPEED',
    stats: { firepower: 3, mobility: 5, defense: 1 },
    skillName: '블링크 차지 (Blink Charge)',
    skillCooldown: 3.5,
    passiveDesc: '황색 타일 위에서 이동속도 +60% 가속, 빈칸 리필 속도 1.5배 증가. 블링크 직후 1.5초 내 첫 3칸+ 발사 데미지 +20%, 대시 직후 1.0초 내 첫 발사 탄속 +10%',
    skillDesc: '이동 방향으로 110px 순간이동하며 착지 타일을 황색으로 바꾸고 발밑 쿨다운을 즉시 복구',
  },
  monochrome: {
    id: 'monochrome',
    name: 'Monochrome',
    nameKo: '모노크롬',
    title: '적색 광전사 특화',
    color: '#FF0033',
    accentHex: '#FF0033',
    badge: 'BERSERK',
    stats: { firepower: 5, mobility: 2, defense: 3 },
    skillName: '블러드 오버드라이브 (Blood Overdrive)',
    skillCooldown: 5.0,
    passiveDesc: '오직 적색만 사출(적색 딜 +15%). 청/황색 밟고 사출 시 흡수(실드 +8, 상한 25, 1.0초 리필, 흡수 2.0초 내부 쿨다운, 디스카드 스택 1개 소모). 청색 충돌 피해는 1.5배로 경감',
    skillDesc: '보드의 활성 타일 3개를 즉시 적색으로 물들이며 다음 타격 1.35배 증폭 (발동 시 자해 HP 6, HP 10 이하에서는 미소모)',
  },
};

export const ARCHETYPE_LIST: ArchetypeConfig[] = Object.values(ARCHETYPES);
