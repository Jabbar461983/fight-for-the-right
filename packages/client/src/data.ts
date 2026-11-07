import { loadRules, parseTiledMap, type GameMap, type Rules } from '@fftr/shared';
import weapons from '@data/rules/weapons.json';
import buildings from '@data/rules/buildings.json';
import factions from '@data/rules/factions.json';
import ai from '@data/rules/ai.json';
import commonUnits from '@data/units/common.json';
import kristalltal from '@data/maps/kristalltal.json';

/**
 * Lädt die Spieldaten aus dem data-Ordner. Neue Karten: JSON-Datei in
 * data/maps ablegen und hier in MAPS eintragen.
 */

let rulesCache: Rules | null = null;

export function getRules(): Rules {
  rulesCache ??= loadRules({ weapons, buildings, factions, ai, units: [commonUnits] });
  return rulesCache;
}

export interface MapInfo {
  id: string;
  nameKey: string;
  maxPlayers: number;
  json: unknown;
}

export const MAPS: MapInfo[] = [{ id: 'kristalltal', nameKey: 'map.kristalltal.name', maxPlayers: 2, json: kristalltal }];

export function loadMap(id: string): GameMap {
  const info = MAPS.find((m) => m.id === id) ?? MAPS[0];
  return parseTiledMap(info.json);
}
