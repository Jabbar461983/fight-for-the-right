import { MoveClass } from '../map/terrain';
import { TILE, isqrt, tileCenter, tileOf, tilesToUnits } from '../math/fixed';
import { exitTile } from './production';
import type { Simulation } from './simulation';
import type { Building, Unit } from './unit';

/** Ticks pro Ernteschritt und Menge pro Schritt. */
const HARVEST_INTERVAL = 5;
const HARVEST_AMOUNT = 35;
/** Entladen an der Raffinerie. */
const UNLOAD_INTERVAL = 3;
const UNLOAD_AMOUNT = 50;
/** Nachwachsen: alle … Ticks wächst jede Kachel um 1/REGROW_DIV ihres Maximums. */
const REGROW_INTERVAL = 60;
const REGROW_DIV = 40;
/** Bis zu dieser Entfernung (Kacheln) sucht ein Sammler das nächste Feld in der Nähe. */
const NEARBY_FIELD = 6;
/** Kacheln mit weniger Glimmerit gelten als «fast leer» (lohnen weniger als eine volle). */
const LOW_TILE = 150;

/**
 * Glimmerit-Wirtschaft: Kristallfelder auf der Karte und das Verhalten der Sammler.
 */
export class Economy {
  /** Glimmerit je Kachel. */
  readonly crystal: Int32Array;
  /** Maximum je Kachel (zum Nachwachsen). */
  readonly crystalMax: Int32Array;

  constructor(private readonly sim: Simulation) {
    const m = sim.map;
    this.crystal = new Int32Array(m.width * m.height);
    this.crystalMax = new Int32Array(m.width * m.height);
    for (const f of m.objectsOfKind('crystalField')) {
      const r = Number(f.props.radius ?? 2);
      const rr = tilesToUnits(r);
      const perTile = Number(f.props.perTile ?? 500);
      const t0x = tileOf(f.x - rr);
      const t1x = tileOf(f.x + rr);
      const t0y = tileOf(f.y - rr);
      const t1y = tileOf(f.y + rr);
      for (let ty = t0y; ty <= t1y; ty++) {
        for (let tx = t0x; tx <= t1x; tx++) {
          if (!m.inBounds(tx, ty) || !m.passable(tx, ty, MoveClass.Vehicle)) continue;
          const dx = tileCenter(tx) - f.x;
          const dy = tileCenter(ty) - f.y;
          const d = isqrt(dx * dx + dy * dy);
          if (d > rr) continue;
          // In der Mitte dichter als am Rand
          const amount = Math.round(perTile * 0.5 + perTile * 0.7 * (1 - d / rr));
          const i = m.index(tx, ty);
          this.crystal[i] = Math.max(this.crystal[i], amount);
          this.crystalMax[i] = this.crystal[i];
        }
      }
    }
  }

  /** Gesamtes Glimmerit auf der Karte (für Tests/Anzeige). */
  total(): number {
    let s = 0;
    for (let i = 0; i < this.crystal.length; i++) s += this.crystal[i];
    return s;
  }

  update(): void {
    const sim = this.sim;
    if (sim.tick % REGROW_INTERVAL === 0) {
      for (let i = 0; i < this.crystal.length; i++) {
        const max = this.crystalMax[i];
        // Nicht unter Gebäuden nachwachsen
        if (max > 0 && this.crystal[i] < max && sim.map.blocked[i] === 0) {
          this.crystal[i] = Math.min(max, this.crystal[i] + Math.max(1, Math.trunc(max / REGROW_DIV)));
        }
      }
    }
    for (const u of sim.units) {
      if (!u.dead && u.task?.kind === 'harvest') this.updateHarvester(u);
    }
  }

  /**
   * Nächste Kachel mit Glimmerit (optional nur im Umkreis). -1 wenn keine.
   * `claimed`: Kacheln, die andere Sammler schon ansteuern – werden gemieden (sonst drängeln
   * sich alle auf einer Kachel). Fast leere Kacheln zählen etwas weiter weg, damit volle drankommen.
   */
  findCrystal(x: number, y: number, maxTiles = Infinity, claimed?: Set<number>): number {
    const m = this.sim.map;
    const cx = tileOf(x);
    const cy = tileOf(y);
    let best = -1;
    let bestD = Infinity;
    const r = maxTiles === Infinity ? Math.max(m.width, m.height) : maxTiles;
    for (let ty = Math.max(0, cy - r); ty <= Math.min(m.height - 1, cy + r); ty++) {
      for (let tx = Math.max(0, cx - r); tx <= Math.min(m.width - 1, cx + r); tx++) {
        const i = ty * m.width + tx;
        if (this.crystal[i] <= 0 || m.blocked[i] !== 0) continue;
        let d = (tx - cx) * (tx - cx) + (ty - cy) * (ty - cy);
        if (claimed?.has(i)) d += 400;
        if (this.crystal[i] < LOW_TILE) d += 6;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best;
  }

  private nearestRefinery(u: Unit): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.sim.buildings) {
      if (b.dead || b.owner !== u.owner || !b.def.refinery) continue;
      const dx = b.x - u.x;
      const dy = b.y - u.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Das Verhalten eines Sammlers als kleine Zustandsmaschine. */
  private updateHarvester(u: Unit): void {
    const sim = this.sim;
    const t = u.task;
    if (!t || t.kind !== 'harvest') return;
    const cap = u.def.harvestCapacity ?? 0;
    const m = sim.map;
    const center = (idx: number) => {
      const tx = idx % m.width;
      return { x: tileCenter(tx), y: tileCenter((idx - tx) / m.width) };
    };
    /** Kacheln, die andere eigene Sammler gerade ansteuern oder abernten. */
    const claimed = () => {
      const s = new Set<number>();
      for (const o of sim.units) {
        if (o === u || o.dead || o.owner !== u.owner || o.task?.kind !== 'harvest') continue;
        if ((o.task.phase === 'toField' || o.task.phase === 'harvesting') && o.task.fieldIdx >= 0) s.add(o.task.fieldIdx);
      }
      return s;
    };

    switch (t.phase) {
      case 'seek': {
        if (u.cargo >= cap) {
          t.phase = 'toRefinery';
          return;
        }
        if (t.timer > 0) {
          t.timer--;
          return;
        }
        const idx = this.findCrystal(u.x, u.y, Infinity, claimed());
        if (idx < 0) {
          t.timer = 30; // nichts gefunden – später wieder schauen
          if (u.cargo > 0) t.phase = 'toRefinery';
          return;
        }
        t.fieldIdx = idx;
        t.phase = 'toField';
        const c = center(idx);
        sim.movement.moveOne(u, c.x, c.y);
        return;
      }
      case 'toField': {
        if (t.fieldIdx < 0 || this.crystal[t.fieldIdx] <= 0) {
          // Feld leer: in der Nähe weitersuchen
          const from = t.fieldIdx >= 0 ? center(t.fieldIdx) : u;
          const near = this.findCrystal(from.x, from.y, NEARBY_FIELD, claimed());
          if (near < 0) {
            t.phase = 'seek';
            return;
          }
          t.fieldIdx = near;
          const c = center(near);
          sim.movement.moveOne(u, c.x, c.y);
          return;
        }
        const c = center(t.fieldIdx);
        const dx = c.x - u.x;
        const dy = c.y - u.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= (TILE / 2) * (TILE / 2) || (!u.order && d2 <= TILE * TILE * 2)) {
          u.order = null;
          t.phase = 'harvesting';
          t.timer = HARVEST_INTERVAL;
        } else if (!u.order) {
          if (!sim.movement.moveOne(u, c.x, c.y)) t.phase = 'seek';
        }
        return;
      }
      case 'harvesting': {
        if (--t.timer > 0) return;
        t.timer = HARVEST_INTERVAL;
        const i = t.fieldIdx;
        const take = Math.min(HARVEST_AMOUNT, this.crystal[i], cap - u.cargo);
        if (take > 0) {
          this.crystal[i] -= take;
          u.cargo += take;
        }
        if (u.cargo >= cap) {
          t.phase = 'toRefinery';
          t.refineryId = 0;
        } else if (this.crystal[i] <= 0) {
          t.phase = 'toField';
        }
        return;
      }
      case 'toRefinery': {
        let r = t.refineryId ? sim.getBuilding(t.refineryId) : undefined;
        if (!r || r.dead || r.owner !== u.owner) {
          r = this.nearestRefinery(u) ?? undefined;
          t.refineryId = r?.id ?? 0;
        }
        if (!r) {
          u.order = null; // keine Raffinerie – warten
          return;
        }
        const dock = exitTile(r);
        const dx = tileCenter(dock.tx) - u.x;
        const dy = tileCenter(dock.ty) - u.y;
        const d2 = dx * dx + dy * dy;
        const busy = r.dockedBy !== 0 && r.dockedBy !== u.id && !!sim.getUnit(r.dockedBy);
        if (busy) {
          // Warteschlange: in der Nähe stehen bleiben
          if (d2 <= 9 * TILE * TILE) u.order = null;
          else if (!u.order) sim.movement.moveOne(u, tileCenter(dock.tx), tileCenter(dock.ty) + 2 * TILE);
          return;
        }
        if (d2 <= (TILE * 2) / 5 * ((TILE * 2) / 5)) {
          u.order = null;
          r.dockedBy = u.id;
          t.phase = 'unloading';
          t.timer = UNLOAD_INTERVAL;
          // Andock-Ausrichtung: nach oben in die Raffinerie
          u.dirX = 0;
          u.dirY = -TILE;
        } else if (!u.order) {
          sim.movement.moveOne(u, tileCenter(dock.tx), tileCenter(dock.ty));
        }
        return;
      }
      case 'unloading': {
        const r = sim.getBuilding(t.refineryId);
        if (!r || r.dead) {
          t.phase = 'toRefinery';
          return;
        }
        u.order = null;
        if (--t.timer > 0) return;
        t.timer = UNLOAD_INTERVAL;
        const p = sim.players[u.owner];
        const room = p.storage - p.credits;
        const amount = Math.min(UNLOAD_AMOUNT, u.cargo, room);
        if (amount <= 0 && u.cargo > 0) {
          sim.notify(p.id, 'storageFull', 15 * 20, { type: 'storageFull', owner: p.id });
          return;
        }
        u.cargo -= amount;
        p.credits += amount;
        p.stats.harvested += amount;
        if (u.cargo <= 0) {
          r.dockedBy = 0;
          // Alte Kachel inzwischen von einem anderen Sammler belegt → eine neue suchen
          if (t.fieldIdx >= 0 && claimed().has(t.fieldIdx)) t.fieldIdx = -1;
          t.phase = t.fieldIdx >= 0 ? 'toField' : 'seek';
        }
        return;
      }
    }
  }
}
