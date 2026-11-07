import { TILE, isqrt, tileOf } from '../math/fixed';
import type { GameMap } from '../map/gameMap';
import type { MoveClass } from '../map/terrain';

/**
 * Prüft, ob die Strecke von A nach B (Welteinheiten) nur über passierbare
 * Kacheln führt. Alle Kacheln, die die Strecke berührt, werden geprüft
 * («Supercover»). Läuft die Strecke exakt durch eine Kachelecke, müssen beide
 * angrenzenden Kacheln frei sein. Die Startkachel selbst wird nicht geprüft.
 *
 * Reine Ganzzahl-Rechnung, daher deterministisch.
 */
export function lineOfSight(
  map: GameMap,
  cls: MoveClass,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  let tx = tileOf(ax);
  let ty = tileOf(ay);
  const ex = tileOf(bx);
  const ey = tileOf(by);
  const dx = bx - ax;
  const dy = by - ay;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  let guard = Math.abs(ex - tx) + Math.abs(ey - ty) + 2;
  while ((tx !== ex || ty !== ey) && guard-- > 0) {
    // Abstand bis zur nächsten senkrechten/waagrechten Kachelgrenze, über Kreuz
    // multipliziert, damit wir ohne Division vergleichen können.
    const bxLine = sx > 0 ? (tx + 1) * TILE : tx * TILE;
    const byLine = sy > 0 ? (ty + 1) * TILE : ty * TILE;
    const numX = sx === 0 ? Infinity : Math.abs(bxLine - ax) * ady;
    const numY = sy === 0 ? Infinity : Math.abs(byLine - ay) * adx;
    if (numX < numY) {
      tx += sx;
    } else if (numY < numX) {
      ty += sy;
    } else {
      // Genau durch die Ecke: beide Nachbarn müssen frei sein.
      if (!map.passable(tx + sx, ty, cls) || !map.passable(tx, ty + sy, cls)) return false;
      tx += sx;
      ty += sy;
    }
    if (!map.passable(tx, ty, cls)) return false;
  }
  return true;
}

/**
 * Wie lineOfSight, prüft aber einen «Korridor» der Breite 2×radius:
 * die Mittellinie und zwei parallele Linien links und rechts davon.
 * So bleiben grössere Einheiten nicht an Ecken hängen.
 */
export function lineOfSightWide(
  map: GameMap,
  cls: MoveClass,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): boolean {
  if (!lineOfSight(map, cls, ax, ay, bx, by)) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const len = isqrt(dx * dx + dy * dy);
  if (len === 0 || radius <= 0) return true;
  // Senkrechter Versatz mit Länge radius
  const ox = Math.trunc((-dy * radius) / len);
  const oy = Math.trunc((dx * radius) / len);
  return (
    lineOfSight(map, cls, ax + ox, ay + oy, bx + ox, by + oy) &&
    lineOfSight(map, cls, ax - ox, ay - oy, bx - ox, by - oy)
  );
}
