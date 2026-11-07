/**
 * Geländearten und Bewegungsklassen.
 * Die Tabelle SPEED legt fest, wer wo fahren darf und wie schnell.
 */

/** Geländeart einer Kachel (Wert im Karten-Array). */
export const Terrain = {
  Grass: 0,
  Sand: 1,
  Road: 2,
  Forest: 3,
  Cliff: 4,
  Water: 5,
  Bridge: 6,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

/** Namen der Geländearten, wie sie in Kartendateien stehen (Index = Terrain-Wert). */
export const TERRAIN_NAMES = ['grass', 'sand', 'road', 'forest', 'cliff', 'water', 'bridge'] as const;
export type TerrainName = (typeof TERRAIN_NAMES)[number];

/** Bewegungsklasse einer Einheit. */
export const MoveClass = {
  Infantry: 0,
  Vehicle: 1,
  Hover: 2,
  Air: 3,
  Naval: 4,
} as const;
export type MoveClass = (typeof MoveClass)[keyof typeof MoveClass];

/** Namen der Bewegungsklassen, wie sie in Datendateien stehen (Index = MoveClass-Wert). */
export const MOVE_CLASS_NAMES = ['infantry', 'vehicle', 'hover', 'air', 'naval'] as const;
export type MoveClassName = (typeof MOVE_CLASS_NAMES)[number];

/**
 * Tempo in Prozent je Bewegungsklasse (Zeile) und Geländeart (Spalte).
 * 0 bedeutet: unpassierbar.
 */
const SPEED: readonly (readonly number[])[] = [
  //  Gras Sand Strasse Wald Klippe Wasser Brücke
  [100, 90, 115, 70, 0, 0, 100], // Infanterie
  [100, 85, 130, 0, 0, 0, 115], // Fahrzeug
  [100, 95, 120, 0, 0, 100, 115], // Schweber (z.B. Gleiterpanzer)
  [100, 100, 100, 100, 100, 100, 100], // Luft
  [0, 0, 0, 0, 0, 100, 100], // See (fährt unter Brücken durch)
];

/** Tempo in Prozent auf diesem Gelände, 0 = unpassierbar. */
export function speedPercent(cls: MoveClass, terrain: number): number {
  return SPEED[cls]?.[terrain] ?? 0;
}

/** Wandelt einen Geländenamen in den Terrain-Wert um. */
export function terrainFromName(name: string): Terrain | undefined {
  const i = (TERRAIN_NAMES as readonly string[]).indexOf(name);
  return i >= 0 ? (i as Terrain) : undefined;
}

/** Wandelt einen Bewegungsklassen-Namen in den MoveClass-Wert um. */
export function moveClassFromName(name: MoveClassName): MoveClass {
  return MOVE_CLASS_NAMES.indexOf(name) as MoveClass;
}
