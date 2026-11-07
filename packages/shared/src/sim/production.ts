import { PRODUCTION_CATEGORIES, type BuildingDef, type ProductionCategory, type UnitDef } from '../data/rules';
import { MoveClass, speedPercent } from '../map/terrain';
import { TILE, tileCenter } from '../math/fixed';
import type { Simulation } from './simulation';
import type { Building, Player, Unit } from './unit';

/**
 * Basisbau und Produktion: Bauschlangen, Platzieren, Strom, Lager, Reparatur.
 */

/** Maximaler Abstand (Kacheln) zwischen einem neuen und einem bestehenden eigenen Gebäude. */
export const BUILD_GAP = 3;
/** Maximale Länge einer Einheiten-Bauschlange. */
const MAX_QUEUE = 10;
/** Rückerstattung beim Verkaufen. */
export const SELL_REFUND = 0.5;

/** Welche Gebäude produzieren diese Kategorie? */
export function producersOf(sim: Simulation, player: number, cat: ProductionCategory): Building[] {
  return sim.buildings.filter((b) => !b.dead && b.owner === player && b.def.produces.includes(cat));
}

export interface Availability {
  available: boolean;
  /** Fehlende Voraussetzungen (Gebäude-ids). */
  missing: string[];
  /** Kein Gebäude, das diese Kategorie herstellt. */
  noProducer: boolean;
}

/** Kann der Spieler diesen Typ bauen? (Voraussetzungen erfüllt, Fabrik vorhanden) */
export function availability(sim: Simulation, player: number, def: UnitDef | BuildingDef): Availability {
  const owned = new Set(sim.buildings.filter((b) => !b.dead && b.owner === player).map((b) => b.def.id));
  const missing = def.buildable ? def.prerequisites.filter((p) => !owned.has(p)) : [def.id];
  const cat = def.category as ProductionCategory;
  const noProducer = producersOf(sim, player, cat).length === 0;
  return { available: missing.length === 0 && !noProducer, missing, noProducer };
}

/** Typdefinition für einen Bauschlangen-Eintrag. */
function defFor(sim: Simulation, p: Player, cat: ProductionCategory, id: string): UnitDef | BuildingDef | undefined {
  return cat === 'building' || cat === 'defense' ? sim.rules.building(p.faction, id) : sim.rules.unit(p.faction, id);
}

/** Bauschlangen-Befehl: hinzufügen, pausieren/fortsetzen, abbrechen. */
export function handleQueueCommand(
  sim: Simulation,
  p: Player,
  cat: ProductionCategory,
  id: string,
  action: 'add' | 'pause' | 'cancel',
): void {
  const def = defFor(sim, p, cat, id);
  if (!def || def.category !== cat) return;
  const queue = p.queues[cat];
  const isBuildingCat = cat === 'building' || cat === 'defense';
  switch (action) {
    case 'add': {
      // Pausierten Eintrag fortsetzen statt neuen anlegen
      const paused = queue.find((q) => q.defId === id && q.paused);
      if (paused) {
        paused.paused = false;
        return;
      }
      if (!availability(sim, p.id, def).available) return;
      // Gebäude: immer nur eins gleichzeitig (und nicht, solange eins aufs Platzieren wartet)
      if (isBuildingCat && (queue.length > 0 || p.ready[cat as 'building' | 'defense'])) return;
      if (queue.length >= MAX_QUEUE) return;
      queue.push({
        defId: id,
        kind: isBuildingCat ? 'building' : 'unit',
        done: 0,
        total: def.buildTicks * 100,
        spent: 0,
        cost: def.cost,
        paused: false,
      });
      return;
    }
    case 'pause': {
      const item = queue.find((q) => q.defId === id);
      if (item) item.paused = !item.paused;
      return;
    }
    case 'cancel': {
      // Letzten Eintrag dieses Typs entfernen, Bezahltes zurück
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].defId === id) {
          p.credits += queue[i].spent;
          queue.splice(i, 1);
          return;
        }
      }
      if (isBuildingCat && p.ready[cat as 'building' | 'defense'] === id) {
        p.ready[cat as 'building' | 'defense'] = undefined;
        p.credits += def.cost;
      }
      return;
    }
  }
}

/** Ein Tick Produktion für alle Spieler. Kosten werden laufend abgebucht. */
export function updateProduction(sim: Simulation): void {
  for (const p of sim.playerList) {
    if (p.defeated) continue;
    for (const cat of PRODUCTION_CATEGORIES) {
      const queue = p.queues[cat];
      if (queue.length === 0) continue;
      const item = queue[0];
      if (item.paused) continue;
      const producers = producersOf(sim, p.id, cat);
      if (producers.length === 0) continue;
      // Mehr Fabriken = schneller; Strommangel = halb so schnell
      let rate = Math.min(200, 100 + 50 * (producers.length - 1));
      if (p.lowPower) rate = Math.trunc(rate / 2);
      const nextDone = Math.min(item.total, item.done + rate);
      const targetSpent = Math.floor((item.cost * nextDone) / item.total);
      const need = targetSpent - item.spent;
      if (need > p.credits) {
        sim.notify(p.id, 'funds', 15 * 15, { type: 'insufficientFunds', owner: p.id });
        continue;
      }
      p.credits -= need;
      item.spent += need;
      item.done = nextDone;
      if (item.done < item.total) continue;

      queue.shift();
      if (item.kind === 'building') {
        p.ready[cat as 'building' | 'defense'] = item.defId;
        sim.emit({ type: 'buildingReady', owner: p.id, category: cat, defId: item.defId });
      } else {
        const u = spawnProduced(sim, p, producers, item.defId);
        if (u) {
          p.stats.unitsBuilt++;
          sim.emit({ type: 'unitReady', owner: p.id, defId: item.defId, id: u.id });
        }
      }
    }
  }
}

/** Ausgang eines Gebäudes: Kachel mittig unterhalb. */
export function exitTile(b: Building): { tx: number; ty: number } {
  return { tx: b.tx + Math.floor(b.def.width / 2), ty: b.ty + b.def.height };
}

/** Lässt eine fertige Einheit aus der (ersten) Fabrik fahren. */
function spawnProduced(sim: Simulation, p: Player, producers: Building[], defId: string): Unit | null {
  const def = sim.rules.unit(p.faction, defId);
  if (!def) return null;
  const b = producers[0];
  const ex = exitTile(b);
  const tile = sim.map.nearestPassable(ex.tx, ex.ty, def.moveClassId);
  if (!tile) return null;
  const u = sim.spawnUnit(defId, p.id, tileCenter(tile.tx), tileCenter(tile.ty));
  // Fertig beladen ausliefern (z.B. Maulwurf mit Schützen)
  if (def.initialPassengers) {
    for (let i = 0; i < def.initialPassengers.count; i++) {
      const passenger = sim.spawnUnit(def.initialPassengers.type, p.id, u.x, u.y);
      if (sim.canBoard(passenger, u)) sim.board(passenger, u);
    }
  }
  // Ein Stück vom Tor wegfahren, damit der Ausgang frei bleibt (Sammler fahren direkt los).
  if (!def.harvestCapacity) {
    const dir = def.moveClassId === MoveClass.Naval ? 0 : 2 * TILE;
    if (dir) sim.movement.moveOne(u, u.x, u.y + dir);
  }
  return u;
}

/** Ist diese Kachel der Andockplatz einer Raffinerie? */
function isDockTile(sim: Simulation, tx: number, ty: number): boolean {
  for (const b of sim.buildings) {
    if (b.dead || !b.def.refinery) continue;
    const d = exitTile(b);
    if (d.tx === tx && d.ty === ty) return true;
  }
  return false;
}

export interface PlaceCheck {
  ok: boolean;
  /** Je Kachel des Grundrisses: frei? (für die grün/rote Anzeige) */
  tiles: boolean[];
  reason?: 'blocked' | 'tooFar' | 'bounds' | 'noWater';
}

/**
 * Darf der Spieler das Gebäude hier hinstellen?
 * Gelände muss bebaubar und frei sein, keine Einheiten im Weg, und es muss in
 * der Nähe eines eigenen Gebäudes stehen.
 */
export function canPlace(sim: Simulation, player: number, def: BuildingDef, tx: number, ty: number): PlaceCheck {
  const m = sim.map;
  const tiles: boolean[] = [];
  let allFree = true;
  for (let y = ty; y < ty + def.height; y++) {
    for (let x = tx; x < tx + def.width; x++) {
      let free =
        m.inBounds(x, y) &&
        !m.isBlocked(x, y) &&
        speedPercent(MoveClass.Vehicle, m.terrainAt(x, y)) > 0 &&
        m.terrainAt(x, y) !== 6 /* keine Brücken */ &&
        !isDockTile(sim, x, y);
      if (free) {
        // Keine Bodeneinheit darf auf der Kachel stehen
        const x0 = x * TILE;
        const y0 = y * TILE;
        for (const u of sim.units) {
          if (u.dead || u.def.moveClassId === MoveClass.Air) continue;
          const r = u.def.radiusUnits;
          if (u.x + r > x0 && u.x - r < x0 + TILE && u.y + r > y0 && u.y - r < y0 + TILE) {
            free = false;
            break;
          }
        }
      }
      tiles.push(free);
      if (!free) allFree = false;
    }
  }
  if (!m.inBounds(tx, ty) || !m.inBounds(tx + def.width - 1, ty + def.height - 1)) {
    return { ok: false, tiles, reason: 'bounds' };
  }
  // Werft muss direkt am Wasser stehen
  if (def.requiresWater) {
    let water = false;
    for (let y = ty - 1; y <= ty + def.height && !water; y++) {
      for (let x = tx - 1; x <= tx + def.width; x++) {
        const inside = x >= tx && x < tx + def.width && y >= ty && y < ty + def.height;
        if (!inside && m.inBounds(x, y) && m.passable(x, y, MoveClass.Naval)) {
          water = true;
          break;
        }
      }
    }
    if (!water) return { ok: false, tiles: tiles.map(() => false), reason: 'noWater' };
  }
  // Raffinerie braucht einen freien Andockplatz
  if (def.refinery) {
    const dx = tx + Math.floor(def.width / 2);
    const dy = ty + def.height;
    if (!m.passable(dx, dy, MoveClass.Vehicle)) return { ok: false, tiles, reason: 'blocked' };
  }
  if (!allFree) return { ok: false, tiles, reason: 'blocked' };
  // Nähe zu eigenen Gebäuden (Mauern zählen nicht)
  const near = sim.buildings.some((b) => {
    if (b.dead || b.owner !== player || b.def.wall || b.def.neutral) return false;
    const gapX = Math.max(b.tx - (tx + def.width), tx - (b.tx + b.def.width), 0);
    const gapY = Math.max(b.ty - (ty + def.height), ty - (b.ty + b.def.height), 0);
    return Math.max(gapX, gapY) <= BUILD_GAP;
  });
  if (!near) return { ok: false, tiles, reason: 'tooFar' };
  return { ok: true, tiles };
}

/** Stellt ein (geprüftes) Gebäude hin. Raffinerien bringen ihren Sammler mit. */
export function placeBuilding(sim: Simulation, player: number, def: BuildingDef, tx: number, ty: number): Building {
  const b = sim.addBuilding(def, player, tx, ty);
  const p = sim.players[player];
  p.stats.buildingsBuilt++;
  if (def.freeUnit) {
    const ex = exitTile(b);
    const unitDef = sim.rules.unit(p.faction, def.freeUnit);
    const t = unitDef ? sim.map.nearestPassable(ex.tx, ex.ty, unitDef.moveClassId) : null;
    if (t) sim.spawnUnit(def.freeUnit, player, tileCenter(t.tx), tileCenter(t.ty));
  }
  return b;
}

/** Strom und Lagerkapazität neu berechnen. Meldet, wenn der Strom knapp wird. */
export function recomputePower(sim: Simulation): void {
  for (const p of sim.playerList) {
    let produced = 0;
    let used = 0;
    let storage = 0;
    let radar = false;
    for (const b of sim.buildings) {
      if (b.dead || b.owner !== p.id) continue;
      if (b.def.power > 0) produced += b.def.power;
      else used -= b.def.power;
      storage += b.def.storage;
      if (b.def.radar) radar = true;
    }
    const wasLow = p.lowPower;
    p.powerProduced = produced;
    p.powerUsed = used;
    p.storage = storage;
    p.lowPower = used > produced;
    p.hasRadar = radar && !p.lowPower;
    if (p.lowPower && !wasLow && !p.defeated) sim.notify(p.id, 'lowPower', 15 * 10, { type: 'lowPower', owner: p.id });
  }
}

/** Bonus-Punkte bringen alle 2 Sekunden Glimmerit (bis zur Lagergrenze). */
function updateIncome(sim: Simulation): void {
  if (sim.tick % 30 !== 0) return;
  for (const b of sim.buildings) {
    if (b.dead || !b.def.income || !b.owner) continue;
    const p = sim.players[b.owner];
    if (!p || p.defeated) continue;
    const add = Math.max(0, Math.min(b.def.income, p.storage - p.credits));
    p.credits += add;
    p.stats.harvested += add;
  }
}

/** Reparaturstation: Fahrzeuge daneben heilen 2 % alle 5 Ticks (halber anteiliger Preis). */
function updateRepairStations(sim: Simulation): void {
  for (const st of sim.buildings) {
    if (st.dead || !st.def.repairsVehicles) continue;
    const p = sim.players[st.owner];
    if (!p) continue;
    for (const u of sim.units) {
      if (u.dead || u.owner !== st.owner || u.def.category !== 'vehicle' || u.order || u.hp >= u.def.hp) continue;
      if (sim.distanceTo(u.x, u.y, st) > TILE + u.def.radiusUnits) continue;
      const heal = Math.min(Math.max(1, Math.ceil(u.def.hp / 50)), u.def.hp - u.hp);
      const cost = Math.max(1, Math.ceil((u.def.cost * heal) / u.def.hp / 2));
      if (p.credits < cost) continue;
      p.credits -= cost;
      u.hp += heal;
    }
  }
}

/** Reparatur: 1 % der Trefferpunkte alle 5 Ticks, kostet die Hälfte des anteiligen Preises. */
export function updateRepairs(sim: Simulation): void {
  updateIncome(sim);
  if (sim.tick % 5 !== 0) return;
  updateRepairStations(sim);
  for (const b of sim.buildings) {
    if (!b.repairing || b.dead) continue;
    const p = sim.players[b.owner];
    if (b.hp >= b.def.hp) {
      b.repairing = false;
      continue;
    }
    const heal = Math.min(Math.max(1, Math.ceil(b.def.hp / 100)), b.def.hp - b.hp);
    const cost = Math.max(1, Math.ceil((b.def.cost * heal) / b.def.hp / 2));
    if (p.credits < cost) continue;
    p.credits -= cost;
    b.hp += heal;
  }
}
