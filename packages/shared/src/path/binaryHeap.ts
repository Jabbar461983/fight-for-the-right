/**
 * Minimaler binärer Heap für Knoten-Indizes mit ganzzahligem Schlüssel.
 * Bei gleichem Schlüssel entscheidet der kleinere Index – so bleibt die
 * Wegfindung deterministisch.
 */
export class IndexHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
    this.keys.length = 0;
  }

  push(item: number, key: number): void {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(key, item, keys[p], items[p])) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }

  /** Entfernt das kleinste Element und gibt es zurück (vorher size prüfen). */
  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastKey = keys.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && this.less(keys[r], items[r], keys[l], items[l]) ? r : l;
        if (!this.less(keys[c], items[c], lastKey, lastItem)) break;
        items[i] = items[c];
        keys[i] = keys[c];
        i = c;
      }
      items[i] = lastItem;
      keys[i] = lastKey;
    }
    return top;
  }

  private less(ka: number, ia: number, kb: number, ib: number): boolean {
    return ka < kb || (ka === kb && ia < ib);
  }
}
