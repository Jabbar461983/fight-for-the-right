import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/map/gameMap';
import { MoveClass } from '../src/map/terrain';
import { TILE, tileCenter, tileOf } from '../src/math/fixed';
import { findPath, findWorldPath } from '../src/path/astar';
import { FlowField, UNREACHABLE } from '../src/path/flowField';
import { lineOfSight } from '../src/path/lineOfSight';
import { loadMap } from './helpers';

const V = MoveClass.Vehicle;
const I = MoveClass.Infantry;

/** Prüft, dass jeder Schritt eines Pfads erlaubt ist. */
function assertValidPath(m: GameMap, cls: MoveClass, start: { tx: number; ty: number }, path: { tx: number; ty: number }[]) {
  let cur = start;
  for (const p of path) {
    const dx = p.tx - cur.tx;
    const dy = p.ty - cur.ty;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBe(1);
    expect(m.canStep(cur.tx, cur.ty, dx, dy, cls)).toBe(true);
    cur = p;
  }
}

describe('A*-Wegfindung', () => {
  it('geht gerade, wenn frei', () => {
    const m = GameMap.fromAscii(['.....']);
    expect(findPath(m, V, { tx: 0, ty: 0 }, { tx: 4, ty: 0 })).toHaveLength(4);
    expect(findPath(m, V, { tx: 2, ty: 0 }, { tx: 2, ty: 0 })).toEqual([]);
  });

  it('umgeht eine Mauer', () => {
    const m = GameMap.fromAscii([
      '.......', //
      '...#...',
      '...#...',
      '...#...',
      '.......',
    ]);
    const start = { tx: 1, ty: 2 };
    const path = findPath(m, V, start, { tx: 5, ty: 2 })!;
    expect(path.at(-1)).toEqual({ tx: 5, ty: 2 });
    assertValidPath(m, V, start, path);
    expect(path.some((p) => p.ty === 0 || p.ty === 4)).toBe(true);
  });

  it('schneidet keine Ecken', () => {
    const m = GameMap.fromAscii([
      '.#', //
      '#.',
    ]);
    // Diagonal zwischen zwei Klippen hindurch ist verboten → kein Weg, nächstes Ziel = Start
    expect(findPath(m, V, { tx: 0, ty: 0 }, { tx: 1, ty: 1 })).toEqual([]);
  });

  it('Fahrzeuge umfahren Wald, Infanterie geht durch', () => {
    const m = GameMap.fromAscii([
      '.......', //
      '.TTTTT.',
      '.TTTTT.',
      '.TTTTT.',
      '.......',
    ]);
    const tank = findPath(m, V, { tx: 3, ty: 0 }, { tx: 3, ty: 4 })!;
    expect(tank.every((p) => m.passable(p.tx, p.ty, V))).toBe(true);
    const inf = findPath(m, I, { tx: 3, ty: 0 }, { tx: 3, ty: 4 })!;
    expect(inf.length).toBeLessThan(tank.length);
  });

  it('bevorzugt Strassen', () => {
    const m = GameMap.fromAscii([
      '====================', //
      '....................',
    ]);
    const path = findPath(m, V, { tx: 0, ty: 1 }, { tx: 19, ty: 1 })!;
    // Kurz auf die Strasse wechseln ist schneller als nur über Gras
    expect(path.filter((p) => m.terrainAt(p.tx, p.ty) === 2).length).toBeGreaterThan(path.length / 2);
  });

  it('unerreichbares Ziel → nächster erreichbarer Punkt', () => {
    const m = GameMap.fromAscii([
      '...~~~...', //
      '...~~~...',
    ]);
    const path = findPath(m, V, { tx: 0, ty: 0 }, { tx: 7, ty: 0 })!;
    expect(path.at(-1)!.tx).toBe(2);
  });

  it('Weltpfad wird geglättet und endet am exakten Zielpunkt', () => {
    const m = GameMap.fromAscii(['..........', '..........', '..........']);
    const to = { x: tileCenter(9) + 100, y: tileCenter(2) - 50 };
    const path = findWorldPath(m, V, { x: tileCenter(0), y: tileCenter(0) }, to, 300)!;
    expect(path).toEqual([to]);
  });

  it('findet auf Kristalltal den Weg von Basis zu Basis', () => {
    const m = loadMap('kristalltal');
    const [a, b] = m.objectsOfKind('spawn');
    const start = { tx: tileOf(a.x), ty: tileOf(a.y) };
    const path = findPath(m, V, start, { tx: tileOf(b.x), ty: tileOf(b.y) })!;
    expect(path.at(-1)).toEqual({ tx: tileOf(b.x), ty: tileOf(b.y) });
    assertValidPath(m, V, start, path);
  });
});

describe('Sichtlinie', () => {
  const m = GameMap.fromAscii([
    '.....', //
    '..#..',
    '.....',
  ]);
  it('frei und blockiert', () => {
    expect(lineOfSight(m, V, tileCenter(0), tileCenter(0), tileCenter(4), tileCenter(0))).toBe(true);
    expect(lineOfSight(m, V, tileCenter(0), tileCenter(1), tileCenter(4), tileCenter(1))).toBe(false);
  });
  it('durch eine Ecke nur, wenn beide Nachbarn frei sind', () => {
    // Von (1,0) nach (3,2) diagonal läuft genau durch die Ecken an der Klippe (2,1)
    expect(lineOfSight(m, V, TILE, TILE, 3 * TILE, 3 * TILE)).toBe(false);
  });
});

describe('Flussfeld', () => {
  it('jede erreichbare Kachel führt zum Ziel', () => {
    const m = loadMap('kristalltal');
    const f = new FlowField(m, V, 50, 12);
    let reachable = 0;
    for (let i = 0; i < f.cost.length; i++) {
      if (f.cost[i] === UNREACHABLE) {
        expect(f.next[i]).toBe(-1);
        continue;
      }
      reachable++;
      // Dem Feld folgen: die Kosten sinken streng, bis das Ziel erreicht ist
      let cur = i;
      let steps = 0;
      while (cur !== f.goalIdx) {
        const nx = f.next[cur];
        expect(f.cost[nx]).toBeLessThan(f.cost[cur]);
        cur = nx;
        if (++steps > 10_000) throw new Error('Endlosschleife');
      }
    }
    expect(reachable).toBeGreaterThan(1000);
  });

  it('unpassierbares Ziel liefert leeres Feld', () => {
    const m = GameMap.fromAscii(['.#.']);
    const f = new FlowField(m, V, 1, 0);
    expect([...f.cost].every((c) => c === UNREACHABLE)).toBe(true);
  });
});
