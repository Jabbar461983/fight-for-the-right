import { TILE, tileCenter, tileOf } from '../math/fixed';
import { DIRS, type GameMap } from '../map/gameMap';
import type { MoveClass } from '../map/terrain';
import { IndexHeap } from './binaryHeap';
import { lineOfSightWide } from './lineOfSight';

export interface TilePoint {
  tx: number;
  ty: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/** Kleinste mögliche Kosten pro gerader Kachel (Strasse) – für eine zulässige Heuristik. */
const MIN_STRAIGHT = 7;
const MIN_DIAG = 9;

/** Wiederverwendbare Arbeitsspeicher pro Karte, damit nicht jede Suche neu alloziert. */
interface Scratch {
  g: Int32Array;
  parent: Int32Array;
  stamp: Uint32Array;
  closed: Uint32Array;
  gen: number;
  heap: IndexHeap;
}
const scratchByMap = new WeakMap<GameMap, Scratch>();

function getScratch(map: GameMap): Scratch {
  let s = scratchByMap.get(map);
  const n = map.width * map.height;
  if (!s || s.g.length !== n) {
    s = {
      g: new Int32Array(n),
      parent: new Int32Array(n),
      stamp: new Uint32Array(n),
      closed: new Uint32Array(n),
      gen: 0,
      heap: new IndexHeap(),
    };
    scratchByMap.set(map, s);
  }
  s.gen++;
  if (s.gen >= 0xffffffff) {
    s.stamp.fill(0);
    s.closed.fill(0);
    s.gen = 1;
  }
  s.heap.clear();
  return s;
}

/** Oktil-Heuristik (8 Richtungen), mit den kleinsten Kosten – unterschätzt nie. */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  const mn = Math.min(dx, dy);
  return MIN_STRAIGHT * (dx + dy) + (MIN_DIAG - 2 * MIN_STRAIGHT) * mn;
}

/**
 * Wählt ein erreichbares Ziel: Ist die Zielkachel unpassierbar oder vom Start
 * aus nicht erreichbar (z.B. Insel), wird die nächstgelegene erreichbare
 * Kachel genommen.
 */
export function resolveGoal(map: GameMap, cls: MoveClass, start: TilePoint, goal: TilePoint): TilePoint | null {
  let comp = map.componentOf(start.tx, start.ty, cls);
  if (comp < 0) {
    // Start steht (z.B. durch Wegschieben) auf unpassierbarem Gelände: nächste freie Kachel als Bezug.
    const near = map.nearestPassable(start.tx, start.ty, cls);
    if (!near) return null;
    comp = map.componentOf(near.tx, near.ty, cls);
  }
  if (map.componentOf(goal.tx, goal.ty, cls) === comp) return goal;
  return map.nearestPassable(goal.tx, goal.ty, cls, comp);
}

/**
 * A*-Wegsuche auf dem Kachelraster (8 Richtungen, keine Ecken schneiden).
 * Liefert die Kacheln vom ersten Schritt bis zum Ziel (ohne Start) oder null,
 * wenn kein Weg existiert. Ein leeres Array heisst: Start = Ziel.
 */
export function findPath(map: GameMap, cls: MoveClass, start: TilePoint, goalIn: TilePoint): TilePoint[] | null {
  const goal = resolveGoal(map, cls, start, goalIn);
  if (!goal) return null;
  const { width } = map;
  const startIdx = map.index(start.tx, start.ty);
  const goalIdx = map.index(goal.tx, goal.ty);
  if (startIdx === goalIdx) return [];

  const s = getScratch(map);
  const { g, parent, stamp, closed, heap } = s;
  const gen = s.gen;

  g[startIdx] = 0;
  parent[startIdx] = -1;
  stamp[startIdx] = gen;
  heap.push(startIdx, heuristic(start.tx, start.ty, goal.tx, goal.ty));

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === goalIdx) break;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    const gc = g[cur];
    for (let d = 0; d < 8; d++) {
      const [dx, dy] = DIRS[d];
      if (!map.canStep(cx, cy, dx, dy, cls)) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      const ni = ny * width + nx;
      if (closed[ni] === gen) continue;
      const ng = gc + map.stepCost(nx, ny, d >= 4, cls);
      if (stamp[ni] !== gen || ng < g[ni]) {
        stamp[ni] = gen;
        g[ni] = ng;
        parent[ni] = cur;
        heap.push(ni, ng + heuristic(nx, ny, goal.tx, goal.ty));
      }
    }
  }

  if (closed[goalIdx] !== gen) return null;
  const path: TilePoint[] = [];
  for (let i = goalIdx; i !== startIdx; i = parent[i]) {
    const x = i % width;
    path.push({ tx: x, ty: (i - x) / width });
  }
  path.reverse();
  return path;
}

/**
 * Glättet einen Kachelpfad («String Pulling»): Wegpunkte, die man auch direkt
 * erreichen kann, werden übersprungen. Ergebnis in Welteinheiten (Kachelmitten).
 */
export function smoothPath(
  map: GameMap,
  cls: MoveClass,
  from: WorldPoint,
  tiles: TilePoint[],
  radius: number,
): WorldPoint[] {
  const pts = tiles.map((t) => ({ x: tileCenter(t.tx), y: tileCenter(t.ty) }));
  if (pts.length <= 1) return pts;
  const out: WorldPoint[] = [];
  let cur = from;
  let i = 0;
  while (i < pts.length) {
    // So weit wie möglich nach vorne springen.
    let j = pts.length - 1;
    while (j > i && !lineOfSightWide(map, cls, cur.x, cur.y, pts[j].x, pts[j].y, radius)) j--;
    out.push(pts[j]);
    cur = pts[j];
    i = j + 1;
  }
  return out;
}

/** Bequeme Kombination: Pfad von einer Weltposition zu einer Weltposition, geglättet. */
export function findWorldPath(
  map: GameMap,
  cls: MoveClass,
  from: WorldPoint,
  to: WorldPoint,
  radius: number,
): WorldPoint[] | null {
  const start = { tx: tileOf(from.x), ty: tileOf(from.y) };
  const goal = { tx: tileOf(to.x), ty: tileOf(to.y) };
  const tiles = findPath(map, cls, start, goal);
  if (!tiles) return null;
  const pts = smoothPath(map, cls, from, tiles, radius);
  // Liegt das gewünschte Ziel in der Zielkachel, fahren wir den exakten Punkt an.
  const last = tiles.length > 0 ? tiles[tiles.length - 1] : start;
  if (last.tx === goal.tx && last.ty === goal.ty && map.passable(goal.tx, goal.ty, cls)) {
    if (pts.length === 0) return [{ x: to.x, y: to.y }];
    pts[pts.length - 1] = { x: to.x, y: to.y };
  } else if (pts.length === 0) {
    return [{ x: tileCenter(start.tx), y: tileCenter(start.ty) }];
  }
  return pts;
}

/** Hilfsfunktion: Welteinheiten-Länge eines Pfads (für Tests/Debug). */
export function pathLength(from: WorldPoint, pts: WorldPoint[]): number {
  let len = 0;
  let p = from;
  for (const q of pts) {
    len += Math.hypot(q.x - p.x, q.y - p.y);
    p = q;
  }
  return len / TILE;
}
