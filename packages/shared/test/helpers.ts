import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRules, type Rules } from '../src/data/rules';
import { parseTiledMap } from '../src/map/tiledLoader';
import type { GameMap } from '../src/map/gameMap';
import { Simulation } from '../src/sim/simulation';

/** Lädt eine Datei aus dem data-Ordner. */
export function loadData(path: string): unknown {
  const url = new URL(`../../../data/${path}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

export function rulesFiles() {
  return {
    weapons: loadData('rules/weapons.json'),
    buildings: loadData('rules/buildings.json'),
    factions: loadData('rules/factions.json'),
    ai: loadData('rules/ai.json'),
    units: [loadData('units/common.json')],
  };
}

export const rules: Rules = loadRules(rulesFiles());

export function loadMap(name: string): GameMap {
  return parseTiledMap(loadData(`maps/${name}.json`));
}

/** Simulation mit zwei Spielern (1 = Aero-Liga, 2 = Granit-Union). */
export function makeSim(map: GameMap, startCredits = 0, victory: 'standard' | 'none' = 'none'): Simulation {
  return new Simulation({
    map,
    rules,
    startCredits,
    victory,
    players: [
      { id: 1, faction: 'aero', team: 0, color: 0, name: 'Eins' },
      { id: 2, faction: 'granite', team: 0, color: 1, name: 'Zwei' },
    ],
  });
}

/** Lässt die Simulation laufen, bis alle Einheiten stehen (oder maxTicks erreicht ist). */
export function runUntilIdle(sim: Simulation, maxTicks: number): number {
  for (let i = 0; i < maxTicks; i++) {
    sim.step();
    if (sim.units.every((u) => u.order === null)) return i + 1;
  }
  return maxTicks;
}

/** Lässt n Ticks laufen. */
export function run(sim: Simulation, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}

/** Gebäude-Definition der Fraktion des Spielers. */
export function bdef(sim: Simulation, player: number, id: string) {
  const d = sim.rules.building(sim.players[player].faction, id);
  if (!d) throw new Error(`unbekannt: ${id}`);
  return d;
}
