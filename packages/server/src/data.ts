import { loadRules, parseTiledMap, type GameMap, type Rules } from '@fftr/shared';
import weapons from '../../../data/rules/weapons.json';
import buildings from '../../../data/rules/buildings.json';
import factions from '../../../data/rules/factions.json';
import ai from '../../../data/rules/ai.json';
import commonUnits from '../../../data/units/common.json';
import aeroUnits from '../../../data/units/aero.json';
import graniteUnits from '../../../data/units/granite.json';
import voltUnits from '../../../data/units/volt.json';
import corsairUnits from '../../../data/units/corsair.json';
import frostUnits from '../../../data/units/frost.json';
import jungleUnits from '../../../data/units/jungle.json';
import kristalltal from '../../../data/maps/kristalltal.json';
import vierWinde from '../../../data/maps/vier-winde.json';
import zweiUfer from '../../../data/maps/zwei-ufer.json';
import archipel from '../../../data/maps/archipel.json';

/**
 * Spieldaten für den Server – dieselben Dateien wie im Client.
 * Beim Bauen (esbuild) werden sie in die Server-Datei eingebettet.
 */

export const rules: Rules = loadRules({ weapons, buildings, factions, ai, units: [commonUnits, aeroUnits, graniteUnits, voltUnits, corsairUnits, frostUnits, jungleUnits],
});

const MAPS: Record<string, unknown> = { kristalltal, 'vier-winde': vierWinde, 'zwei-ufer': zweiUfer, archipel };

export function hasMap(id: string): boolean {
  return id in MAPS;
}

/** Lädt eine Karte frisch (jede Partie braucht ihre eigene, weil Gebäude die Karte verändern). */
export function loadMap(id: string): GameMap {
  return parseTiledMap(MAPS[id] ?? MAPS.kristalltal);
}

export function maxPlayersOf(id: string): number {
  return Number(loadMap(id).props.maxPlayers ?? 2);
}
