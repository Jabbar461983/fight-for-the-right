import type { GameMap } from '../map/gameMap';
import { MoveClass } from '../map/terrain';
import { TILE, clamp, isqrt, tileCenter, tileOf } from '../math/fixed';
import { findWorldPath, resolveGoal, type WorldPoint } from '../path/astar';
import { FlowFieldCache, UNREACHABLE } from '../path/flowField';
import { lineOfSightWide } from '../path/lineOfSight';
import { collectSlots } from './formation';
import type { SpatialHash } from './spatialHash';
import type { MoveOrder, Unit } from './unit';

/** Abstand, ab dem ein Ziel als erreicht gilt. */
const ARRIVE_DIST = TILE / 8;
/** Abstand zu einem Zwischen-Wegpunkt, ab dem der nächste angesteuert wird. */
const WAYPOINT_DIST = TILE / 3;
/** Wie viele Kacheln eine Einheit im Flussfeld vorausschaut. */
const FLOW_LOOKAHEAD = 6;
/** Bis zu diesen Restkosten (≈ 6 Kacheln) darf eine Einheit direkt zu ihrem Platz fahren. */
const DIRECT_COST = 60;
/** Maximales Wegschieben pro Tick (verhindert Zittern). */
const MAX_PUSH = TILE / 8;
/**
 * Nach so vielen Ticks ohne Verkürzung des Restwegs gilt eine Einheit als
 * festgefahren (3 s – Gedränge in der Gruppe ist kein Feststecken).
 */
const STUCK_TICKS = 45;
/** So viel muss der Restweg mindestens schrumpfen, damit es als Fortschritt zählt. */
const PROGRESS_STEP = TILE / 4;
const MAX_REPATHS = 5;

/**
 * Bewegung: Wegfindung (A* für Einzelne, Flussfelder für Gruppen),
 * Abstand halten im Gedränge und Gleiten an Hindernissen.
 */
export class Movement {
  private flowFields: FlowFieldCache;
  private vx: Int32Array = new Int32Array(0);
  private vy: Int32Array = new Int32Array(0);
  private px: Int32Array = new Int32Array(0);
  private py: Int32Array = new Int32Array(0);

  constructor(private readonly map: GameMap) {
    this.flowFields = new FlowFieldCache(map);
  }

  // ───────────────────────────── Aufträge ─────────────────────────────

  /** Gibt einer Gruppe einen Bewegungsbefehl: Einzelne per A*, Gruppen per Flussfeld. */
  moveGroup(units: Unit[], x: number, y: number): void {
    x = clamp(x, 0, this.map.worldWidth - 1);
    y = clamp(y, 0, this.map.worldHeight - 1);
    // Nach Bewegungsklasse aufteilen – Panzer und Infanterie brauchen andere Wege.
    const byClass = new Map<MoveClass, Unit[]>();
    for (const u of units) {
      const list = byClass.get(u.def.moveClassId) ?? [];
      list.push(u);
      byClass.set(u.def.moveClassId, list);
    }
    // Gemeinsames Tempo: Bodentruppen fahren so schnell wie die langsamste, Flieger ebenso unter sich –
    // so kommt eine Angriffswelle zusammen an statt tröpfchenweise.
    const isAir = (u: Unit) => u.def.moveClassId === MoveClass.Air && u.def.airborne;
    const slowest = (list: Unit[]) => (list.length > 1 ? Math.min(...list.map((u) => u.def.speedUnits)) : 0);
    const groundCap = slowest(units.filter((u) => !isAir(u) && !u.def.harvestCapacity));
    const airCap = slowest(units.filter(isAir));
    const cap = (u: Unit) => (u.def.harvestCapacity ? 0 : isAir(u) ? airCap : groundCap);
    for (const [cls, group] of [...byClass.entries()].sort((a, b) => a[0] - b[0])) {
      if (group.length === 1) {
        if (this.moveOne(group[0], x, y) && group[0].order) group[0].order.maxSpeed = cap(group[0]);
        continue;
      }
      const first = group[0];
      const goal = resolveGoal(this.map, cls, { tx: tileOf(first.x), ty: tileOf(first.y) }, { tx: tileOf(x), ty: tileOf(y) });
      if (!goal) continue;
      const slots = collectSlots(this.map, cls, goal, group.length);
      const starts = group.map((u) => this.map.index(tileOf(u.x), tileOf(u.y)));
      const field = this.flowFields.get(cls, goal.tx, goal.ty, starts);
      const groupRadius = TILE * (1 + isqrt(group.length));
      // Jedem Platz (innen zuerst) die nächstgelegene freie Einheit zuordnen.
      const free = [...group];
      for (const slot of slots) {
        const sx = tileCenter(slot.tx);
        const sy = tileCenter(slot.ty);
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < free.length; i++) {
          const dx = free[i].x - sx;
          const dy = free[i].y - sy;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        const u = free.splice(best, 1)[0];
        u.order = {
          goalX: sx,
          goalY: sy,
          mode: 'flow',
          path: [],
          pathIndex: 0,
          field,
          slotIdx: this.map.index(slot.tx, slot.ty),
          groupRadius,
          repaths: 0,
          bestRemaining: Infinity,
          noProgressTicks: 0,
          maxSpeed: cap(u),
        };
      }
    }
  }

  /** Bewegt eine einzelne Einheit per A* an einen Punkt. false, wenn kein Weg existiert. */
  moveOne(u: Unit, x: number, y: number, groupRadius = TILE): boolean {
    x = clamp(x, 0, this.map.worldWidth - 1);
    y = clamp(y, 0, this.map.worldHeight - 1);
    const path = findWorldPath(this.map, u.def.moveClassId, u, { x, y }, this.clearance(u));
    if (!path || path.length === 0) {
      u.order = null;
      return false;
    }
    const goal = path[path.length - 1];
    u.order = {
      goalX: goal.x,
      goalY: goal.y,
      mode: 'path',
      path,
      pathIndex: 0,
      field: null,
      slotIdx: this.map.index(tileOf(goal.x), tileOf(goal.y)),
      groupRadius,
      repaths: 0,
      bestRemaining: Infinity,
      noProgressTicks: 0,
      maxSpeed: 0,
    };
    return true;
  }

  /** Abstand, den eine Einheit zu Hindernissen hält (etwas kleiner als ihr Radius). */
  private clearance(u: Unit): number {
    return Math.trunc((u.def.radiusUnits * 6) / 10);
  }

  // ───────────────────────────── Tick ─────────────────────────────

  /**
   * Bewegt alle Einheiten um einen Tick. `hash` muss die aktuellen Positionen
   * der (lebenden) Einheiten enthalten.
   */
  step(units: Unit[], hash: SpatialHash): void {
    const n = units.length;
    if (this.vx.length < n) {
      const size = Math.max(n, this.vx.length * 2, 64);
      this.vx = new Int32Array(size);
      this.vy = new Int32Array(size);
      this.px = new Int32Array(size);
      this.py = new Int32Array(size);
    }
    const { vx, vy, px, py } = this;

    // 1) Gewünschte Geschwindigkeit jeder Einheit
    for (let i = 0; i < n; i++) {
      const u = units[i];
      vx[i] = 0;
      vy[i] = 0;
      px[i] = 0;
      py[i] = 0;
      const target = this.steerTarget(u);
      if (!target) continue;
      const dx = target.x - u.x;
      const dy = target.y - u.y;
      const d = isqrt(dx * dx + dy * dy);
      if (d === 0) continue;
      const speed = this.currentSpeed(u);
      if (d <= speed) {
        vx[i] = dx;
        vy[i] = dy;
      } else {
        vx[i] = Math.trunc((dx * speed) / d);
        vy[i] = Math.trunc((dy * speed) / d);
      }
    }

    // 2) Abstand halten: überlappende Einheiten schieben sich auseinander
    for (let i = 0; i < n; i++) {
      const a = units[i];
      const aAir = a.def.moveClassId === MoveClass.Air;
      hash.forNeighbors(a.x, a.y, (j) => {
        if (j <= i) return;
        const b = units[j];
        if (aAir !== (b.def.moveClassId === MoveClass.Air)) return;
        this.separate(i, a, j, b);
      });
    }

    // 3) Bewegen, mit Gelände-Kollision
    for (let i = 0; i < n; i++) {
      const u = units[i];
      let pushX = px[i];
      let pushY = py[i];
      const pl = isqrt(pushX * pushX + pushY * pushY);
      if (pl > MAX_PUSH) {
        pushX = Math.trunc((pushX * MAX_PUSH) / pl);
        pushY = Math.trunc((pushY * MAX_PUSH) / pl);
      }
      this.moveUnit(u, vx[i] + pushX, vy[i] + pushY);
      if (vx[i] !== 0 || vy[i] !== 0) {
        u.dirX = vx[i];
        u.dirY = vy[i];
      }
      this.updateProgress(u);
    }
  }

  /** Tempo der Einheit auf ihrem aktuellen Gelände (Welteinheiten pro Tick). */
  private currentSpeed(u: Unit): number {
    const pct = this.map.speedAt(tileOf(u.x), tileOf(u.y), u.def.moveClassId);
    const base = u.order?.maxSpeed ? Math.min(u.def.speedUnits, u.order.maxSpeed) : u.def.speedUnits;
    return Math.max(1, Math.trunc((base * (pct > 0 ? pct : 100)) / 100));
  }

  /** Bestimmt den Punkt, auf den die Einheit in diesem Tick zusteuert. */
  private steerTarget(u: Unit): WorldPoint | null {
    const o = u.order;
    if (!o) return null;
    const cls = u.def.moveClassId;
    const r = this.clearance(u);
    const w = this.map.width;

    if (o.mode === 'flow') {
      const f = o.field!;
      const t = this.map.index(tileOf(u.x), tileOf(u.y));
      const c = f.cost[t];
      const slotCost = f.cost[o.slotIdx];
      if (c === UNREACHABLE || c <= slotCost) {
        // Nicht im Feld oder schon «auf Höhe» des Platzes ohne Sicht → eigener A*-Weg.
        if (!this.switchToPath(u)) return null;
      } else if (c <= slotCost + DIRECT_COST && lineOfSightWide(this.map, cls, u.x, u.y, o.goalX, o.goalY, r)) {
        o.mode = 'path';
        o.path = [{ x: o.goalX, y: o.goalY }];
        o.pathIndex = 0;
        o.bestRemaining = Infinity;
      } else {
        // Dem Fluss folgen und so weit vorausschauen, wie die Sicht frei ist.
        let best = -1;
        let cur = t;
        for (let k = 0; k < FLOW_LOOKAHEAD; k++) {
          const nx = f.next[cur];
          if (nx < 0 || nx === cur) break;
          const cx = nx % w;
          const cy = (nx - cx) / w;
          if (!lineOfSightWide(this.map, cls, u.x, u.y, tileCenter(cx), tileCenter(cy), r)) break;
          best = nx;
          cur = nx;
        }
        if (best < 0) {
          // Nächster Schritt nicht frei sichtbar (z.B. dicht an einer Klippe):
          // erst zur Mitte der eigenen Kachel, von dort direkt zur nächsten.
          const tx = t % w;
          const ccx = tileCenter(tx);
          const ccy = tileCenter((t - tx) / w);
          const ddx = ccx - u.x;
          const ddy = ccy - u.y;
          if (ddx * ddx + ddy * ddy > (TILE / 4) * (TILE / 4)) return { x: ccx, y: ccy };
          const nx = f.next[t];
          if (nx < 0) return null;
          const nxx = nx % w;
          return { x: tileCenter(nxx), y: tileCenter((nx - nxx) / w) };
        }
        const bx = best % w;
        return { x: tileCenter(bx), y: tileCenter((best - bx) / w) };
      }
    }

    // Wegpunkt-Modus
    const last = o.path.length - 1;
    if (o.pathIndex < last) {
      const p = o.path[o.pathIndex];
      const dx = p.x - u.x;
      const dy = p.y - u.y;
      const q = o.path[o.pathIndex + 1];
      if (dx * dx + dy * dy <= WAYPOINT_DIST * WAYPOINT_DIST || lineOfSightWide(this.map, cls, u.x, u.y, q.x, q.y, r)) {
        o.pathIndex++;
      }
    }
    return o.path[o.pathIndex];
  }

  /** Wechselt auf einen eigenen A*-Weg zum Platz. false, wenn es keinen gibt. */
  private switchToPath(u: Unit): boolean {
    const o = u.order!;
    const path = findWorldPath(this.map, u.def.moveClassId, u, { x: o.goalX, y: o.goalY }, this.clearance(u));
    if (!path || path.length === 0) {
      u.order = null;
      return false;
    }
    o.mode = 'path';
    o.path = path;
    o.pathIndex = 0;
    o.goalX = path[path.length - 1].x;
    o.goalY = path[path.length - 1].y;
    o.bestRemaining = Infinity;
    o.noProgressTicks = 0;
    return true;
  }

  /** Restweg bis zum Ziel in Welteinheiten (Flussfeld-Kosten bzw. Länge der Wegpunkte). */
  private remaining(u: Unit, o: MoveOrder): number {
    if (o.mode === 'flow') {
      const c = o.field!.cost[this.map.index(tileOf(u.x), tileOf(u.y))];
      // Kosten 10 ≈ eine Graskachel
      return c === UNREACHABLE ? Infinity : Math.trunc((c * TILE) / 10);
    }
    let x = u.x;
    let y = u.y;
    let sum = 0;
    for (let i = o.pathIndex; i < o.path.length; i++) {
      const dx = o.path[i].x - x;
      const dy = o.path[i].y - y;
      sum += isqrt(dx * dx + dy * dy);
      x = o.path[i].x;
      y = o.path[i].y;
    }
    return sum;
  }

  /** Schiebt zwei überlappende Einheiten auseinander. Wer steht, weicht stärker aus. */
  private separate(i: number, a: Unit, j: number, b: Unit): void {
    const r = a.def.radiusUnits + b.def.radiusUnits;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return;
    let d = isqrt(d2);
    if (d === 0) {
      // Genau übereinander: deterministisch waagrecht trennen.
      dx = 1;
      dy = 0;
      d = 1;
    }
    const overlap = r - d;
    const ox = Math.trunc((dx * overlap) / d);
    const oy = Math.trunc((dy * overlap) / d);
    const aMov = a.order !== null;
    const bMov = b.order !== null;
    let shareA: number;
    let shareB: number;
    if (aMov && !bMov) {
      shareA = 2;
      shareB = 8;
    } else if (!aMov && bMov) {
      shareA = 8;
      shareB = 2;
    } else if (aMov && bMov) {
      shareA = 5;
      shareB = 5;
    } else {
      shareA = 3;
      shareB = 3;
    }
    const { px, py, vx, vy } = this;
    px[i] -= Math.trunc((ox * shareA) / 10);
    py[i] -= Math.trunc((oy * shareA) / 10);
    px[j] += Math.trunc((ox * shareB) / 10);
    py[j] += Math.trunc((oy * shareB) / 10);

    // Rechts ausweichen, wenn sich zwei fahrende Einheiten entgegenkommen.
    if (aMov && bMov && vx[i] * vx[j] + vy[i] * vy[j] < 0) {
      for (const k of [i, j]) {
        const l = isqrt(vx[k] * vx[k] + vy[k] * vy[k]);
        if (l === 0) continue;
        px[k] += Math.trunc((-vy[k] * overlap) / (2 * l));
        py[k] += Math.trunc((vx[k] * overlap) / (2 * l));
      }
    }
  }

  /** Ist die Position frei für diese Einheit (Mitte plus Abstand in vier Richtungen)? */
  private freeAt(u: Unit, x: number, y: number, r: number): boolean {
    const cls = u.def.moveClassId;
    const m = this.map;
    const tx = tileOf(x);
    const ty = tileOf(y);
    if (!m.passable(tx, ty, cls)) return false;
    if (r === 0) return true;
    return (
      m.passable(tileOf(x + r), ty, cls) &&
      m.passable(tileOf(x - r), ty, cls) &&
      m.passable(tx, tileOf(y + r), cls) &&
      m.passable(tx, tileOf(y - r), cls)
    );
  }

  /** Bewegt eine Einheit um (dx,dy) und gleitet an Hindernissen entlang. */
  private moveUnit(u: Unit, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const nx = clamp(u.x + dx, 0, this.map.worldWidth - 1);
    const ny = clamp(u.y + dy, 0, this.map.worldHeight - 1);
    if (u.def.moveClassId === MoveClass.Air) {
      u.x = nx;
      u.y = ny;
      return;
    }
    // Steht die Einheit schon nicht ganz frei (z.B. weggeschoben), nur die Mitte prüfen.
    const r0 = this.clearance(u);
    const r = this.freeAt(u, u.x, u.y, r0) ? r0 : 0;
    if (this.freeAt(u, nx, ny, r)) {
      u.x = nx;
      u.y = ny;
    } else if (dx !== 0 && this.freeAt(u, nx, u.y, r)) {
      u.x = nx;
    } else if (dy !== 0 && this.freeAt(u, u.x, ny, r)) {
      u.y = ny;
    } else if (!this.freeAt(u, u.x, u.y, 0)) {
      // Steckt die Einheit in einem Hindernis (z.B. neues Gebäude), darf sie hinaus.
      u.x = nx;
      u.y = ny;
    }
  }

  /** Prüft Ankunft und erkennt festgefahrene Einheiten. */
  private updateProgress(u: Unit): void {
    const o = u.order;
    if (!o) return;
    const gx = o.goalX - u.x;
    const gy = o.goalY - u.y;
    const goalD2 = gx * gx + gy * gy;
    if (o.mode === 'path' && o.pathIndex === o.path.length - 1 && goalD2 <= ARRIVE_DIST * ARRIVE_DIST) {
      u.order = null;
      return;
    }
    // Fortschritt = der Restweg wird kürzer. Wer im Gedränge wartet, steckt nicht fest.
    const rem = this.remaining(u, o);
    if (rem <= o.bestRemaining - PROGRESS_STEP || o.bestRemaining === Infinity) {
      o.bestRemaining = rem;
      o.noProgressTicks = 0;
      return;
    }
    if (++o.noProgressTicks < STUCK_TICKS) return;

    o.noProgressTicks = 0;
    o.bestRemaining = Infinity;
    if (goalD2 <= o.groupRadius * o.groupRadius) {
      // Nah genug am Ziel, aber der Platz ist belegt → hier bleiben.
      u.order = null;
    } else if (o.repaths < MAX_REPATHS) {
      o.repaths++;
      this.switchToPath(u);
    } else {
      u.order = null;
    }
  }
}
