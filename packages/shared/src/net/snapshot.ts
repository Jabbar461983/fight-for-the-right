import { FACTIONS, PRODUCTION_CATEGORIES, type Faction, type ProductionCategory } from '../data/rules';
import { tileOf } from '../math/fixed';
import type { SimEvent } from '../sim/events';
import type { Simulation } from '../sim/simulation';
import { STANCES, type Building, type PlayerStats, type Projectile, type Unit } from '../sim/unit';

/**
 * Momentaufnahmen für den Mehrspieler.
 *
 * Der Server rechnet die Simulation und schickt jedem Spieler regelmässig eine
 * Momentaufnahme – aber nur, was dieser Spieler sehen darf (Nebel = kein
 * Schummeln möglich) und nur, was sich seit der letzten Aufnahme geändert hat.
 * Der Client trägt die Aufnahmen in eine «Spiegel»-Simulation ein, die er wie
 * im Einzelspieler darstellt.
 *
 * Kompakte Tupel statt Objekte, weil das über das Netz geht.
 */

/** [id, Typ-Index, Besitzer, x, y, Richtung (0–255), Zielrichtung (0–255), HP, Flags, Ladung] */
export type UnitTuple = [number, number, number, number, number, number, number, number, number, number];
/** [id, Typ-Index, Fraktions-Index, Besitzer, tx, ty, HP, Zielrichtung, Flags] */
export type BuildingTuple = [number, number, number, number, number, number, number, number, number];
/** [id, Waffen-Index, x, y, Start-x, Start-y, Ziel-x, Ziel-y] */
export type ProjectileTuple = [number, number, number, number, number, number, number, number];
/** [id, Typ-Index, Fraktions-Index, Besitzer, tx, ty] */
export type GhostTuple = [number, number, number, number, number, number];
/** [id, ausgeschieden (0/1), …Statistik] */
export type PlayerTuple = [number, number, number, number, number, number, number, number];

export interface SelfState {
  cr: number;
  st: number;
  pp: number;
  pu: number;
  lp: number;
  rd: number;
  /** Bauschlangen: Kategorie → [[Typ, Fortschritt, Gesamt, pausiert]] */
  q: Partial<Record<ProductionCategory, [string, number, number, number][]>>;
  rdy: { building?: string; defense?: string };
}

export interface Snapshot {
  /** Tick der Simulation. */
  t: number;
  /** 1 = vollständige Aufnahme (nach Beitritt/Wiederverbinden). */
  full?: 1;
  u?: UnitTuple[];
  ur?: number[];
  b?: BuildingTuple[];
  br?: number[];
  p: ProjectileTuple[];
  me?: SelfState;
  pl?: PlayerTuple[];
  /** Sicht und Erkundet als Bit-Felder. */
  fv?: Uint8Array;
  fe?: Uint8Array;
  gh?: GhostTuple[];
  /** Geänderte Kristalle als flache Liste [Index, Menge, Index, Menge, …]. */
  cr?: number[];
  ev?: SimEvent[];
  go?: { winners: number[] };
}

const STAT_KEYS: (keyof PlayerStats)[] = ['unitsBuilt', 'unitsLost', 'buildingsBuilt', 'buildingsLost', 'kills', 'harvested'];

/** Winkel → Byte (0–255). Nur für die Darstellung, daher sind Kommazahlen hier unkritisch. */
function angleByte(x: number, y: number): number {
  if (x === 0 && y === 0) return 64; // nach unten
  return Math.round((Math.atan2(y, x) / (Math.PI * 2)) * 256) & 255;
}

function byteToDir(b: number): [number, number] {
  const a = (b / 256) * Math.PI * 2;
  return [Math.round(Math.cos(a) * 1024), Math.round(Math.sin(a) * 1024)];
}

export function packBits(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(src.length / 8));
  for (let i = 0; i < src.length; i++) if (src[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

export function unpackBits(src: Uint8Array, dst: Uint8Array): void {
  for (let i = 0; i < dst.length; i++) dst[i] = (src[i >> 3] >> (i & 7)) & 1;
}

function sameTuple(a: readonly number[] | undefined, b: readonly number[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Index-Tabellen, damit Typen als kleine Zahlen übertragen werden. */
export class NetIndex {
  readonly units: string[];
  readonly buildings: string[];
  readonly weapons: string[];
  constructor(sim: Simulation) {
    this.units = [...sim.rules.unitIds];
    this.buildings = [...sim.rules.buildingIds];
    this.weapons = [...sim.rules.weapons.keys()];
  }
}

/** Gehört dieses Ereignis zu dem, was der Spieler wissen darf? */
export function eventVisibleTo(sim: Simulation, player: number, e: SimEvent): boolean {
  const seen = (x: number, y: number) => sim.isVisible(player, tileOf(x), tileOf(y));
  switch (e.type) {
    case 'unitDied':
    case 'buildingDestroyed':
      return sim.isAlly(player, e.owner) || seen(e.x, e.y);
    case 'impact':
      return seen(e.x, e.y);
    case 'fired':
    case 'unitCreated':
    case 'buildingPlaced':
    case 'buildingSold':
      return false; // braucht der Client nicht
    case 'captured':
      return e.owner === player || e.previousOwner === player;
    case 'playerDefeated':
    case 'gameOver':
      return true;
    default:
      return 'owner' in e && e.owner === player;
  }
}

// ───────────────────────────── Server: Kodieren ─────────────────────────────

/** Merkt sich pro Spieler, was zuletzt geschickt wurde, und erzeugt Änderungs-Aufnahmen. */
export class SnapshotEncoder {
  private units = new Map<number, UnitTuple>();
  private buildings = new Map<number, BuildingTuple>();
  private fv: Uint8Array | null = null;
  private fe: Uint8Array | null = null;
  private ghostsKey = '';
  private selfKey = '';
  private playersKey = '';
  private crystals: Int32Array | null = null;
  private sentGameOver = false;

  constructor(
    private readonly sim: Simulation,
    readonly player: number,
    private readonly index: NetIndex,
  ) {}

  /** Beim Wiederverbinden: alles vergessen, nächste Aufnahme ist vollständig. */
  reset(): void {
    this.units.clear();
    this.buildings.clear();
    this.fv = this.fe = null;
    this.ghostsKey = this.selfKey = this.playersKey = '';
    this.crystals = null;
    this.sentGameOver = false;
  }

  encode(events: SimEvent[]): Snapshot {
    const sim = this.sim;
    const me = this.player;
    const full = this.crystals === null;
    const snap: Snapshot = { t: sim.tick, p: [] };
    if (full) snap.full = 1;

    // Einheiten: eigene/verbündete immer, gegnerische nur im Sichtbereich
    const u: UnitTuple[] = [];
    const seenUnits = new Set<number>();
    for (const x of sim.units) {
      if (x.dead) continue;
      if (!sim.canSee(me, x)) continue;
      seenUnits.add(x.id);
      const flags =
        (x.targetId !== 0 || x.task?.kind === 'attack' ? 1 : 0) |
        (x.order ? 2 : 0) |
        (STANCES.indexOf(x.stance) << 2) |
        (x.burrowed ? 16 : 0) |
        (x.ammo === 0 ? 32 : 0);
      const ally = sim.isAlly(me, x.owner);
      const tuple: UnitTuple = [
        x.id,
        this.index.units.indexOf(x.def.id),
        x.owner,
        x.x,
        x.y,
        angleByte(x.dirX, x.dirY),
        angleByte(x.aimX, x.aimY),
        x.hp,
        flags,
        // Ladung: Sammler-Glimmerit bzw. Anzahl Mitfahrer (nur für Verbündete)
        ally ? (x.def.transport ? x.passengers.length : x.cargo) : 0,
      ];
      if (!sameTuple(this.units.get(x.id), tuple)) {
        u.push(tuple);
        this.units.set(x.id, tuple);
      }
    }
    const ur: number[] = [];
    for (const id of this.units.keys()) {
      if (!seenUnits.has(id)) {
        ur.push(id);
        this.units.delete(id);
      }
    }
    if (u.length) snap.u = u;
    if (ur.length) snap.ur = ur;

    // Gebäude: eigene/verbündete und gerade gesehene (Rest kennt der Spieler als «Geist»)
    const b: BuildingTuple[] = [];
    const seenB = new Set<number>();
    for (const x of sim.buildings) {
      if (x.dead || !sim.canSee(me, x)) continue;
      seenB.add(x.id);
      const tuple: BuildingTuple = [
        x.id,
        this.index.buildings.indexOf(x.def.id),
        FACTIONS.indexOf(x.def.forFaction),
        x.owner,
        x.tx,
        x.ty,
        x.hp,
        angleByte(x.aimX, x.aimY),
        (x.repairing ? 1 : 0) | (x.targetId ? 2 : 0) | (x.passengers.length << 2),
      ];
      if (!sameTuple(this.buildings.get(x.id), tuple)) {
        b.push(tuple);
        this.buildings.set(x.id, tuple);
      }
    }
    const br: number[] = [];
    for (const id of this.buildings.keys()) {
      if (!seenB.has(id)) {
        br.push(id);
        this.buildings.delete(id);
      }
    }
    if (b.length) snap.b = b;
    if (br.length) snap.br = br;

    // Geschosse (kurzlebig – immer alle sichtbaren)
    for (const pr of sim.projectiles) {
      if (pr.dead || !sim.isVisible(me, tileOf(pr.x), tileOf(pr.y))) continue;
      snap.p.push([pr.id, this.index.weapons.indexOf(pr.weapon.id), pr.x, pr.y, pr.startX, pr.startY, pr.tx, pr.ty]);
    }

    // Eigener Spielerzustand
    const p = sim.players[me];
    const self: SelfState = {
      cr: p.credits,
      st: p.storage,
      pp: p.powerProduced,
      pu: p.powerUsed,
      lp: p.lowPower ? 1 : 0,
      rd: p.hasRadar ? 1 : 0,
      q: {},
      rdy: { ...p.ready },
    };
    for (const c of PRODUCTION_CATEGORIES) {
      if (p.queues[c].length) self.q[c] = p.queues[c].map((q) => [q.defId, q.done, q.total, q.paused ? 1 : 0]);
    }
    const selfKey = JSON.stringify(self);
    if (selfKey !== this.selfKey) {
      snap.me = self;
      this.selfKey = selfKey;
    }

    // Alle Spieler: ausgeschieden + Statistik
    const pl: PlayerTuple[] = sim.playerList.map(
      (x) => [x.id, x.defeated ? 1 : 0, ...STAT_KEYS.map((k) => x.stats[k])] as PlayerTuple,
    );
    const plKey = JSON.stringify(pl);
    if (plKey !== this.playersKey) {
      snap.pl = pl;
      this.playersKey = plKey;
    }

    // Nebel
    const fv = packBits(p.visible);
    if (!sameBytes(this.fv, fv)) {
      snap.fv = fv;
      this.fv = fv;
    }
    const fe = packBits(p.explored);
    if (!sameBytes(this.fe, fe)) {
      snap.fe = fe;
      this.fe = fe;
    }
    const gh: GhostTuple[] = [...p.ghosts.values()].map((g) => [
      g.id,
      this.index.buildings.indexOf(g.defId),
      FACTIONS.indexOf(g.faction),
      g.owner,
      g.tx,
      g.ty,
    ]);
    const ghKey = JSON.stringify(gh);
    if (ghKey !== this.ghostsKey) {
      snap.gh = gh;
      this.ghostsKey = ghKey;
    }

    // Kristalle: nur Änderungen
    const crystal = sim.economy.crystal;
    if (!this.crystals) this.crystals = new Int32Array(crystal.length).fill(-1);
    const cr: number[] = [];
    for (let i = 0; i < crystal.length; i++) {
      if (crystal[i] !== this.crystals[i]) {
        if (crystal[i] > 0 || this.crystals[i] > 0) cr.push(i, crystal[i]);
        this.crystals[i] = crystal[i];
      }
    }
    if (cr.length) snap.cr = cr;

    const ev = events.filter((e) => eventVisibleTo(sim, me, e));
    if (ev.length) snap.ev = ev;
    if (sim.gameOver && !this.sentGameOver) {
      snap.go = sim.gameOver;
      this.sentGameOver = true;
    }
    return snap;
  }
}

// ───────────────────────────── Client: Anwenden ─────────────────────────────

/**
 * Trägt eine Momentaufnahme in die Spiegel-Simulation ein.
 * Alle Einheiten bekommen prevX/prevY = bisherige Position, damit der Client
 * flüssig zur neuen Position interpolieren kann.
 */
export function applySnapshot(sim: Simulation, snap: Snapshot, index: NetIndex, player: number): void {
  const rules = sim.rules;
  const factionOf = (owner: number): Faction => sim.players[owner]?.faction ?? 'aero';

  if (snap.full) {
    for (const u of [...sim.units]) sim.mirrorRemoveUnit(u.id);
    for (const b of [...sim.buildings]) sim.mirrorRemoveBuilding(b.id);
  }
  for (const u of sim.units) {
    u.prevX = u.x;
    u.prevY = u.y;
  }

  for (const id of snap.ur ?? []) sim.mirrorRemoveUnit(id);
  for (const t of snap.u ?? []) {
    const [id, defIdx, owner, x, y, dirB, aimB, hp, flags, cargo] = t;
    const def = rules.unit(factionOf(owner), index.units[defIdx]);
    if (!def) continue;
    const [dirX, dirY] = byteToDir(dirB);
    const [aimX, aimY] = byteToDir(aimB);
    const existing = sim.getUnit(id);
    if (existing && existing.def === def) {
      existing.x = x;
      existing.y = y;
      existing.dirX = dirX;
      existing.dirY = dirY;
      existing.aimX = aimX;
      existing.aimY = aimY;
      existing.hp = hp;
      existing.targetId = flags & 1 ? -1 : 0;
      existing.stance = STANCES[(flags >> 2) & 3] ?? 'aggressive';
      existing.burrowed = (flags & 16) !== 0;
      existing.ammo = flags & 32 ? 0 : -1;
      existing.cargo = def.transport ? 0 : cargo;
      existing.passengers = def.transport ? new Array(cargo).fill(0) : [];
      existing.owner = owner;
      continue;
    }
    const unit: Unit = {
      id,
      owner,
      def,
      x,
      y,
      prevX: x,
      prevY: y,
      dirX,
      dirY,
      aimX,
      aimY,
      hp,
      order: null,
      task: null,
      stance: STANCES[(flags >> 2) & 3] ?? 'aggressive',
      cooldown: 0,
      targetId: flags & 1 ? -1 : 0,
      cargo: def.transport ? 0 : cargo,
      passengers: def.transport ? new Array(cargo).fill(0) : [],
      ammo: flags & 32 ? 0 : -1,
      burrowed: (flags & 16) !== 0,
      dead: false,
    };
    sim.mirrorPutUnit(unit);
  }

  for (const id of snap.br ?? []) sim.mirrorRemoveBuilding(id);
  for (const t of snap.b ?? []) {
    const [id, defIdx, factionIdx, owner, tx, ty, hp, aimB, flags] = t;
    const def = rules.building(FACTIONS[factionIdx] ?? 'aero', index.buildings[defIdx]);
    if (!def) continue;
    const [aimX, aimY] = byteToDir(aimB);
    const existing = sim.getBuilding(id);
    if (existing) {
      existing.owner = owner;
      existing.hp = hp;
      existing.aimX = aimX;
      existing.aimY = aimY;
      existing.repairing = (flags & 1) !== 0;
      existing.targetId = flags & 2 ? -1 : 0;
      existing.passengers = new Array(flags >> 2).fill(0);
      continue;
    }
    const b: Building = {
      id,
      owner,
      def,
      tx,
      ty,
      x: tx * 1024 + (def.width * 1024) / 2,
      y: ty * 1024 + (def.height * 1024) / 2,
      hp,
      cooldown: 0,
      targetId: flags & 2 ? -1 : 0,
      aimX,
      aimY,
      repairing: (flags & 1) !== 0,
      dockedBy: 0,
      passengers: new Array(flags >> 2).fill(0),
      dead: false,
    };
    sim.mirrorPutBuilding(b);
  }

  // Geschosse: vorherige Position übernehmen, damit sie flüssig fliegen
  const prev = new Map(sim.projectiles.map((p) => [p.id, p]));
  sim.projectiles = snap.p.map(([id, wIdx, x, y, sx, sy, tx, ty]): Projectile => {
    const old = prev.get(id);
    return {
      id,
      owner: 0,
      weapon: rules.weapons.get(index.weapons[wIdx])!,
      x,
      y,
      prevX: old?.x ?? sx,
      prevY: old?.y ?? sy,
      startX: sx,
      startY: sy,
      targetId: 0,
      tx,
      ty,
      dead: false,
    };
  });

  const p = sim.players[player];
  if (snap.me) {
    const m = snap.me;
    p.credits = m.cr;
    p.storage = m.st;
    p.powerProduced = m.pp;
    p.powerUsed = m.pu;
    p.lowPower = m.lp === 1;
    p.hasRadar = m.rd === 1;
    for (const c of PRODUCTION_CATEGORIES) {
      p.queues[c] = (m.q[c] ?? []).map(([defId, done, total, paused]) => ({
        defId,
        kind: c === 'building' || c === 'defense' ? 'building' : 'unit',
        done,
        total,
        spent: 0,
        cost: 0,
        paused: paused === 1,
      }));
    }
    p.ready = { ...m.rdy };
  }
  for (const t of snap.pl ?? []) {
    const q = sim.players[t[0]];
    if (!q) continue;
    q.defeated = t[1] === 1;
    STAT_KEYS.forEach((k, i) => (q.stats[k] = t[2 + i]));
  }
  if (snap.fv) unpackBits(snap.fv, p.visible);
  if (snap.fe) unpackBits(snap.fe, p.explored);
  if (snap.gh) {
    p.ghosts = new Map(
      snap.gh.map(([id, defIdx, fIdx, owner, tx, ty]) => [
        id,
        { id, defId: index.buildings[defIdx], faction: FACTIONS[fIdx] ?? 'aero', owner, tx, ty },
      ]),
    );
  }
  if (snap.cr) {
    const c = sim.economy.crystal;
    for (let i = 0; i < snap.cr.length; i += 2) c[snap.cr[i]] = snap.cr[i + 1];
  }
  for (const e of snap.ev ?? []) sim.emit(e);
  if (snap.go) sim.gameOver = snap.go;
  sim.tick = snap.t;
}
