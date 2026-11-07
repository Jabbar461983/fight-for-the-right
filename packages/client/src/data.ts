import { loadRules, parseTiledMap, type GameMap, type Rules } from '@fftr/shared';
import weapons from '@data/rules/weapons.json';
import buildings from '@data/rules/buildings.json';
import factions from '@data/rules/factions.json';
import ai from '@data/rules/ai.json';
import commonUnits from '@data/units/common.json';
import aeroUnits from '@data/units/aero.json';
import graniteUnits from '@data/units/granite.json';
import kristalltal from '@data/maps/kristalltal.json';
import vierWinde from '@data/maps/vier-winde.json';
import zweiUfer from '@data/maps/zwei-ufer.json';
import archipel from '@data/maps/archipel.json';

/**
 * Lädt die Spieldaten aus dem data-Ordner. Neue Karten: JSON-Datei in
 * data/maps ablegen und hier (und im Server unter src/data.ts) in MAPS eintragen.
 */

let rulesCache: Rules | null = null;

export function getRules(): Rules {
  rulesCache ??= loadRules({ weapons, buildings, factions, ai, units: [commonUnits, aeroUnits, graniteUnits] });
  return rulesCache;
}

export interface MapInfo {
  id: string;
  nameKey: string;
  maxPlayers: number;
  json: unknown;
}

export const MAPS: MapInfo[] = [
  { id: 'kristalltal', nameKey: 'map.kristalltal.name', maxPlayers: 2, json: kristalltal },
  { id: 'zwei-ufer', nameKey: 'map.zweiUfer.name', maxPlayers: 2, json: zweiUfer },
  { id: 'vier-winde', nameKey: 'map.vierWinde.name', maxPlayers: 4, json: vierWinde },
  { id: 'archipel', nameKey: 'map.archipel.name', maxPlayers: 4, json: archipel },
];

export function mapInfo(id: string): MapInfo {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

export function loadMap(id: string): GameMap {
  return parseTiledMap(mapInfo(id).json);
}
