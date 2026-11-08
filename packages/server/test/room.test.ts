import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { GameStartInfo, LobbyState, Snapshot } from '@fftr/shared';
import { createServer } from '../src/app';
import type { GameRoom } from '../src/GameRoom';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createServer(), 2599);
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  await colyseus.cleanup();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wartet auf die nächste Nachricht eines Typs. */
function next<T>(room: { onMessage: (t: string, cb: (m: T) => void) => () => void }, type: string, pred: (m: T) => boolean = () => true, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Keine Nachricht «${type}»`)), timeout);
    const off = room.onMessage(type, (m: T) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      off();
      resolve(m);
    });
  });
}

describe('Spielraum', () => {
  it('erhält einen 6-stelligen Code, Freunde treten per Code bei', async () => {
    const host = await colyseus.sdk.create('game', { name: 'Anna' });
    expect(host.roomId).toMatch(/^[A-Z2-9]{6}$/);
    const lobbyP = next<LobbyState>(host, 'lobby', (l) => l.slots.filter((s) => s.kind === 'human').length === 2);
    const guest = await colyseus.sdk.joinById(host.roomId, { name: 'Ben!!' });
    const lobby = await lobbyP;
    expect(lobby.code).toBe(host.roomId);
    expect(lobby.hostSessionId).toBe(host.sessionId);
    expect(lobby.slots[0].name).toBe('Anna');
    expect(lobby.slots[1].name).toBe('Ben');
    expect(lobby.slots[0].color).not.toBe(lobby.slots[1].color);
    await guest.leave();
    await host.leave();
  });

  it('filtert unpassende Namen', async () => {
    const host = await colyseus.sdk.create('game', { name: 'Shit42' });
    const lobby = await next<LobbyState>(host, 'lobby');
    expect(lobby.slots[0].name).toBe('Kommandant');
    await host.leave();
  });

  it('nur der Gastgeber darf Einstellungen ändern und starten; alle müssen bereit sein', async () => {
    const host = await colyseus.sdk.create('game', { name: 'Anna' });
    const guest = await colyseus.sdk.joinById(host.roomId, { name: 'Ben' });
    await wait(100);
    const room = colyseus.getRoomById<GameRoom>(host.roomId) as unknown as GameRoom;
    guest.send('settings', { mapId: 'vier-winde' });
    await wait(100);
    host.send('start');
    const err = await next<{ key: string }>(host, 'error');
    expect(err.key).toBe('lobby.err.notReady');
    expect(room.simulation).toBeNull();

    host.send('settings', { mapId: 'vier-winde', mode: 'teams' });
    host.send('slot', { slot: 2, kind: 'ai', ai: 'easy' });
    host.send('slot', { slot: 3, kind: 'ai', ai: 'easy' });
    host.send('slotSettings', { slot: 0, team: 1 });
    guest.send('slotSettings', { slot: 1, team: 1 });
    host.send('slotSettings', { slot: 2, team: 2 });
    host.send('slotSettings', { slot: 3, team: 2 });
    guest.send('ready', { ready: true });
    const lobby = await next<LobbyState>(host, 'lobby', (l) => l.slots[1].ready && l.slots[3].team === 2);
    expect(lobby.mapId).toBe('vier-winde');
    expect(lobby.slots.map((s) => s.kind)).toEqual(['human', 'human', 'ai', 'ai']);

    const startHost = next<GameStartInfo>(host, 'start');
    const startGuest = next<GameStartInfo>(guest, 'start');
    const snapGuest = next<Snapshot>(guest, 'snap', (s) => !!s.full);
    host.send('start');
    const [sh, sg] = await Promise.all([startHost, startGuest]);
    expect(sh.localPlayer).toBe(1);
    expect(sg.localPlayer).toBe(2);
    expect(sh.players.map((p) => p.team)).toEqual([1, 1, 2, 2]);
    const snap = await snapGuest;
    // Eigene und verbündete Einheiten sind enthalten, die weit entfernten Gegner nicht (Nebel)
    const owners = new Set((snap.u ?? []).map((t) => t[2]));
    expect(owners.has(1)).toBe(true);
    expect(owners.has(2)).toBe(true);
    expect(owners.has(3)).toBe(false);
    expect(owners.has(4)).toBe(false);
    await guest.leave();
    await host.leave();
  });

  it('Befehle bewegen Einheiten auf dem Server, Momentaufnahmen zeigen es', async () => {
    const host = await colyseus.sdk.create('game', { name: 'Anna' });
    host.send('slot', { slot: 1, kind: 'ai', ai: 'easy' });
    await next<LobbyState>(host, 'lobby', (l) => l.slots[1].kind === 'ai');
    const startP = next<GameStartInfo>(host, 'start');
    const fullP = next<Snapshot>(host, 'snap', (s) => !!s.full);
    host.send('start');
    await startP;
    const full = await fullP;
    const tank = full.u!.find((t) => t[2] === 1 && t[1] >= 0)!;
    const [id, , , x0] = tank;
    host.send('cmd', { type: 'move', units: [id], x: x0 + 5 * 1024, y: tank[4] });
    // Ungültiger Befehl (fremde Einheit / Unsinn) wird still ignoriert
    host.send('cmd', { type: 'explode', units: [id] });
    let moved = false;
    for (let i = 0; i < 30 && !moved; i++) {
      const s = await next<Snapshot>(host, 'snap');
      const t = s.u?.find((u) => u[0] === id);
      if (t && t[3] > x0 + 1024) moved = true;
    }
    expect(moved).toBe(true);
    await host.leave();
  });

  it('wer das Spiel verlässt, wird von einer KI ersetzt', async () => {
    const host = await colyseus.sdk.create('game', { name: 'Anna' });
    const guest = await colyseus.sdk.joinById(host.roomId, { name: 'Ben' });
    guest.send('ready', { ready: true });
    await next<LobbyState>(host, 'lobby', (l) => l.slots[1].ready);
    const startP = next<GameStartInfo>(guest, 'start');
    host.send('start');
    await startP;
    const room = colyseus.getRoomById(host.roomId) as unknown as GameRoom;
    const before = room.simulation!.listeners.length;
    await guest.leave(true);
    await wait(200);
    expect(room.simulation!.listeners.length).toBe(before + 1);
    expect(room.simulation!.players[2].defeated).toBe(false);
    await host.leave();
  });

  it('übersteht Fehler im Spieltakt und schickt auf Wunsch eine vollständige Aufnahme', async () => {
    const host = await colyseus.sdk.create('game', { name: 'Anna' });
    host.send('slot', { slot: 1, kind: 'ai', ai: 'easy' });
    await next<LobbyState>(host, 'lobby', (l) => l.slots[1].kind === 'ai');
    const startP = next<GameStartInfo>(host, 'start');
    const fullP = next<Snapshot>(host, 'snap', (s) => !!s.full);
    host.send('start');
    await startP;
    await fullP;
    const room = colyseus.getRoomById(host.roomId) as unknown as GameRoom;
    const sim = room.simulation!;
    // Ein paar Ticks werfen einen Fehler – der Raum muss weiterlaufen
    const realStep = sim.step.bind(sim);
    let failures = 3;
    sim.step = () => {
      if (failures-- > 0) throw new Error('Testfehler');
      realStep();
    };
    await next<Snapshot>(host, 'snap');
    expect(room.simulation).toBe(sim);
    // Client meldet kaputten Spiegel → nächste Aufnahme ist vollständig
    const resyncP = next<Snapshot>(host, 'snap', (s) => !!s.full);
    host.send('resync');
    await resyncP;
    await host.leave();
  });

  it('ein laufendes Spiel nimmt keine neuen Spieler auf', async () => {
    const host = await colyseus.sdk.create('game', { name: 'Anna' });
    host.send('slot', { slot: 1, kind: 'ai', ai: 'easy' });
    await next<LobbyState>(host, 'lobby', (l) => l.slots[1].kind === 'ai');
    const startP = next<GameStartInfo>(host, 'start');
    host.send('start');
    await startP;
    await expect(colyseus.sdk.joinById(host.roomId, { name: 'Zu spät' })).rejects.toBeTruthy();
    await host.leave();
  });
});
