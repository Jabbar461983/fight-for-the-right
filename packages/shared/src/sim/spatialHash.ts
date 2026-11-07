/**
 * Räumliches Raster zum schnellen Finden naher Einheiten.
 * Jede Zelle enthält eine verkettete Liste von Einträgen (Indizes ins Einheiten-Array).
 */
export class SpatialHash {
  private head: Int32Array;
  private next: Int32Array = new Int32Array(0);
  readonly cols: number;
  readonly rows: number;

  constructor(
    worldWidth: number,
    worldHeight: number,
    readonly cellSize: number,
  ) {
    this.cols = Math.max(1, Math.ceil(worldWidth / cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / cellSize));
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
  }

  /** Baut das Raster neu auf. xs/ys: Positionen aller Einträge. */
  rebuild(count: number, xs: (i: number) => number, ys: (i: number) => number): void {
    this.head.fill(-1);
    if (this.next.length < count) this.next = new Int32Array(Math.max(count, this.next.length * 2));
    // Rückwärts einfügen, damit Listen aufsteigend nach Index sortiert sind (deterministisch).
    for (let i = count - 1; i >= 0; i--) {
      const c = this.cellOf(xs(i), ys(i));
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }

  cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return cy * this.cols + cx;
  }

  /** Ruft fn für alle Einträge in den 3×3 Zellen um (x,y) auf. */
  forNeighbors(x: number, y: number, fn: (i: number) => void): void {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(this.rows - 1, cy + 1); yy++) {
      for (let xx = Math.max(0, cx - 1); xx <= Math.min(this.cols - 1, cx + 1); xx++) {
        for (let i = this.head[yy * this.cols + xx]; i !== -1; i = this.next[i]) fn(i);
      }
    }
  }
}
