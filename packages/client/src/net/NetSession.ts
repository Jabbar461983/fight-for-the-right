import { Client, type Room } from '@colyseus/sdk';
import { netVersion, type GameStartInfo, type LobbyState, type PingKind, type Snapshot } from '@fftr/shared';
import { getRules } from '../data';

/** Antwort von /health. */
export interface ServerHealth {
  ok: boolean;
  version?: string;
  uptime?: number;
  rooms?: number;
}

let cachedVersion = '';
/** Fingerabdruck der Inhalte dieses Clients (muss zum Server passen). */
export function clientVersion(): string {
  if (!cachedVersion) cachedVersion = netVersion(getRules());
  return cachedVersion;
}

/**
 * Verbindung zum Mehrspieler-Server (Colyseus).
 * Hält den Raum, puffert Momentaufnahmen und kümmert sich ums Wiederverbinden.
 */

const RESUME_KEY = 'fftr.resume';
/** So lange nach einem Neuladen der Seite versuchen wir, in den alten Raum zurückzukehren. */
const RESUME_MS = 2 * 60 * 1000;

/** Server-Adresse: beim Bauen gesetzt (VITE_SERVER_URL), lokal Port 2567 auf demselben Rechner. */
export function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const secure = location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${location.hostname}:2567`;
}

function httpUrl(): string {
  return serverUrl().replace(/^ws/, 'http');
}

export interface PingMessage {
  kind: PingKind;
  x: number;
  y: number;
  from: string;
  player: number;
}

export type ConnectionState = 'ok' | 'dropped' | 'lost';

export class NetSession {
  lobby: LobbyState | null = null;
  start: GameStartInfo | null = null;
  onLobby: ((l: LobbyState) => void) | null = null;
  onStart: ((s: GameStartInfo) => void) | null = null;
  onError: ((key: string) => void) | null = null;
  onPing: ((p: PingMessage) => void) | null = null;
  onConnection: ((s: ConnectionState) => void) | null = null;
  private snapHandler: ((s: Snapshot) => void) | null = null;
  private snapQueue: Snapshot[] = [];
  private left = false;

  private constructor(readonly room: Room) {
    room.onMessage('lobby', (l: LobbyState) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    room.onMessage('start', (s: GameStartInfo) => {
      this.start = s;
      this.snapQueue = [];
      this.onStart?.(s);
    });
    room.onMessage('snap', (s: Snapshot) => {
      if (this.snapHandler) this.snapHandler(s);
      else this.snapQueue.push(s);
    });
    room.onMessage('error', (e: { key: string }) => this.onError?.(e.key));
    room.onMessage('ping', (p: PingMessage) => this.onPing?.(p));
    room.onDrop(() => this.onConnection?.('dropped'));
    room.onReconnect(() => {
      this.saveResume();
      this.onConnection?.('ok');
    });
    room.onLeave(() => {
      window.clearInterval(this.keepAlive);
      if (!this.left) this.onConnection?.('lost');
      sessionStorage.removeItem(RESUME_KEY);
    });
    room.onError((code, message) => console.warn('Raum-Fehler', code, message));
    this.saveResume();
    // Wachhalten: Der Gratis-Hoster zählt nur neue HTTP-Anfragen als «Aktivität»,
    // nicht die offene Spielverbindung – deshalb alle 4 Minuten kurz anklopfen.
    this.keepAlive = window.setInterval(() => {
      fetch(`${httpUrl()}/health`).catch(() => undefined);
    }, 4 * 60 * 1000);
  }

  private keepAlive = 0;

  get isHost(): boolean {
    return this.lobby?.hostSessionId === this.room.sessionId;
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  /** Momentaufnahmen abholen: erst die gepufferten, dann laufend. */
  setSnapshotHandler(fn: ((s: Snapshot) => void) | null): void {
    this.snapHandler = fn;
    if (fn) {
      const q = this.snapQueue;
      this.snapQueue = [];
      for (const s of q) fn(s);
    }
  }

  send(type: string, msg?: unknown): void {
    this.room.send(type, msg);
  }

  async leave(): Promise<void> {
    this.left = true;
    window.clearInterval(this.keepAlive);
    sessionStorage.removeItem(RESUME_KEY);
    try {
      await this.room.leave(true);
    } catch {
      // schon weg
    }
  }

  private saveResume(): void {
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ token: this.room.reconnectionToken, at: Date.now() }));
    } catch {
      // ignorieren
    }
  }

  // ───────────── Verbinden ─────────────

  /**
   * Weckt den Server (der Gratis-Hoster schläft nach 15 Minuten ein) und meldet,
   * wenn das länger dauert.
   */
  static async wake(onSlow: () => void): Promise<ServerHealth | null> {
    const slow = window.setTimeout(onSlow, 2500);
    try {
      const ctrl = new AbortController();
      const timeout = window.setTimeout(() => ctrl.abort(), 90_000);
      const res = await fetch(`${httpUrl()}/health`, { signal: ctrl.signal }).catch(() => undefined);
      clearTimeout(timeout);
      return res?.ok ? ((await res.json().catch(() => null)) as ServerHealth | null) : null;
    } finally {
      clearTimeout(slow);
    }
  }

  /** Passt der Server zu diesem Client? (Nein = Server noch nicht aktualisiert oder Seite veraltet.) */
  static compatible(health: ServerHealth | null): boolean {
    return !health || health.version === clientVersion();
  }

  static async create(name: string): Promise<NetSession> {
    const client = new Client(serverUrl());
    return new NetSession(await client.create('game', { name, version: clientVersion() }));
  }

  static async join(code: string, name: string): Promise<NetSession> {
    const client = new Client(serverUrl());
    return new NetSession(await client.joinById(code, { name, version: clientVersion() }));
  }

  /** Nach dem Neuladen der Seite: zurück in den alten Raum, falls möglich. */
  static async resume(): Promise<NetSession | null> {
    let saved: { token: string; at: number } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null');
    } catch {
      saved = null;
    }
    if (!saved || Date.now() - saved.at > RESUME_MS) return null;
    try {
      const client = new Client(serverUrl());
      return new NetSession(await client.reconnect(saved.token));
    } catch {
      sessionStorage.removeItem(RESUME_KEY);
      return null;
    }
  }
}
