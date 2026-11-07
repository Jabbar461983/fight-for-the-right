import { describe, expect, it } from 'vitest';
import { TILE, isqrt, tileCenter, tileOf, tilesPerSecToUnitsPerTick } from '../src/math/fixed';
import { Rng } from '../src/math/rng';
import { IndexHeap } from '../src/path/binaryHeap';

describe('Ganzzahl-Mathematik', () => {
  it('isqrt rundet exakt ab', () => {
    for (let n = 0; n < 5000; n++) {
      const r = isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
    expect(isqrt(2 ** 40)).toBe(2 ** 20);
    expect(isqrt(-5)).toBe(0);
  });

  it('rechnet Kacheln und Welteinheiten um', () => {
    expect(tileOf(0)).toBe(0);
    expect(tileOf(TILE - 1)).toBe(0);
    expect(tileOf(TILE)).toBe(1);
    expect(tileCenter(2)).toBe(2 * TILE + TILE / 2);
    expect(tilesPerSecToUnitsPerTick(1.5)).toBe(Math.round((1.5 * TILE) / 15));
  });

  it('Zufallsgenerator ist reproduzierbar', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextUint()).toBe(b.nextUint());
    expect(new Rng(1).nextUint()).not.toBe(new Rng(2).nextUint());
  });

  it('Heap liefert aufsteigend, bei Gleichstand kleinster Index zuerst', () => {
    const h = new IndexHeap();
    const items = [5, 3, 9, 1, 7, 2, 8];
    for (const i of items) h.push(i, i % 3);
    const out: number[] = [];
    while (h.size > 0) out.push(h.pop());
    expect(out).toEqual([3, 9, 1, 7, 2, 5, 8]);
  });
});
