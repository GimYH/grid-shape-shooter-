import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

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
  } while (rooms.has(code));
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
}, 60000);

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
          break;
        }
      }
    } catch {
      // Ignore malformed packets
    }
  });

  ws.on('close', () => {
    leaveCurrentRoom();
  });

  ws.on('error', () => {
    leaveCurrentRoom();
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
