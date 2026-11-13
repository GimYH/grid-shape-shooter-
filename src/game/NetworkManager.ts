import { ArchetypeId } from '../types/game';

export interface NetworkAction {
  // board_hash/board_request/board_sync: periodic board reconciliation.
  type:
    | 'move'
    | 'dash'
    | 'launch'
    | 'skill'
    | 'discard'
    | 'hit'
    | 'rematch'
    | 'absorb'
    | 'board_hash'
    | 'board_request'
    | 'board_sync';
  data: Record<string, unknown>;
}

export type NetworkRole = 'p1' | 'p2' | null;

export class NetworkManager {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private pingTimer: number | null = null;
  public role: NetworkRole = null;
  public roomCode: string | null = null;
  public isConnected: boolean = false;
  public opponentConnected: boolean = false;
  public opponentReady: boolean = false;
  public opponentArchetype: ArchetypeId = 'wave';

  // Callbacks
  public onRoomCreated?: (roomCode: string) => void;
  public onRoomJoined?: (roomCode: string, opponentArchetype?: ArchetypeId) => void;
  public onPeerJoined?: (opponentArchetype?: ArchetypeId) => void;
  public onPeerArchetypeSelected?: (archetype: ArchetypeId) => void;
  public onPeerReady?: (isReady: boolean) => void;
  public onBattleStart?: (seed: number, p1Arch: ArchetypeId, p2Arch: ArchetypeId) => void;
  public onPeerAction?: (action: NetworkAction) => void;
  public onPeerLeft?: () => void;
  public onError?: (message: string) => void;

  public connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      const socket = new WebSocket(wsUrl);
      let settled = false;

      const timeout = window.setTimeout(() => {
        if (!settled && socket.readyState !== WebSocket.OPEN) {
          settled = true;
          try {
            socket.close();
          } catch {
            // ignore
          }
          this.connectPromise = null;
          reject(new Error('Connection timeout'));
        }
      }, 6000);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.isConnected = true;
        this.ws = socket;
        this.startHeartbeat();
        this.connectPromise = null;
        resolve();
      };

      socket.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.isConnected = false;
        this.connectPromise = null;
        reject(new Error('WebSocket connection failed'));
      };

      socket.onclose = () => {
        this.isConnected = false;
        this.stopHeartbeat();
        if (this.ws === socket) {
          this.ws = null;
        }
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch {
          // Ignore
        }
      };
    });

    return this.connectPromise;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    // App-level ping keeps NAT/proxies from dropping an idle lobby socket.
    // The server answers with { type: 'pong' } and also runs its own
    // ws-level ping/pong to terminate zombie connections.
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'ping', timestamp: Date.now() });
    }, 10000);
  }

  private stopHeartbeat() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'pong': {
        break;
      }
      case 'room_created': {
        // Trust the server-assigned role (it may fill a vacant slot).
        this.role = (msg.role as NetworkRole) || 'p1';
        this.roomCode = msg.roomCode as string;
        this.opponentConnected = false;
        if (this.onRoomCreated) this.onRoomCreated(this.roomCode);
        break;
      }
      case 'room_joined': {
        this.role = (msg.role as NetworkRole) || 'p2';
        this.roomCode = msg.roomCode as string;
        this.opponentConnected = true;
        if (msg.opponentArchetype) {
          this.opponentArchetype = msg.opponentArchetype as ArchetypeId;
        }
        if (this.onRoomJoined) this.onRoomJoined(this.roomCode, this.opponentArchetype);
        break;
      }
      case 'peer_joined': {
        this.opponentConnected = true;
        if (msg.opponentArchetype) {
          this.opponentArchetype = msg.opponentArchetype as ArchetypeId;
        }
        if (this.onPeerJoined) this.onPeerJoined(this.opponentArchetype);
        break;
      }
      case 'peer_archetype_selected': {
        this.opponentArchetype = msg.archetype as ArchetypeId;
        if (this.onPeerArchetypeSelected) {
          this.onPeerArchetypeSelected(this.opponentArchetype);
        }
        break;
      }
      case 'peer_ready_status': {
        this.opponentReady = msg.ready as boolean;
        if (this.onPeerReady) this.onPeerReady(this.opponentReady);
        break;
      }
      case 'battle_start': {
        if (this.onBattleStart) {
          this.onBattleStart(
            msg.seed as number,
            msg.p1Archetype as ArchetypeId,
            msg.p2Archetype as ArchetypeId
          );
        }
        break;
      }
      case 'peer_action': {
        if (this.onPeerAction) {
          this.onPeerAction(msg.action as NetworkAction);
        }
        break;
      }
      case 'peer_left': {
        this.opponentConnected = false;
        this.opponentReady = false;
        if (this.onPeerLeft) this.onPeerLeft();
        break;
      }
      case 'error': {
        if (this.onError) this.onError(msg.message as string);
        break;
      }
    }
  }

  public async createRoom(archetype: ArchetypeId): Promise<void> {
    await this.connect();
    this.send({ type: 'create_room', archetype });
  }

  public async joinRoom(roomCode: string, archetype: ArchetypeId): Promise<void> {
    await this.connect();
    this.send({ type: 'join_room', roomCode: roomCode.toUpperCase().trim(), archetype });
  }

  public selectArchetype(archetype: ArchetypeId) {
    this.send({ type: 'select_archetype', archetype });
  }

  public setReady(ready: boolean) {
    this.send({ type: 'set_ready', ready });
  }

  public sendAction(type: NetworkAction['type'], data: Record<string, unknown>) {
    this.send({
      type: 'sync_action',
      action: { type, data },
    });
  }

  // Ask the server to coordinate a rematch. When both players ask, the
  // server issues a fresh battle_start with one shared seed, so both
  // boards are generated from the same seed (the old client-side rematch
  // used a different Date.now() seed on each side and desynced boards).
  public requestRematch() {
    this.send({ type: 'rematch_request' });
  }

  private send(data: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.send({ type: 'leave_room' });
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connectPromise = null;
    this.role = null;
    this.roomCode = null;
    this.isConnected = false;
    this.opponentConnected = false;
    this.opponentReady = false;
  }
}

export const networkManager = new NetworkManager();
