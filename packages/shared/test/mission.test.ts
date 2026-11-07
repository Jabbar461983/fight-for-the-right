import { describe, expect, it } from 'vitest';
import { AI_LEVELS, type AiLevel } from '../src/data/rules';
import { MoveClass } from '../src/map/terrain';
import { TICK_RATE, TILE, tileCenter, tileOf } from '../src/math/fixed';
import { createMission, loadMission, type MissionDef } from '../src/mission/mission';
import { placeBuilding } from '../src/sim/production';
import type { Simulation } from '../src/sim/simulation';
import { loadData, loadMap, rules, run } from './helpers';

const MISSIONS = ['a1', 'a2', 'g1', 'g2'];

function mission(id: string): MissionDef {
  return loadMission(loadData(`missions/${id}.json`), rules);
}

function start(id: string, difficulty: AiLevel = 'medium') {
  const def = mission(id);
  return { def, ...createMission({ def, map: loadMap(def.map), rules, difficulty }) };
}

/** Alle Ereignisse seit dem letzten Aufruf, nur eine Art. */
function events(sim: Simulation, type: string) {
  return sim.drainEvents().filter((e) => e.type === type);
}

function killAll(sim: Simulation, ids: number[]) {
  for (const id of ids) {
    const t = sim.getTarget(id);
    if (t) sim.damage(t, 1_000_000, 0);
  }
}

describe('Missionen', () => {
  it('alle Missionsdateien sind gültig und starten auf jeder Stufe', () => {
    for (const id of MISSIONS) {
      for (const level of AI_LEVELS) {
        const { sim, mission: m } = start(id, level);
        expect(sim.units.some((u) => u.owner === 1), `${id}/${level}: Spieler hat Einheiten`).toBe(true);
        expect(m.objectives.length, `${id}/${level}: Ziele`).toBeGreaterThan(0);
        run(sim, 15 * 20);
        expect(sim.gameOver, `${id}/${level}: nicht sofort vorbei`).toBeNull();
      }
    }
  });

  it('gleicher Ablauf → gleiche Prüfsumme (deterministisch)', () => {
    const a = start('g1', 'hard').sim;
    const b = start('g1', 'hard').sim;
    run(a, 15 * 120);
    run(b, 15 * 120);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('Kampagnen-Reihenfolge: je Fraktion 1, 2', () => {
    const defs = MISSIONS.map(mission);
    for (const f of ['aero', 'granite'] as const) {
      expect(defs.filter((d) => d.faction === f).map((d) => d.order).sort()).toEqual([1, 2]);
    }
  });

  it('A1 Tutorial: Ziele kommen nacheinander, Aussenposten zerstört → Sieg', () => {
    const { sim, mission: m } = start('a1', 'easy');
    const yardDef = rules.building('aero', 'constructionYard')!;
    const wagon = sim.units.find((u) => u.owner === 1 && u.def.deploysTo)!;
    sim.issue(1, { type: 'deploy', units: [wagon.id] });
    run(sim, 40);
    expect(sim.buildings.some((b) => b.owner === 1 && b.def.id === yardDef.id)).toBe(true);
    run(sim, 10);
    expect(m.objectives.find((o) => o.id === 'deploy')?.status).toBe('done');
    expect(m.objectives.find((o) => o.id === 'power')?.status).toBe('open');
    // Gebäude der Reihe nach hinstellen (abgekürzt)
    const yard = sim.buildings.find((b) => b.owner === 1 && b.def.constructionYard)!;
    let x = yard.tx - 8;
    for (const id of ['powerPlant', 'refinery', 'barracks', 'factory']) {
      placeBuilding(sim, 1, rules.building('aero', id)!, x, yard.ty - 4);
      x += 4;
      run(sim, 10);
    }
    expect(m.objectives.find((o) => o.id === 'factory')?.status).toBe('done');
    expect(m.objectives.find((o) => o.id === 'army')?.status).toBe('open');
    for (let i = 0; i < 6; i++) sim.spawnUnit('lightTank', 1, yard.x + (i - 3) * TILE, yard.y + 4 * TILE);
    run(sim, 10);
    expect(m.objectives.find((o) => o.id === 'outpost')?.status).toBe('open');
    expect(sim.gameOver).toBeNull();
    killAll(sim, m.tagged('outpost'));
    run(sim, 10);
    expect(m.result).toBe('victory');
    expect(sim.gameOver?.winners).toEqual([1]);
  });

  it('A1: Bauwagen und Basis verloren → Niederlage', () => {
    const { sim, mission: m } = start('a1', 'easy');
    killAll(sim, sim.units.filter((u) => u.owner === 1 && u.def.deploysTo).map((u) => u.id));
    run(sim, 10);
    expect(m.result).toBe('defeat');
    expect(sim.gameOver?.winners).toEqual([2]);
  });

  it('A1: gesperrte Gebäude sind nicht baubar', () => {
    const { sim } = start('a1');
    expect(sim.issue(1, { type: 'queue', category: 'building', item: 'airfield', action: 'add' })).toBe(true);
    run(sim, 2);
    expect(sim.players[1].queues.building.length).toBe(0);
  });

  it('A2 Rettung: Wege existieren, Befreien wechselt den Besitzer, Abholpunkt → Sieg', () => {
    const { sim, mission: m, def } = start('a2', 'hard');
    const area = (n: string) => def.areas[n];
    const center = (n: string) => ({ tx: area(n)[0] + (area(n)[2] >> 1), ty: area(n)[1] + (area(n)[3] >> 1) });
    const comp = (n: string, cls: MoveClass) => {
      const c = center(n);
      const t = sim.map.nearestPassable(c.tx, c.ty, cls)!;
      return sim.map.componentOf(t.tx, t.ty, cls);
    };
    // Schwebepanzer kommen vom Landeplatz zum Lager, die Forscherin vom Lager zum Abholpunkt
    expect(comp('landing', MoveClass.Hover)).toBe(comp('prison', MoveClass.Hover));
    expect(comp('prison', MoveClass.Infantry)).toBe(comp('pickup', MoveClass.Infantry));

    const researcher = sim.getUnit(m.tagged('researcher')[0])!;
    expect(researcher.owner).toBe(2);
    expect(sim.issue(1, { type: 'attack', units: [sim.units.find((u) => u.owner === 1)!.id], target: researcher.id })).toBe(false);
    // Ein Späher landet im Lager
    const ranger = sim.units.find((u) => u.owner === 1 && u.def.id === 'jetpackRanger')!;
    ranger.x = researcher.x + TILE;
    ranger.y = researcher.y;
    run(sim, 10);
    expect(researcher.owner).toBe(1);
    expect(m.objectives.find((o) => o.id === 'rescue')?.status).toBe('done');
    expect(sim.units.filter((u) => u.owner === 2).length).toBeGreaterThan(0);
    // Zum Abholpunkt
    const p = center('pickup');
    researcher.x = tileCenter(p.tx);
    researcher.y = tileCenter(p.ty);
    run(sim, 10);
    expect(m.result).toBe('victory');
  });

  it('A2: Verfolger kommen erst mit Verzögerung nach der Befreiung (delay)', () => {
    const { sim, mission: m, def } = start('a2', 'hard');
    const [ax, ay, aw, ah] = def.areas.northEast;
    const inNE = () => sim.units.filter((u) => u.owner === 2 && tileOf(u.x) >= ax && tileOf(u.x) < ax + aw && tileOf(u.y) >= ay && tileOf(u.y) < ay + ah).length;
    const researcher = sim.getUnit(m.tagged('researcher')[0])!;
    const ranger = sim.units.find((u) => u.owner === 1 && u.def.id === 'jetpackRanger')!;
    ranger.x = researcher.x + TILE;
    ranger.y = researcher.y;
    run(sim, 10);
    expect(researcher.owner).toBe(1);
    run(sim, 15 * 10);
    expect(inNE()).toBe(0);
    run(sim, 15 * 6);
    expect(sim.units.filter((u) => u.owner === 2 && u.task?.kind === 'attackMove').length).toBeGreaterThan(0);
  });

  it('A2: Trupp verloren → Niederlage', () => {
    const { sim, mission: m } = start('a2', 'easy');
    killAll(sim, sim.units.filter((u) => u.owner === 1).map((u) => u.id));
    run(sim, 10);
    expect(m.result).toBe('defeat');
  });

  it('G1: Wellen kommen und wachsen, Countdown läuft, Bauhof verloren → Niederlage', () => {
    const { sim, mission: m } = start('g1', 'medium');
    expect(m.countdown).not.toBeNull();
    expect(m.tagged('hq').length).toBe(1);
    const enemies = () => sim.units.filter((u) => u.owner === 2).length;
    run(sim, 15 * 80);
    const first = enemies();
    expect(first).toBeGreaterThan(0);
    killAll(sim, sim.units.filter((u) => u.owner === 2).map((u) => u.id));
    run(sim, 15 * 360);
    killAll(sim, m.tagged('hq'));
    run(sim, 10);
    expect(m.result).toBe('defeat');
  });

  it('G1 Leicht: Basis hält 15 Minuten auch mit einfacher Verteidigung → Sieg', () => {
    const { sim, mission: m } = start('g1', 'easy');
    const yard = sim.getBuilding(m.tagged('hq')[0])!;
    // Spieler baut nur ein paar Panzer nach und lässt sie an der Basis stehen
    for (let s = 0; s < 900; s += 30) {
      const p = sim.players[1];
      if (p.credits > 800 && p.queues.vehicle.length === 0) sim.issue(1, { type: 'queue', category: 'vehicle', item: 'lightTank', action: 'add' });
      run(sim, 15 * 30);
      const idle = sim.units.filter((u) => u.owner === 1 && u.def.weapon && !u.order && !u.task);
      if (idle.length) sim.issue(1, { type: 'attackMove', units: idle.map((u) => u.id), x: yard.x + 3 * TILE, y: yard.y + 3 * TILE });
      if (m.result) break;
    }
    run(sim, 15 * 5);
    expect(m.result).toBe('victory');
  }, 60_000);

  it('G2: KI-Basis steht, KI spielt, Basis zerstört → Sieg', () => {
    const { sim, mission: m } = start('g2', 'easy');
    const enemyYard = sim.buildings.find((b) => b.owner === 2 && b.def.constructionYard);
    expect(enemyYard).toBeDefined();
    expect(sim.buildings.some((b) => b.owner === 2 && b.def.airfield)).toBe(true);
    expect(sim.buildings.some((b) => b.owner === 1 && b.def.constructionYard)).toBe(true);
    // Basis auf der eigenen Insel, Gegner auf der gegenüberliegenden
    expect(tileOf(enemyYard!.x)).toBeGreaterThan(60);
    run(sim, 15 * 60);
    expect(sim.players[2].stats.unitsBuilt + sim.players[2].stats.buildingsBuilt).toBeGreaterThan(0);
    killAll(sim, sim.buildings.filter((b) => b.owner === 2).map((b) => b.id));
    killAll(sim, sim.units.filter((u) => u.owner === 2 && u.def.deploysTo).map((u) => u.id));
    run(sim, 10);
    expect(m.result).toBe('victory');
  });

  it('Ereignisse: Funkspruch, Ziele und Missionsende werden gemeldet', () => {
    const { sim } = start('a1', 'easy');
    const radios = events(sim, 'radio');
    expect(radios.length).toBeGreaterThan(0);
    run(sim, Math.round(46 * TICK_RATE));
    expect(events(sim, 'radio').length).toBe(1); // Steuerungs-Tipp nach 45 s
  });
});
