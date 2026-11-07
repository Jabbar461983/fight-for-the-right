import { TILE, tileOf } from '../math/fixed';
import type { Simulation } from './simulation';

/**
 * Nebel des Krieges: Was sieht jeder Spieler gerade, was hat er schon erkundet,
 * und welchen Stand fremder Gebäude hat er zuletzt gesehen?
 * Verbündete teilen ihre Sicht.
 */

/** Kreis-Versätze je Radius (Kacheln), einmal berechnet. */
const circleCache = new Map<number, Int16Array>();

function circle(r: number): Int16Array {
  let c = circleCache.get(r);
  if (c) return c;
  const pts: number[] = [];
  const r2 = r * r + r; // etwas runder als ein exakter Kreis
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r2) pts.push(dx, dy);
  }
  c = Int16Array.from(pts);
  circleCache.set(r, c);
  return c;
}

export function updateFog(sim: Simulation): void {
  const m = sim.map;
  const w = m.width;
  const h = m.height;
  const players = sim.playerList;

  // Eigene Sicht jedes Spielers
  const own = new Map<number, Uint8Array>();
  for (const p of players) own.set(p.id, new Uint8Array(w * h));
  const stamp = (owner: number, x: number, y: number, sightUnits: number) => {
    const grid = own.get(owner);
    if (!grid) return;
    const cx = tileOf(x);
    const cy = tileOf(y);
    const pts = circle(Math.max(1, Math.round(sightUnits / TILE)));
    for (let i = 0; i < pts.length; i += 2) {
      const tx = cx + pts[i];
      const ty = cy + pts[i + 1];
      if (tx >= 0 && ty >= 0 && tx < w && ty < h) grid[ty * w + tx] = 1;
    }
  };
  for (const u of sim.units) if (!u.dead) stamp(u.owner, u.x, u.y, u.def.sightUnits);
  for (const b of sim.buildings) if (!b.dead) stamp(b.owner, b.x, b.y, b.def.sightUnits + (b.def.width * TILE) / 2);

  // Mit Verbündeten zusammenführen
  for (const p of players) {
    const vis = p.visible;
    vis.fill(0);
    for (const q of players) {
      if (!sim.isAlly(p.id, q.id)) continue;
      const g = own.get(q.id)!;
      for (let i = 0; i < vis.length; i++) vis[i] |= g[i];
    }
    const ex = p.explored;
    for (let i = 0; i < vis.length; i++) ex[i] |= vis[i];
  }

  // «Geister»: zuletzt gesehener Stand fremder Gebäude
  for (const p of players) {
    for (const b of sim.buildings) {
      if (b.dead || sim.isAlly(p.id, b.owner)) continue;
      if (sim.canSee(p.id, b)) {
        p.ghosts.set(b.id, { id: b.id, defId: b.def.id, owner: b.owner, faction: b.def.forFaction, tx: b.tx, ty: b.ty });
      }
    }
    for (const [id, g] of p.ghosts) {
      const b = sim.getBuilding(id);
      const stale = !b || b.dead || sim.isAlly(p.id, b.owner);
      if (!stale) continue;
      // Erst vergessen, wenn der Spieler die Stelle wieder sieht
      const def = sim.rules.building(g.faction, g.defId);
      let seen = false;
      for (let y = g.ty; y < g.ty + (def?.height ?? 1) && !seen; y++) {
        for (let x = g.tx; x < g.tx + (def?.width ?? 1); x++) {
          if (sim.isVisible(p.id, x, y)) {
            seen = true;
            break;
          }
        }
      }
      if (seen || (b && sim.isAlly(p.id, b.owner))) p.ghosts.delete(id);
    }
  }
}
