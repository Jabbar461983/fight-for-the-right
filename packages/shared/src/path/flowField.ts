import { DIRS, type GameMap } from '../map/gameMap';
import type { MoveClass } from '../map/terrain';
import { IndexHeap } from './binaryHeap';

/** Markiert «nicht erreichbar» im Kostenfeld. */
export const UNREACHABLE = 0xffffffff;

/**
 * Flussfeld (Flow Field) für Gruppenbewegungen.
 *
 * Statt für jede Einheit einen eigenen A*-Pfad zu suchen, wird einmal vom Ziel
 * aus rückwärts (Dijkstra) für jede Kachel berechnet, wie teuer der Weg zum
 * Ziel ist und welche Nachbarkachel der nächste Schritt ist. Beliebig viele
 * Einheiten können dann einfach «dem Pfeil folgen».
 */
export class FlowField {
  /** Wegkosten bis zum Ziel je Kachel (UNREACHABLE = nicht erreichbar). */
  readonly cost: Uint32Array;
  /** Index der nächsten Kachel Richtung Ziel (-1 = keine; Ziel zeigt auf sich selbst). */
  readonly next: Int32Array;
  readonly goalIdx: number;

  /** Nur bis zu dieser Kostengrenze berechnet (Infinity = ganze Karte). */
  readonly limit: number;

  /**
   * `starts` (Kachel-Indizes der Gruppe): Wenn angegeben, wird nur so weit gerechnet, bis alle
   * Startkacheln erfasst sind – plus Reserve für Umwege. Spart auf grossen Karten viel Zeit.
   * Einheiten ausserhalb des Feldes weichen automatisch auf A* aus.
   */
  constructor(
    readonly map: GameMap,
    readonly cls: MoveClass,
    readonly goalTx: number,
    readonly goalTy: number,
    starts?: number[],
  ) {
    const { width, height } = map;
    const n = width * height;
    this.cost = new Uint32Array(n).fill(UNREACHABLE);
    this.next = new Int32Array(n).fill(-1);
    this.goalIdx = map.index(goalTx, goalTy);
    this.limit = Infinity;
    if (!map.passable(goalTx, goalTy, cls)) return;

    const speed = map.speedGrid(cls);
    const heap = new IndexHeap();
    const closed = new Uint8Array(n);
    this.cost[this.goalIdx] = 0;
    this.next[this.goalIdx] = this.goalIdx;
    heap.push(this.goalIdx, 0);
    // Noch nicht erfasste Startkacheln
    const pending = new Set(starts ?? []);
    let bound = Infinity;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      const cc = this.cost[cur];
      if (cc > bound) {
        // Rest bleibt «nicht erreichbar» (→ A*); Kosten im Heap sind aufsteigend
        this.limit = bound;
        break;
      }
      closed[cur] = 1;
      if (starts && pending.delete(cur) && pending.size === 0) {
        // Alle erfasst: noch ein Stück weiter (Umwege, Gedränge)
        bound = Math.trunc((cc * 5) / 4) + 120;
      }
      const cx = cur % width;
      const cy = (cur - cx) / width;
      // Kosten, um cur zu betreten (wie map.stepCost)
      const base = Math.round(1000 / speed[cur]);
      const diagCost = Math.floor((base * 1414 + 500) / 1000);
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0];
        const dy = DIRS[d][1];
        // Rückwärts: Von Nachbar (nx,ny) nach cur gehen – also Schritt (-dx,-dy) ab Nachbar.
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (closed[ni]) continue;
        // Wie canStep(nx, ny, -dx, -dy): Ziel cur ist passierbar; diagonal keine Ecken schneiden
        if (dx !== 0 && dy !== 0 && (speed[ny * width + cx] === 0 || speed[cy * width + nx] === 0)) continue;
        const nc = cc + (d >= 4 ? diagCost : base);
        if (nc < this.cost[ni]) {
          this.cost[ni] = nc;
          this.next[ni] = cur;
          heap.push(ni, nc);
        }
      }
    }
  }

  costAt(tx: number, ty: number): number {
    if (!this.map.inBounds(tx, ty)) return UNREACHABLE;
    return this.cost[this.map.index(tx, ty)];
  }
}

/**
 * Kleiner Zwischenspeicher für Flussfelder (gleiches Ziel + gleiche
 * Bewegungsklasse → gleiches Feld). Die ältesten Einträge fliegen raus.
 */
export class FlowFieldCache {
  private fields = new Map<string, FlowField>();

  constructor(
    private readonly map: GameMap,
    private readonly maxEntries = 16,
  ) {}

  private version = -1;

  get(cls: MoveClass, tx: number, ty: number, starts?: number[]): FlowField {
    // Hat sich die Karte verändert (neues Gebäude), sind alle Felder veraltet.
    if (this.map.version !== this.version) {
      this.fields.clear();
      this.version = this.map.version;
    }
    const key = `${cls}:${tx}:${ty}`;
    let f = this.fields.get(key);
    // Begrenztes Feld nur wiederverwenden, wenn es alle Startkacheln abdeckt
    if (f && f.limit !== Infinity && (!starts || starts.some((s) => f!.cost[s] === UNREACHABLE))) f = undefined;
    if (f) {
      // Als «zuletzt benutzt» markieren
      this.fields.delete(key);
      this.fields.set(key, f);
      return f;
    }
    f = new FlowField(this.map, cls, tx, ty, starts);
    this.fields.delete(key);
    this.fields.set(key, f);
    if (this.fields.size > this.maxEntries) {
      const oldest = this.fields.keys().next().value!;
      this.fields.delete(oldest);
    }
    return f;
  }

  clear(): void {
    this.fields.clear();
  }
}
