/**
 * Ganzzahl-Arithmetik für die Simulation.
 *
 * Die Simulation rechnet ausschliesslich mit ganzen Zahlen, damit sie auf jedem
 * Gerät (PC, Tablet, Server) exakt dieselben Ergebnisse liefert. Positionen sind
 * in «Welteinheiten» angegeben: Eine Kachel ist TILE Einheiten breit.
 */

/** Welteinheiten pro Kachel. */
export const TILE = 1024;

/** Pixel pro Kachel in der Darstellung. */
export const TILE_PX = 32;

/** Simulationstakt: Ticks pro Sekunde. */
export const TICK_RATE = 15;

/** Dauer eines Ticks in Millisekunden. */
export const TICK_MS = 1000 / TICK_RATE;

/**
 * Ganzzahlige Quadratwurzel (abgerundet).
 * Math.sqrt ist laut IEEE 754 exakt gerundet, die Korrekturschleifen
 * garantieren zusätzlich ein exaktes ganzzahliges Ergebnis.
 */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Kachel-Koordinate einer Weltkoordinate. */
export function tileOf(v: number): number {
  return Math.floor(v / TILE);
}

/** Weltkoordinate der Mitte einer Kachel. */
export function tileCenter(t: number): number {
  return t * TILE + TILE / 2;
}

/** Wandelt «Kacheln pro Sekunde» (Datendateien) in «Einheiten pro Tick» um. */
export function tilesPerSecToUnitsPerTick(tilesPerSec: number): number {
  return Math.max(1, Math.round((tilesPerSec * TILE) / TICK_RATE));
}

/** Wandelt eine Länge in Kacheln (Datendateien) in Welteinheiten um. */
export function tilesToUnits(tiles: number): number {
  return Math.round(tiles * TILE);
}

/** Welteinheiten → Pixel (nur für die Darstellung, darf Kommazahlen liefern). */
export function unitsToPx(v: number): number {
  return (v * TILE_PX) / TILE;
}

/** Pixel → Welteinheiten (für Eingaben, wird gerundet). */
export function pxToUnits(px: number): number {
  return Math.round((px * TILE) / TILE_PX);
}

/** Begrenzt v auf den Bereich [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Ganzzahlige Division mit Abschneiden Richtung 0. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}
