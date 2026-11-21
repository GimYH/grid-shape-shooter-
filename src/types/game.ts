export type TileColor = 'red' | 'blue' | 'yellow';

export type ArchetypeId =
  | 'lancer'
  | 'wave'
  | 'sniper'
  | 'painter'
  | 'transporter'
  | 'speedster'
  | 'monochrome';

export type ShapePatternType =
  | 'spear'    // Vertical line >= 3
  | 'wall'     // Horizontal line >= 3
  | 'homing'   // 2x2 square
  | 'meteor'   // T or Cross shape >= 5
  | 'standard';// General cluster

export interface ArchetypeConfig {
  id: ArchetypeId;
  name: string;
  nameKo: string;
  title: string;
  color: string;
  accentHex: string;
  skillName: string;
  skillCooldown: number; // in seconds
  passiveDesc: string;
  skillDesc: string;
  badge: string;
}

export interface GridTile {
  col: number; // 0 to 8
  row: number; // 0 to 4
  color: TileColor | null; // null when cooldown/empty
  cooldownRemaining: number; // in seconds
  cooldownMax: number; // cooldown this tile started with (reload ring)
  pulsePhase: number;
}

export interface Cluster {
  id: string;
  color: TileColor;
  tiles: { col: number; row: number }[];
  isActivePad: boolean;
  shapeType: ShapePatternType;
  shapeTitle: string;
}

export interface ProjectileCell {
  relCol: number; // relative col offset from anchor
  relRow: number; // relative row offset from anchor
  hp: number; // cell durability
  maxHp: number;
  destroyed: boolean;
}

export interface ShapeProjectile {
  id: string;
  owner: 'player' | 'enemy';
  color: TileColor;
  shapeType: ShapePatternType;
  // v2.2: who launched it (monochrome type exception, sniper core
  // damage). 'standard' for AI launches.
  archetypeId?: string;
  x: number; // world X (center or anchor)
  y: number; // world Y
  vx: number;
  vy: number;
  cellWidth: number;
  cellHeight: number;
  cells: ProjectileCell[]; // shape configuration
  damagePerCell: number;
  speedMultiplier: number;
  glowColor: string;
  trailTimer: number;
  // v2.4 royale: whether the launch counted as frontline (kept so the
  // portal packet can carry it without recomputing it mid-flight).
  frontline?: boolean;
  // v2.4 royale: true for sniper beams (one-off snipes, ignoreCounter).
  isBeam?: boolean;
  // v2.4 royale: the player id the projectile came from (kill credit).
  fromPlayerId?: string;
  targetColX?: number; // For homing
  isMeteorExploding?: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  shape?: 'circle' | 'square' | 'line' | 'ring' | 'shard';
  // Shard fragments tumble as they fly (radians / radians per second).
  angle?: number;
  spin?: number;
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  alpha: number;
  life: number;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  alpha: number;
}

export type GameMode = 'single' | 'multi' | 'boss' | 'royale';

export type AiLevel = 1 | 2 | 3 | 4 | 5;

// v2.3: 30-stage campaign. Every stage is data-only: AIController reads
// the config (archetypes, aiLevel, hp, coreHp) directly, and the
// difficulty numbers (reaction interval, move speed, launch wait) are
// derived from aiLevel by linear interpolation in stages.ts.
export interface StageConfig {
  id: number; // 1..30
  sector: 1 | 2 | 3 | 4 | 5;
  name: string;
  nameKo: string;
  desc: string;
  // 0 = tutorial (no archetype), 1 = single, 2 = hybrid, 7 = final boss.
  archetypes: ArchetypeId[];
  hp: number;
  coreHp: number; // rear core HP
  aiLevel: AiLevel;
  isSectorBoss?: boolean;
  isFinalBoss?: boolean;
  // Legacy compat: true only for the final boss (stage 30).
  isBoss: boolean;
  // Final boss skill cadence base (seconds); phase 2 shortens it.
  bossSkillInterval?: number;
}

// Campaign progress (v2.3, persisted in localStorage).
export interface NoContinueRecord {
  timeSec: number; // total clear time for the 1..30 run
  clearedAt: string; // ISO date
}

export interface CampaignProgress {
  maxCleared: number; // 0..30
  noContinue: NoContinueRecord | null;
}

// Rear core state (v2.2): one per side. `collapsed` turns on when the core
// drops to 50% or below and the board's outer columns lock.
export interface CoreState {
  hp: number;
  maxHp: number;
  collapsed: boolean;
  // Crack stage shown on the core: 0 intact, 1 at/below 60%, 2 at/below 30%.
  crack: 0 | 1 | 2;
}

export type ShrinkPhase = 'idle' | 'warning' | 'shrinking' | 'closed';

// Safe-zone rectangle in canvas coordinates, or null while the shrink zone
// has not started. One per board side.
export interface ShrinkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GameStats {
  damageDealt: number;
  damageTaken: number;
  shapesLaunched: number;
  tilesDiscarded: number;
  clashesWon: number;
  maxClusterSize: number;
  maxCombo: number;
  gameDuration: number;
  currentStage: number;
}

// Explicit, packet-carried result of a random skill effect (wave row refill,
// monochrome random conversion). The player who fires the skill rolls locally
// and sends the exact tiles, so the remote side applies the same tiles
// instead of rolling its own. Rolling on both sides with a seeded RNG is not
// enough: different frame timing changes the draw order and the boards drift.
export type SkillEffect =
  | { kind: 'wave'; tiles: { col: number; row: number; color: TileColor }[] }
  | { kind: 'monochrome'; tiles: { col: number; row: number }[] };

