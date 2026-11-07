import { TILE } from '../math/fixed';
import { MoveClass, Terrain, speedPercent } from './terrain';

/** Ein Objekt aus der Kartendatei (Startpunkt, Glimmerit-Feld, …). Koordinaten in Welteinheiten. */
export interface MapObject {
  id: number;
  kind: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Record<string, string | number | boolean>;
}

/** Die acht Nachbarrichtungen (erst gerade, dann diagonal). */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Anzahl Bewegungsklassen (Grösse der Caches). */
const MOVE_CLASS_COUNT = 5;

/**
 * Die Spielkarte: ein Raster aus Geländekacheln plus Kartenobjekte.
 * Enthält Hilfsfunktionen für Passierbarkeit, Wegkosten und Zusammenhangskomponenten.
 */
export class GameMap {
  /** Zusammenhangskomponenten je Bewegungsklasse (lazy berechnet). */
  private components: (Int32Array | undefined)[] = new Array(MOVE_CLASS_COUNT);
  /** Von Gebäuden belegte Kacheln (für Bodeneinheiten unpassierbar). */
  readonly blocked: Uint8Array;
  /** Zählt Änderungen der Passierbarkeit (für Caches wie Flussfelder). */
  version = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly terrain: Uint8Array,
    readonly objects: MapObject[] = [],
    readonly props: Record<string, string | number | boolean> = {},
  ) {
    if (terrain.length !== width * height) {
      throw new Error(`Kartengrösse passt nicht: ${width}x${height} ≠ ${terrain.length}`);
    }
    this.blocked = new Uint8Array(width * height);
  }

  /** Belegt (value=1) oder räumt (value=0) ein Rechteck – z.B. für ein Gebäude. */
  setBlocked(tx: number, ty: number, w: number, h: number, value: 0 | 1): void {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        if (this.inBounds(x, y)) this.blocked[y * this.width + x] = value;
      }
    }
    this.invalidateCaches();
  }

  isBlocked(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.blocked[ty * this.width + tx] !== 0;
  }

  /** Breite in Welteinheiten. */
  get worldWidth(): number {
    return this.width * TILE;
  }

  /** Höhe in Welteinheiten. */
  get worldHeight(): number {
    return this.height * TILE;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  terrainAt(tx: number, ty: number): number {
    return this.inBounds(tx, ty) ? this.terrain[ty * this.width + tx] : Terrain.Cliff;
  }

  /** Tempo in Prozent auf dieser Kachel, 0 = unpassierbar oder ausserhalb. */
  speedAt(tx: number, ty: number, cls: MoveClass): number {
    if (!this.inBounds(tx, ty)) return 0;
    const i = ty * this.width + tx;
    if (this.blocked[i] !== 0 && cls !== MoveClass.Air) return 0;
    return speedPercent(cls, this.terrain[i]);
  }

  passable(tx: number, ty: number, cls: MoveClass): boolean {
    return this.speedAt(tx, ty, cls) > 0;
  }

  /**
   * Darf man diagonal von (tx,ty) nach (tx+dx,ty+dy)? Nur wenn beide angrenzenden
   * geraden Nachbarn frei sind («keine Ecken schneiden»).
   */
  canStep(tx: number, ty: number, dx: number, dy: number, cls: MoveClass): boolean {
    if (!this.passable(tx + dx, ty + dy, cls)) return false;
    if (dx !== 0 && dy !== 0) {
      return this.passable(tx + dx, ty, cls) && this.passable(tx, ty + dy, cls);
    }
    return true;
  }

  /**
   * Wegkosten, um eine Kachel zu betreten (gerade: Basis, diagonal: ×√2).
   * Schnelleres Gelände (Strasse) ist günstiger, damit die Wegfindung es bevorzugt.
   */
  stepCost(tx: number, ty: number, diagonal: boolean, cls: MoveClass): number {
    const speed = this.speedAt(tx, ty, cls);
    const base = Math.round(1000 / speed);
    return diagonal ? Math.floor((base * 1414 + 500) / 1000) : base;
  }

  /**
   * Nummer der Zusammenhangskomponente (Gebiet, das ohne Hindernis erreichbar ist).
   * -1 für unpassierbare Kacheln. Zwei Kacheln mit gleicher Nummer sind
   * gegenseitig erreichbar.
   */
  componentOf(tx: number, ty: number, cls: MoveClass): number {
    if (!this.inBounds(tx, ty)) return -1;
    let comp = this.components[cls];
    if (!comp) {
      comp = this.buildComponents(cls);
      this.components[cls] = comp;
    }
    return comp[ty * this.width + tx];
  }

  /** Muss aufgerufen werden, wenn sich die Passierbarkeit ändert (z.B. Gebäude gebaut). */
  invalidateCaches(): void {
    this.components = new Array(MOVE_CLASS_COUNT);
    this.speedGrids = new Array(MOVE_CLASS_COUNT);
    this.version++;
  }

  private speedGrids: (Uint8Array | undefined)[] = new Array(MOVE_CLASS_COUNT);

  /**
   * Tempo (Prozent, 0 = unpassierbar) aller Kacheln für eine Bewegungsklasse, zwischengespeichert.
   * Für schnelle innere Schleifen (Flussfelder, Komponenten) – gleiche Werte wie speedAt().
   */
  speedGrid(cls: MoveClass): Uint8Array {
    let g = this.speedGrids[cls];
    if (!g) {
      g = new Uint8Array(this.width * this.height);
      for (let i = 0; i < g.length; i++) g[i] = this.blocked[i] !== 0 && cls !== MoveClass.Air ? 0 : speedPercent(cls, this.terrain[i]);
      this.speedGrids[cls] = g;
    }
    return g;
  }

  private buildComponents(cls: MoveClass): Int32Array {
    const { width, height } = this;
    const speed = this.speedGrid(cls);
    const comp = new Int32Array(width * height).fill(-1);
    const stack: number[] = [];
    let next = 0;
    for (let start = 0; start < comp.length; start++) {
      if (comp[start] !== -1 || speed[start] === 0) continue;
      comp[start] = next;
      stack.push(start);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cx = cur % width;
        const cy = (cur - cx) / width;
        for (let d = 0; d < 8; d++) {
          const dx = DIRS[d][0];
          const dy = DIRS[d][1];
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (comp[ni] !== -1 || speed[ni] === 0) continue;
          // Diagonal nur, wenn beide geraden Nachbarn frei sind (wie canStep)
          if (dx !== 0 && dy !== 0 && (speed[cy * width + nx] === 0 || speed[ny * width + cx] === 0)) continue;
          comp[ni] = next;
          stack.push(ni);
        }
      }
      next++;
    }
    return comp;
  }

  /**
   * Nächstgelegene passierbare Kachel (Breitensuche). Ist `component` angegeben,
   * muss die Kachel in dieser Komponente liegen.
   */
  nearestPassable(
    tx: number,
    ty: number,
    cls: MoveClass,
    component?: number,
  ): { tx: number; ty: number } | null {
    const ok = (x: number, y: number) =>
      component === undefined ? this.passable(x, y, cls) : this.componentOf(x, y, cls) === component;
    // Ausserhalb liegende Ziele auf den Kartenrand ziehen.
    tx = Math.min(Math.max(tx, 0), this.width - 1);
    ty = Math.min(Math.max(ty, 0), this.height - 1);
    if (ok(tx, ty)) return { tx, ty };
    // Ringe mit wachsendem Radius absuchen; innerhalb eines Rings gewinnt die
    // euklidisch nächste Kachel (deterministisch bei Gleichstand: zuerst gefunden).
    const maxR = Math.max(this.width, this.height);
    for (let r = 1; r < maxR; r++) {
      let best: { tx: number; ty: number } | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (!this.inBounds(x, y) || !ok(x, y)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { tx: x, ty: y };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Alle Kartenobjekte einer Art (z.B. "spawn"). */
  objectsOfKind(kind: string): MapObject[] {
    return this.objects.filter((o) => o.kind === kind);
  }

  /**
   * Baut eine Karte aus Textzeilen – praktisch für Tests.
   * Zeichen: `.` Gras, `s` Sand, `=` Strasse, `T` Wald, `#` Klippe, `~` Wasser, `B` Brücke.
   */
  static fromAscii(rows: string[]): GameMap {
    const height = rows.length;
    const width = rows[0].length;
    const terrain = new Uint8Array(width * height);
    const chars: Record<string, Terrain> = {
      '.': Terrain.Grass,
      s: Terrain.Sand,
      '=': Terrain.Road,
      T: Terrain.Forest,
      '#': Terrain.Cliff,
      '~': Terrain.Water,
      B: Terrain.Bridge,
    };
    rows.forEach((row, y) => {
      if (row.length !== width) throw new Error(`Zeile ${y} hat falsche Länge`);
      for (let x = 0; x < width; x++) {
        const t = chars[row[x]];
        if (t === undefined) throw new Error(`Unbekanntes Zeichen '${row[x]}'`);
        terrain[y * width + x] = t;
      }
    });
    return new GameMap(width, height, terrain);
  }
}
