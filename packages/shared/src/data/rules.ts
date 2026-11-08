import { z } from 'zod';
import { MOVE_CLASS_NAMES, moveClassFromName, type MoveClass } from '../map/terrain';
import { TICK_RATE, tilesPerSecToUnitsPerTick, tilesToUnits } from '../math/fixed';

/**
 * Spielregeln aus den Datendateien (data/rules/*.json, data/units/*.json).
 * Alle Werte stehen dort in «menschlichen» Einheiten (Kacheln, Sekunden) und
 * werden hier einmalig in Simulationseinheiten (Welteinheiten, Ticks) umgerechnet.
 */

export const ARMOR_CLASSES = ['infantry', 'light', 'heavy', 'building', 'air'] as const;
export type ArmorClass = (typeof ARMOR_CLASSES)[number];

/** Bauschlangen-Kategorien. building/defense baut der Bauhof, der Rest die jeweilige Fabrik. */
export const PRODUCTION_CATEGORIES = ['building', 'defense', 'infantry', 'vehicle', 'air', 'naval'] as const;
export type ProductionCategory = (typeof PRODUCTION_CATEGORIES)[number];

/** Alle spielbaren Teams. Die Reihenfolge ist Teil des Netzwerkformats (Index) – neue nur hinten anhängen. */
export const FACTIONS = ['aero', 'granite', 'volt', 'corsair', 'frost', 'jungle'] as const;
export type Faction = (typeof FACTIONS)[number];

// ───────────── Schemas ─────────────

const VersusSchema = z.object({
  infantry: z.number().min(0),
  light: z.number().min(0),
  heavy: z.number().min(0),
  building: z.number().min(0),
  air: z.number().min(0),
});

export const WeaponSchema = z.object({
  id: z.string(),
  damage: z.number().int().positive(),
  /** Schaden in Prozent je Panzerungsklasse. */
  versus: VersusSchema,
  range: z.number().positive(),
  minRange: z.number().min(0).default(0),
  /** Nachladezeit in Sekunden. */
  reload: z.number().positive(),
  /** arc = Blitz (Volt-Kollektiv), wird als Lichtbogen gezeichnet. */
  projectile: z.enum(['bullet', 'rocket', 'cannon', 'shell', 'flak', 'bomb', 'arc']),
  /** Geschosstempo in Kacheln pro Sekunde. */
  projectileSpeed: z.number().positive(),
  /** Flächenschaden-Radius in Kacheln (0 = nur das Ziel). */
  splash: z.number().min(0).default(0),
  targets: z.enum(['ground', 'air', 'both']),
});

const FactionTag = z.enum(['common', ...FACTIONS]);

export const UnitSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  nameKey: z.string(),
  faction: FactionTag,
  category: z.enum(['infantry', 'vehicle', 'air', 'naval']),
  moveClass: z.enum(MOVE_CLASS_NAMES),
  armor: z.enum(ARMOR_CLASSES),
  weapon: z.string().optional(),
  speed: z.number().positive().max(10),
  radius: z.number().positive().max(1),
  sight: z.number().positive(),
  hp: z.number().int().positive(),
  cost: z.number().int().nonnegative(),
  buildTime: z.number().positive(),
  prerequisites: z.array(z.string()).default([]),
  buildable: z.boolean().default(true),
  harvestCapacity: z.number().int().positive().optional(),
  engineer: z.boolean().default(false),
  deploysTo: z.string().optional(),
  /** Fliegt wirklich (nur Flak/Raketen treffen). Jetpack-Infanterie fliegt tief: airborne = false. */
  airborne: z.boolean().default(false),
  /** Schüsse bis zum Aufmunitionieren am Flugfeld (Jets). */
  ammo: z.number().int().positive().optional(),
  /** Gräbt sich beim Fahren ein (unsichtbar für Gegner). */
  burrows: z.boolean().default(false),
  /** Tarnung (Dschungel-Ranger): unsichtbar, solange die Einheit steht und nicht schiesst – ausser ein Gegner ist ganz nah. */
  camouflage: z.boolean().default(false),
  /** Zivilist (z.B. Forscherin in der Kampagne): wird nie beschossen. */
  civilian: z.boolean().default(false),
  /** Schutzschild für Infanterie in der Nähe. */
  shield: z.object({ radius: z.number().positive(), reduction: z.number().min(0).max(0.9) }).optional(),
  /** Kann Einheiten mitnehmen. */
  transport: z
    .object({ capacity: z.number().int().positive(), accepts: z.array(z.enum(['infantry', 'vehicle'])) })
    .optional(),
  /** Kommt bereits beladen aus der Fabrik (z.B. Maulwurf mit 4 Schützen). */
  initialPassengers: z.object({ type: z.string(), count: z.number().int().positive() }).optional(),
  sprite: z.string(),
  turret: z.boolean().default(false),
});

export const BuildingSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  nameKey: z.string(),
  faction: FactionTag.default('common'),
  category: z.enum(['building', 'defense']),
  width: z.number().int().min(1).max(5),
  height: z.number().int().min(1).max(5),
  hp: z.number().int().positive(),
  cost: z.number().int().nonnegative(),
  /** Positiv = liefert Strom, negativ = verbraucht Strom. */
  power: z.number().int(),
  buildTime: z.number().positive(),
  prerequisites: z.array(z.string()).default([]),
  buildable: z.boolean().default(true),
  sight: z.number().positive(),
  storage: z.number().int().min(0).default(0),
  produces: z.array(z.enum(PRODUCTION_CATEGORIES)).default([]),
  constructionYard: z.boolean().default(false),
  refinery: z.boolean().default(false),
  radar: z.boolean().default(false),
  wall: z.boolean().default(false),
  freeUnit: z.string().optional(),
  weapon: z.string().optional(),
  /** Plätze für Infanterie, die von drinnen schiesst (Panzerbunker). */
  garrison: z.number().int().min(0).default(0),
  /** Repariert Fahrzeuge in der Nähe (gegen Glimmerit). */
  repairsVehicles: z.boolean().default(false),
  /** Muss am Wasser stehen (Werft). */
  requiresWater: z.boolean().default(false),
  /** Flugfeld: Jets munitionieren hier auf. */
  airfield: z.boolean().default(false),
  /** Neutrales Kartenobjekt (Bonus-Punkt), gehört anfangs niemandem. */
  neutral: z.boolean().default(false),
  invulnerable: z.boolean().default(false),
  /** Glimmerit-Einkommen alle 2 Sekunden für den Besitzer. */
  income: z.number().int().min(0).default(0),
  sprite: z.string(),
});

const ModifiersSchema = z.object({
  cost: z.number().positive().default(1),
  speed: z.number().positive().default(1),
  hp: z.number().positive().default(1),
  buildTime: z.number().positive().default(1),
});

export const FactionSchema = z.object({
  id: z.enum(FACTIONS),
  nameKey: z.string(),
  palette: z.object({ main: z.string(), second: z.string(), metal: z.string(), dark: z.string() }),
  unitModifiers: ModifiersSchema,
});

export const AiDifficultySchema = z.object({
  /** Eigener Bauplan (sonst der allgemeine aus ai.json). */
  buildOrder: z.array(z.string()).optional(),
  /** Wie oft die KI nachdenkt (Sekunden). */
  thinkInterval: z.number().positive(),
  /** Erster Angriff frühestens nach … Sekunden. */
  firstAttackAfter: z.number().min(0),
  attackInterval: z.number().positive(),
  waveSize: z.number().int().positive(),
  waveGrowth: z.number().int().min(0),
  maxWaveSize: z.number().int().positive(),
  harvestersPerRefinery: z.number().int().min(1),
  maxRefineries: z.number().int().min(1),
  /** Wie weit die KI ihrem Bauplan folgt. */
  buildOrderLength: z.number().int().min(1),
  /** Glimmerit, das die KI nicht für Einheiten ausgibt (bremst «Leicht»). */
  reserveCredits: z.number().int().min(0),
  unitMix: z.record(z.string(), z.number().int().min(0)),
  /** Mischung, wenn der Gegner über Land nicht erreichbar ist (Inselkarten). */
  islandMix: z.record(z.string(), z.number().int().min(0)),
  maxArmy: z.number().int().positive(),
  /** Ingenieure für Bonus-Punkte. */
  engineers: z.number().int().min(0).default(0),
  /** Mit zusätzlichem Bauwagen an weiteren Kristallfeldern ausbauen. */
  expand: z.boolean().default(false),
  /** Angriffe aus zwei Richtungen. */
  twoFronts: z.boolean().default(false),
  repairBuildings: z.boolean().default(false),
  /**
   * Greift erst an, wenn die eigene Armee um diesen Faktor stärker ist als alles,
   * was die KI vom Gegner gesehen hat (0 = ohne Vergleich angreifen).
   */
  attackAdvantage: z.number().min(0).default(0),
});
export type AiDifficulty = z.infer<typeof AiDifficultySchema>;
export const AI_LEVELS = ['easy', 'medium', 'hard'] as const;
export type AiLevel = (typeof AI_LEVELS)[number];

export const AiConfigSchema = z.object({
  buildOrder: z.array(z.string()),
  difficulties: z.object({ easy: AiDifficultySchema, medium: AiDifficultySchema, hard: AiDifficultySchema }),
});
export type AiConfig = z.infer<typeof AiConfigSchema>;

// ───────────── Aufbereitete Typen ─────────────

export interface WeaponDef extends z.infer<typeof WeaponSchema> {
  rangeUnits: number;
  minRangeUnits: number;
  reloadTicks: number;
  speedUnits: number;
  splashUnits: number;
}

export interface UnitDef extends Omit<z.infer<typeof UnitSchema>, 'weapon'> {
  weapon: WeaponDef | null;
  moveClassId: MoveClass;
  speedUnits: number;
  radiusUnits: number;
  sightUnits: number;
  buildTicks: number;
  /** Für welche Fraktion diese Variante gilt. */
  forFaction: Faction;
}

export interface BuildingDef extends Omit<z.infer<typeof BuildingSchema>, 'weapon'> {
  weapon: WeaponDef | null;
  sightUnits: number;
  buildTicks: number;
  forFaction: Faction;
}

export type FactionDef = z.infer<typeof FactionSchema>;

/** Ab diesem Schadens-Prozentsatz gilt eine Waffe als «stark gegen» eine Panzerungsklasse. */
export const STRONG_VERSUS = 80;

/**
 * Wogegen eine Einheit oder ein Turm gut wirkt – aus den Waffenwerten abgeleitet
 * (für die Anzeige in der Bauleiste). Leer, wenn unbewaffnet.
 */
export function strongAgainst(def: { weapon: WeaponDef | null }): ArmorClass[] {
  const r = effectiveness(def);
  return ARMOR_CLASSES.filter((c) => r[c] >= 4);
}

/**
 * Wie wirksam eine Einheit/ein Turm gegen jede Panzerungsklasse ist: 0–5 Sterne
 * (0 = trifft gar nicht). Aus dem Schadens-Prozentsatz der Waffe:
 * ab 100 % ★★★★★, ab 80 % ★★★★, ab 50 % ★★★, ab 25 % ★★, darunter ★.
 */
export function effectiveness(def: { weapon: WeaponDef | null }): Record<ArmorClass, number> {
  const out = { infantry: 0, light: 0, heavy: 0, building: 0, air: 0 } as Record<ArmorClass, number>;
  const w = def.weapon;
  if (!w) return out;
  for (const c of ARMOR_CLASSES) {
    if (c === 'air' ? w.targets === 'ground' : w.targets === 'air') continue;
    const v = w.versus[c];
    out[c] = v <= 0 ? 0 : v >= 100 ? 5 : v >= STRONG_VERSUS ? 4 : v >= 50 ? 3 : v >= 25 ? 2 : 1;
  }
  return out;
}

/** Alle Regeln, fertig für die Simulation. */
export class Rules {
  readonly weapons = new Map<string, WeaponDef>();
  readonly factions = new Map<Faction, FactionDef>();
  /** Schlüssel: `${faction}/${id}` */
  private readonly units = new Map<string, UnitDef>();
  private readonly buildings = new Map<string, BuildingDef>();
  readonly unitIds: string[] = [];
  readonly buildingIds: string[] = [];

  constructor(readonly ai: AiConfig) {}

  unit(faction: Faction, id: string): UnitDef | undefined {
    return this.units.get(`${faction}/${id}`);
  }

  building(faction: Faction, id: string): BuildingDef | undefined {
    return this.buildings.get(`${faction}/${id}`);
  }

  /** Alle Einheiten-/Gebäudetypen einer Fraktion. */
  unitsOf(faction: Faction): UnitDef[] {
    return this.unitIds.map((id) => this.unit(faction, id)).filter((d): d is UnitDef => !!d);
  }

  buildingsOf(faction: Faction): BuildingDef[] {
    return this.buildingIds.map((id) => this.building(faction, id)).filter((d): d is BuildingDef => !!d);
  }

  /** Intern: Einheit für alle passenden Fraktionen eintragen. */
  addUnit(def: UnitDef): void {
    this.units.set(`${def.forFaction}/${def.id}`, def);
    if (!this.unitIds.includes(def.id)) this.unitIds.push(def.id);
  }

  addBuilding(def: BuildingDef): void {
    this.buildings.set(`${def.forFaction}/${def.id}`, def);
    if (!this.buildingIds.includes(def.id)) this.buildingIds.push(def.id);
  }
}

export interface RulesFiles {
  weapons: unknown;
  buildings: unknown;
  factions: unknown;
  ai: unknown;
  /** Eine oder mehrere Einheiten-Dateien. */
  units: unknown[];
}

function parse<T>(schema: z.ZodType<T>, json: unknown, what: string): T {
  const r = schema.safeParse(json);
  if (!r.success) throw new Error(`Ungültige Datei «${what}»: ${z.prettifyError(r.error)}`);
  return r.data;
}

const sec = (s: number) => Math.max(1, Math.round(s * TICK_RATE));

/** Lädt und prüft alle Regel-Dateien. Wirft bei Fehlern eine verständliche Meldung. */
export function loadRules(files: RulesFiles): Rules {
  const ai = parse(AiConfigSchema, files.ai, 'ai.json');
  const rules = new Rules(ai);

  for (const w of parse(z.object({ weapons: z.array(WeaponSchema) }), files.weapons, 'weapons.json').weapons) {
    if (rules.weapons.has(w.id)) throw new Error(`Waffe «${w.id}» ist doppelt definiert.`);
    rules.weapons.set(w.id, {
      ...w,
      rangeUnits: tilesToUnits(w.range),
      minRangeUnits: tilesToUnits(w.minRange),
      reloadTicks: sec(w.reload),
      speedUnits: tilesPerSecToUnitsPerTick(w.projectileSpeed),
      splashUnits: tilesToUnits(w.splash),
    });
  }
  const weapon = (id: string | undefined, owner: string): WeaponDef | null => {
    if (!id) return null;
    const w = rules.weapons.get(id);
    if (!w) throw new Error(`«${owner}» nutzt unbekannte Waffe «${id}».`);
    return w;
  };

  for (const f of parse(z.object({ factions: z.array(FactionSchema) }), files.factions, 'factions.json').factions) {
    rules.factions.set(f.id, f);
  }
  for (const f of FACTIONS) if (!rules.factions.has(f)) throw new Error(`Fraktion «${f}» fehlt in factions.json.`);

  for (const file of files.units) {
    for (const u of parse(z.object({ units: z.array(UnitSchema) }), file, 'units').units) {
      for (const faction of FACTIONS) {
        if (u.faction !== 'common' && u.faction !== faction) continue;
        if (rules.unit(faction, u.id)) throw new Error(`Einheit «${u.id}» ist doppelt definiert.`);
        const m = rules.factions.get(faction)!.unitModifiers;
        rules.addUnit({
          ...u,
          forFaction: faction,
          weapon: weapon(u.weapon, u.id),
          cost: Math.round((u.cost * m.cost) / 10) * 10,
          hp: Math.round(u.hp * m.hp),
          moveClassId: moveClassFromName(u.moveClass),
          speedUnits: tilesPerSecToUnitsPerTick(u.speed * m.speed),
          radiusUnits: tilesToUnits(u.radius),
          sightUnits: tilesToUnits(u.sight),
          buildTicks: sec(u.buildTime * m.buildTime),
        });
      }
    }
  }

  for (const b of parse(z.object({ buildings: z.array(BuildingSchema) }), files.buildings, 'buildings.json').buildings) {
    for (const faction of FACTIONS) {
      if (b.faction !== 'common' && b.faction !== faction) continue;
      rules.addBuilding({
        ...b,
        forFaction: faction,
        weapon: weapon(b.weapon, b.id),
        sightUnits: tilesToUnits(b.sight),
        buildTicks: sec(b.buildTime),
      });
    }
  }

  // Querverweise prüfen
  const known = (id: string) => rules.buildingIds.includes(id) || rules.unitIds.includes(id);
  for (const faction of FACTIONS) {
    for (const d of [...rules.unitsOf(faction), ...rules.buildingsOf(faction)]) {
      for (const p of d.prerequisites) {
        if (!rules.buildingIds.includes(p)) throw new Error(`«${d.id}» setzt unbekanntes Gebäude «${p}» voraus.`);
      }
    }
    for (const u of rules.unitsOf(faction)) {
      if (u.deploysTo && !rules.building(faction, u.deploysTo)) throw new Error(`«${u.id}»: unbekanntes deploysTo.`);
      if (u.initialPassengers && !rules.unit(faction, u.initialPassengers.type)) {
        throw new Error(`«${u.id}»: unbekannte initialPassengers.`);
      }
    }
    for (const b of rules.buildingsOf(faction)) {
      if (b.freeUnit && !rules.unit(faction, b.freeUnit)) throw new Error(`«${b.id}»: unbekannte freeUnit.`);
    }
  }
  for (const order of [ai.buildOrder, ...Object.values(ai.difficulties).map((d) => d.buildOrder ?? [])]) {
    for (const id of order) if (!known(id)) throw new Error(`ai.json: unbekannter Bauplan-Eintrag «${id}».`);
  }
  return rules;
}
