// ---------------------------------------------------------------------------
// GRID ROYALE (v2.4): shared pure module for the up-to-8-player battle
// royale. Imported by BOTH the Node server (server.ts) and the browser
// client (GameEngine / NetworkManager), so it must stay DOM-free: no
// window, document, canvas or audio access here.
// ---------------------------------------------------------------------------
import { ArchetypeId, ShapePatternType, TileColor } from '../types/game';

export const ROYALE_MAX_PLAYERS = 8;
export const ROYALE_MIN_PLAYERS = 2;
// Portal line: a player projectile that crosses Y <= 80 is warped to its
// target's portal instead of hitting a top board.
export const ROYALE_PORTAL_Y = 80;
// Seconds between an incoming projectile's warning line and its spawn.
export const ROYALE_INCOMING_WARNING_SEC = 0.4;

// KO rewards (spec §4.3).
export const ROYALE_KO_HP_REWARD = 20;
export const ROYALE_KO_CORE_REWARD = 40;
export const ROYALE_KO_DMG_BUFF_STEP = 0.1; // +10% per KO
export const ROYALE_KO_DMG_BUFF_MAX = 5; // max +50%

// Gang-up compensation (spec §4.3): targeted by 3+ players at once.
export const ROYALE_GANGUP_THRESHOLD = 3;
export const ROYALE_GANGUP_REFILL_MULT = 1.15;

export type RoyaleTargetMode = 'random' | 'ko' | 'counter' | 'leader';

export const ROYALE_TARGET_MODES: {
  mode: RoyaleTargetMode;
  key: string;
  labelKo: string;
  descKo: string;
}[] = [
  { mode: 'random', key: '1', labelKo: '무작위', descKo: '생존자 중 무작위 1명' },
  { mode: 'ko', key: '2', labelKo: '마무리', descKo: '체력 합이 가장 낮은 적' },
  { mode: 'counter', key: '3', labelKo: '카운터', descKo: '나를 노리는 적 순환' },
  { mode: 'leader', key: '4', labelKo: '선두', descKo: 'KO 수 1위' },
];

export function royaleTargetModeLabel(mode: RoyaleTargetMode): string {
  return ROYALE_TARGET_MODES.find((m) => m.mode === mode)?.labelKo ?? '무작위';
}

// One player's public royale state. The server is authoritative; clients
// keep a copy from royale_status / royale_ko broadcasts.
export interface RoyalePlayerInfo {
  id: string;
  name: string;
  archetype: ArchetypeId;
  isBot: boolean;
  isHost: boolean;
  hp: number;
  coreHp: number;
  kos: number;
  alive: boolean;
  // Rank assigned on elimination (1 = winner, 8 = first out in an 8p game).
  rank: number | null;
  targetMode: RoyaleTargetMode;
  // Player ids this player is currently targeting (usually 1 entry).
  targetingIds: string[];
  // Lobby ready flag (pre-battle only; not part of the 4 battle packets).
  ready: boolean;
}

// One projectile cell as it travels through a portal. `col` is the target
// board column the cell will occupy (0..8); `damage` is the final per-cell
// damage (frontline / monochrome / overdrive / KO buff already applied by
// the sender), so the target applies it verbatim.
export interface RoyaleFireCell {
  col: number;
  hp: number;
  damage: number;
}

// Client -> Server, sent once when a projectile crosses the portal.
export interface RoyaleFirePacket {
  targetMode: RoyaleTargetMode;
  color: TileColor;
  shape: ShapePatternType;
  cells: RoyaleFireCell[];
  speed: number; // |vy| px/s of the sender's projectile
  isFrontline: boolean;
  // True for one-off snipes (sniper beam): the fire does not register the
  // sender in the target's "attackers" list, so COUNTER cannot pick them
  // up from it. (Interpretation: the spec lists the field without
  // defining it; a beam is instant and untraceable, unlike a launched
  // block that keeps flying.)
  ignoreCounter: boolean;
}

// Server -> target client only.
export interface RoyaleIncomingPacket {
  fromPlayerId: string;
  color: TileColor;
  shape: ShapePatternType;
  cells: RoyaleFireCell[];
  speed: number;
}

// Client -> Server -> room broadcast. Sent only on HP/core change, target
// change, or elimination (never per-frame).
export interface RoyaleStatusPacket {
  playerId: string;
  hp: number;
  coreHp: number;
  targetMode: RoyaleTargetMode;
  targetingIds: string[];
  alive: boolean;
  kos: number;
}

// Server -> room broadcast on elimination. `killerId` is null when the
// victim left / disconnected instead of being KO'd. `rank` is the
// victim's final placement; `aliveCount` is the survivors after the KO.
export interface RoyaleKoPacket {
  victimId: string;
  killerId: string | null;
  rank: number;
  aliveCount: number;
}

// Minimal player shape the target selector needs (server + client share it).
export interface RoyaleTargetCandidate {
  id: string;
  hp: number;
  coreHp: number;
  kos: number;
  alive: boolean;
  targetingIds: string[];
}

// Combined HP + core ratio (0..2). Used by both KO targeting (lowest) and
// the LEADER tiebreak (highest).
export function royaleHealthSum(p: { hp: number; coreHp: number }): number {
  // v3.0: default HP 120 / core 300 (was 100 / 250). Uniform 0.8333x
  // rescale, so targeting decisions are unchanged; the 0..2 range is kept.
  return p.hp / 120 + p.coreHp / 300;
}

// Pick a target id for `selfId` under `mode`. Returns null when nobody is
// a valid target (e.g. only the sender is alive). `counterIndex` rotates
// the COUNTER pick through the current attackers, one per fire.
export function selectRoyaleTarget(
  mode: RoyaleTargetMode,
  selfId: string,
  players: RoyaleTargetCandidate[],
  counterIndex: number = 0
): string | null {
  const alive = players.filter((p) => p.alive && p.id !== selfId);
  if (alive.length === 0) return null;
  switch (mode) {
    case 'random': {
      return alive[Math.floor(Math.random() * alive.length)].id;
    }
    case 'ko': {
      let best = alive[0];
      for (const p of alive) {
        if (royaleHealthSum(p) < royaleHealthSum(best)) best = p;
      }
      return best.id;
    }
    case 'counter': {
      const attackers = alive.filter((p) => p.targetingIds.includes(selfId));
      if (attackers.length === 0) {
        // Nobody is targeting me: fall back to RANDOM (spec leaves this
        // open; a dead mode with no valid target would strand the player).
        return alive[Math.floor(Math.random() * alive.length)].id;
      }
      return attackers[counterIndex % attackers.length].id;
    }
    case 'leader': {
      let best = alive[0];
      for (const p of alive) {
        if (p.kos > best.kos) {
          best = p;
        } else if (p.kos === best.kos && royaleHealthSum(p) > royaleHealthSum(best)) {
          best = p;
        }
      }
      return best.id;
    }
  }
}

// Rank of a player eliminated while `aliveBeforeDeath` players (including
// the victim) are still alive: first out in an 8-player game is 8th.
export function royaleRankForElimination(aliveBeforeDeath: number): number {
  return Math.max(1, aliveBeforeDeath);
}
