import { loadMission, loadRules, parseTiledMap, type GameMap, type MissionDef, type Rules } from '@fftr/shared';
import nebelwald from '@data/maps/nebelwald.json';
import missionA1 from '@data/missions/a1.json';
import missionA2 from '@data/missions/a2.json';
import missionG1 from '@data/missions/g1.json';
import missionG2 from '@data/missions/g2.json';
import weapons from '@data/rules/weapons.json';
import buildings from '@data/rules/buildings.json';
import factions from '@data/rules/factions.json';
import ai from '@data/rules/ai.json';
import commonUnits from '@data/units/common.json';
import aeroUnits from '@data/units/aero.json';
import graniteUnits from '@data/units/granite.json';
import voltUnits from '@data/units/volt.json';
import corsairUnits from '@data/units/corsair.json';
import frostUnits from '@data/units/frost.json';
import jungleUnits from '@data/units/jungle.json';
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
  rulesCache ??= loadRules({ weapons, buildings, factions, ai, units: [commonUnits, aeroUnits, graniteUnits, voltUnits, corsairUnits, frostUnits, jungleUnits],
  });
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

/** Karten nur für Missionen (nicht im Gefecht wählbar). */
const MISSION_MAPS: MapInfo[] = [{ id: 'nebelwald', nameKey: 'map.nebelwald.name', maxPlayers: 2, json: nebelwald }];

export function mapInfo(id: string): MapInfo {
  return MAPS.find((m) => m.id === id) ?? MISSION_MAPS.find((m) => m.id === id) ?? MAPS[0];
}

export function loadMap(id: string): GameMap {
  return parseTiledMap(mapInfo(id).json);
}

let missionsCache: MissionDef[] | null = null;

/** Alle Kampagnen-Missionen (geprüft), sortiert nach Fraktion und Reihenfolge. Neue Mission: JSON in data/missions + hier eintragen. */
export function getMissions(): MissionDef[] {
  missionsCache ??= [missionA1, missionA2, missionG1, missionG2]
    .map((json) => loadMission(json, getRules()))
    .sort((a, b) => a.faction.localeCompare(b.faction) || a.order - b.order);
  return missionsCache;
}

export function getMission(id: string): MissionDef | undefined {
  return getMissions().find((m) => m.id === id);
}
