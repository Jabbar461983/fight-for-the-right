import { PRODUCTION_CATEGORIES, type BuildingDef, type Faction, type ProductionCategory, type Rules } from '../data/rules';
import type { GameMap } from '../map/gameMap';
import { MoveClass } from '../map/terrain';
import { TILE, isqrt, tileCenter, tileOf } from '../math/fixed';
import { parseCommand, type Command } from './commands';
import { updateCombat, updateProjectiles } from './combat';
import { Economy } from './economy';
import type { SimEvent } from './events';
import { updateFog } from './fog';
import { collectSlots } from './formation';
import { Movement } from './movement';
import { canPlace, recomputePower, updateProduction, updateRepairs, handleQueueCommand, placeBuilding } from './production';
import { SpatialHash } from './spatialHash';
import { updateTasks } from './tasks';
import type { Building, Player, Projectile, Unit } from './unit';

/** Einstellungen eines Spielers beim Start. */
export interface PlayerSetup {
  id: number;
  faction: Faction;
  team: number;
  color: number;
  name: string;
}

export interface SimulationOptions {
  map: GameMap;
  rules: Rules;
  players: PlayerSetup[];
  startCredits?: number;
  /**
   * 'standard': Wer keine Gebäude und keinen Bauwagen mehr hat, verliert.
   * 'none': keine automatische Niederlage (Tests, Kampagnen-Missionen mit eigenen Zielen).
   */
  victory?: 'standard' | 'none';
}

/** Etwas, das jeden Tick mitrechnen darf (z.B. eine KI). Muss deterministisch sein. */
export interface TickListener {
  update(sim: Simulation): void;
}

/** Nach so vielen Ticks ohne Kampf darf «Basis wird angegriffen» erneut gemeldet werden. */
const ATTACK_NOTIFY_TICKS = 15 * 20;

/**
 * Die Spielsimulation. Reine Logik ohne Grafik: läuft im Browser (Einzelspieler)
 * und später auf dem Server (Mehrspieler). Jeder Aufruf von step() rechnet
 * genau einen Tick. Gleiche Befehle → gleiches Ergebnis auf jedem Gerät.
 */
export class Simulation {
  readonly map: GameMap;
  readonly rules: Rules;
  tick = 0;
  /** Spieler, Index = Spieler-id (Index 0 bleibt leer). */
  readonly players: Player[] = [];
  /** Alle Einheiten, aufsteigend nach id sortiert. */
  units: Unit[] = [];
  buildings: Building[] = [];
  projectiles: Projectile[] = [];
  readonly economy: Economy;
  readonly movement: Movement;
  /** Räumliches Raster der Einheiten (Index ins units-Array), jeden Tick neu. */
  readonly hash: SpatialHash;
  gameOver: { winners: number[] } | null = null;
  readonly listeners: TickListener[] = [];
  readonly victoryMode: 'standard' | 'none';

  private unitById = new Map<number, Unit>();
  private buildingById = new Map<number, Building>();
  private nextId = 1;
  private pending: { player: number; cmd: Command }[] = [];
  private eventQueue: SimEvent[] = [];

  constructor(opts: SimulationOptions) {
    this.map = opts.map;
    this.rules = opts.rules;
    this.victoryMode = opts.victory ?? 'standard';
    this.movement = new Movement(this.map);
    this.economy = new Economy(this);
    this.hash = new SpatialHash(this.map.worldWidth, this.map.worldHeight, 2 * TILE);
    const n = this.map.width * this.map.height;
    for (const p of opts.players) {
      if (p.id <= 0 || this.players[p.id]) throw new Error(`Ungültige Spieler-id ${p.id}`);
      this.players[p.id] = {
        id: p.id,
        faction: p.faction,
        team: p.team,
        color: p.color,
        name: p.name,
        credits: opts.startCredits ?? 0,
        storage: 0,
        powerProduced: 0,
        powerUsed: 0,
        lowPower: false,
        hasRadar: false,
        defeated: false,
        queues: Object.fromEntries(PRODUCTION_CATEGORIES.map((c) => [c, []])) as unknown as Player['queues'],
        ready: {},
        stats: { unitsBuilt: 0, unitsLost: 0, buildingsBuilt: 0, buildingsLost: 0, kills: 0, harvested: 0 },
        visible: new Uint8Array(n),
        explored: new Uint8Array(n),
        ghosts: new Map(),
        notifyTicks: {},
      };
    }
  }

  /** Alle Spieler als Liste (ohne Lücken). */
  get playerList(): Player[] {
    return this.players.filter((p): p is Player => !!p);
  }

  getUnit(id: number): Unit | undefined {
    return this.unitById.get(id);
  }

  getBuilding(id: number): Building | undefined {
    return this.buildingById.get(id);
  }

  /** Lebende Einheit oder lebendes Gebäude mit dieser id. */
  getTarget(id: number): Unit | Building | undefined {
    const u = this.unitById.get(id);
    if (u && !u.dead) return u;
    const b = this.buildingById.get(id);
    return b && !b.dead ? b : undefined;
  }

  // ───────────────────────────── Beziehungen ─────────────────────────────

  isAlly(a: number, b: number): boolean {
    if (a === b) return true;
    const pa = this.players[a];
    const pb = this.players[b];
    return !!pa && !!pb && pa.team !== 0 && pa.team === pb.team;
  }

  isEnemy(a: number, b: number): boolean {
    return a !== 0 && b !== 0 && !this.isAlly(a, b);
  }

  /** Ist die Kachel für diesen Spieler gerade sichtbar? */
  isVisible(player: number, tx: number, ty: number): boolean {
    const p = this.players[player];
    if (!p || !this.map.inBounds(tx, ty)) return false;
    return p.visible[ty * this.map.width + tx] !== 0;
  }

  /** Sieht der Spieler dieses Ziel (Einheit: ihre Kachel, Gebäude: irgendeine Kachel)? */
  canSee(player: number, t: Unit | Building): boolean {
    if (this.isAlly(player, t.owner)) return true;
    if ('tx' in t) {
      for (let y = t.ty; y < t.ty + t.def.height; y++) {
        for (let x = t.tx; x < t.tx + t.def.width; x++) if (this.isVisible(player, x, y)) return true;
      }
      return false;
    }
    return this.isVisible(player, tileOf(t.x), tileOf(t.y));
  }

  // ───────────────────────────── Ereignisse ─────────────────────────────

  emit(e: SimEvent): void {
    this.eventQueue.push(e);
  }

  /** Holt alle Ereignisse seit dem letzten Aufruf (für Client/Server). */
  drainEvents(): SimEvent[] {
    const out = this.eventQueue;
    this.eventQueue = [];
    return out;
  }

  /** Meldung höchstens alle `interval` Ticks pro Spieler und Art. */
  notify(player: number, key: string, interval: number, e: SimEvent): void {
    const p = this.players[player];
    if (!p) return;
    const last = p.notifyTicks[key] ?? -Infinity;
    if (this.tick - last < interval) return;
    p.notifyTicks[key] = this.tick;
    this.emit(e);
  }

  // ───────────────────────────── Erzeugen & Entfernen ─────────────────────────────

  spawnUnit(type: string, owner: number, x: number, y: number): Unit {
    const p = this.players[owner];
    if (!p) throw new Error(`Unbekannter Spieler ${owner}`);
    const def = this.rules.unit(p.faction, type);
    if (!def) throw new Error(`Unbekannter Einheitentyp "${type}"`);
    const unit: Unit = {
      id: this.nextId++,
      owner,
      def,
      x,
      y,
      prevX: x,
      prevY: y,
      dirX: 0,
      dirY: TILE,
      aimX: 0,
      aimY: TILE,
      hp: def.hp,
      order: null,
      task: null,
      stance: 'aggressive',
      cooldown: 0,
      targetId: 0,
      cargo: 0,
      dead: false,
    };
    this.units.push(unit);
    this.unitById.set(unit.id, unit);
    if (def.harvestCapacity) unit.task = { kind: 'harvest', phase: 'seek', fieldIdx: -1, refineryId: 0, timer: 0 };
    this.emit({ type: 'unitCreated', id: unit.id, owner, defId: def.id });
    return unit;
  }

  /** Stellt mehrere Einheiten als Traube um eine Kachel auf. */
  spawnFormation(entries: { type: string; count: number }[], owner: number, tx: number, ty: number): Unit[] {
    const total = entries.reduce((s, e) => s + e.count, 0);
    const start = this.map.nearestPassable(tx, ty, MoveClass.Vehicle) ?? { tx, ty };
    const slots = collectSlots(this.map, MoveClass.Vehicle, start, total);
    const out: Unit[] = [];
    let s = 0;
    for (const e of entries) {
      for (let i = 0; i < e.count; i++, s++) {
        const slot = slots[s] ?? start;
        out.push(this.spawnUnit(e.type, owner, tileCenter(slot.tx), tileCenter(slot.ty)));
      }
    }
    return out;
  }

  /** Erstellt ein Gebäude ohne Prüfungen (z.B. für Startbasen und Tests). */
  addBuilding(def: BuildingDef, owner: number, tx: number, ty: number): Building {
    const b: Building = {
      id: this.nextId++,
      owner,
      def,
      tx,
      ty,
      x: tx * TILE + (def.width * TILE) / 2,
      y: ty * TILE + (def.height * TILE) / 2,
      hp: def.hp,
      cooldown: 0,
      targetId: 0,
      aimX: 0,
      aimY: TILE,
      repairing: false,
      dockedBy: 0,
      dead: false,
    };
    this.buildings.push(b);
    this.buildingById.set(b.id, b);
    this.map.setBlocked(tx, ty, def.width, def.height, 1);
    recomputePower(this);
    this.emit({ type: 'buildingPlaced', id: b.id, owner, defId: def.id });
    return b;
  }

  /** Wechselt den Besitzer eines Gebäudes (Ingenieur). */
  captureBuilding(b: Building, newOwner: number): void {
    const prev = b.owner;
    b.owner = newOwner;
    b.targetId = 0;
    b.repairing = false;
    this.emit({ type: 'captured', id: b.id, owner: newOwner, previousOwner: prev });
    recomputePower(this);
  }

  /** Fügt Schaden zu. `attacker` = Spieler, der getroffen hat (für Statistik). */
  damage(t: Unit | Building, amount: number, attacker: number): void {
    if (t.dead) return;
    t.hp -= Math.max(1, amount);
    const isBuilding = 'tx' in t;
    if (this.isEnemy(attacker, t.owner)) {
      this.notify(t.owner, 'underAttack', ATTACK_NOTIFY_TICKS, { type: 'underAttack', owner: t.owner, x: t.x, y: t.y });
    }
    if (t.hp > 0) return;
    t.hp = 0;
    t.dead = true;
    const victim = this.players[t.owner];
    const killer = this.players[attacker];
    if (killer && attacker !== t.owner) killer.stats.kills++;
    if (isBuilding) {
      if (victim) victim.stats.buildingsLost++;
      this.removeBuilding(t as Building, false);
    } else {
      if (victim) victim.stats.unitsLost++;
      this.killUnit(t as Unit);
    }
  }

  /** Entfernt eine Einheit (mit Ereignis für die Comic-Wolke). */
  killUnit(u: Unit): void {
    u.dead = true;
    u.order = null;
    u.task = null;
    for (const b of this.buildings) if (b.dockedBy === u.id) b.dockedBy = 0;
    this.emit({ type: 'unitDied', id: u.id, owner: u.owner, defId: u.def.id, x: u.x, y: u.y, category: u.def.category });
  }

  /** Entfernt eine Einheit still (z.B. Ingenieur betritt Gebäude, Bauwagen fährt aus). */
  removeUnitSilently(u: Unit): void {
    u.dead = true;
    u.order = null;
    u.task = null;
  }

  removeBuilding(b: Building, sold: boolean): void {
    b.dead = true;
    this.map.setBlocked(b.tx, b.ty, b.def.width, b.def.height, 0);
    if (sold) this.emit({ type: 'buildingSold', id: b.id, owner: b.owner });
    else
      this.emit({
        type: 'buildingDestroyed',
        id: b.id,
        owner: b.owner,
        defId: b.def.id,
        x: b.x,
        y: b.y,
        w: b.def.width,
        h: b.def.height,
      });
    recomputePower(this);
  }

  /** Tote Einheiten/Gebäude/Geschosse aus den Listen räumen. */
  private cleanup(): void {
    if (this.units.some((u) => u.dead)) {
      for (const u of this.units) if (u.dead) this.unitById.delete(u.id);
      this.units = this.units.filter((u) => !u.dead);
    }
    if (this.buildings.some((b) => b.dead)) {
      for (const b of this.buildings) if (b.dead) this.buildingById.delete(b.id);
      this.buildings = this.buildings.filter((b) => !b.dead);
    }
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  newId(): number {
    return this.nextId++;
  }

  rebuildHash(): void {
    this.hash.rebuild(this.units.length, (i) => this.units[i].x, (i) => this.units[i].y);
  }

  // ───────────────────────────── Befehle ─────────────────────────────

  /**
   * Nimmt einen Befehl eines Spielers entgegen. Er wird zu Beginn des nächsten
   * Ticks ausgeführt. Ungültige Befehle (falsche Form, fremde Einheiten) werden
   * abgelehnt – so kann im Mehrspieler niemand schummeln.
   */
  issue(player: number, raw: unknown): boolean {
    const p = this.players[player];
    if (!p || p.defeated) return false;
    const cmd = parseCommand(raw);
    if (!cmd) return false;
    if ('units' in cmd) {
      for (const id of cmd.units) {
        const u = this.unitById.get(id);
        if (!u || u.dead || u.owner !== player) return false;
      }
    }
    if (cmd.type === 'sell' || cmd.type === 'repair') {
      const b = this.buildingById.get(cmd.building);
      if (!b || b.dead || b.owner !== player) return false;
    }
    if ((cmd.type === 'attack' || cmd.type === 'enter' || cmd.type === 'dock') && !this.getTarget(cmd.target)) return false;
    this.pending.push({ player, cmd });
    return true;
  }

  private ownUnits(player: number, ids: number[]): Unit[] {
    const seen = new Set<number>();
    const out: Unit[] = [];
    for (const id of ids) {
      const u = this.unitById.get(id);
      if (u && !u.dead && u.owner === player && !seen.has(id)) {
        seen.add(id);
        out.push(u);
      }
    }
    return out.sort((a, b) => a.id - b.id);
  }

  private applyCommand(player: number, cmd: Command): void {
    const p = this.players[player];
    if (!p || p.defeated) return;
    switch (cmd.type) {
      case 'move': {
        const units = this.ownUnits(player, cmd.units);
        for (const u of units) {
          u.task = null;
          u.targetId = 0;
        }
        this.movement.moveGroup(units, cmd.x, cmd.y);
        break;
      }
      case 'attackMove': {
        const units = this.ownUnits(player, cmd.units);
        for (const u of units) {
          u.task = u.def.weapon ? { kind: 'attackMove', x: cmd.x, y: cmd.y } : null;
          u.targetId = 0;
        }
        this.movement.moveGroup(units, cmd.x, cmd.y);
        break;
      }
      case 'attack': {
        const target = this.getTarget(cmd.target);
        if (!target) break;
        for (const u of this.ownUnits(player, cmd.units)) {
          if (!u.def.weapon) continue;
          if (target.owner === player) continue;
          u.task = { kind: 'attack', targetId: target.id, forced: true, nextRepath: 0, guardX: u.x, guardY: u.y };
        }
        break;
      }
      case 'stop':
        for (const u of this.ownUnits(player, cmd.units)) {
          u.order = null;
          u.task = null;
          u.targetId = 0;
        }
        break;
      case 'stance':
        for (const u of this.ownUnits(player, cmd.units)) u.stance = cmd.stance;
        break;
      case 'harvest':
        for (const u of this.ownUnits(player, cmd.units)) {
          if (!u.def.harvestCapacity) continue;
          const idx = this.map.inBounds(cmd.tx, cmd.ty) ? this.map.index(cmd.tx, cmd.ty) : -1;
          u.task = { kind: 'harvest', phase: 'toField', fieldIdx: idx, refineryId: 0, timer: 0 };
          u.order = null;
        }
        break;
      case 'dock': {
        const b = this.buildingById.get(cmd.target);
        if (!b || b.owner !== player || !b.def.refinery) break;
        for (const u of this.ownUnits(player, cmd.units)) {
          if (!u.def.harvestCapacity) continue;
          u.task = { kind: 'harvest', phase: 'toRefinery', fieldIdx: -1, refineryId: b.id, timer: 0 };
          u.order = null;
        }
        break;
      }
      case 'enter': {
        const b = this.buildingById.get(cmd.target);
        if (!b) break;
        for (const u of this.ownUnits(player, cmd.units)) {
          if (!u.def.engineer) continue;
          u.task = { kind: 'enter', targetId: b.id, nextRepath: 0 };
          u.order = null;
        }
        break;
      }
      case 'deploy':
        for (const u of this.ownUnits(player, cmd.units)) {
          if (u.def.deploysTo) {
            u.task = { kind: 'deploy', tries: 0 };
            u.order = null;
          }
        }
        break;
      case 'queue':
        handleQueueCommand(this, p, cmd.category as ProductionCategory, cmd.item, cmd.action);
        break;
      case 'place': {
        const defId = p.ready[cmd.category];
        if (!defId) break;
        const def = this.rules.building(p.faction, defId);
        if (!def || !canPlace(this, player, def, cmd.tx, cmd.ty).ok) break;
        p.ready[cmd.category] = undefined;
        placeBuilding(this, player, def, cmd.tx, cmd.ty);
        break;
      }
      case 'sell': {
        const b = this.buildingById.get(cmd.building);
        if (!b || b.dead || b.owner !== player) break;
        p.credits += Math.floor((b.def.cost * b.hp) / b.def.hp / 2);
        this.removeBuilding(b, true);
        break;
      }
      case 'repair': {
        const b = this.buildingById.get(cmd.building);
        if (b && !b.dead && b.owner === player) b.repairing = !b.repairing && b.hp < b.def.hp;
        break;
      }
      case 'surrender':
        this.defeat(p);
        break;
    }
  }

  // ───────────────────────────── Tick ─────────────────────────────

  /** Rechnet einen Simulationsschritt. */
  step(): void {
    this.tick++;
    const pending = this.pending;
    this.pending = [];
    for (const c of pending) this.applyCommand(c.player, c.cmd);
    this.cleanup();

    for (const u of this.units) {
      u.prevX = u.x;
      u.prevY = u.y;
    }
    for (const pr of this.projectiles) {
      pr.prevX = pr.x;
      pr.prevY = pr.y;
    }

    // Reihenfolge: Wirtschaft → Aufgaben → Kampf → Geschosse → Bewegung → Sicht
    updateProduction(this);
    updateRepairs(this);
    this.economy.update();
    this.rebuildHash();
    updateTasks(this);
    updateCombat(this);
    updateProjectiles(this);
    this.cleanup();
    this.rebuildHash();
    this.movement.step(this.units, this.hash);
    recomputePower(this);
    if (this.tick % 3 === 1) updateFog(this);
    if (this.tick % 15 === 0) this.checkVictory();
    for (const l of this.listeners) l.update(this);
    this.cleanup();
  }

  // ───────────────────────────── Sieg & Niederlage ─────────────────────────────

  /** Ein Spieler verliert, wenn er keine Gebäude (ausser Mauern) und keinen Bauwagen mehr hat. */
  private checkVictory(): void {
    if (this.gameOver || this.victoryMode === 'none') return;
    for (const p of this.playerList) {
      if (p.defeated) continue;
      const alive =
        this.buildings.some((b) => !b.dead && b.owner === p.id && !b.def.wall) ||
        this.units.some((u) => !u.dead && u.owner === p.id && !!u.def.deploysTo);
      if (!alive) this.defeat(p);
    }
    const teams = new Set(this.playerList.filter((p) => !p.defeated).map((p) => (p.team === 0 ? `solo${p.id}` : `team${p.team}`)));
    if (teams.size <= 1) {
      const winners = this.playerList.filter((p) => !p.defeated).map((p) => p.id);
      this.gameOver = { winners };
      this.emit({ type: 'gameOver', winners });
    }
  }

  /** Spieler scheidet aus: alles, was ihm gehört, verschwindet in Comic-Wolken. */
  defeat(p: Player): void {
    if (p.defeated) return;
    p.defeated = true;
    for (const u of this.units) if (!u.dead && u.owner === p.id) this.killUnit(u);
    for (const b of this.buildings) if (!b.dead && b.owner === p.id) this.removeBuilding(b, false);
    for (const c of PRODUCTION_CATEGORIES) p.queues[c] = [];
    p.ready = {};
    this.emit({ type: 'playerDefeated', owner: p.id });
    if (this.tick % 15 !== 0) this.checkVictory();
  }

  // ───────────────────────────── Netzwerk-Spiegel ─────────────────────────────
  // Im Mehrspieler rechnet der Server. Der Client hält eine «Spiegel»-Simulation,
  // die nie step() aufruft, sondern mit diesen Methoden aus Momentaufnahmen befüllt wird.

  /** Fügt eine Einheit ein (oder ersetzt sie) – ohne Ereignisse. */
  mirrorPutUnit(u: Unit): void {
    const old = this.unitById.get(u.id);
    this.unitById.set(u.id, u);
    if (old) {
      const i = this.units.indexOf(old);
      if (i >= 0) this.units[i] = u;
      return;
    }
    // Sortiert einfügen
    let i = this.units.length;
    while (i > 0 && this.units[i - 1].id > u.id) i--;
    this.units.splice(i, 0, u);
  }

  mirrorRemoveUnit(id: number): void {
    const u = this.unitById.get(id);
    if (!u) return;
    this.unitById.delete(id);
    this.units = this.units.filter((x) => x !== u);
  }

  /** Fügt ein Gebäude ein (blockiert die Karte) – ohne Ereignisse. */
  mirrorPutBuilding(b: Building): void {
    const old = this.buildingById.get(b.id);
    if (old) {
      Object.assign(old, b);
      return;
    }
    this.buildingById.set(b.id, b);
    let i = this.buildings.length;
    while (i > 0 && this.buildings[i - 1].id > b.id) i--;
    this.buildings.splice(i, 0, b);
    this.map.setBlocked(b.tx, b.ty, b.def.width, b.def.height, 1);
  }

  mirrorRemoveBuilding(id: number): void {
    const b = this.buildingById.get(id);
    if (!b) return;
    this.buildingById.delete(id);
    this.buildings = this.buildings.filter((x) => x !== b);
    this.map.setBlocked(b.tx, b.ty, b.def.width, b.def.height, 0);
  }

  // ───────────────────────────── Hilfen ─────────────────────────────

  /** Abstand (Welteinheiten) vom Punkt zum Ziel: bei Gebäuden zum nächsten Punkt der Fläche. */
  distanceTo(x: number, y: number, t: Unit | Building): number {
    if ('tx' in t) {
      const x0 = t.tx * TILE;
      const y0 = t.ty * TILE;
      const x1 = x0 + t.def.width * TILE;
      const y1 = y0 + t.def.height * TILE;
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      return isqrt(dx * dx + dy * dy);
    }
    const dx = t.x - x;
    const dy = t.y - y;
    return Math.max(0, isqrt(dx * dx + dy * dy) - t.def.radiusUnits);
  }

  /** Prüfsumme des Spielzustands – gleich auf allen Geräten, wenn alles synchron ist. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h ^= v & 0xffff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xffff;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.tick);
    for (const u of this.units) {
      mix(u.id);
      mix(u.x);
      mix(u.y);
      mix(u.hp);
      mix(u.order ? 1 : 0);
    }
    for (const b of this.buildings) {
      mix(b.id);
      mix(b.hp);
      mix(b.owner);
    }
    for (const p of this.playerList) mix(p.credits);
    return h >>> 0;
  }
}
