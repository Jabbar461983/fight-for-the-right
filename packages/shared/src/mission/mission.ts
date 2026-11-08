import { z } from 'zod';
import { AI_LEVELS, FACTIONS, type AiLevel, type Rules } from '../data/rules';
import type { GameMap } from '../map/gameMap';
import { MoveClass } from '../map/terrain';
import { TICK_RATE, TILE, tileOf } from '../math/fixed';
import { SkirmishAi } from '../ai/skirmishAi';
import { canPlace, placeBuilding } from '../sim/production';
import { Simulation, type TickListener } from '../sim/simulation';
import { STANCES, type Building, type Unit } from '../sim/unit';

/**
 * Kampagnen-Missionen: Eine Mission ist eine JSON-Datei (data/missions/*.json) mit
 * Startaufstellung, Zielen und Ereignissen. Ereignis = Auslöser (alle müssen zutreffen)
 * + Aktionen. Beispiel: «wenn Einheit Gebiet X erreicht» → «Nachricht, Verstärkung, Sieg».
 *
 * Alles läuft deterministisch im Spielkern (Ticks, keine Uhrzeit), damit Missionen
 * genauso testbar sind wie der Rest der Simulation.
 */

// ───────────── Schema ─────────────

/** Zahl, optional je Schwierigkeitsgrad verschieden. */
const Num = z.union([z.number(), z.object({ easy: z.number(), medium: z.number(), hard: z.number() })]);
type Num = z.infer<typeof Num>;

/** Rechteck in Kacheln: [x, y, Breite, Höhe]. */
const Area = z.tuple([z.number().int(), z.number().int(), z.number().int().positive(), z.number().int().positive()]);
const Owner = z.number().int().min(1).max(4);
const Difficulty = z.array(z.enum(AI_LEVELS)).optional();

const Trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  /** Einmalig nach … Sekunden. */
  z.object({ type: z.literal('time'), seconds: Num }),
  /** Wiederholt alle … Sekunden (zwischen from und until). */
  z.object({ type: z.literal('every'), seconds: Num, from: Num.optional(), until: Num.optional() }),
  /** Einheiten (eines Spielers oder mit Markierung) im Gebiet. */
  z.object({
    type: z.literal('enterArea'),
    area: z.string(),
    owner: Owner.optional(),
    tag: z.string().optional(),
    count: z.number().int().positive().default(1),
  }),
  /** Alles mit dieser Markierung ist zerstört. */
  z.object({ type: z.literal('destroyed'), tag: z.string() }),
  /** Spieler besitzt mindestens `count` Gebäude dieses Typs. */
  z.object({ type: z.literal('built'), owner: Owner, building: z.string(), count: z.number().int().positive().default(1) }),
  /** Anzahl Kampfeinheiten eines Spielers. */
  z.object({ type: z.literal('army'), owner: Owner, atLeast: z.number().int().optional(), atMost: z.number().int().optional() }),
  /** Spieler hat keine Gebäude (ausser Mauern) und keinen Bauwagen mehr. */
  z.object({ type: z.literal('noBase'), owner: Owner }),
  z.object({ type: z.literal('objectivesDone'), ids: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('flag'), name: z.string() }),
]);
export type MissionTrigger = z.infer<typeof Trigger>;

const Stance = z.enum(STANCES);

const Action = z.discriminatedUnion('type', [
  /** Funkspruch als Sprechblase. */
  z.object({ type: z.literal('message'), key: z.string(), speaker: z.enum(['commander', 'enemy', 'researcher']).default('commander'), difficulty: Difficulty }),
  z.object({ type: z.literal('objective'), id: z.string(), key: z.string(), difficulty: Difficulty }),
  z.object({ type: z.literal('complete'), id: z.string(), difficulty: Difficulty }),
  z.object({ type: z.literal('fail'), id: z.string(), difficulty: Difficulty }),
  /** Einheiten im Gebiet erscheinen lassen; `growth` = so viele mehr bei jeder Wiederholung. */
  z.object({
    type: z.literal('spawn'),
    owner: Owner,
    unit: z.string(),
    count: Num.default(1),
    growth: Num.default(0),
    max: z.number().int().positive().default(40),
    at: z.string(),
    tag: z.string().optional(),
    stance: Stance.optional(),
    attackTo: z.string().optional(),
    moveTo: z.string().optional(),
    difficulty: Difficulty,
  }),
  /** Gebäude hinstellen (sucht den nächsten freien Platz um die Kachel). */
  z.object({ type: z.literal('building'), owner: Owner, building: z.string(), at: z.tuple([z.number().int(), z.number().int()]), tag: z.string().optional(), difficulty: Difficulty }),
  /** Mehrere Gebäude rund um einen Punkt (mit Abstand, ohne Kristalle). */
  z.object({
    type: z.literal('base'),
    owner: Owner,
    at: z.tuple([z.number().int(), z.number().int()]),
    buildings: z.array(z.string()),
    tag: z.string().optional(),
    difficulty: Difficulty,
  }),
  /** Alle (bzw. markierten) Kampfeinheiten eines Spielers greifen ein Gebiet an. */
  z.object({ type: z.literal('attack'), owner: Owner, tag: z.string().optional(), to: z.string(), difficulty: Difficulty }),
  /** Markierte Einheiten wechseln den Besitzer. */
  z.object({ type: z.literal('transfer'), tag: z.string(), owner: Owner, difficulty: Difficulty }),
  /** Gebiet für einen Spieler aufdecken. */
  z.object({ type: z.literal('reveal'), area: z.string(), owner: Owner.default(1), difficulty: Difficulty }),
  z.object({ type: z.literal('credits'), owner: Owner, amount: Num, difficulty: Difficulty }),
  z.object({ type: z.literal('flag'), name: z.string(), difficulty: Difficulty }),
  /** Computergegner einschalten (Stufe = Schwierigkeit der Mission, wenn nicht angegeben). */
  z.object({ type: z.literal('ai'), owner: Owner, level: z.enum(AI_LEVELS).optional(), difficulty: Difficulty }),
  /** Tutorial: Knopf pulsieren lassen («cmd:deploy», «tab:infantry», «build:powerPlant»; null = aus). */
  z.object({ type: z.literal('highlight'), target: z.string().regex(/^(cmd|tab|build):[a-zA-Z]+$/).nullable(), difficulty: Difficulty }),
  /** Sichtbarer Countdown (z.B. «Durchhalten: 14:59»). */
  z.object({ type: z.literal('countdown'), seconds: Num, key: z.string(), difficulty: Difficulty }),
  z.object({ type: z.literal('victory'), difficulty: Difficulty }),
  z.object({ type: z.literal('defeat'), key: z.string().optional(), difficulty: Difficulty }),
]);
export type MissionAction = z.infer<typeof Action>;

const Event = z.object({
  when: z.array(Trigger).min(1),
  do: z.array(Action).min(1),
  /** Aktionen erst … Sekunden, nachdem die Auslöser zugetroffen haben (nicht mit «every»). */
  delay: Num.optional(),
  difficulty: Difficulty,
});

export const MissionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+$/),
  faction: z.enum(FACTIONS),
  /** Reihenfolge innerhalb der Kampagne (1, 2, …). */
  order: z.number().int().positive(),
  map: z.string(),
  titleKey: z.string(),
  briefingKey: z.string(),
  /** Ziele, die das Briefing vorab nennt. */
  briefingGoals: z.array(z.string()).default([]),
  players: z
    .array(z.object({ id: Owner, faction: z.enum(FACTIONS), color: z.number().int().min(0).max(7), team: z.number().int().min(1), nameKey: z.string() }))
    .min(2),
  /** Startkapital des Spielers (id 1). */
  credits: Num,
  /** Gesperrte Einheiten/Gebäude für den Spieler («*» = alles, z.B. Kommando-Missionen ohne Basis). */
  locked: z.array(z.string()).default([]),
  areas: z.record(z.string(), Area).default({}),
  events: z.array(Event).min(1),
});
export type MissionDef = z.infer<typeof MissionSchema>;

/** Prüft eine Missionsdatei inkl. Querverweise (Gebiete, Typen). */
export function loadMission(json: unknown, rules: Rules): MissionDef {
  const r = MissionSchema.safeParse(json);
  if (!r.success) throw new Error(`Ungültige Mission: ${z.prettifyError(r.error)}`);
  const m = r.data;
  const areaOk = (name: string | undefined) => {
    if (name !== undefined && !m.areas[name]) throw new Error(`Mission ${m.id}: unbekanntes Gebiet «${name}».`);
  };
  const factionOf = (owner: number) => {
    const p = m.players.find((pl) => pl.id === owner);
    if (!p) throw new Error(`Mission ${m.id}: unbekannter Spieler ${owner}.`);
    return p.faction;
  };
  for (const e of m.events) {
    for (const t of e.when) if (t.type === 'enterArea') areaOk(t.area);
    for (const a of e.do) {
      if (a.type === 'spawn') {
        areaOk(a.at);
        areaOk(a.attackTo);
        areaOk(a.moveTo);
        if (!rules.unit(factionOf(a.owner), a.unit)) throw new Error(`Mission ${m.id}: unbekannte Einheit «${a.unit}».`);
      }
      if (a.type === 'attack') areaOk(a.to);
      if (a.type === 'reveal') areaOk(a.area);
      if (a.type === 'building' || a.type === 'base') {
        for (const id of a.type === 'building' ? [a.building] : a.buildings) {
          if (!rules.building(factionOf(a.owner), id)) throw new Error(`Mission ${m.id}: unbekanntes Gebäude «${id}».`);
        }
      }
    }
  }
  return m;
}

// ───────────── Ablauf ─────────────

export interface Objective {
  id: string;
  key: string;
  status: 'open' | 'done' | 'failed';
}

/** Wie oft Auslöser geprüft werden (Ticks). */
const CHECK_INTERVAL = 5;

/**
 * Führt eine Mission aus. Wird als TickListener an die Simulation gehängt
 * (nach der KI), prüft die Auslöser und führt Aktionen aus.
 */
export class Mission implements TickListener {
  readonly objectives: Objective[] = [];
  /** Countdown für die Anzeige: Ende in Ticks. */
  countdown: { endTick: number; key: string } | null = null;
  result: 'victory' | 'defeat' | null = null;
  /** Aktueller Tutorial-Hinweis (Knopf, der pulsiert). */
  highlight: string | null = null;
  private readonly tags = new Map<string, number[]>();
  private readonly flags = new Set<string>();
  /** Je Ereignis: schon ausgelöst bzw. nächster Zeitpunkt (für «every») und Anzahl Auslösungen. */
  private readonly state: { done: boolean; next: number; fired: number }[];

  constructor(
    readonly def: MissionDef,
    readonly difficulty: AiLevel,
    private readonly sim: Simulation,
  ) {
    this.state = def.events.map(() => ({ done: false, next: -1, fired: 0 }));
  }

  /** Wert für die gewählte Schwierigkeit. */
  num(v: Num): number {
    return typeof v === 'number' ? v : v[this.difficulty];
  }

  private ticks(seconds: Num): number {
    return Math.round(this.num(seconds) * TICK_RATE);
  }

  private active(d: AiLevel[] | undefined): boolean {
    return !d || d.includes(this.difficulty);
  }

  /** Start-Ereignisse sofort ausführen (vor dem ersten Tick, damit alles schon zu sehen ist). */
  start(): void {
    this.def.events.forEach((e, i) => {
      if (!this.active(e.difficulty) || !e.when.every((t) => t.type === 'start')) return;
      this.state[i].done = true;
      this.run(e.do, this.state[i]);
    });
    // Startaufstellung zählt nicht zur Statistik
    for (const p of this.sim.playerList) {
      p.stats.buildingsBuilt = 0;
      p.stats.unitsBuilt = 0;
    }
  }

  update(sim: Simulation): void {
    if (this.result || sim.gameOver) return;
    // Aufgegeben
    if (sim.players[1]?.defeated) {
      this.finish(false, 'mission.lost.surrender');
      return;
    }
    if (sim.tick % CHECK_INTERVAL !== 0) return;
    this.def.events.forEach((e, i) => {
      if (this.result || !this.active(e.difficulty)) return;
      const st = this.state[i];
      if (st.done) return;
      const repeating = e.when.some((t) => t.type === 'every');
      if (e.delay !== undefined && !repeating) {
        // Verzögert: erst Zeitpunkt merken, dann zur Zeit auslösen
        if (st.next < 0) {
          if (e.when.every((t) => this.check(t, st))) st.next = sim.tick + this.ticks(e.delay);
          return;
        }
        if (sim.tick < st.next) return;
        st.done = true;
        this.run(e.do, st);
        st.fired++;
        return;
      }
      if (!e.when.every((t) => this.check(t, st))) return;
      if (repeating) {
        const every = e.when.find((t) => t.type === 'every')!;
        st.next = sim.tick + Math.max(CHECK_INTERVAL, this.ticks(every.seconds));
      } else st.done = true;
      this.run(e.do, st);
      st.fired++;
    });
  }

  private check(t: MissionTrigger, st: { next: number }): boolean {
    const sim = this.sim;
    switch (t.type) {
      case 'start':
        return false;
      case 'time':
        return sim.tick >= this.ticks(t.seconds);
      case 'every': {
        const from = t.from !== undefined ? this.ticks(t.from) : this.ticks(t.seconds);
        if (sim.tick < from) return false;
        if (t.until !== undefined && sim.tick > this.ticks(t.until)) return false;
        return st.next < 0 || sim.tick >= st.next;
      }
      case 'enterArea': {
        const [ax, ay, aw, ah] = this.def.areas[t.area];
        const ids = t.tag ? new Set(this.tags.get(t.tag) ?? []) : null;
        let n = 0;
        for (const u of sim.units) {
          if (u.dead || (t.owner !== undefined && u.owner !== t.owner) || (ids && !ids.has(u.id))) continue;
          const tx = tileOf(u.x);
          const ty = tileOf(u.y);
          if (tx >= ax && tx < ax + aw && ty >= ay && ty < ay + ah) n++;
        }
        return n >= t.count;
      }
      case 'destroyed': {
        const ids = this.tags.get(t.tag);
        return !!ids && ids.length > 0 && ids.every((id) => !sim.getTarget(id));
      }
      case 'built':
        return sim.buildings.filter((b) => !b.dead && b.owner === t.owner && b.def.id === t.building).length >= t.count;
      case 'army': {
        const n = sim.units.filter((u) => !u.dead && u.owner === t.owner && isArmy(u)).length + this.storedArmy(t.owner);
        return (t.atLeast === undefined || n >= t.atLeast) && (t.atMost === undefined || n <= t.atMost);
      }
      case 'noBase':
        return (
          !sim.buildings.some((b) => !b.dead && b.owner === t.owner && !b.def.wall && !b.def.neutral) &&
          !sim.units.some((u) => !u.dead && u.owner === t.owner && !!u.def.deploysTo)
        );
      case 'objectivesDone':
        return t.ids.every((id) => this.objectives.find((o) => o.id === id)?.status === 'done');
      case 'flag':
        return this.flags.has(t.name);
    }
  }

  /** Kampfeinheiten in Transportern zählen mit. */
  private storedArmy(owner: number): number {
    let n = 0;
    for (const u of this.sim.stored.values()) if (u.owner === owner && isArmy(u)) n++;
    return n;
  }

  private run(actions: MissionAction[], st: { fired: number }): void {
    for (const a of actions) {
      if (this.result) return;
      if (!this.active(a.difficulty)) continue;
      this.apply(a, st);
    }
  }

  private apply(a: MissionAction, st: { fired: number }): void {
    const sim = this.sim;
    switch (a.type) {
      case 'message':
        sim.emit({ type: 'radio', key: a.key, speaker: a.speaker });
        break;
      case 'objective': {
        if (this.objectives.some((o) => o.id === a.id)) break;
        const o: Objective = { id: a.id, key: a.key, status: 'open' };
        this.objectives.push(o);
        sim.emit({ type: 'objective', id: o.id, key: o.key, status: 'open' });
        break;
      }
      case 'complete':
      case 'fail': {
        const o = this.objectives.find((x) => x.id === a.id);
        if (!o || o.status !== 'open') break;
        o.status = a.type === 'complete' ? 'done' : 'failed';
        sim.emit({ type: 'objective', id: o.id, key: o.key, status: o.status });
        break;
      }
      case 'spawn': {
        const count = Math.min(a.max, Math.round(this.num(a.count) + this.num(a.growth) * st.fired));
        const [ax, ay, aw, ah] = this.def.areas[a.at];
        const units = sim.spawnFormation([{ type: a.unit, count }], a.owner, ax + (aw >> 1), ay + (ah >> 1));
        for (const u of units) {
          if (a.stance) u.stance = a.stance;
          if (a.tag) this.tag(a.tag, u.id);
        }
        const ids = units.map((u) => u.id);
        if (a.attackTo && ids.length) {
          const [x, y] = this.areaCenter(a.attackTo);
          sim.issue(a.owner, { type: 'attackMove', units: ids, x, y });
        } else if (a.moveTo && ids.length) {
          const [x, y] = this.areaCenter(a.moveTo);
          sim.issue(a.owner, { type: 'move', units: ids, x, y });
        }
        break;
      }
      case 'building': {
        const b = this.place(a.owner, a.building, a.at[0], a.at[1], 0);
        if (b && a.tag) this.tag(a.tag, b.id);
        break;
      }
      case 'base':
        for (const id of a.buildings) {
          const b = this.place(a.owner, id, a.at[0], a.at[1], 1);
          if (b && a.tag) this.tag(a.tag, b.id);
        }
        break;
      case 'attack': {
        const ids = new Set(a.tag ? this.tags.get(a.tag) ?? [] : []);
        const units = sim.units.filter((u) => !u.dead && u.owner === a.owner && isArmy(u) && (!a.tag || ids.has(u.id)));
        if (!units.length) break;
        const [x, y] = this.areaCenter(a.to);
        sim.issue(a.owner, { type: 'attackMove', units: units.map((u) => u.id), x, y });
        break;
      }
      case 'transfer':
        for (const id of this.tags.get(a.tag) ?? []) {
          const u = sim.getUnit(id);
          if (u && !u.dead) sim.transferUnit(u, a.owner);
        }
        break;
      case 'reveal': {
        const p = sim.players[a.owner];
        if (!p) break;
        const [ax, ay, aw, ah] = this.def.areas[a.area];
        for (let y = ay; y < ay + ah; y++) {
          for (let x = ax; x < ax + aw; x++) if (sim.map.inBounds(x, y)) p.explored[sim.map.index(x, y)] = 1;
        }
        break;
      }
      case 'credits': {
        const p = sim.players[a.owner];
        if (p) p.credits += this.num(a.amount);
        break;
      }
      case 'flag':
        this.flags.add(a.name);
        break;
      case 'ai':
        sim.listeners.splice(sim.listeners.indexOf(this), 0, new SkirmishAi(a.owner, a.level ?? this.difficulty, sim));
        break;
      case 'countdown':
        this.countdown = { endTick: sim.tick + this.ticks(a.seconds), key: a.key };
        break;
      case 'highlight':
        this.highlight = a.target;
        sim.emit({ type: 'highlight', target: a.target });
        break;
      case 'victory':
      case 'defeat':
        this.finish(a.type === 'victory', a.type === 'defeat' ? a.key : undefined);
        break;
    }
  }

  private finish(victory: boolean, reasonKey?: string): void {
    const sim = this.sim;
    this.result = victory ? 'victory' : 'defeat';
    this.countdown = null;
    if (this.highlight) {
      this.highlight = null;
      sim.emit({ type: 'highlight', target: null });
    }
    if (victory) for (const o of this.objectives) if (o.status === 'open') o.status = 'done';
    const me = sim.players[1];
    const winners = victory ? [1] : sim.playerList.filter((p) => !sim.isAlly(1, p.id)).map((p) => p.id);
    if (me && !victory) me.defeated = true;
    sim.emit({ type: 'missionEnd', victory, reasonKey });
    sim.gameOver = { winners };
    sim.emit({ type: 'gameOver', winners });
  }

  private tag(name: string, id: number): void {
    const list = this.tags.get(name) ?? [];
    list.push(id);
    this.tags.set(name, list);
  }

  /** Ids mit dieser Markierung (für Tests und Anzeige). */
  tagged(name: string): number[] {
    return this.tags.get(name) ?? [];
  }

  private areaCenter(name: string): [number, number] {
    const [ax, ay, aw, ah] = this.def.areas[name];
    return [ax * TILE + (aw * TILE) / 2, ay * TILE + (ah * TILE) / 2];
  }

  /**
   * Stellt ein Gebäude möglichst nahe an (tx,ty) hin – spiralförmig nach aussen,
   * nicht auf Kristalle, mit `gap` Kacheln Abstand zu anderen Gebäuden.
   */
  private place(owner: number, id: string, tx: number, ty: number, gap: number): Building | null {
    const sim = this.sim;
    const p = sim.players[owner];
    const def = p ? sim.rules.building(p.faction, id) : undefined;
    if (!def) return null;
    const cx = tx - (def.width >> 1);
    const cy = ty - (def.height >> 1);
    for (let r = 0; r <= 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!this.freeFor(owner, def, x, y, gap)) continue;
          return placeBuilding(sim, owner, def, x, y);
        }
      }
    }
    return null;
  }

  private freeFor(owner: number, def: NonNullable<ReturnType<Rules['building']>>, x: number, y: number, gap: number): boolean {
    const sim = this.sim;
    const check = canPlace(sim, owner, def, x, y);
    if (!check.ok && check.reason !== 'tooFar') return false;
    const m = sim.map;
    for (let yy = y - gap; yy < y + def.height + gap; yy++) {
      for (let xx = x - gap; xx < x + def.width + gap; xx++) {
        if (!m.inBounds(xx, yy)) return false;
        if (m.isBlocked(xx, yy)) return false;
        if (sim.economy.crystal[m.index(xx, yy)] > 0) return false;
      }
    }
    // Raffinerie: Platz vor dem Andockplatz freihalten
    if (def.refinery && !m.passable(x + (def.width >> 1), y + def.height + 1, MoveClass.Vehicle)) return false;
    return true;
  }
}

/** Kampfeinheit (bewaffnet, kein Sammler/Bauwagen). */
function isArmy(u: Unit): boolean {
  return !!u.def.weapon && !u.def.harvestCapacity && !u.def.deploysTo;
}

export interface MissionSetup {
  def: MissionDef;
  map: GameMap;
  rules: Rules;
  difficulty: AiLevel;
  /** Übersetzt die Spielernamen (Client); ohne bleibt der Textschlüssel stehen. */
  translate?: (key: string) => string;
}

/** Erstellt Simulation + Mission. Der Spieler hat immer die id 1. */
export function createMission(setup: MissionSetup): { sim: Simulation; mission: Mission } {
  const { def } = setup;
  const sim = new Simulation({
    map: setup.map,
    rules: setup.rules,
    victory: 'none',
    players: def.players.map((p) => ({ id: p.id, faction: p.faction, team: p.team, color: p.color, name: setup.translate?.(p.nameKey) ?? p.nameKey })),
  });
  const mission = new Mission(def, setup.difficulty, sim);
  sim.players[1].credits = mission.num(def.credits);
  if (def.locked.length) sim.players[1].locked = new Set(def.locked);
  sim.listeners.push(mission);
  mission.start();
  return { sim, mission };
}
