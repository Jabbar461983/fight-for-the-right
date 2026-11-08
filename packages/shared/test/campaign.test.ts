import { describe, expect, it } from 'vitest';
import { MoveClass } from '../src/map/terrain';
import { TILE, tileCenter, tileOf } from '../src/math/fixed';
import { createMission, loadMission, type MissionDef } from '../src/mission/mission';
import type { Simulation } from '../src/sim/simulation';
import { loadData, loadMap, rules, run } from './helpers';
import type { AiLevel } from '../src/data/rules';

function start(id: string, difficulty: AiLevel = 'medium') {
  const def: MissionDef = loadMission(loadData(`missions/${id}.json`), rules);
  return { def, ...createMission({ def, map: loadMap(def.map), rules, difficulty }) };
}

const center = (def: MissionDef, area: string) => {
  const a = def.areas[area];
  return { tx: a[0] + (a[2] >> 1), ty: a[1] + (a[3] >> 1) };
};

function killAll(sim: Simulation, ids: number[]) {
  for (const id of ids) {
    const t = sim.getTarget(id);
    if (t) sim.damage(t, 1_000_000, 0);
  }
}

describe('Kampagne: neue Missionen', () => {
  it('Ziele mit Gebiet werden markiert (A2: Abholpunkt)', () => {
    const { sim, mission: m, def } = start('a2');
    expect(m.objectives.find((o) => o.id === 'rescue')?.area).toEqual(def.areas.prison);
    const researcher = sim.getUnit(m.tagged('researcher')[0])!;
    const ranger = sim.units.find((u) => u.owner === 1 && u.def.id === 'jetpackRanger')!;
    ranger.x = researcher.x + TILE;
    ranger.y = researcher.y;
    run(sim, 10);
    expect(m.objectives.find((o) => o.id === 'escort')?.area).toEqual(def.areas.pickup);
  });

  it('A4 Konvoi: Weg zum Depot existiert, 2 Sammler im Depot → Sieg, zu viele verloren → Niederlage', () => {
    const { sim, mission: m, def } = start('a4', 'medium');
    const convoy = m.tagged('convoy').map((id) => sim.getUnit(id)!);
    expect(convoy).toHaveLength(4);
    const s = center(def, 'convoyStart');
    const d = center(def, 'depot');
    const comp = (p: { tx: number; ty: number }) => {
      const t = sim.map.nearestPassable(p.tx, p.ty, MoveClass.Vehicle)!;
      return sim.map.componentOf(t.tx, t.ty, MoveClass.Vehicle);
    };
    expect(comp(s)).toBe(comp(d));
    // Sammler sammeln nicht von selbst los (Spieler steuert den Konvoi)
    run(sim, 15 * 5);
    expect(convoy.every((u) => u.task === null)).toBe(true);
    for (const u of convoy.slice(0, 2)) {
      u.x = tileCenter(d.tx);
      u.y = tileCenter(d.ty);
    }
    run(sim, 10);
    expect(m.result).toBe('victory');

    const b = start('a4', 'medium');
    killAll(b.sim, b.mission.tagged('convoy').slice(0, 3));
    run(b.sim, 10);
    expect(b.mission.result).toBe('defeat');
  });

  it('A5: Ingenieure übernehmen beide Quellen → Halten → Sieg nach dem Countdown', () => {
    const { sim, mission: m } = start('a5', 'easy');
    const sources = m.tagged('sources').map((id) => sim.getBuilding(id)!);
    expect(sources).toHaveLength(2);
    expect(sources.every((b) => b.owner === 0)).toBe(true);
    for (const b of sources) sim.captureBuilding(b, 1);
    run(sim, 10);
    expect(m.objectives.find((o) => o.id === 'capture')?.status).toBe('done');
    expect(m.countdown).not.toBeNull();
    run(sim, 15 * 185);
    expect(m.result).toBe('victory');
  });

  it('A7: die Verbündete Staffel ist ein Verbündeter, beide Gegner sind Feinde mit eigener KI', () => {
    const { sim } = start('a7');
    expect(sim.isAlly(1, 4)).toBe(true);
    expect(sim.isEnemy(1, 2)).toBe(true);
    expect(sim.isEnemy(1, 3)).toBe(true);
    expect(sim.listeners.length).toBe(4); // 3 KIs + Mission
  });

  it('G3: Kraftwerk übernehmen bringt einen Bauwagen und das nächste Ziel', () => {
    const { sim, mission: m } = start('g3');
    const power = sim.getBuilding(m.tagged('power')[0])!;
    sim.captureBuilding(power, 1);
    run(sim, 10);
    expect(m.objectives.find((o) => o.id === 'power')?.status).toBe('done');
    expect(sim.units.some((u) => u.owner === 1 && u.def.deploysTo)).toBe(true);
    killAll(sim, m.tagged('outpost'));
    run(sim, 10);
    expect(m.result).toBe('victory');
  });

  it('G4: feindliche Boote erscheinen auf dem Wasser (nicht an Land)', () => {
    const { sim } = start('g4', 'hard');
    run(sim, 15 * 305);
    const boats = sim.units.filter((u) => u.owner === 2 && u.def.category === 'naval');
    expect(boats.length).toBeGreaterThan(0);
    for (const b of boats) expect(sim.map.passable(tileOf(b.x), tileOf(b.y), MoveClass.Naval), b.def.id).toBe(true);
  });

  it('G5: drei Radarposten zerstören → Sieg', () => {
    const { sim, mission: m } = start('g5');
    for (const tag of ['r1', 'r2', 'r3']) {
      killAll(sim, m.tagged(tag));
      run(sim, 10);
    }
    expect(m.result).toBe('victory');
  });

  it('spätere Missionen sind schwerer: mehr bzw. stärkere KI-Gegner', () => {
    const enemies = (id: string, level: AiLevel) => {
      const { sim } = start(id, level);
      return sim.listeners.length - 1;
    };
    expect(enemies('a3', 'easy')).toBe(1);
    expect(enemies('a8', 'easy')).toBe(3);
    expect(enemies('g8', 'easy')).toBe(3);
  });
});
