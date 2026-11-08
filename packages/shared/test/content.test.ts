import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../src/data/rules';
import { GameMap } from '../src/map/gameMap';
import { MoveClass } from '../src/map/terrain';
import { TILE, tileCenter, tileOf } from '../src/math/fixed';
import { canPlace } from '../src/sim/production';
import { createSkirmish } from '../src/sim/setup';
import type { Simulation } from '../src/sim/simulation';
import { bdef, loadMap, makeSim, rules, run } from './helpers';

const field = (w = 30, h = 12) => GameMap.fromAscii(Array.from({ length: h }, () => '.'.repeat(w)));

function stepUntil(sim: Simulation, pred: () => boolean, max: number): number {
  for (let i = 0; i < max; i++) {
    if (pred()) return i;
    sim.step();
  }
  return max;
}

describe('Inhalt', () => {
  it('jede Fraktion hat 5 Spezialeinheiten und 1 Spezialverteidigung, alles ist erreichbar', () => {
    for (const f of FACTIONS) {
      const specials = rules.unitsOf(f).filter((u) => u.faction === f);
      expect(specials, f).toHaveLength(5);
      expect(new Set(specials.map((u) => u.category))).toEqual(new Set(['infantry', 'vehicle', 'air', 'naval']));
      const defenses = rules.buildingsOf(f).filter((b) => b.faction === f);
      expect(defenses, f).toHaveLength(1);
      // Alle Voraussetzungen sind Gebäude dieser Fraktion, und es gibt eine Fabrik für jede Kategorie
      for (const d of [...rules.unitsOf(f), ...rules.buildingsOf(f)]) {
        for (const p of d.prerequisites) expect(rules.building(f, p), `${d.id} → ${p}`).toBeDefined();
        if (!d.buildable) continue;
        expect(rules.buildingsOf(f).some((b) => b.produces.includes(d.category as never)), d.id).toBe(true);
      }
    }
  });

  it('alle gemeinsamen Einheiten und Gebäude aus dem Konzept sind vorhanden', () => {
    const units = ['rifleman', 'rocketeer', 'engineer', 'constructionWagon', 'harvester', 'lightTank', 'flakWagon', 'artillery', 'gunship', 'transportHeli', 'patrolBoat', 'transportBoat'];
    const buildings = ['constructionYard', 'powerPlant', 'refinery', 'silo', 'barracks', 'factory', 'radar', 'airfield', 'shipyard', 'repairStation', 'techCenter', 'wall', 'mgTower', 'cannonTower', 'flakPosition'];
    for (const f of FACTIONS) {
      for (const id of units) expect(rules.unit(f, id), id).toBeDefined();
      for (const id of buildings) expect(rules.building(f, id), id).toBeDefined();
    }
  });
});

describe('Transport', () => {
  it('Transporthelikopter nimmt 5 Infanteristen mit, fliegt übers Wasser und lädt aus', () => {
    const m = GameMap.fromAscii([
      '.....~~~~~~~~~.....',
      '.....~~~~~~~~~.....',
      '.....~~~~~~~~~.....',
      '.....~~~~~~~~~.....',
    ]);
    const sim = makeSim(m);
    const heli = sim.spawnUnit('transportHeli', 1, tileCenter(3), tileCenter(1));
    const inf = [0, 1, 2, 3, 4, 5].map((i) => sim.spawnUnit('rifleman', 1, tileCenter(i % 3), tileCenter(i < 3 ? 0 : 3)));
    sim.issue(1, { type: 'enter', units: inf.map((u) => u.id), target: heli.id });
    stepUntil(sim, () => heli.passengers.length === 5, 300);
    run(sim, 30);
    expect(heli.passengers).toHaveLength(5); // der Sechste passt nicht mehr
    expect(sim.units.filter((u) => u.def.id === 'rifleman')).toHaveLength(1);
    sim.issue(1, { type: 'unload', units: [heli.id], x: tileCenter(16), y: tileCenter(1) });
    stepUntil(sim, () => heli.passengers.length === 0, 400);
    run(sim, 2);
    const landed = sim.units.filter((u) => u.def.id === 'rifleman' && tileOf(u.x) >= 14);
    expect(landed).toHaveLength(5);
    for (const u of landed) expect(m.passable(tileOf(u.x), tileOf(u.y), MoveClass.Infantry)).toBe(true);
  });

  it('Transportboot bringt einen Panzer über den See', () => {
    const m = GameMap.fromAscii([
      '....~~~~~~~~....',
      '....~~~~~~~~....',
      '....~~~~~~~~....',
    ]);
    const sim = makeSim(m);
    const boat = sim.spawnUnit('transportBoat', 1, tileCenter(4), tileCenter(1));
    const tank = sim.spawnUnit('lightTank', 1, tileCenter(1), tileCenter(1));
    sim.issue(1, { type: 'enter', units: [tank.id], target: boat.id });
    stepUntil(sim, () => boat.passengers.length === 1, 300);
    expect(boat.passengers).toEqual([tank.id]);
    sim.issue(1, { type: 'unload', units: [boat.id], x: tileCenter(11), y: tileCenter(1) });
    stepUntil(sim, () => boat.passengers.length === 0, 400);
    run(sim, 2);
    expect(sim.getUnit(tank.id)).toBeDefined();
    expect(tileOf(tank.x)).toBeGreaterThanOrEqual(12);
  });

  it('wird der Transporter zerstört, sind die Mitfahrer auch weg', () => {
    const sim = makeSim(field());
    const heli = sim.spawnUnit('transportHeli', 1, tileCenter(3), tileCenter(3));
    const inf = sim.spawnUnit('rifleman', 1, tileCenter(3), tileCenter(4));
    sim.issue(1, { type: 'enter', units: [inf.id], target: heli.id });
    stepUntil(sim, () => heli.passengers.length === 1, 200);
    sim.damage(heli, 100_000, 2);
    sim.step();
    expect(sim.stored.size).toBe(0);
    expect(sim.players[1].stats.unitsLost).toBe(2);
  });
});

describe('Bunker, Maulwurf, Jets, Schild', () => {
  it('Panzerbunker: 3 Schützen schiessen von drinnen, Räumen bringt sie zurück', () => {
    const sim = makeSim(field());
    const bunker = sim.addBuilding(bdef(sim, 2, 'bunker'), 2, 5, 4);
    const inf = [0, 1, 2, 3].map((i) => sim.spawnUnit('rifleman', 2, tileCenter(2 + i), tileCenter(8)));
    sim.issue(2, { type: 'enter', units: inf.map((u) => u.id), target: bunker.id });
    stepUntil(sim, () => bunker.passengers.length === 3, 300);
    run(sim, 20);
    expect(bunker.passengers).toHaveLength(3);
    const enemy = sim.spawnUnit('rifleman', 1, tileCenter(10), tileCenter(5));
    sim.issue(1, { type: 'stance', units: [enemy.id], stance: 'passive' });
    stepUntil(sim, () => enemy.dead, 15 * 10);
    expect(enemy.dead).toBe(true);
    sim.issue(2, { type: 'evacuate', building: bunker.id });
    run(sim, 2);
    expect(bunker.passengers).toHaveLength(0);
    expect(sim.units.filter((u) => u.owner === 2 && u.def.id === 'rifleman')).toHaveLength(4);
  });

  it('Maulwurf kommt mit 4 Schützen, ist eingegraben unsichtbar und taucht am Ziel auf', () => {
    const sim = makeSim(field(40, 8), 5000);
    sim.addBuilding(bdef(sim, 2, 'factory'), 2, 2, 1);
    sim.addBuilding(bdef(sim, 2, 'techCenter'), 2, 6, 1);
    sim.addBuilding(bdef(sim, 2, 'powerPlant'), 2, 9, 1);
    sim.addBuilding(bdef(sim, 2, 'powerPlant'), 2, 12, 1);
    sim.issue(2, { type: 'queue', category: 'vehicle', item: 'mole', action: 'add' });
    stepUntil(sim, () => sim.units.some((u) => u.def.id === 'mole'), 15 * 60);
    const mole = sim.units.find((u) => u.def.id === 'mole')!;
    expect(mole.passengers).toHaveLength(4);
    const watcher = sim.spawnUnit('lightTank', 1, tileCenter(30), tileCenter(5));
    sim.issue(1, { type: 'stance', units: [watcher.id], stance: 'passive' });
    run(sim, 30);
    sim.issue(2, { type: 'move', units: [mole.id], x: tileCenter(28), y: tileCenter(5) });
    let seenWhileMoving = false;
    for (let i = 0; i < 900 && (mole.order || i < 3); i++) {
      sim.step();
      if (mole.burrowed && sim.canSee(1, mole)) seenWhileMoving = true;
    }
    expect(seenWhileMoving).toBe(false);
    expect(mole.burrowed).toBe(false);
    sim.issue(2, { type: 'unload', units: [mole.id] });
    run(sim, 2);
    expect(sim.units.filter((u) => u.owner === 2 && u.def.id === 'rifleman')).toHaveLength(4);
  });

  it('Komet-Jäger feuert seine Raketen und fliegt zum Aufmunitionieren zurück', () => {
    const sim = makeSim(field(40, 10));
    const airfield = sim.addBuilding(bdef(sim, 1, 'airfield'), 1, 2, 2);
    const jet = sim.spawnUnit('cometFighter', 1, tileCenter(15), tileCenter(5));
    const target = sim.spawnUnit('lightTank', 2, tileCenter(18), tileCenter(5));
    target.hp = 10_000;
    sim.issue(2, { type: 'stance', units: [target.id], stance: 'passive' });
    stepUntil(sim, () => jet.ammo === 0, 15 * 10);
    expect(jet.ammo).toBe(0);
    stepUntil(sim, () => jet.ammo > 0, 15 * 30);
    expect(jet.ammo).toBe(2);
    expect(sim.distanceTo(jet.x, jet.y, airfield)).toBeLessThan(3 * TILE);
  });

  it('Flak-Stellung trifft Helikopter, MG-Turm nicht', () => {
    const sim = makeSim(field());
    sim.addBuilding(bdef(sim, 1, 'mgTower'), 1, 5, 5);
    const heli = sim.spawnUnit('gunship', 2, tileCenter(8), tileCenter(5));
    sim.issue(2, { type: 'stance', units: [heli.id], stance: 'passive' });
    run(sim, 15 * 5);
    expect(heli.hp).toBe(heli.def.hp);
    sim.addBuilding(bdef(sim, 1, 'flakPosition'), 1, 5, 7);
    stepUntil(sim, () => heli.dead, 15 * 20);
    expect(heli.dead).toBe(true);
  });

  it('Schildträger halbiert den Schaden an Infanterie in der Nähe', () => {
    const sim = makeSim(field());
    const a = sim.spawnUnit('rifleman', 2, tileCenter(5), tileCenter(5));
    const b = sim.spawnUnit('rifleman', 2, tileCenter(20), tileCenter(5));
    sim.spawnUnit('shieldBearer', 2, tileCenter(5) + 400, tileCenter(5));
    sim.rebuildHash();
    sim.damage(a, 40, 1);
    sim.damage(b, 40, 1);
    expect(100 - a.hp).toBeLessThan(100 - b.hp);
  });

  it('Jetpack-Ranger fliegt über Klippen, Gleiterpanzer fährt übers Wasser', () => {
    const m = GameMap.fromAscii(['..#####..', '..#####..', '..~~~~~..']);
    const sim = makeSim(m);
    const ranger = sim.spawnUnit('jetpackRanger', 1, tileCenter(0), tileCenter(0));
    const hover = sim.spawnUnit('hoverTank', 1, tileCenter(0), tileCenter(2));
    sim.issue(1, { type: 'move', units: [ranger.id], x: tileCenter(8), y: tileCenter(0) });
    sim.issue(1, { type: 'move', units: [hover.id], x: tileCenter(8), y: tileCenter(2) });
    run(sim, 15 * 10);
    expect(tileOf(ranger.x)).toBe(8);
    expect(tileOf(hover.x)).toBe(8);
    // Ranger ist Infanterie im Tiefflug: Bodenwaffen treffen ihn
    expect(ranger.def.airborne).toBe(false);
  });
});

describe('Werft, Reparatur, Bonus-Punkte', () => {
  it('Werft braucht Wasser; Schiffe starten auf dem Wasser', () => {
    const m = GameMap.fromAscii([
      '..............',
      '..............',
      '..............',
      '..........~~~~',
      '..........~~~~',
    ]);
    const sim = makeSim(m, 5000);
    sim.addBuilding(bdef(sim, 1, 'constructionYard'), 1, 0, 0);
    sim.addBuilding(bdef(sim, 1, 'powerPlant'), 1, 3, 3);
    const yard = bdef(sim, 1, 'shipyard');
    expect(canPlace(sim, 1, yard, 4, 0).reason).toBe('noWater');
    expect(canPlace(sim, 1, yard, 7, 2).ok).toBe(true);
    sim.addBuilding(yard, 1, 7, 2);
    sim.issue(1, { type: 'queue', category: 'naval', item: 'patrolBoat', action: 'add' });
    stepUntil(sim, () => sim.units.some((u) => u.def.id === 'patrolBoat'), 15 * 30);
    const boat = sim.units.find((u) => u.def.id === 'patrolBoat')!;
    expect(m.passable(tileOf(boat.x), tileOf(boat.y), MoveClass.Naval)).toBe(true);
  });

  it('Reparaturstation repariert Fahrzeuge gegen Glimmerit', () => {
    const sim = makeSim(field(), 2000);
    sim.addBuilding(bdef(sim, 1, 'repairStation'), 1, 5, 5);
    const tank = sim.spawnUnit('lightTank', 1, tileCenter(7) + 300, tileCenter(5));
    tank.hp = 50;
    run(sim, 15 * 10);
    expect(tank.hp).toBeGreaterThan(200);
    expect(sim.players[1].credits).toBeLessThan(2000);
  });

  it('Bonus-Punkte: Ingenieur besetzt die Quelle, sie bringt Einkommen, Gegner kann sie zurückholen', () => {
    const sim = createSkirmish({
      map: loadMap('kristalltal'),
      rules,
      startCredits: 0,
      bonusPoints: true,
      slots: [
        { id: 1, name: 'A', faction: 'aero', color: 0, team: 0 },
        { id: 2, name: 'B', faction: 'granite', color: 1, team: 0 },
      ],
    });
    const sources = sim.buildings.filter((b) => b.def.neutral);
    expect(sources.length).toBe(4);
    const src = sources[0];
    // Unverwundbar
    sim.damage(src, 100_000, 1);
    expect(src.dead).toBe(false);
    // Lager für das Einkommen
    sim.addBuilding(bdef(sim, 1, 'refinery'), 1, 2, 2);
    const eng = sim.spawnUnit('engineer', 1, src.x + 3 * TILE, src.y);
    sim.issue(1, { type: 'enter', units: [eng.id], target: src.id });
    stepUntil(sim, () => src.owner === 1, 15 * 20);
    expect(src.owner).toBe(1);
    const before = sim.players[1].credits;
    run(sim, 15 * 10);
    expect(sim.players[1].credits).toBeGreaterThan(before);
    const enemyEng = sim.spawnUnit('engineer', 2, src.x - 3 * TILE, src.y);
    sim.issue(2, { type: 'enter', units: [enemyEng.id], target: src.id });
    stepUntil(sim, () => src.owner === 2, 15 * 20);
    expect(src.owner).toBe(2);
  });
});

describe('Neue Karten', () => {
  it('Zwei Ufer: Basen über Brücken verbunden, Werft am Seitenarm möglich', () => {
    const m = loadMap('zwei-ufer');
    const [a, b] = m.objectsOfKind('spawn');
    const ca = m.componentOf(tileOf(a.x), tileOf(a.y), MoveClass.Vehicle);
    expect(m.componentOf(tileOf(b.x), tileOf(b.y), MoveClass.Vehicle)).toBe(ca);
    expect([...m.terrain].some((t) => t === 6)).toBe(true); // Brücken
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) expect(m.terrainAt(x, y)).toBe(m.terrainAt(m.width - 1 - x, m.height - 1 - y));
  });

  it('Archipel: 4 Inseln ohne Landverbindung, alle per Schiff erreichbar', () => {
    const m = loadMap('archipel');
    const spawns = m.objectsOfKind('spawn');
    expect(spawns).toHaveLength(4);
    const land = spawns.map((s) => m.componentOf(tileOf(s.x), tileOf(s.y), MoveClass.Vehicle));
    expect(new Set(land).size).toBe(4);
    // Jede Insel hat Wasser in der Nähe, und alles Wasser ist ein zusammenhängendes Meer
    const waterComps = new Set<number>();
    for (let i = 0; i < m.terrain.length; i++) {
      if (m.terrain[i] !== 5) continue;
      waterComps.add(m.componentOf(i % m.width, Math.floor(i / m.width), MoveClass.Naval));
    }
    expect(waterComps.size).toBe(1);
  });
});

describe('KI Mittel und Schwer', () => {
  const game = (a: 'easy' | 'medium' | 'hard', b: 'easy' | 'medium' | 'hard' | undefined, map = 'kristalltal', bonusPoints = false) =>
    createSkirmish({
      map: loadMap(map),
      rules,
      startCredits: 3000,
      bonusPoints,
      slots: [
        { id: 1, name: 'A', faction: 'granite', color: 0, team: 0, ai: a },
        { id: 2, name: 'B', faction: 'aero', color: 1, team: 0, ai: b },
      ],
    });

  it('Schwer baut Technikzentrum, Spezialeinheiten und besetzt Bonus-Punkte', () => {
    const sim = game('hard', 'easy', 'kristalltal', true);
    const seen = { tech: false, airfield: false, bonus: false, special: false };
    for (let i = 0; i < 15 * 60 * 25 && !sim.gameOver; i++) {
      sim.step();
      if (i % 150 !== 0) continue;
      for (const b of sim.buildings) {
        if (b.owner !== 1) continue;
        if (b.def.id === 'techCenter') seen.tech = true;
        if (b.def.id === 'airfield') seen.airfield = true;
        if (b.def.neutral) seen.bonus = true;
      }
      if (sim.units.some((u) => u.owner === 1 && u.def.faction === 'granite')) seen.special = true;
    }
    // Gewinnt Schwer früh, kommt es vielleicht nicht mehr zu Flugfeld und Bonus-Punkten – das ist in Ordnung
    const wonEarly = sim.gameOver?.winners.includes(1) ?? false;
    const info = JSON.stringify({ ...seen, tick: sim.tick, over: sim.gameOver });
    expect(seen.tech, info).toBe(true);
    if (!wonEarly) expect(seen, info).toEqual({ tech: true, airfield: true, bonus: true, special: true });
    else expect(sim.tick, info).toBeLessThan(15 * 60 * 25);
  }, 300_000);

  // Stand 8.11.2026 (Balancing Etappe 6): auf Kristalltal 2 Siege, 2 Unentschieden (30 Min.), keine Niederlage.
  it('Schwer verliert auf Kristalltal nie gegen Leicht (beide Startplätze, beide Fraktionen)', () => {
    let wins = 0;
    for (const hardFirst of [true, false]) {
      for (const hardFaction of ['aero', 'granite'] as const) {
        const other: 'aero' | 'granite' = hardFaction === 'aero' ? 'granite' : 'aero';
        const hard = { name: 'S', faction: hardFaction, color: 0, team: 0, ai: 'hard' as const };
        const easy = { name: 'L', faction: other, color: 1, team: 0, ai: 'easy' as const };
        const slots = hardFirst ? [{ id: 1, ...hard }, { id: 2, ...easy }] : [{ id: 1, ...easy }, { id: 2, ...hard }];
        const sim = createSkirmish({ map: loadMap('kristalltal'), rules, startCredits: 3000, slots });
        for (let i = 0; i < 15 * 60 * 30 && !sim.gameOver; i++) sim.step();
        const hardId = hardFirst ? 1 : 2;
        expect(sim.gameOver?.winners ?? [hardId], `${hardFaction} ${hardFirst}`).toContain(hardId);
        if (sim.gameOver) wins++;
      }
    }
    expect(wins).toBeGreaterThanOrEqual(1);
  }, 600_000);

  it('auf dem Archipel setzt die KI auf Luft und See', () => {
    const sim = createSkirmish({
      map: loadMap('archipel'),
      rules,
      startCredits: 5000,
      slots: [
        { id: 1, name: 'A', faction: 'aero', color: 0, team: 0, ai: 'medium' },
        { id: 2, name: 'B', faction: 'granite', color: 1, team: 0 },
      ],
    });
    run(sim, 15 * 60 * 14);
    const air = sim.units.filter((u) => u.owner === 1 && (u.def.category === 'air' || u.def.category === 'naval'));
    expect(air.length).toBeGreaterThan(0);
  }, 120_000);
});
