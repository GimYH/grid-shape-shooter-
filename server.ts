import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
// GRID ROYALE (v2.4): server-side bots reuse the same pure game classes as
// the client (GridBoard / AIController / ProjectileManager). They are
// DOM-free at import time (soundManager guards `window` and every play
// method early-returns without an AudioContext), so tsx can load them.
import { GridBoard } from './src/game/GridEngine';
import { AIController } from './src/game/AIController';
import { ParticleSystem } from './src/game/ParticleSystem';
import { ProjectileManager } from './src/game/ProjectileManager';
import { ARCHETYPE_LIST, ARCHETYPES } from './src/game/archetypes';
import { ArchetypeId } from './src/types/game';
import {
  ROYALE_MAX_PLAYERS,
  ROYALE_MIN_PLAYERS,
  RoyaleFirePacket,
  RoyalePlayerInfo,
  RoyaleTargetMode,
  royaleRankForElimination,
  selectRoyaleTarget,
} from './src/game/royale';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());

interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

// Room Data Structure
interface PlayerSession {
  ws: AliveWebSocket;
  role: 'p1' | 'p2';
  archetype: string;
  ready: boolean;
  rematchRequested: boolean;
}

interface BattleRoom {
  code: string;
  p1: PlayerSession | null;
  p2: PlayerSession | null;
  state: 'waiting' | 'ready' | 'battling';
  createdAt: number;
}

const rooms = new Map<string, BattleRoom>();

function newRoomCode(): string {
  let code = '';
  do {
    code = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  } while (rooms.has(code) || royaleRooms.has(code));
  return code;
}

function newBattleSeed(): number {
  return crypto.randomInt(1, 1_000_000_000);
}

// Clean up stale rooms older than 2 hours, or rooms with nobody left
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (!room.p1 && !room.p2) {
      rooms.delete(code);
    } else if (now - room.createdAt > 2 * 60 * 60 * 1000) {
      rooms.delete(code);
    }
  }
  for (const [code, room] of royaleRooms.entries()) {
    const humans = [...room.players.values()].filter((p) => !p.isBot);
    if (humans.length === 0) {
      stopRoyaleBots(room);
      royaleRooms.delete(code);
    } else if (now - room.createdAt > 2 * 60 * 60 * 1000) {
      stopRoyaleBots(room);
      royaleRooms.delete(code);
    }
  }
}, 60000);

// ---------------------------------------------------------------------------
// GRID ROYALE (v2.4): up to 8 players, warp-portal combat, lightweight
// packets only (no board tiles, no 20 Hz movement sync).
//
// Bot model (server-side simulation): each bot owns a real GridBoard and a
// v2.3 utility AIController (aiLevel 3) ticked at 10 Hz. On launch the bot's
// cluster is turned into a royale_fire via the same ProjectileManager the
// client uses, so damage / cell HP / speed match the real game exactly.
// Incoming fire is resolved geometrically: cells in the bot's current
// column hit its character (capped at 35, shield first), cells in the
// central 3 columns that miss the character pass through to the core.
// Bots play for real — they fire, take damage and get eliminated — and the
// match resolves even if every human disconnects.
// ---------------------------------------------------------------------------

interface RoyaleBotState {
  board: GridBoard;
  ai: AIController;
  particles: ParticleSystem;
  coreCollapsed: boolean;
}

interface RoyalePlayer extends RoyalePlayerInfo {
  ws: AliveWebSocket | null;
  isHost: boolean;
  counterIndex: number;
  bot: RoyaleBotState | null;
}

interface RoyaleRoom {
  code: string;
  players: Map<string, RoyalePlayer>;
  fillBots: boolean;
  state: 'waiting' | 'countdown' | 'battling' | 'finished';
  createdAt: number;
  botTimer: NodeJS.Timeout | null;
  countdownTimer: NodeJS.Timeout | null;
}

const royaleRooms = new Map<string, RoyaleRoom>();

// One shared ProjectileManager, used only to compute a bot launch's real
// damage / cell HP / speed via createProjectile (the temp projectile is
// discarded right after; it never flies anywhere).
const royaleProjMgr = new ProjectileManager();

function newPlayerId(): string {
  return crypto.randomBytes(4).toString('hex');
}

function royalePublicList(room: RoyaleRoom): RoyalePlayerInfo[] {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    archetype: p.archetype,
    isBot: p.isBot,
    isHost: p.isHost,
    hp: p.hp,
    coreHp: p.coreHp,
    kos: p.kos,
    alive: p.alive,
    rank: p.rank,
    targetMode: p.targetMode,
    targetingIds: [...p.targetingIds],
    ready: p.ready,
  }));
}

function royaleBroadcast(room: RoyaleRoom, payload: unknown) {
  const text = JSON.stringify(payload);
  for (const p of room.players.values()) {
    if (!p.isBot && p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(text);
    }
  }
}

function royaleBroadcastPlayerList(room: RoyaleRoom) {
  royaleBroadcast(room, { type: 'royale_player_list', players: royalePublicList(room) });
}

function royaleAliveCount(room: RoyaleRoom): number {
  let n = 0;
  for (const p of room.players.values()) if (p.alive) n++;
  return n;
}

function stopRoyaleBots(room: RoyaleRoom) {
  if (room.botTimer) {
    clearInterval(room.botTimer);
    room.botTimer = null;
  }
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
}

function makeRoyaleBot(room: RoyaleRoom, seed: number): RoyalePlayer {
  const archetype = ARCHETYPE_LIST[Math.floor(Math.random() * ARCHETYPE_LIST.length)];
  const board = new GridBoard('enemy');
  board.reset(seed);
  // Virtual board origin (0,0): center of a 9x5 board (116px col step,
  // 62px row step) is x=519, y=152.
  const ai = new AIController(519, 152);
  ai.archetypes = [archetype.id];
  ai.aiLevel = 3;
  ai.hp = 100;
  ai.maxHp = 100;
  ai.shield = 0;
  ai.isFinalBoss = false;
  ai.isBoss = false;
  const id = newPlayerId();
  return {
    id,
    ws: null,
    name: `봇 ${ARCHETYPES[archetype.id].nameKo}`,
    archetype: archetype.id,
    ready: true,
    isHost: false,
    isBot: true,
    hp: 100,
    coreHp: 250,
    kos: 0,
    alive: true,
    rank: null,
    targetMode: 'random',
    targetingIds: [],
    counterIndex: 0,
    bot: { board, ai, particles: new ParticleSystem(), coreCollapsed: false },
  };
}

function royaleCanStart(room: RoyaleRoom): boolean {
  if (room.state !== 'waiting') return false;
  const humans = [...room.players.values()].filter((p) => !p.isBot);
  if (humans.length < 1) return false;
  // Min 2 players, unless bots fill the empty slots.
  if (humans.length < ROYALE_MIN_PLAYERS && !room.fillBots) return false;
  return true;
}

function royaleStartCountdown(room: RoyaleRoom) {
  if (!royaleCanStart(room)) return;
  room.state = 'countdown';
  royaleBroadcast(room, { type: 'royale_countdown', seconds: 3 });
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;
    if (room.state !== 'countdown') return;
    royaleStartBattle(room);
  }, 3000);
}

function royaleStartBattle(room: RoyaleRoom) {
  if (room.fillBots) {
    while (room.players.size < ROYALE_MAX_PLAYERS) {
      const bot = makeRoyaleBot(room, newBattleSeed());
      room.players.set(bot.id, bot);
    }
  }
  room.state = 'battling';
  const seed = newBattleSeed();
  royaleBroadcast(room, {
    type: 'royale_start',
    players: royalePublicList(room),
    seed,
  });
  // Tick bots at 10 Hz while the battle runs.
  room.botTimer = setInterval(() => {
    if (room.state !== 'battling') {
      stopRoyaleBots(room);
      return;
    }
    for (const p of room.players.values()) {
      if (p.isBot && p.alive && p.bot) tickRoyaleBot(room, p);
    }
  }, 100);
}

function tickRoyaleBot(room: RoyaleRoom, botPlayer: RoyalePlayer) {
  const bot = botPlayer.bot;
  if (!bot) return;
  const dt = 0.1;
  const isSpeedster = bot.ai.archetypes.includes('speedster');
  const refillMult = (isSpeedster ? 1.5 : 1.0) * (bot.coreCollapsed ? 1.3 : 1.0);
  bot.board.update(dt, refillMult, bot.ai.archetypes.includes('sniper'));

  const onLaunch = (cluster: { color: string; shapeType: string; tiles: { col: number; row: number }[] }) => {
    // Monochrome absorb mirrors the player rule (unless this launch is a
    // wave core-defense counter, which bypasses it).
    const bypass = bot.ai.bypassAbsorb;
    bot.ai.bypassAbsorb = false;
    if (bot.ai.archetypes.includes('monochrome') && cluster.color !== 'red' && !bypass) {
      bot.board.launchCluster(cluster as never, 0.5);
      bot.ai.shield = Math.min(40, bot.ai.shield + 10);
      return;
    }
    bot.board.launchCluster(cluster as never);
    const frontline = cluster.tiles.some((t) => t.row <= 1);
    const overdrive = bot.ai.overdriveActive;
    bot.ai.overdriveActive = false;
    // Reuse the client's exact damage / HP / speed math.
    const tmp = royaleProjMgr.createProjectile(
      'player',
      cluster as never,
      0,
      0,
      110,
      56,
      6,
      bot.ai.archetypes[0] ?? 'standard',
      overdrive,
      frontline
    );
    royaleProjMgr.projectiles.length = 0;
    const fire: RoyaleFirePacket = {
      targetMode: botPlayer.targetMode,
      color: tmp.color,
      shape: tmp.shapeType,
      cells: tmp.cells.map((c, i) => ({
        col: cluster.tiles[i]?.col ?? 0,
        hp: c.hp,
        damage: tmp.damagePerCell,
      })),
      speed: Math.abs(tmp.vy),
      isFrontline: frontline,
      ignoreCounter: false,
    };
    routeRoyaleFire(room, botPlayer.id, fire);
  };

  const onBeam = () => {
    // Sniper beam: one instant cell, untraceable (ignoreCounter).
    routeRoyaleFire(room, botPlayer.id, {
      targetMode: botPlayer.targetMode,
      color: 'yellow',
      shape: 'spear',
      cells: [{ col: bot.ai.currentCol, hp: 2, damage: 12 }],
      speed: 800,
      isFrontline: false,
      ignoreCounter: true,
    });
  };

  bot.ai.update(
    dt,
    0,
    0,
    110,
    56,
    6,
    bot.board,
    [],
    bot.particles,
    onLaunch,
    onBeam,
    { col: 4, row: 2 }
  );
}

function routeRoyaleFire(room: RoyaleRoom, senderId: string, fire: RoyaleFirePacket) {
  const sender = room.players.get(senderId);
  if (!sender || !sender.alive || room.state !== 'battling') return;
  const candidates = [...room.players.values()].map((p) => ({
    id: p.id,
    hp: p.hp,
    coreHp: p.coreHp,
    kos: p.kos,
    alive: p.alive,
    targetingIds: p.targetingIds,
  }));
  const targetId = selectRoyaleTarget(fire.targetMode, senderId, candidates, sender.counterIndex);
  if (!targetId) return;
  if (fire.targetMode === 'counter') sender.counterIndex++;
  const target = room.players.get(targetId);
  if (!target || !target.alive) return;

  if (target.isBot) {
    resolveRoyaleBotDamage(room, target, senderId, fire);
  } else if (target.ws && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify({
      type: 'royale_incoming',
      fromPlayerId: senderId,
      color: fire.color,
      shape: fire.shape,
      cells: fire.cells,
      speed: fire.speed,
    }));
  }

  // The resolved target becomes the sender's current targeting (echoed to
  // every client via status, so HUD reticles stay correct even for RANDOM).
  // A beam (ignoreCounter) does not register the sender as an attacker.
  if (!fire.ignoreCounter) {
    sender.targetingIds = [targetId];
    royaleBroadcast(room, {
      type: 'royale_status',
      playerId: sender.id,
      hp: sender.hp,
      coreHp: sender.coreHp,
      targetMode: sender.targetMode,
      targetingIds: sender.targetingIds,
      alive: sender.alive,
      kos: sender.kos,
    });
  }
}

function resolveRoyaleBotDamage(
  room: RoyaleRoom,
  botPlayer: RoyalePlayer,
  senderId: string,
  fire: RoyaleFirePacket
) {
  const bot = botPlayer.bot;
  if (!bot) return;
  const botCol = bot.ai.currentCol;
  let charDmg = 0;
  let coreDmg = 0;
  for (const cell of fire.cells) {
    if (cell.col === botCol) {
      charDmg += cell.damage;
    } else if (cell.col >= 3 && cell.col <= 5) {
      // Missed the character but passes through the central 3 columns to
      // the rear core (same rule as the client-side core hit).
      coreDmg += cell.damage;
    }
  }
  // Anti-instant-kill: one fire deals at most 35 to the character.
  charDmg = Math.min(35, charDmg);
  const absorbed = Math.min(bot.ai.shield, charDmg);
  bot.ai.shield -= absorbed;
  botPlayer.hp = Math.max(0, botPlayer.hp - (charDmg - absorbed));
  botPlayer.coreHp = Math.max(0, botPlayer.coreHp - coreDmg);
  if (!bot.coreCollapsed && botPlayer.coreHp <= 125) {
    bot.coreCollapsed = true;
    bot.board.collapseSides();
  }
  if (botPlayer.hp <= 0 || botPlayer.coreHp <= 0) {
    eliminateRoyalePlayer(room, botPlayer, senderId);
    return;
  }
  royaleBroadcast(room, {
    type: 'royale_status',
    playerId: botPlayer.id,
    hp: botPlayer.hp,
    coreHp: botPlayer.coreHp,
    targetMode: botPlayer.targetMode,
    targetingIds: botPlayer.targetingIds,
    alive: true,
    kos: botPlayer.kos,
  });
}

function eliminateRoyalePlayer(room: RoyaleRoom, victim: RoyalePlayer, killerId: string | null) {
  if (!victim.alive) return;
  const aliveBefore = royaleAliveCount(room);
  victim.alive = false;
  victim.hp = Math.max(0, victim.hp);
  victim.coreHp = Math.max(0, victim.coreHp);
  victim.rank = royaleRankForElimination(aliveBefore);
  const aliveAfter = aliveBefore - 1;
  if (killerId) {
    const killer = room.players.get(killerId);
    if (killer) killer.kos++;
  }
  royaleBroadcast(room, {
    type: 'royale_ko',
    victimId: victim.id,
    killerId,
    rank: victim.rank,
    aliveCount: aliveAfter,
  });
  royaleBroadcast(room, {
    type: 'royale_status',
    playerId: victim.id,
    hp: victim.hp,
    coreHp: victim.coreHp,
    targetMode: victim.targetMode,
    targetingIds: victim.targetingIds,
    alive: false,
    kos: victim.kos,
  });
  if (killerId) {
    const killer = room.players.get(killerId);
    if (killer) {
      royaleBroadcast(room, {
        type: 'royale_status',
        playerId: killer.id,
        hp: killer.hp,
        coreHp: killer.coreHp,
        targetMode: killer.targetMode,
        targetingIds: killer.targetingIds,
        alive: killer.alive,
        kos: killer.kos,
      });
    }
  }
  if (aliveAfter <= 1) {
    room.state = 'finished';
    stopRoyaleBots(room);
  }
}

const httpServer = http.createServer(app);

// WebSocket Server attached to same HTTP server
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// Heartbeat: terminate zombie connections (browser killed, mobile network
// dropped) so rooms don't hang forever waiting for a dead peer.
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    const ws = client as AliveWebSocket;
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws: AliveWebSocket) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let currentRoomCode: string | null = null;
  let userRole: 'p1' | 'p2' | null = null;

  // GRID ROYALE session on this connection (a socket is in at most one
  // duel room and one royale room; leaving one never touches the other).
  let currentRoyaleCode: string | null = null;
  let royalePlayerId: string | null = null;

  const leaveCurrentRoyaleRoom = () => {
    if (!currentRoyaleCode || !royalePlayerId) return;
    const code = currentRoyaleCode;
    const pid = royalePlayerId;
    currentRoyaleCode = null;
    royalePlayerId = null;
    const room = royaleRooms.get(code);
    if (!room) return;
    const me = room.players.get(pid);
    if (!me || me.isBot) return;
    if (room.state === 'battling' && me.alive) {
      // Mid-battle leave / disconnect counts as an elimination.
      eliminateRoyalePlayer(room, me, null);
      room.players.delete(pid);
    } else {
      const wasHost = me.isHost;
      room.players.delete(pid);
      if (room.state === 'waiting' && wasHost) {
        const next = [...room.players.values()].find((p) => !p.isBot);
        if (next) next.isHost = true;
      }
      if (room.state === 'countdown' && !royaleCanStart(room)) {
        room.state = 'waiting';
        if (room.countdownTimer) {
          clearTimeout(room.countdownTimer);
          room.countdownTimer = null;
        }
        royaleBroadcast(room, { type: 'royale_countdown_cancelled' });
      }
      royaleBroadcastPlayerList(room);
    }
    const humans = [...room.players.values()].filter((p) => !p.isBot);
    if (humans.length === 0) {
      stopRoyaleBots(room);
      royaleRooms.delete(code);
    }
  };

  // Leave the current room cleanly, notifying the peer. Called before
  // joining/creating another room and on disconnect, so duplicate
  // create/join calls cannot pile up ghost rooms.
  const leaveCurrentRoom = () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (room) {
      if (userRole === 'p1') {
        room.p1 = null;
      } else if (userRole === 'p2') {
        room.p2 = null;
      }
      room.state = 'waiting';
      room.p1 && (room.p1.ready = false);
      room.p2 && (room.p2.ready = false);
      room.p1 && (room.p1.rematchRequested = false);
      room.p2 && (room.p2.rematchRequested = false);
      const remaining = room.p1 || room.p2;
      if (remaining && remaining.ws.readyState === WebSocket.OPEN) {
        remaining.ws.send(JSON.stringify({ type: 'peer_left' }));
      }
      if (!room.p1 && !room.p2) {
        rooms.delete(currentRoomCode);
      }
    }
    currentRoomCode = null;
    userRole = null;
  };

  const sendBattleStart = (room: BattleRoom) => {
    room.state = 'battling';
    // Reset ready/rematch flags immediately so a later rematch or a new
    // ready round starts from a clean state.
    if (room.p1) {
      room.p1.ready = false;
      room.p1.rematchRequested = false;
    }
    if (room.p2) {
      room.p2.ready = false;
      room.p2.rematchRequested = false;
    }
    const startPayload = JSON.stringify({
      type: 'battle_start',
      seed: newBattleSeed(),
      p1Archetype: room.p1?.archetype,
      p2Archetype: room.p2?.archetype,
    });
    if (room.p1 && room.p1.ws.readyState === WebSocket.OPEN) room.p1.ws.send(startPayload);
    if (room.p2 && room.p2.ws.readyState === WebSocket.OPEN) room.p2.ws.send(startPayload);
  };

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
          break;
        }

        case 'create_room': {
          leaveCurrentRoom();
          const roomCode = newRoomCode();
          const newRoom: BattleRoom = {
            code: roomCode,
            p1: {
              ws,
              role: 'p1',
              archetype: data.archetype || 'lancer',
              ready: false,
              rematchRequested: false,
            },
            p2: null,
            state: 'waiting',
            createdAt: Date.now(),
          };
          rooms.set(roomCode, newRoom);
          currentRoomCode = roomCode;
          userRole = 'p1';

          ws.send(JSON.stringify({
            type: 'room_created',
            roomCode,
            role: 'p1',
          }));
          break;
        }

        case 'join_room': {
          leaveCurrentRoom();
          const targetCode = (data.roomCode || '').toUpperCase().trim();
          const room = rooms.get(targetCode);

          if (!room) {
            ws.send(JSON.stringify({
              type: 'error',
              message: '방 코드를 찾을 수 없습니다. (Room Not Found)',
            }));
            return;
          }

          const p1Open = room.p1 && room.p1.ws.readyState === WebSocket.OPEN;
          const p2Open = room.p2 && room.p2.ws.readyState === WebSocket.OPEN;

          if (p1Open && p2Open) {
            ws.send(JSON.stringify({
              type: 'error',
              message: '방이 이미 가득 찼습니다. (Room is full)',
            }));
            return;
          }

          // Fill the vacant slot (P1 may have left while P2 waits).
          const joiningAsP1 = !p1Open;
          const session: PlayerSession = {
            ws,
            role: joiningAsP1 ? 'p1' : 'p2',
            archetype: data.archetype || (joiningAsP1 ? 'lancer' : 'wave'),
            ready: false,
            rematchRequested: false,
          };
          if (joiningAsP1) {
            room.p1 = session;
          } else {
            room.p2 = session;
          }
          room.state = room.p1 && room.p2 ? 'ready' : 'waiting';
          currentRoomCode = targetCode;
          userRole = session.role;

          const opponent = joiningAsP1 ? room.p2 : room.p1;

          // Notify the joiner
          ws.send(JSON.stringify({
            type: 'room_joined',
            roomCode: targetCode,
            role: session.role,
            opponentArchetype: opponent?.archetype,
          }));

          // Notify the waiting opponent that someone joined
          if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
            opponent.ws.send(JSON.stringify({
              type: 'peer_joined',
              opponentArchetype: session.archetype,
            }));
          }
          break;
        }

        case 'select_archetype': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room) return;

          const me = userRole === 'p1' ? room.p1 : room.p2;
          const opponent = userRole === 'p1' ? room.p2 : room.p1;

          if (me) {
            me.archetype = data.archetype;
            // Changing class invalidates a previous Ready.
            me.ready = false;
          }

          if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
            opponent.ws.send(JSON.stringify({
              type: 'peer_archetype_selected',
              archetype: data.archetype,
            }));
            opponent.ws.send(JSON.stringify({
              type: 'peer_ready_status',
              ready: false,
            }));
          }
          break;
        }

        case 'set_ready': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room) return;

          if (userRole === 'p1' && room.p1) room.p1.ready = Boolean(data.ready);
          if (userRole === 'p2' && room.p2) room.p2.ready = Boolean(data.ready);

          // Notify opponent
          const opponent = userRole === 'p1' ? room.p2 : room.p1;
          if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
            opponent.ws.send(JSON.stringify({
              type: 'peer_ready_status',
              ready: Boolean(data.ready),
            }));
          }

          // If both players ready, start the battle!
          if (room.p1?.ready && room.p2?.ready) {
            sendBattleStart(room);
          }
          break;
        }

        case 'rematch_request': {
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room || !room.p1 || !room.p2) return;
          const me = userRole === 'p1' ? room.p1 : room.p2;
          if (me) me.rematchRequested = true;
          // Both players asked: restart with ONE shared seed.
          if (room.p1.rematchRequested && room.p2.rematchRequested) {
            sendBattleStart(room);
          }
          break;
        }

        case 'sync_action': {
          // Relay action to the other player
          if (!currentRoomCode) return;
          const room = rooms.get(currentRoomCode);
          if (!room) return;

          const targetSession = userRole === 'p1' ? room.p2 : room.p1;
          if (targetSession && targetSession.ws.readyState === WebSocket.OPEN) {
            targetSession.ws.send(JSON.stringify({
              type: 'peer_action',
              action: data.action,
            }));
          }
          break;
        }

        case 'leave_room': {
          leaveCurrentRoom();
          leaveCurrentRoyaleRoom();
          break;
        }

        // --- GRID ROYALE -------------------------------------------------
        case 'create_royale_room': {
          leaveCurrentRoom();
          leaveCurrentRoyaleRoom();
          const roomCode = newRoomCode();
          const playerId = newPlayerId();
          const name =
            typeof data.name === 'string' && data.name.trim()
              ? data.name.trim().slice(0, 12)
              : '플레이어 1';
          const newRoom: RoyaleRoom = {
            code: roomCode,
            players: new Map([
              [
                playerId,
                {
                  id: playerId,
                  ws,
                  name,
                  archetype: (data.archetype as ArchetypeId) || 'lancer',
                  ready: false,
                  isHost: true,
                  isBot: false,
                  hp: 100,
                  coreHp: 250,
                  kos: 0,
                  alive: true,
                  rank: null,
                  targetMode: 'random',
                  targetingIds: [],
                  counterIndex: 0,
                  bot: null,
                },
              ],
            ]),
            fillBots: Boolean(data.fillBots),
            state: 'waiting',
            createdAt: Date.now(),
            botTimer: null,
            countdownTimer: null,
          };
          royaleRooms.set(roomCode, newRoom);
          currentRoyaleCode = roomCode;
          royalePlayerId = playerId;
          ws.send(
            JSON.stringify({
              type: 'royale_room_created',
              roomCode,
              playerId,
              players: royalePublicList(newRoom),
            })
          );
          break;
        }

        case 'join_royale_room': {
          leaveCurrentRoom();
          leaveCurrentRoyaleRoom();
          const targetCode = (data.roomCode || '').toUpperCase().trim();
          const room = royaleRooms.get(targetCode);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: '방 코드를 찾을 수 없습니다. (Room Not Found)' }));
            return;
          }
          if (room.state !== 'waiting') {
            ws.send(JSON.stringify({ type: 'error', message: '이미 시작된 방입니다. (Battle already started)' }));
            return;
          }
          if (room.players.size >= ROYALE_MAX_PLAYERS) {
            ws.send(JSON.stringify({ type: 'error', message: '방이 이미 가득 찼습니다. (Room is full)' }));
            return;
          }
          const playerId = newPlayerId();
          const seat = room.players.size + 1;
          const name =
            typeof data.name === 'string' && data.name.trim()
              ? data.name.trim().slice(0, 12)
              : `플레이어 ${seat}`;
          room.players.set(playerId, {
            id: playerId,
            ws,
            name,
            archetype: (data.archetype as ArchetypeId) || 'lancer',
            ready: false,
            isHost: false,
            isBot: false,
            hp: 100,
            coreHp: 250,
            kos: 0,
            alive: true,
            rank: null,
            targetMode: 'random',
            targetingIds: [],
            counterIndex: 0,
            bot: null,
          });
          currentRoyaleCode = targetCode;
          royalePlayerId = playerId;
          ws.send(
            JSON.stringify({
              type: 'royale_room_joined',
              roomCode: targetCode,
              playerId,
              players: royalePublicList(room),
            })
          );
          royaleBroadcastPlayerList(room);
          break;
        }

        case 'royale_select_archetype': {
          if (!currentRoyaleCode || !royalePlayerId) return;
          const room = royaleRooms.get(currentRoyaleCode);
          const me = room?.players.get(royalePlayerId);
          if (!room || !me) return;
          me.archetype = (data.archetype as ArchetypeId) || me.archetype;
          me.ready = false;
          royaleBroadcastPlayerList(room);
          break;
        }

        case 'royale_ready': {
          if (!currentRoyaleCode || !royalePlayerId) return;
          const room = royaleRooms.get(currentRoyaleCode);
          const me = room?.players.get(royalePlayerId);
          if (!room || !me) return;
          me.ready = Boolean(data.ready);
          royaleBroadcastPlayerList(room);
          const humans = [...room.players.values()].filter((p) => !p.isBot);
          if (humans.length > 0 && humans.every((p) => p.ready) && royaleCanStart(room)) {
            royaleStartCountdown(room);
          }
          break;
        }

        case 'royale_force_start': {
          if (!currentRoyaleCode || !royalePlayerId) return;
          const room = royaleRooms.get(currentRoyaleCode);
          const me = room?.players.get(royalePlayerId);
          if (!room || !me || !me.isHost) return;
          royaleStartCountdown(room);
          break;
        }

        case 'royale_fire': {
          if (!currentRoyaleCode || !royalePlayerId) return;
          const room = royaleRooms.get(currentRoyaleCode);
          if (!room || !data.fire || !Array.isArray(data.fire.cells)) return;
          routeRoyaleFire(room, royalePlayerId, data.fire as RoyaleFirePacket);
          break;
        }

        case 'royale_status': {
          if (!currentRoyaleCode || !royalePlayerId) return;
          const room = royaleRooms.get(currentRoyaleCode);
          const me = room?.players.get(royalePlayerId);
          if (!room || !me) return;
          if (typeof data.hp === 'number') me.hp = Math.max(0, Math.min(100, data.hp));
          if (typeof data.coreHp === 'number') me.coreHp = Math.max(0, Math.min(250, data.coreHp));
          if (typeof data.targetMode === 'string') me.targetMode = data.targetMode as RoyaleTargetMode;
          if (Array.isArray(data.targetingIds)) me.targetingIds = data.targetingIds.slice(0, 4);
          if (typeof data.kos === 'number') me.kos = Math.max(0, data.kos);
          if (data.alive === false && me.alive) {
            // The client detected its own elimination; the killer is the
            // last attacker it saw (sent as an extra field — the listed
            // status fields stay unchanged).
            eliminateRoyalePlayer(room, me, typeof data.killerId === 'string' ? data.killerId : null);
            return;
          }
          royaleBroadcast(room, {
            type: 'royale_status',
            playerId: me.id,
            hp: me.hp,
            coreHp: me.coreHp,
            targetMode: me.targetMode,
            targetingIds: me.targetingIds,
            alive: me.alive,
            kos: me.kos,
          });
          break;
        }

        case 'royale_leave': {
          leaveCurrentRoyaleRoom();
          break;
        }
      }
    } catch {
      // Ignore malformed packets
    }
  });

  ws.on('close', () => {
    leaveCurrentRoom();
    leaveCurrentRoyaleRoom();
  });

  ws.on('error', () => {
    leaveCurrentRoom();
    leaveCurrentRoyaleRoom();
  });
});

// Setup Vite or Static File Serving
async function startServer() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(port, () => {
    console.log(`Grid Shape Shooter Server running on port ${port}`);
  });
}

startServer();
