import { describe, expect, it } from 'vitest';
import { loadRules } from '../src/data/rules';
import { damageFor } from '../src/sim/combat';
import { GameMap } from '../src/map/gameMap';
import { TILE, tileCenter } from '../src/math/fixed';
import { canPlace, placeBuilding } from '../src/sim/production';
import { createSkirmish } from '../src/sim/setup';
import type { SimEvent } from '../src/sim/events';
import type { Simulation } from '../src/sim/simulation';
import { bdef, loadMap, makeSim, rules, rulesFiles, run } from './helpers';

/** Offene Wiese zum Testen. */
const field = (w = 30, h = 12) => GameMap.fromAscii(Array.from({ length: h }, () => '.'.repeat(w)));

function events(sim: Simulation, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    out.push(...sim.drainEvents());
  }
  return out;
}

describe('Regeln', () => {
  it('lädt alle Dateien und rechnet Fraktionsunterschiede ein', () => {
    const aero = rules.unit('aero', 'rifleman')!;
    const granite = rules.unit('granite', 'rifleman')!;
    // Preise sind auf Zehner gerundet – der Unterschied zeigt sich bei teureren Einheiten
    expect(rules.unit('aero', 'lightTank')!.cost).toBeLessThan(rules.unit('granite', 'lightTank')!.cost);
    expect(aero.speedUnits).toBeGreaterThan(granite.speedUnits);
    expect(aero.hp).toBeLessThan(granite.hp);
    expect(aero.weapon?.id).toBe('rifle');
    expect(rules.building('aero', 'refinery')?.freeUnit).toBe('harvester');
  });

  it('meldet Fehler in Datendateien verständlich', () => {
    const files = rulesFiles();
    const bad = structuredClone(files.units[0]) as { units: { weapon?: string }[] };
    bad.units[0].weapon = 'laserschwert';
    expect(() => loadRules({ ...files, units: [bad] })).toThrow(/unbekannte Waffe/);
    expect(() => loadRules({ ...files, weapons: { weapons: [{ id: 'x' }] } })).toThrow(/weapons.json/);
  });

  it('Stein-Schere-Papier: Gewehr gegen Infanterie stark, gegen Panzer schwach', () => {
    const sim = makeSim(field());
    const rifle = rules.weapons.get('rifle')!;
    const rocket = rules.weapons.get('rocketLauncher')!;
    const inf = sim.spawnUnit('rifleman', 1, TILE, TILE);
    const tank = sim.spawnUnit('lightTank', 1, 3 * TILE, TILE);
    expect(damageFor(rifle, inf)).toBeGreaterThan(damageFor(rifle, tank) * 3);
    expect(damageFor(rocket, tank)).toBeGreaterThan(damageFor(rocket, inf) * 3);
  });
});

describe('Basisbau und Strom', () => {
  function base(credits = 5000) {
    const sim = makeSim(field(40, 20), credits);
    sim.addBuilding(bdef(sim, 1, 'constructionYard'), 1, 2, 2);
    return sim;
  }

  it('baut ein Kraftwerk, bucht laufend ab und wartet aufs Platzieren', () => {
    const sim = base();
    const pp = bdef(sim, 1, 'powerPlant');
    sim.issue(1, { type: 'queue', category: 'building', item: 'powerPlant', action: 'add' });
    run(sim, Math.floor(pp.buildTicks / 2));
    const mid = sim.players[1].credits;
    expect(mid).toBeLessThan(5000);
    expect(mid).toBeGreaterThan(5000 - pp.cost);
    const ev = events(sim, pp.buildTicks);
    expect(ev.some((e) => e.type === 'buildingReady')).toBe(true);
    expect(sim.players[1].ready.building).toBe('powerPlant');
    expect(sim.players[1].credits).toBe(5000 - pp.cost);

    // Zu weit weg → abgelehnt; daneben → gebaut
    expect(canPlace(sim, 1, pp, 30, 15).reason).toBe('tooFar');
    sim.issue(1, { type: 'place', category: 'building', tx: 30, ty: 15 });
    sim.step();
    expect(sim.buildings).toHaveLength(1);
    sim.issue(1, { type: 'place', category: 'building', tx: 6, ty: 2 });
    sim.step();
    expect(sim.buildings).toHaveLength(2);
    expect(sim.players[1].powerProduced).toBe(100);
    expect(sim.players[1].ready.building).toBeUndefined();
    // Gebäude blockiert den Weg
    expect(sim.map.isBlocked(6, 2)).toBe(true);
  });

  it('Abbrechen erstattet alles, Pause hält an', () => {
    const sim = base();
    sim.issue(1, { type: 'queue', category: 'building', item: 'powerPlant', action: 'add' });
    run(sim, 30);
    const item = sim.players[1].queues.building[0];
    sim.issue(1, { type: 'queue', category: 'building', item: 'powerPlant', action: 'pause' });
    run(sim, 2);
    const done = item.done;
    run(sim, 30);
    expect(item.done).toBe(done);
    sim.issue(1, { type: 'queue', category: 'building', item: 'powerPlant', action: 'cancel' });
    sim.step();
    expect(sim.players[1].queues.building).toHaveLength(0);
    expect(sim.players[1].credits).toBe(5000);
  });

  it('gesperrte Einträge lassen sich nicht bauen (Voraussetzung fehlt)', () => {
    const sim = base();
    sim.issue(1, { type: 'queue', category: 'building', item: 'factory', action: 'add' });
    sim.step();
    expect(sim.players[1].queues.building).toHaveLength(0);
  });

  it('Strommangel halbiert das Bautempo', () => {
    const timeFor = (withPower: boolean) => {
      const sim = base();
      if (withPower) sim.addBuilding(bdef(sim, 1, 'powerPlant'), 1, 6, 2);
      sim.addBuilding(bdef(sim, 1, 'barracks'), 1, 2, 6);
      expect(sim.players[1].lowPower).toBe(!withPower);
      sim.issue(1, { type: 'queue', category: 'infantry', item: 'rifleman', action: 'add' });
      for (let i = 1; i < 1000; i++) {
        sim.step();
        if (sim.units.length > 0) return i;
      }
      return 1000;
    };
    const fast = timeFor(true);
    const slow = timeFor(false);
    expect(slow).toBeGreaterThanOrEqual(fast * 2 - 2);
  });

  it('Verkaufen bringt die Hälfte zurück und gibt die Fläche frei', () => {
    const sim = base(0);
    const b = sim.addBuilding(bdef(sim, 1, 'powerPlant'), 1, 6, 2);
    sim.issue(1, { type: 'sell', building: b.id });
    sim.step();
    expect(sim.players[1].credits).toBe(Math.floor(b.def.cost / 2));
    expect(sim.map.isBlocked(6, 2)).toBe(false);
  });

  it('Reparieren kostet Glimmerit und heilt', () => {
    const sim = base(1000);
    const b = sim.addBuilding(bdef(sim, 1, 'powerPlant'), 1, 6, 2);
    b.hp = 100;
    sim.issue(1, { type: 'repair', building: b.id });
    run(sim, 200);
    // 40 Reparaturschritte à 1 % (aufgerundet 5 HP)
    expect(b.hp).toBe(300);
    expect(sim.players[1].credits).toBeLessThan(1000);
  });
});

describe('Wirtschaft', () => {
  function econ(credits: number) {
    const sim = makeSim(loadMap('kristalltal'), credits);
    sim.addBuilding(bdef(sim, 1, 'constructionYard'), 1, 8, 51);
    placeBuilding(sim, 1, bdef(sim, 1, 'refinery'), 13, 54);
    return sim;
  }

  it('Raffinerie bringt einen Sammler mit, der Glimmerit erntet und abliefert', () => {
    const sim = econ(0);
    const harvester = sim.units.find((u) => u.def.harvestCapacity);
    expect(harvester).toBeDefined();
    const before = sim.economy.total();
    run(sim, 15 * 90);
    expect(sim.players[1].stats.harvested).toBeGreaterThan(0);
    expect(sim.players[1].credits).toBe(sim.players[1].stats.harvested);
    expect(sim.economy.total()).toBeLessThan(before);
  });

  it('volles Lager stoppt die Ernte mit Hinweis', () => {
    const sim = econ(100_000);
    const ev = events(sim, 15 * 90);
    expect(sim.players[1].stats.harvested).toBe(0);
    expect(ev.some((e) => e.type === 'storageFull' && e.owner === 1)).toBe(true);
  });
});

describe('Kampf', () => {
  it('Panzer besiegt Schützen, mit Ereignis und Statistik', () => {
    const sim = makeSim(field());
    sim.spawnUnit('lightTank', 1, tileCenter(2), tileCenter(5));
    const enemy = sim.spawnUnit('rifleman', 2, tileCenter(6), tileCenter(5));
    const ev = events(sim, 15 * 20);
    expect(enemy.dead).toBe(true);
    expect(ev.some((e) => e.type === 'unitDied' && e.id === enemy.id)).toBe(true);
    expect(ev.some((e) => e.type === 'fired')).toBe(true);
    expect(sim.players[1].stats.kills).toBe(1);
    expect(sim.players[2].stats.unitsLost).toBe(1);
  });

  it('Haltung «Passiv» schiesst nicht von selbst', () => {
    const sim = makeSim(field());
    const tank = sim.spawnUnit('lightTank', 1, tileCenter(2), tileCenter(5));
    const enemy = sim.spawnUnit('lightTank', 2, tileCenter(5), tileCenter(5));
    sim.issue(1, { type: 'stance', units: [tank.id], stance: 'passive' });
    sim.issue(2, { type: 'stance', units: [enemy.id], stance: 'passive' });
    run(sim, 15 * 5);
    expect(enemy.hp).toBe(enemy.def.hp);
    expect(tank.hp).toBe(tank.def.hp);
  });

  it('Angriffsbefehl auf ein Gebäude zerstört es und gibt die Fläche frei', () => {
    const sim = makeSim(field(), 0, 'none');
    const tank = sim.spawnUnit('lightTank', 1, tileCenter(2), tileCenter(5));
    const target = sim.addBuilding(bdef(sim, 2, 'powerPlant'), 2, 20, 4);
    sim.step();
    sim.issue(1, { type: 'attack', units: [tank.id], target: target.id });
    run(sim, 15 * 60);
    expect(target.dead).toBe(true);
    expect(sim.map.isBlocked(20, 4)).toBe(false);
  });

  it('MG-Turm verteidigt gegen Infanterie', () => {
    const sim = makeSim(field());
    sim.addBuilding(bdef(sim, 1, 'mgTower'), 1, 5, 5);
    const enemy = sim.spawnUnit('rifleman', 2, tileCenter(12), tileCenter(5));
    sim.issue(2, { type: 'move', units: [enemy.id], x: tileCenter(8), y: tileCenter(5) });
    run(sim, 15 * 15);
    expect(enemy.dead).toBe(true);
  });

  it('Artillerie trifft mit Flächenschaden mehrere Gegner', () => {
    const sim = makeSim(field(40, 12));
    const arty = sim.spawnUnit('artillery', 1, tileCenter(2), tileCenter(5));
    const group = [0, 1, 2].map((i) => sim.spawnUnit('rifleman', 2, tileCenter(9) + i * 300, tileCenter(5)));
    for (const g of group) sim.issue(2, { type: 'stance', units: [g.id], stance: 'passive' });
    sim.step();
    sim.issue(1, { type: 'attack', units: [arty.id], target: group[1].id });
    run(sim, 15 * 6);
    expect(group.filter((g) => g.hp < g.def.hp).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Nebel des Krieges', () => {
  it('sieht nur in Sichtweite, Erkundetes bleibt erkundet', () => {
    const sim = makeSim(field(40, 5));
    const scout = sim.spawnUnit('rifleman', 1, tileCenter(2), tileCenter(2));
    sim.step();
    expect(sim.isVisible(1, 3, 2)).toBe(true);
    expect(sim.isVisible(1, 30, 2)).toBe(false);
    scout.x = tileCenter(30);
    run(sim, 3);
    expect(sim.isVisible(1, 2, 2)).toBe(false);
    expect(sim.players[1].explored[sim.map.index(2, 2)]).toBe(1);
  });

  it('merkt sich gegnerische Gebäude, bis die Stelle wieder sichtbar ist', () => {
    const sim = makeSim(field(40, 5));
    const scout = sim.spawnUnit('rifleman', 1, tileCenter(2), tileCenter(2));
    const silo = sim.addBuilding(bdef(sim, 2, 'silo'), 2, 5, 1);
    sim.issue(1, { type: 'stance', units: [scout.id], stance: 'passive' });
    run(sim, 2);
    expect(sim.players[1].ghosts.has(silo.id)).toBe(true);
    scout.x = tileCenter(35);
    run(sim, 3);
    sim.damage(silo, 100_000, 0);
    run(sim, 6);
    expect(sim.players[1].ghosts.has(silo.id)).toBe(true); // noch nicht gesehen, dass es weg ist
    scout.x = tileCenter(3);
    run(sim, 3);
    expect(sim.players[1].ghosts.has(silo.id)).toBe(false);
  });

  it('Einheiten schiessen nicht auf Ziele im Nebel', () => {
    const sim = makeSim(field(40, 5));
    // Artillerie-Reichweite 9 > Sicht 6
    sim.spawnUnit('artillery', 1, tileCenter(2), tileCenter(2));
    const far = sim.spawnUnit('rifleman', 2, tileCenter(10), tileCenter(2));
    sim.issue(2, { type: 'stance', units: [far.id], stance: 'passive' });
    run(sim, 15 * 5);
    expect(far.hp).toBe(far.def.hp);
  });
});

describe('Bauwagen, Ingenieur, Sieg', () => {
  it('Bauwagen fährt zum Bauhof aus', () => {
    const sim = makeSim(field());
    const wagon = sim.spawnUnit('constructionWagon', 1, tileCenter(10), tileCenter(5));
    sim.issue(1, { type: 'deploy', units: [wagon.id] });
    run(sim, 2);
    expect(wagon.dead).toBe(true);
    expect(sim.buildings[0]?.def.id).toBe('constructionYard');
    expect(sim.buildings[0].tx).toBe(9);
  });

  it('Ingenieur übernimmt ein gegnerisches Gebäude', () => {
    const sim = makeSim(field());
    const eng = sim.spawnUnit('engineer', 1, tileCenter(2), tileCenter(5));
    const target = sim.addBuilding(bdef(sim, 2, 'barracks'), 2, 10, 4);
    sim.step();
    sim.issue(1, { type: 'enter', units: [eng.id], target: target.id });
    const ev = events(sim, 15 * 15);
    expect(target.owner).toBe(1);
    expect(eng.dead).toBe(true);
    expect(ev.some((e) => e.type === 'captured')).toBe(true);
  });

  it('wer alles verliert, scheidet aus – der Gegner gewinnt', () => {
    const sim = makeSim(field(), 0, 'standard');
    sim.addBuilding(bdef(sim, 1, 'constructionYard'), 1, 2, 2);
    const enemyYard = sim.addBuilding(bdef(sim, 2, 'constructionYard'), 2, 20, 2);
    run(sim, 20);
    expect(sim.gameOver).toBeNull();
    sim.damage(enemyYard, 100_000, 1);
    const ev = events(sim, 20);
    expect(sim.players[2].defeated).toBe(true);
    expect(sim.gameOver).toEqual({ winners: [1] });
    expect(ev.some((e) => e.type === 'gameOver')).toBe(true);
  });

  it('Aufgeben beendet das Spiel', () => {
    const sim = makeSim(field(), 0, 'standard');
    sim.addBuilding(bdef(sim, 1, 'constructionYard'), 1, 2, 2);
    sim.addBuilding(bdef(sim, 2, 'constructionYard'), 2, 20, 2);
    sim.issue(1, { type: 'surrender' });
    run(sim, 2);
    expect(sim.players[1].defeated).toBe(true);
    expect(sim.gameOver?.winners).toEqual([2]);
    expect(sim.buildings.every((b) => b.owner === 2)).toBe(true);
  });
});

describe('KI (Leicht)', () => {
  const skirmish = (aiBoth: boolean) =>
    createSkirmish({
      map: loadMap('kristalltal'),
      rules,
      startCredits: 3000,
      slots: [
        { id: 1, name: 'A', faction: 'aero', color: 0, team: 0, ai: aiBoth ? 'easy' : undefined },
        { id: 2, name: 'B', faction: 'granite', color: 1, team: 0, ai: 'easy' },
      ],
    });

  it('baut eine Basis mit Wirtschaft und Armee', () => {
    const sim = skirmish(false);
    run(sim, 15 * 60 * 6);
    const owned = new Set(sim.buildings.filter((b) => b.owner === 2).map((b) => b.def.id));
    for (const id of ['constructionYard', 'powerPlant', 'refinery', 'barracks', 'factory']) expect(owned, id).toContain(id);
    expect(sim.players[2].stats.harvested).toBeGreaterThan(500);
    expect(sim.units.filter((u) => u.owner === 2 && u.def.weapon).length).toBeGreaterThanOrEqual(4);
    expect(sim.players[2].lowPower).toBe(false);
  }, 60_000);

  it('besiegt einen untätigen Gegner (komplette Partie bis zum Ende)', () => {
    const sim = skirmish(false);
    for (let i = 0; i < 15 * 60 * 25 && !sim.gameOver; i++) sim.step();
    expect(sim.gameOver?.winners).toEqual([2]);
  }, 120_000);

  it('KI gegen KI ist deterministisch', () => {
    const hashes = () => {
      const sim = skirmish(true);
      const out: number[] = [];
      for (let i = 1; i <= 15 * 60 * 4; i++) {
        sim.step();
        if (i % 600 === 0) out.push(sim.stateHash());
      }
      return out;
    };
    expect(hashes()).toEqual(hashes());
  }, 60_000);
});
