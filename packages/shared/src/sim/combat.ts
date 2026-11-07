import type { ArmorClass, WeaponDef } from '../data/rules';
import { MoveClass } from '../map/terrain';
import { isqrt } from '../math/fixed';
import type { Simulation } from './simulation';
import type { Building, Unit } from './unit';

/**
 * Kampf: Ziele finden, schiessen, Geschosse fliegen lassen, Schaden verteilen.
 */

type Target = Unit | Building;

/** Alle so viele Ticks sucht eine Einheit ein neues Ziel (gestaffelt nach id). */
export const ACQUIRE_INTERVAL = 4;

function isBuilding(t: Target): t is Building {
  return 'tx' in t;
}

export function armorOf(t: Target): ArmorClass {
  return isBuilding(t) ? 'building' : t.def.armor;
}

function isAir(t: Target): boolean {
  return !isBuilding(t) && t.def.moveClassId === MoveClass.Air;
}

/** Kann diese Waffe das Ziel überhaupt treffen (Boden/Luft, Schaden > 0)? */
export function canHit(w: WeaponDef, t: Target): boolean {
  const air = isAir(t);
  if (air && w.targets === 'ground') return false;
  if (!air && w.targets === 'air') return false;
  return w.versus[armorOf(t)] > 0;
}

/** Abstand vom Schützen zum Ziel ist innerhalb [minRange, range]? */
export function inRange(sim: Simulation, x: number, y: number, w: WeaponDef, t: Target): boolean {
  const d = sim.distanceTo(x, y, t);
  return d <= w.rangeUnits && d >= w.minRangeUnits;
}

/**
 * Sucht das beste gegnerische Ziel im Umkreis. Nur sichtbare Ziele (Nebel!).
 * Bewaffnete Einheiten werden bevorzugt, Mauern kommen zuletzt.
 */
export function findTarget(
  sim: Simulation,
  owner: number,
  x: number,
  y: number,
  w: WeaponDef,
  radius: number,
): Target | null {
  let best: Target | null = null;
  let bestScore = Infinity;
  const consider = (t: Target) => {
    if (t.dead || !sim.isEnemy(owner, t.owner)) return;
    if (!canHit(w, t)) return;
    const d = sim.distanceTo(x, y, t);
    if (d > radius || d < w.minRangeUnits) return;
    if (!sim.canSee(owner, t)) return;
    let score = d;
    if (isBuilding(t)) score = t.def.wall ? d * 16 + 1_000_000 : d * 3 + (t.def.weapon ? 0 : 50_000);
    else if (!t.def.weapon) score = d * 2;
    if (score < bestScore || (score === bestScore && best && t.id < best.id)) {
      bestScore = score;
      best = t;
    }
  };
  const units = sim.units;
  sim.hash.forRadius(x, y, radius + 2048, (i) => consider(units[i]));
  for (const b of sim.buildings) consider(b);
  return best;
}

/** Feuert ein Geschoss ab. */
function fire(sim: Simulation, sourceId: number, owner: number, x: number, y: number, w: WeaponDef, t: Target): void {
  const homing = w.projectile !== 'shell';
  sim.projectiles.push({
    id: sim.newId(),
    owner,
    weapon: w,
    x,
    y,
    prevX: x,
    prevY: y,
    startX: x,
    startY: y,
    targetId: homing ? t.id : 0,
    tx: t.x,
    ty: t.y,
    dead: false,
  });
  sim.emit({ type: 'fired', sourceId, owner, x, y, weaponId: w.id });
}

/** Kampf-Tick: Einheiten und Türme zielen und schiessen. */
export function updateCombat(sim: Simulation): void {
  for (const u of sim.units) {
    if (u.dead) continue;
    const w = u.def.weapon;
    if (!w) continue;
    if (u.cooldown > 0) u.cooldown--;

    let target: Target | null = null;
    const task = u.task;
    if (task?.kind === 'attack') {
      const t = sim.getTarget(task.targetId);
      if (t && inRange(sim, u.x, u.y, w, t)) target = t;
    } else if (u.stance !== 'passive') {
      // Darf beim Fahren nur schiessen, wer einen Turm hat (oder auf Angriffsbewegung ist)
      const mayFire = !u.order || u.def.turret || task?.kind === 'attackMove';
      if (mayFire) {
        let t = u.targetId ? sim.getTarget(u.targetId) : undefined;
        if (t && (!inRange(sim, u.x, u.y, w, t) || !sim.canSee(u.owner, t) || !sim.isEnemy(u.owner, t.owner))) t = undefined;
        if (!t && (sim.tick + u.id) % ACQUIRE_INTERVAL === 0) t = findTarget(sim, u.owner, u.x, u.y, w, w.rangeUnits) ?? undefined;
        u.targetId = t?.id ?? 0;
        target = t ?? null;
      }
    }
    if (!target) continue;
    u.aimX = target.x - u.x;
    u.aimY = target.y - u.y;
    // Ohne Turm muss sich die ganze Einheit zum Ziel drehen
    if (!u.def.turret && !u.order) {
      u.dirX = u.aimX;
      u.dirY = u.aimY;
    }
    if (u.cooldown <= 0) {
      fire(sim, u.id, u.owner, u.x, u.y, w, target);
      u.cooldown = w.reloadTicks;
    }
  }

  for (const b of sim.buildings) {
    if (b.dead) continue;
    const w = b.def.weapon;
    if (!w) continue;
    if (b.cooldown > 0) b.cooldown--;
    let t = b.targetId ? sim.getTarget(b.targetId) : undefined;
    if (t && (!inRange(sim, b.x, b.y, w, t) || !sim.canSee(b.owner, t) || !sim.isEnemy(b.owner, t.owner))) t = undefined;
    if (!t && (sim.tick + b.id) % ACQUIRE_INTERVAL === 0) t = findTarget(sim, b.owner, b.x, b.y, w, w.rangeUnits) ?? undefined;
    b.targetId = t?.id ?? 0;
    if (!t) continue;
    b.aimX = t.x - b.x;
    b.aimY = t.y - b.y;
    if (b.cooldown <= 0) {
      fire(sim, b.id, b.owner, b.x, b.y, w, t);
      // Strommangel: Türme feuern halb so schnell
      b.cooldown = sim.players[b.owner]?.lowPower ? w.reloadTicks * 2 : w.reloadTicks;
    }
  }
}

/** Schaden einer Waffe gegen ein Ziel. */
export function damageFor(w: WeaponDef, t: Target): number {
  return Math.max(1, Math.trunc((w.damage * w.versus[armorOf(t)]) / 100));
}

/** Geschosse bewegen und beim Einschlag Schaden verteilen. */
export function updateProjectiles(sim: Simulation): void {
  for (const p of sim.projectiles) {
    if (p.dead) continue;
    const target = p.targetId ? sim.getTarget(p.targetId) : undefined;
    if (target) {
      p.tx = target.x;
      p.ty = target.y;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = isqrt(dx * dx + dy * dy);
    const s = p.weapon.speedUnits;
    if (d > s) {
      p.x += Math.trunc((dx * s) / d);
      p.y += Math.trunc((dy * s) / d);
      continue;
    }
    // Einschlag
    p.x = p.tx;
    p.y = p.ty;
    p.dead = true;
    const w = p.weapon;
    sim.emit({ type: 'impact', x: p.x, y: p.y, weaponId: w.id, splash: w.splashUnits });
    if (w.splashUnits > 0) {
      // Flächenschaden trifft nur Gegner (kein Eigenbeschuss – kinderfreundlich und einfach)
      const hit: Target[] = [];
      sim.hash.forRadius(p.x, p.y, w.splashUnits + 1024, (i) => {
        const u = sim.units[i];
        if (!u.dead && sim.isEnemy(p.owner, u.owner) && canHit(w, u) && sim.distanceTo(p.x, p.y, u) <= w.splashUnits) hit.push(u);
      });
      for (const b of sim.buildings) {
        if (!b.dead && sim.isEnemy(p.owner, b.owner) && sim.distanceTo(p.x, p.y, b) <= w.splashUnits) hit.push(b);
      }
      hit.sort((a, b) => a.id - b.id);
      for (const t of hit) sim.damage(t, damageFor(w, t), p.owner);
    } else if (target) {
      sim.damage(target, damageFor(w, target), p.owner);
    }
  }
}
