import { Room, type Client } from '@colyseus/core';
import {
  GAME_SPEEDS,
  LobbyMessages,
  MAX_SLOTS,
  NetIndex,
  PLAYER_SLOT_IDS,
  RECONNECT_SECONDS,
  START_CREDITS,
  SkirmishAi,
  SnapshotEncoder,
  TICK_MS,
  cleanName,
  createSkirmish,
  emptySlot,
  makeRoomCode,
  teamFor,
  validateStart,
  type GameStartInfo,
  type LobbySlot,
  type LobbyState,
  type SimEvent,
  type Simulation,
} from '@fftr/shared';
import type { ZodType } from 'zod';
import { hasMap, loadMap, maxPlayersOf, rules } from './data';

/** Momentaufnahme alle 2 Ticks (7,5 pro Sekunde) – der Client interpoliert dazwischen. */
export const SNAPSHOT_EVERY = 2;
/** Bereits vergebene Codes (pro Server-Prozess). */
const usedCodes = new Set<string>();

/**
 * Ein privater Spielraum: zuerst Lobby, dann die laufende Partie.
 * Der Server rechnet die Simulation; Clients schicken nur Befehle.
 */
export class GameRoom extends Room {
  override maxClients = MAX_SLOTS;
  /** Schutz vor Überflutung mit Nachrichten. */
  override maxMessagesPerSecond = 40;

  private lobby!: LobbyState;
  private sim: Simulation | null = null;
  private index: NetIndex | null = null;
  private encoders = new Map<string, SnapshotEncoder>();
  /** Spieler-id je Sitzung (im Spiel). */
  private playerOf = new Map<string, number>();
  private pendingEvents: SimEvent[] = [];
  private startInfo: Omit<GameStartInfo, 'localPlayer'> | null = null;

  override onCreate(options: { name?: string }): void {
    let code = makeRoomCode();
    while (usedCodes.has(code)) code = makeRoomCode();
    usedCodes.add(code);
    this.roomId = code;
    void this.setPrivate(true);
    this.autoDispose = true;
    this.lobby = {
      code,
      hostSessionId: '',
      mapId: 'kristalltal',
      mode: 'ffa',
      startCredits: 3000,
      speed: 1,
      slots: Array.from({ length: MAX_SLOTS }, (_, i) => emptySlot(i, i < 2 ? 'open' : 'closed')),
      chat: [],
      started: false,
    };
    void options;
    this.registerMessages();
  }

  override onDispose(): void {
    usedCodes.delete(this.lobby.code);
  }

  // ───────────── Beitreten / Verlassen ─────────────

  override onJoin(client: Client, options: { name?: string }): void {
    if (this.lobby.started) throw new Error('Das Spiel läuft schon.');
    const slot = this.lobby.slots.findIndex((s) => s.kind === 'open');
    if (slot < 0) throw new Error('Der Raum ist voll.');
    const s = this.lobby.slots[slot];
    s.kind = 'human';
    s.sessionId = client.sessionId;
    s.name = cleanName(options?.name);
    s.connected = true;
    s.ready = false;
    if (!this.lobby.hostSessionId) this.lobby.hostSessionId = client.sessionId;
    this.ensureUniqueColor(slot);
    this.broadcastLobby();
  }

  override onDrop(client: Client): void {
    // Verbindung verloren: Platz freihalten (im Spiel 2 Minuten, in der Lobby 30 s)
    const slot = this.slotOf(client.sessionId);
    if (slot) slot.connected = false;
    this.broadcastLobby();
    void this.allowReconnection(client, this.lobby.started ? RECONNECT_SECONDS : 30);
  }

  override onReconnect(client: Client): void {
    const slot = this.slotOf(client.sessionId);
    if (slot) slot.connected = true;
    this.broadcastLobby();
    if (this.lobby.started) this.sendGameStart(client);
  }

  override onLeave(client: Client): void {
    const slot = this.slotOf(client.sessionId);
    if (!slot) return;
    if (this.lobby.started && this.sim) {
      // Spieler ist endgültig weg → eine KI übernimmt seine Basis
      const player = this.playerOf.get(client.sessionId);
      if (player && !this.sim.players[player]?.defeated) this.sim.listeners.push(new SkirmishAi(player, 'easy', this.sim));
      slot.connected = false;
      slot.name = `${slot.name} (KI)`;
      this.encoders.delete(client.sessionId);
    } else {
      const i = this.lobby.slots.indexOf(slot);
      this.lobby.slots[i] = emptySlot(i, 'open');
    }
    if (this.lobby.hostSessionId === client.sessionId) {
      // Gastgeber übergeben
      this.lobby.hostSessionId = this.lobby.slots.find((s) => s.kind === 'human' && s.connected)?.sessionId ?? '';
    }
    this.broadcastLobby();
  }

  // ───────────── Lobby ─────────────

  private slotOf(sessionId: string): LobbySlot | undefined {
    return this.lobby.slots.find((s) => s.kind === 'human' && s.sessionId === sessionId);
  }

  private isHost(client: Client): boolean {
    return client.sessionId === this.lobby.hostSessionId;
  }

  private ensureUniqueColor(slotIndex: number): void {
    const s = this.lobby.slots[slotIndex];
    const taken = new Set(this.lobby.slots.filter((o, i) => i !== slotIndex && (o.kind === 'human' || o.kind === 'ai')).map((o) => o.color));
    if (!taken.has(s.color)) return;
    for (let c = 0; c < 6; c++) {
      if (!taken.has(c)) {
        s.color = c;
        return;
      }
    }
  }

  private broadcastLobby(): void {
    this.broadcast('lobby', this.lobby);
  }

  /** Registriert eine geprüfte Nachricht (Form wird mit zod geprüft, Fehlerhaftes ignoriert). */
  private on<T>(type: string, schema: ZodType<T>, fn: (client: Client, msg: T) => void): void {
    this.onMessage(type, (client: Client, raw: unknown) => {
      const r = schema.safeParse(raw);
      if (r.success) fn(client, r.data);
    });
  }

  private registerMessages(): void {
    const L = LobbyMessages;
    this.on('slot', L.slot, (client, m) => {
      if (!this.isHost(client) || this.lobby.started) return;
      const s = this.lobby.slots[m.slot];
      if (s.kind === 'human') return;
      this.lobby.slots[m.slot] = { ...emptySlot(m.slot, m.kind), ai: m.ai ?? 'easy', name: m.kind === 'ai' ? `KI ${m.slot + 1}` : '' };
      if (m.kind === 'ai') this.ensureUniqueColor(m.slot);
      this.broadcastLobby();
    });
    this.on('slotSettings', L.slotSettings, (client, m) => {
      if (this.lobby.started) return;
      const s = this.lobby.slots[m.slot];
      const own = s.kind === 'human' && s.sessionId === client.sessionId;
      const hostOnAi = s.kind === 'ai' && this.isHost(client);
      if (!own && !hostOnAi) return;
      if (m.faction) s.faction = m.faction;
      if (m.team !== undefined) s.team = m.team;
      if (m.ai && s.kind === 'ai') s.ai = m.ai;
      if (m.color !== undefined) {
        const taken = this.lobby.slots.some((o, i) => i !== m.slot && (o.kind === 'human' || o.kind === 'ai') && o.color === m.color);
        if (!taken) s.color = m.color;
      }
      if (own) s.ready = false; // Änderung → nochmal bestätigen
      this.broadcastLobby();
    });
    this.on('settings', L.settings, (client, m) => {
      if (!this.isHost(client) || this.lobby.started) return;
      if (m.mapId && hasMap(m.mapId)) this.lobby.mapId = m.mapId;
      if (m.mode) this.lobby.mode = m.mode;
      if (m.startCredits && (START_CREDITS as readonly number[]).includes(m.startCredits)) this.lobby.startCredits = m.startCredits;
      if (m.speed && (GAME_SPEEDS as readonly number[]).includes(m.speed)) this.lobby.speed = m.speed;
      for (const s of this.lobby.slots) s.ready = false;
      this.broadcastLobby();
    });
    this.on('ready', L.ready, (client, m) => {
      const s = this.slotOf(client.sessionId);
      if (!s || this.lobby.started) return;
      s.ready = m.ready;
      this.broadcastLobby();
    });
    this.on('chat', L.chat, (client, m) => {
      const s = this.slotOf(client.sessionId);
      if (!s) return;
      this.lobby.chat.push({ from: s.name, msg: m.msg });
      if (this.lobby.chat.length > 20) this.lobby.chat.shift();
      this.broadcastLobby();
    });
    this.onMessage('start', (client: Client) => {
      if (!this.isHost(client) || this.lobby.started) return;
      const err = validateStart(this.lobby, maxPlayersOf(this.lobby.mapId));
      if (err) {
        client.send('error', { key: err });
        return;
      }
      this.startGame();
    });
    this.onMessage('cmd', (client: Client, cmd: unknown) => {
      const player = this.playerOf.get(client.sessionId);
      if (!this.sim || !player) return;
      this.sim.issue(player, cmd);
    });
    this.on('ping', L.ping, (client, m) => {
      const player = this.playerOf.get(client.sessionId);
      if (!this.sim || !player) return;
      const name = this.slotOf(client.sessionId)?.name ?? '';
      for (const other of this.clients) {
        const p = this.playerOf.get(other.sessionId);
        if (p && this.sim.isAlly(player, p)) other.send('ping', { ...m, from: name, player });
      }
    });
  }

  // ───────────── Spiel ─────────────

  private startGame(): void {
    const lobby = this.lobby;
    lobby.started = true;
    void this.lock();
    const active = lobby.slots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.kind === 'human' || s.kind === 'ai');
    const slots = active.map(({ s, i }) => ({
      id: PLAYER_SLOT_IDS[i],
      name: s.name,
      faction: s.faction,
      color: s.color,
      team: teamFor(lobby, s, i),
      ai: s.kind === 'ai' ? s.ai : undefined,
    }));
    this.sim = createSkirmish({ map: loadMap(lobby.mapId), rules, slots, startCredits: lobby.startCredits });
    this.index = new NetIndex(this.sim);
    this.startInfo = {
      mapId: lobby.mapId,
      speed: lobby.speed,
      startCredits: lobby.startCredits,
      players: slots.map((s) => ({ id: s.id, name: s.name, faction: s.faction, color: s.color, team: s.team, ai: !!s.ai })),
    };
    for (const { s, i } of active) {
      if (s.kind === 'human') this.playerOf.set(s.sessionId, PLAYER_SLOT_IDS[i]);
    }
    this.broadcastLobby();
    for (const c of this.clients) this.sendGameStart(c);
    this.setSimulationInterval(() => this.tick(), TICK_MS / lobby.speed);
  }

  /** Startinfo + vollständige Momentaufnahme an einen Client (auch nach Wiederverbinden). */
  private sendGameStart(client: Client): void {
    const player = this.playerOf.get(client.sessionId);
    if (!this.sim || !this.index || !this.startInfo || !player) return;
    client.send('start', { ...this.startInfo, localPlayer: player } satisfies GameStartInfo);
    const enc = new SnapshotEncoder(this.sim, player, this.index);
    this.encoders.set(client.sessionId, enc);
    client.send('snap', enc.encode([]));
  }

  private tick(): void {
    const sim = this.sim;
    if (!sim) return;
    sim.step();
    this.pendingEvents.push(...sim.drainEvents());
    if (sim.tick % SNAPSHOT_EVERY !== 0) return;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const client of this.clients) {
      const enc = this.encoders.get(client.sessionId);
      if (enc) client.send('snap', enc.encode(events));
    }
  }

  /** Für Tests. */
  get simulation(): Simulation | null {
    return this.sim;
  }
}
