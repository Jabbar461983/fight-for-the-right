import { describe, expect, it } from 'vitest';
import { FACTIONS, type Faction } from '../src/data/rules';
import { GameMap } from '../src/map/gameMap';
import { TILE, tileCenter } from '../src/math/fixed';
import { placeBuilding } from '../src/sim/production';
import { createSkirmish } from '../src/sim/setup';
import { Simulation } from '../src/sim/simulation';
import { loadMap, rules, run } from './helpers';

/** Freies Feld, Spieler 1 und 2 mit frei wählbaren Teams. */
function field(f1: Faction, f2: Faction) {
  const map = GameMap.fromAscii(Array.from({ length: 30 }, () => '.'.repeat(40)));
  return new Simulation({
    map,
    rules,
    victory: 'none',
    startCredits: 20000,
    players: [
      { id: 1, faction: f1, team: 0, color: 0, name: 'A' },
      { id: 2, faction: f2, team: 0, color: 1, name: 'B' },
    ],
  });
}

describe('Neue Teams und Einheiten', () => {
  it('Tarnung: stehende Dschungel-Einheit ist nur aus nächster Nähe zu sehen', () => {
    const sim = field('jungle', 'aero');
    const scout = sim.spawnUnit('camoScout', 1, tileCenter(10), tileCenter(10));
    scout.stance = 'passive'; // schiesst nicht (Schiessen verrät die Tarnung)
    const watcher = sim.spawnUnit('rifleman', 2, tileCenter(16), tileCenter(10));
    watcher.stance = 'hold';
    run(sim, 6);
    expect(scout.burrowed).toBe(true);
    expect(sim.canSee(2, scout)).toBe(false);
    // Gegner kommt ganz nah → entdeckt
    watcher.x = tileCenter(12);
    run(sim, 1);
    expect(sim.canSee(2, scout)).toBe(true);
    // 3 Kacheln entfernt (in Sichtweite, aber zu weit zum Entdecken): steht → unsichtbar, fährt → sichtbar
    watcher.x = tileCenter(13);
    run(sim, 4);
    expect(sim.canSee(2, scout)).toBe(false);
    sim.issue(1, { type: 'move', units: [scout.id], x: tileCenter(10), y: tileCenter(4) });
    run(sim, 4);
    expect(scout.burrowed).toBe(false);
    expect(sim.canSee(2, scout)).toBe(true);
  });

  it('Tarnung: getarnte Einheiten werden nicht beschossen, solange niemand nah ist', () => {
    const sim = field('jungle', 'granite');
    const tank = sim.spawnUnit('lianaTank', 1, tileCenter(10), tileCenter(10));
    sim.spawnUnit('lightTank', 2, tileCenter(14), tileCenter(10)); // 4 Kacheln: in Reichweite, aber zu weit zum Entdecken
    sim.units[1].stance = 'hold';
    tank.stance = 'passive';
    run(sim, 15 * 5);
    expect(tank.hp).toBe(tank.def.hp);
  });

  it('eine gemischte Gruppe fährt zusammen (Tempo der langsamsten Bodeneinheit)', () => {
    const sim = field('aero', 'granite');
    const bike = sim.spawnUnit('skyBike', 1, tileCenter(3), tileCenter(10));
    const rifle = sim.spawnUnit('rifleman', 1, tileCenter(3), tileCenter(12));
    sim.issue(1, { type: 'move', units: [bike.id, rifle.id], x: tileCenter(35), y: tileCenter(11) });
    run(sim, 15 * 5);
    // Das schnelle Motorrad ist der Gruppe nicht davongefahren
    expect(Math.abs(bike.x - rifle.x)).toBeLessThan(3 * TILE);
    // Allein fährt es dagegen mit vollem Tempo
    sim.issue(1, { type: 'move', units: [bike.id], x: tileCenter(3), y: tileCenter(10) });
    const x0 = bike.x;
    run(sim, 15 * 2);
    expect(x0 - bike.x).toBeGreaterThan(Math.abs(rifle.def.speedUnits) * 15 * 2);
  });

  it('Fallschirm-Flieger bringt 4 Fallschirmjäger mit und setzt sie über Land ab', () => {
    const sim = field('aero', 'granite');
    const d = (id: string) => rules.building('aero', id)!;
    placeBuilding(sim, 1, d('constructionYard'), 2, 2);
    placeBuilding(sim, 1, d('powerPlant'), 6, 2);
    placeBuilding(sim, 1, d('powerPlant'), 9, 2);
    placeBuilding(sim, 1, d('refinery'), 12, 2);
    placeBuilding(sim, 1, d('radar'), 2, 6);
    placeBuilding(sim, 1, d('airfield'), 6, 6);
    sim.issue(1, { type: 'queue', category: 'air', item: 'paraPlane', action: 'add' });
    run(sim, 15 * 40);
    const plane = sim.units.find((u) => u.def.id === 'paraPlane');
    expect(plane).toBeDefined();
    expect(plane!.passengers.length).toBe(4);
    sim.issue(1, { type: 'unload', units: [plane!.id], x: 25 * TILE, y: 20 * TILE });
    run(sim, 15 * 15);
    expect(sim.units.filter((u) => u.def.id === 'paratrooper').length).toBe(4);
  });

  it('jedes Team kann ein Gefecht beginnen, und die KI (Mittel) baut eigene Spezialeinheiten', () => {
    for (const f of FACTIONS) {
      const sim = createSkirmish({
        map: loadMap('kristalltal'),
        rules,
        startCredits: 5000,
        slots: [
          { id: 1, name: 'K', faction: f, color: 0, team: 0, ai: 'medium' },
          { id: 2, name: 'X', faction: f === 'aero' ? 'granite' : 'aero', color: 1, team: 0 },
        ],
      });
      let special = false;
      for (let i = 0; i < 15 * 60 * 14 && !special && !sim.gameOver; i++) {
        sim.step();
        if (i % 150 === 0) special = sim.units.some((u) => u.owner === 1 && u.def.faction === f);
      }
      expect(special, f).toBe(true);
    }
  }, 300_000);
});
