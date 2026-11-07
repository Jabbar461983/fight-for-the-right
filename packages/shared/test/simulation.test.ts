import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/map/gameMap';
import { TILE, tileCenter, tileOf } from '../src/math/fixed';
import type { Simulation } from '../src/sim/simulation';
import { loadMap, makeSim, runUntilIdle } from './helpers';

/** Keine Einheit steht auf für sie unpassierbarem Gelände. */
function assertAllOnValidTerrain(sim: Simulation) {
  for (const u of sim.units) {
    expect(sim.map.passable(tileOf(u.x), tileOf(u.y), u.def.moveClassId), `Einheit ${u.id} (${u.def.id})`).toBe(true);
  }
}

function spawnArmy(sim: Simulation, owner = 1, count = 20) {
  const spawn = sim.map.objectsOfKind('spawn').find((s) => s.props.player === owner)!;
  return sim.spawnFormation(
    [
      { type: 'lightTank', count: Math.round(count * 0.3) },
      { type: 'artillery', count: Math.round(count * 0.1) },
      { type: 'rifleman', count: count - Math.round(count * 0.3) - Math.round(count * 0.1) - Math.round(count * 0.2) },
      { type: 'rocketeer', count: Math.round(count * 0.2) },
    ],
    owner,
    tileOf(spawn.x),
    tileOf(spawn.y),
  );
}

describe('Simulation', () => {
  it('eine Einheit fährt um ein Hindernis zum Ziel', () => {
    const m = GameMap.fromAscii([
      '..........', //
      '....#.....',
      '....#.....',
      '....#.....',
      '..........',
    ]);
    const sim = makeSim(m);
    const u = sim.spawnUnit('lightTank', 1, tileCenter(1), tileCenter(2));
    expect(sim.issue(1, { type: 'move', units: [u.id], x: tileCenter(8), y: tileCenter(2) })).toBe(true);
    const ticks = runUntilIdle(sim, 300);
    expect(ticks).toBeLessThan(300);
    expect(Math.abs(u.x - tileCenter(8))).toBeLessThan(TILE / 4);
    expect(Math.abs(u.y - tileCenter(2))).toBeLessThan(TILE / 4);
    assertAllOnValidTerrain(sim);
  });

  it('20 Einheiten fahren auf Kristalltal quer über die Karte und kommen an', () => {
    const sim = makeSim(loadMap('kristalltal'));
    const army = spawnArmy(sim);
    expect(army).toHaveLength(20);
    const goal = sim.map.objectsOfKind('spawn').find((s) => s.props.player === 2)!;
    sim.issue(1, { type: 'move', units: army.map((u) => u.id), x: goal.x, y: goal.y });
    sim.step(); // Befehle werden zu Beginn des nächsten Ticks ausgeführt
    expect(sim.units.every((u) => u.order !== null)).toBe(true);

    for (let i = 0; i < 1500 && sim.units.some((u) => u.order); i++) {
      sim.step();
      if (i % 50 === 0) assertAllOnValidTerrain(sim);
    }
    expect(sim.units.every((u) => u.order === null)).toBe(true);
    assertAllOnValidTerrain(sim);
    // Alle sind in der Nähe des Ziels angekommen
    for (const u of sim.units) {
      const d = Math.hypot(u.x - goal.x, u.y - goal.y) / TILE;
      expect(d, `Einheit ${u.id} (${u.def.id}) ist ${d.toFixed(1)} Kacheln entfernt`).toBeLessThan(7);
    }
    // Am Ziel stehen sie nicht aufeinander
    let overlaps = 0;
    for (let i = 0; i < sim.units.length; i++) {
      for (let j = i + 1; j < sim.units.length; j++) {
        const a = sim.units[i];
        const b = sim.units[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < (a.def.radiusUnits + b.def.radiusUnits) * 0.5) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it('ist deterministisch: gleiche Befehle → gleicher Zustand', () => {
    const run = () => {
      const sim = makeSim(loadMap('kristalltal'));
      const army = spawnArmy(sim, 1, 40);
      const ids = army.map((u) => u.id);
      const hashes: number[] = [];
      for (let t = 0; t < 400; t++) {
        if (t === 0) sim.issue(1, { type: 'move', units: ids, x: 40 * TILE, y: 30 * TILE });
        if (t === 120) sim.issue(1, { type: 'move', units: ids.slice(0, 10), x: 10 * TILE, y: 20 * TILE });
        if (t === 200) sim.issue(1, { type: 'stop', units: ids.slice(10, 15) });
        sim.step();
        if (t % 50 === 0) hashes.push(sim.stateHash());
      }
      return hashes;
    };
    expect(run()).toEqual(run());
  });

  it('lehnt Befehle für fremde oder unbekannte Einheiten ab', () => {
    const sim = makeSim(loadMap('kristalltal'));
    const mine = spawnArmy(sim, 1, 5);
    const theirs = spawnArmy(sim, 2, 5);
    expect(sim.issue(1, { type: 'move', units: [mine[0].id], x: 0, y: 0 })).toBe(true);
    expect(sim.issue(1, { type: 'move', units: [theirs[0].id], x: 0, y: 0 })).toBe(false);
    expect(sim.issue(1, { type: 'move', units: [9999], x: 0, y: 0 })).toBe(false);
    expect(sim.issue(1, { type: 'move', units: [mine[0].id], x: 1.5, y: 0 })).toBe(false);
    expect(sim.issue(1, { type: 'explode', units: [mine[0].id] })).toBe(false);
    expect(sim.issue(1, { type: 'move', units: [], x: 0, y: 0 })).toBe(false);
  });

  it('Ziel im Wasser: Einheiten halten am Ufer', () => {
    const m = GameMap.fromAscii([
      '.......~~~', //
      '.......~~~',
      '.......~~~',
    ]);
    const sim = makeSim(m);
    const a = sim.spawnUnit('lightTank', 1, tileCenter(1), tileCenter(1));
    const b = sim.spawnUnit('rifleman', 1, tileCenter(1), tileCenter(0));
    sim.issue(1, { type: 'move', units: [a.id, b.id], x: tileCenter(9), y: tileCenter(1) });
    runUntilIdle(sim, 300);
    assertAllOnValidTerrain(sim);
    expect(tileOf(a.x)).toBeGreaterThanOrEqual(5);
  });

  it('Stopp hält Einheiten an', () => {
    const sim = makeSim(GameMap.fromAscii(['....................']));
    const u = sim.spawnUnit('rifleman', 1, tileCenter(0), tileCenter(0));
    sim.issue(1, { type: 'move', units: [u.id], x: tileCenter(19), y: tileCenter(0) });
    for (let i = 0; i < 10; i++) sim.step();
    sim.issue(1, { type: 'stop', units: [u.id] });
    sim.step();
    const x = u.x;
    for (let i = 0; i < 10; i++) sim.step();
    expect(u.order).toBeNull();
    expect(u.x).toBe(x);
  });

  it('zwei Gruppen kreuzen sich in einem Engpass ohne dauerhaft zu blockieren', () => {
    const m = GameMap.fromAscii([
      '####################', //
      '....................',
      '....................',
      '#########..#########',
      '....................',
      '....................',
      '####################',
    ]);
    const sim = makeSim(m);
    const top = [2, 4, 6, 8].map((x) => sim.spawnUnit('lightTank', 1, tileCenter(x), tileCenter(1)));
    const bottom = [11, 13, 15, 17].map((x) => sim.spawnUnit('lightTank', 1, tileCenter(x), tileCenter(5)));
    sim.issue(1, { type: 'move', units: top.map((u) => u.id), x: tileCenter(15), y: tileCenter(5) });
    sim.issue(1, { type: 'move', units: bottom.map((u) => u.id), x: tileCenter(4), y: tileCenter(1) });
    runUntilIdle(sim, 900);
    assertAllOnValidTerrain(sim);
    for (const u of top) expect(tileOf(u.y)).toBeGreaterThanOrEqual(4);
    for (const u of bottom) expect(tileOf(u.y)).toBeLessThanOrEqual(2);
  });

  it('200 Einheiten: ein Tick bleibt schnell genug', () => {
    const sim = makeSim(loadMap('kristalltal'));
    const army = spawnArmy(sim, 1, 200);
    sim.issue(1, { type: 'move', units: army.map((u) => u.id), x: 50 * TILE, y: 12 * TILE });
    const t0 = performance.now();
    const ticks = 150;
    for (let i = 0; i < ticks; i++) sim.step();
    const msPerTick = (performance.now() - t0) / ticks;
    // Budget pro Tick: 66 ms. Wir verlangen grosszügig < 8 ms auf dem Testrechner.
    expect(msPerTick).toBeLessThan(8);
    assertAllOnValidTerrain(sim);
  });
});
