import { describe, expect, it } from 'vitest';
import { MoveClass } from '../src/map/terrain';
import { tileOf } from '../src/math/fixed';
import { cleanName, makeRoomCode, normalizeCode, validateStart, emptySlot, type LobbyState } from '../src/net/lobby';
import { NetIndex, SnapshotEncoder, applySnapshot, packBits, unpackBits } from '../src/net/snapshot';
import { Simulation } from '../src/sim/simulation';
import { createSkirmish } from '../src/sim/setup';
import { loadMap, rules, run } from './helpers';

function game() {
  return createSkirmish({
    map: loadMap('kristalltal'),
    rules,
    startCredits: 3000,
    slots: [
      { id: 1, name: 'A', faction: 'aero', color: 0, team: 0, ai: 'easy' },
      { id: 2, name: 'B', faction: 'granite', color: 1, team: 0, ai: 'easy' },
    ],
  });
}

function mirror() {
  return new Simulation({
    map: loadMap('kristalltal'),
    rules,
    victory: 'none',
    players: [
      { id: 1, faction: 'aero', team: 0, color: 0, name: 'A' },
      { id: 2, faction: 'granite', team: 0, color: 1, name: 'B' },
    ],
  });
}

describe('Momentaufnahmen', () => {
  it('Bit-Felder packen und entpacken', () => {
    const src = Uint8Array.from({ length: 77 }, (_, i) => (i * 7) % 3 === 0 ? 1 : 0);
    const out = new Uint8Array(77);
    unpackBits(packBits(src), out);
    expect([...out]).toEqual([...src]);
  });

  it('der Spiegel zeigt genau, was Spieler 1 sehen darf – über viele Aufnahmen', () => {
    const server = game();
    const client = mirror();
    const index = new NetIndex(server);
    const enc = new SnapshotEncoder(server, 1, index);
    let bytes = 0;
    for (let i = 1; i <= 15 * 60 * 9; i++) {
      server.step();
      const events = server.drainEvents();
      if (i % 2 !== 0) continue;
      const snap = enc.encode(events);
      bytes += JSON.stringify(snap, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)).length;
      applySnapshot(client, snap, index, 1);
      if (i % 600 === 0) {
        // Sichtbare Einheiten stimmen überein (Position, HP, Besitzer)
        const expected = server.units
          .filter((u) => server.isAlly(1, u.owner) || server.isVisible(1, tileOf(u.x), tileOf(u.y)))
          .map((u) => [u.id, u.owner, u.x, u.y, u.hp]);
        expect(client.units.map((u) => [u.id, u.owner, u.x, u.y, u.hp])).toEqual(expected);
        expect(client.buildings.map((b) => b.id)).toEqual(server.buildings.filter((b) => server.canSee(1, b)).map((b) => b.id));
        expect(client.players[1].credits).toBe(server.players[1].credits);
        expect([...client.players[1].visible]).toEqual([...server.players[1].visible]);
        expect([...client.economy.crystal]).toEqual([...server.economy.crystal]);
        // Gebäude blockieren auch im Spiegel die Karte (wichtig fürs Platzieren)
        for (const b of client.buildings) expect(client.map.passable(b.tx, b.ty, MoveClass.Vehicle)).toBe(false);
      }
    }
    // Datenmenge: im Schnitt deutlich unter 2 KB pro Aufnahme (als JSON gemessen; über das Netz kleiner)
    expect(bytes / (15 * 60 * 9 / 2)).toBeLessThan(2000);
  }, 60_000);

  it('verrät keine Gegner im Nebel', () => {
    const server = game();
    const enc = new SnapshotEncoder(server, 1, new NetIndex(server));
    run(server, 10);
    const snap = enc.encode([]);
    expect((snap.u ?? []).every((t) => t[2] === 1)).toBe(true);
  });
});

describe('Lobby-Regeln', () => {
  it('Raumcodes sind 6 Zeichen ohne Verwechslungsgefahr', () => {
    for (let i = 0; i < 100; i++) expect(makeRoomCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normalizeCode(' ab-c12 xyz')).toBe('ABC12X');
  });

  it('Namen werden bereinigt', () => {
    expect(cleanName('  Max   Muster ')).toBe('Max Muster');
    expect(cleanName('<script>Lea')).toBe('scriptLea');
    expect(cleanName('X')).toBe('Kommandant');
    expect(cleanName('Sh1t-Head')).toBe('Kommandant');
    expect(cleanName('Zoë_2014')).toBe('Zoë_2014');
  });

  it('Startprüfung je Spielmodus', () => {
    const lobby: LobbyState = {
      code: 'ABCDEF',
      hostSessionId: 'h',
      mapId: 'vier-winde',
      mode: 'ffa',
      startCredits: 3000,
      speed: 1,
      bonusPoints: true,
      slots: [0, 1, 2, 3].map((i) => emptySlot(i, 'closed')),
      chat: [],
      started: false,
    };
    lobby.slots[0] = { ...emptySlot(0, 'human'), sessionId: 'h' };
    expect(validateStart(lobby, 4)).toBe('lobby.err.tooFew');
    lobby.slots[1] = { ...emptySlot(1, 'human'), sessionId: 'g' };
    expect(validateStart(lobby, 4)).toBe('lobby.err.notReady');
    lobby.slots[1].ready = true;
    expect(validateStart(lobby, 4)).toBeNull();
    lobby.mode = 'teams';
    expect(validateStart(lobby, 4)).toBe('lobby.err.teams');
    lobby.slots[0].team = 1;
    lobby.slots[1].team = 2;
    expect(validateStart(lobby, 4)).toBeNull();
    lobby.mode = 'coop';
    expect(validateStart(lobby, 4)).toBe('lobby.err.coopNeedsAi');
    lobby.slots[2] = emptySlot(2, 'ai');
    expect(validateStart(lobby, 4)).toBeNull();
    expect(validateStart(lobby, 2)).toBe('lobby.err.tooMany');
  });
});
