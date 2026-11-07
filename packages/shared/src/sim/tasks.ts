import { MoveClass } from '../map/terrain';
import { TILE, tileOf } from '../math/fixed';
import { ACQUIRE_INTERVAL, findTarget, inRange } from './combat';
import type { Simulation } from './simulation';
import type { Unit } from './unit';

/**
 * Aufgaben der Einheiten: angreifen, Angriffsbewegung, von selbst verfolgen,
 * Ingenieur-Einsätze und Bauwagen ausfahren. Sammler steuert die Wirtschaft.
 */

/** Wie oft ein Verfolger seinen Weg neu plant (Ticks). */
const REPATH_TICKS = 15;
/** So weit (Kacheln) verfolgt eine Einheit von selbst, bevor sie umkehrt. */
const LEASH = 8 * TILE;

export function updateTasks(sim: Simulation): void {
  for (const u of sim.units) {
    if (u.dead) continue;
    const t = u.task;
    if (!t) {
      autoEngage(sim, u);
      continue;
    }
    switch (t.kind) {
      case 'attack':
        updateAttack(sim, u);
        break;
      case 'attackMove':
        updateAttackMove(sim, u);
        break;
      case 'enter':
        updateEnter(sim, u);
        break;
      case 'deploy':
        deploy(sim, u);
        break;
      case 'harvest':
        break; // → Economy
    }
  }
}

/** Untätige Einheiten mit Haltung «Angreifen» verfolgen sichtbare Gegner in Sichtweite. */
function autoEngage(sim: Simulation, u: Unit): void {
  const w = u.def.weapon;
  if (!w || u.order || u.stance !== 'aggressive') return;
  if ((sim.tick + u.id) % ACQUIRE_INTERVAL !== 0) return;
  // Wer schon ein Ziel in Reichweite hat, schiesst einfach (combat.ts)
  if (u.targetId && sim.getTarget(u.targetId)) return;
  const t = findTarget(sim, u.owner, u.x, u.y, w, Math.max(u.def.sightUnits, w.rangeUnits));
  if (!t) return;
  u.task = { kind: 'attack', targetId: t.id, forced: false, nextRepath: 0, guardX: u.x, guardY: u.y };
}

function updateAttack(sim: Simulation, u: Unit): void {
  const t = u.task;
  if (!t || t.kind !== 'attack') return;
  const w = u.def.weapon;
  const target = sim.getTarget(t.targetId);
  // Ziel weg, verbündet geworden oder (bei automatischer Verfolgung) nicht mehr sichtbar
  if (!w || !target || !sim.isEnemy(u.owner, target.owner) || (!t.forced && !sim.canSee(u.owner, target))) {
    finishAttack(sim, u);
    return;
  }
  if (!t.forced) {
    const dx = u.x - t.guardX;
    const dy = u.y - t.guardY;
    if (dx * dx + dy * dy > LEASH * LEASH) {
      // Zu weit weg gelockt → zurück
      u.task = null;
      sim.movement.moveOne(u, t.guardX, t.guardY);
      return;
    }
  }
  if (inRange(sim, u.x, u.y, w, target)) {
    u.order = null;
    return;
  }
  if (u.stance === 'hold' && !t.forced) {
    u.task = null;
    return;
  }
  if (!u.order || sim.tick >= t.nextRepath) {
    t.nextRepath = sim.tick + REPATH_TICKS;
    // Bei Mindestreichweite (Artillerie) zurückweichen statt näher ran
    if (sim.distanceTo(u.x, u.y, target) < w.minRangeUnits) {
      const dx = u.x - target.x;
      const dy = u.y - target.y;
      sim.movement.moveOne(u, u.x + Math.sign(dx) * 2 * TILE, u.y + Math.sign(dy) * 2 * TILE);
    } else {
      sim.movement.moveOne(u, target.x, target.y);
    }
  }
}

function finishAttack(sim: Simulation, u: Unit): void {
  u.task = null;
  u.order = null;
  u.targetId = 0;
}

function updateAttackMove(sim: Simulation, u: Unit): void {
  const t = u.task;
  if (!t || t.kind !== 'attackMove') return;
  const w = u.def.weapon;
  if (!w) {
    u.task = null;
    return;
  }
  // Gegner in Sichtweite? → verfolgen, danach das ursprüngliche Ziel weiter ansteuern
  let target = u.targetId ? sim.getTarget(u.targetId) : undefined;
  if (target && (!sim.isEnemy(u.owner, target.owner) || !sim.canSee(u.owner, target))) target = undefined;
  if (!target && (sim.tick + u.id) % ACQUIRE_INTERVAL === 0) {
    target = findTarget(sim, u.owner, u.x, u.y, w, Math.max(u.def.sightUnits, w.rangeUnits)) ?? undefined;
  }
  u.targetId = target?.id ?? 0;
  if (target) {
    if (inRange(sim, u.x, u.y, w, target)) {
      u.order = null;
    } else if (!u.order || (sim.tick + u.id) % REPATH_TICKS === 0) {
      sim.movement.moveOne(u, target.x, target.y);
    }
    return;
  }
  const dx = t.x - u.x;
  const dy = t.y - u.y;
  if (dx * dx + dy * dy <= 2 * TILE * 2 * TILE) {
    if (!u.order) u.task = null; // angekommen
    return;
  }
  if (!u.order) {
    if (!sim.movement.moveOne(u, t.x, t.y, 3 * TILE)) u.task = null;
  }
}

/** Ingenieur: neben dem Gebäude angekommen → übernehmen (Gegner) oder reparieren (eigenes). */
function updateEnter(sim: Simulation, u: Unit): void {
  const t = u.task;
  if (!t || t.kind !== 'enter') return;
  const b = sim.getBuilding(t.targetId);
  if (!b || b.dead) {
    u.task = null;
    return;
  }
  if (sim.distanceTo(u.x, u.y, b) <= TILE * 0.6 + u.def.radiusUnits) {
    if (sim.isEnemy(u.owner, b.owner)) {
      sim.captureBuilding(b, u.owner);
    } else {
      b.hp = b.def.hp;
    }
    sim.removeUnitSilently(u);
    return;
  }
  if (!u.order || sim.tick >= t.nextRepath) {
    t.nextRepath = sim.tick + REPATH_TICKS * 2;
    if (!sim.movement.moveOne(u, b.x, b.y)) u.task = null;
  }
}

/** Bauwagen ausfahren: Bauhof mittig auf der Position des Wagens. */
function deploy(sim: Simulation, u: Unit): void {
  const task = u.task;
  if (!task || task.kind !== 'deploy') return;
  u.task = null;
  u.order = null;
  const p = sim.players[u.owner];
  const def = u.def.deploysTo ? sim.rules.building(p.faction, u.def.deploysTo) : undefined;
  if (!def) return;
  const tx = tileOf(u.x) - Math.floor(def.width / 2);
  const ty = tileOf(u.y) - Math.floor(def.height / 2);
  // Gelände frei und keine anderen Einheiten im Weg
  let ok = sim.map.inBounds(tx, ty) && sim.map.inBounds(tx + def.width - 1, ty + def.height - 1);
  for (let y = ty; ok && y < ty + def.height; y++) {
    for (let x = tx; ok && x < tx + def.width; x++) {
      if (!sim.map.passable(x, y, MoveClass.Vehicle) || sim.map.terrainAt(x, y) === 6) ok = false;
    }
  }
  if (ok) {
    const x0 = tx * TILE;
    const y0 = ty * TILE;
    let blockedByOwn = false;
    for (const o of sim.units) {
      if (o === u || o.dead || o.def.moveClassId === MoveClass.Air) continue;
      if (o.x > x0 && o.x < x0 + def.width * TILE && o.y > y0 && o.y < y0 + def.height * TILE) {
        // Eigene Einheiten machen Platz, dann neuer Versuch (bis 3 s lang)
        if (o.owner === u.owner) {
          if (!o.order) sim.movement.moveOne(o, o.x + (o.x < u.x ? -3 : 3) * TILE, o.y + (o.y < u.y ? -3 : 3) * TILE);
          blockedByOwn = true;
        }
        ok = false;
      }
    }
    if (!ok && blockedByOwn && task.tries < 45) {
      u.task = { kind: 'deploy', tries: task.tries + 1 };
      return;
    }
  }
  if (!ok) {
    sim.emit({ type: 'cannotDeploy', owner: u.owner, x: u.x, y: u.y });
    return;
  }
  sim.removeUnitSilently(u);
  sim.addBuilding(def, u.owner, tx, ty);
  p.stats.buildingsBuilt++;
}
