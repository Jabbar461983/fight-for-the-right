import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseUnitDefs } from '../src/data/unitDefs';
import { parseTiledMap } from '../src/map/tiledLoader';
import type { GameMap } from '../src/map/gameMap';
import { Simulation } from '../src/sim/simulation';

/** Lädt eine Datei aus dem data-Ordner. */
export function loadData(path: string): unknown {
  const url = new URL(`../../../data/${path}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

export const unitDefs = parseUnitDefs(loadData('units/common.json'));

export function loadMap(name: string): GameMap {
  return parseTiledMap(loadData(`maps/${name}.json`));
}

export function makeSim(map: GameMap): Simulation {
  return new Simulation({ map, unitDefs });
}

/** Lässt die Simulation laufen, bis alle Einheiten stehen (oder maxTicks erreicht ist). */
export function runUntilIdle(sim: Simulation, maxTicks: number): number {
  for (let i = 0; i < maxTicks; i++) {
    sim.step();
    if (sim.units.every((u) => u.order === null)) return i + 1;
  }
  return maxTicks;
}
