import type { BuildingDef, Faction, ProductionCategory, UnitDef, WeaponDef } from '../data/rules';
import type { WorldPoint } from '../path/astar';
import type { FlowField } from '../path/flowField';

/** Ein Bewegungsauftrag einer Einheit. */
export interface MoveOrder {
  /** Endpunkt dieser Einheit (bei Gruppen: ihr Formationsplatz). */
  goalX: number;
  goalY: number;
  /**
   * 'path': folgt einer Liste von Wegpunkten (A* oder direkt).
   * 'flow': folgt einem gemeinsamen Flussfeld der Gruppe.
   */
  mode: 'path' | 'flow';
  path: WorldPoint[];
  pathIndex: number;
  field: FlowField | null;
  /** Kachel-Index des Formationsplatzes (für den Wechsel von Fluss- auf Direktmodus). */
  slotIdx: number;
  /** Radius um das Gruppenziel, in dem «fast angekommen» als angekommen gilt. */
  groupRadius: number;
  /** Anzahl Neuberechnungen, weil die Einheit feststeckte. */
  repaths: number;
  /** Bisher kleinster Restweg (Welteinheiten) – Massstab für Fortschritt. */
  bestRemaining: number;
  /** Ticks seit der letzten echten Verbesserung des Restwegs. */
  noProgressTicks: number;
}

/** Haltung: Angreifen (verfolgt Gegner), Stellung halten (schiesst, bleibt stehen), Passiv (schiesst nie von selbst). */
export const STANCES = ['aggressive', 'hold', 'passive'] as const;
export type Stance = (typeof STANCES)[number];

export type HarvestPhase = 'seek' | 'toField' | 'harvesting' | 'toRefinery' | 'unloading';

/** Was eine Einheit gerade «vorhat» – steuert Bewegung und Kampf. */
export type Task =
  | { kind: 'attack'; targetId: number; forced: boolean; nextRepath: number; guardX: number; guardY: number }
  | { kind: 'attackMove'; x: number; y: number }
  | { kind: 'harvest'; phase: HarvestPhase; fieldIdx: number; refineryId: number; timer: number }
  | { kind: 'enter'; targetId: number; nextRepath: number }
  | { kind: 'deploy'; tries: number }
  /** Transporter fährt hin und lässt dort alle aussteigen. */
  | { kind: 'unload'; x: number; y: number }
  /** Jet fliegt zum Flugfeld und munitioniert auf. */
  | { kind: 'rearm'; airfieldId: number; timer: number };

/** Eine Einheit in der Simulation. Alle Werte ganzzahlig. */
export interface Unit {
  readonly id: number;
  owner: number;
  /** Ändert sich nur bei transferUnit (andere Fraktion → andere Werte). */
  def: UnitDef;
  x: number;
  y: number;
  /** Position zu Beginn des letzten Ticks – für flüssige Darstellung (Interpolation). */
  prevX: number;
  prevY: number;
  /** Letzte Bewegungsrichtung (für die Ausrichtung der Grafik). */
  dirX: number;
  dirY: number;
  /** Zielrichtung der Waffe (für den Turm). */
  aimX: number;
  aimY: number;
  hp: number;
  order: MoveOrder | null;
  task: Task | null;
  stance: Stance;
  /** Ticks bis zum nächsten Schuss. */
  cooldown: number;
  /** Automatisch gewähltes Ziel (0 = keins). */
  targetId: number;
  /** Ladung eines Sammlers. */
  cargo: number;
  /** Mitfahrende Einheiten (ids; sie sind solange nicht auf der Karte). */
  passengers: number[];
  /** Verbleibende Schüsse (Jets), -1 = unbegrenzt. */
  ammo: number;
  /** Eingegraben (Maulwurf in Fahrt) – für Gegner unsichtbar und unangreifbar. */
  burrowed: boolean;
  /** Wird am Tick-Ende entfernt. */
  dead: boolean;
}

/** Ein Gebäude. tx/ty = linke obere Kachel. */
export interface Building {
  readonly id: number;
  owner: number;
  readonly def: BuildingDef;
  readonly tx: number;
  readonly ty: number;
  /** Mittelpunkt in Welteinheiten. */
  readonly x: number;
  readonly y: number;
  hp: number;
  cooldown: number;
  targetId: number;
  aimX: number;
  aimY: number;
  repairing: boolean;
  /** Sammler, der gerade an der Raffinerie entlädt (0 = frei). */
  dockedBy: number;
  /** Infanterie im Bunker (ids). */
  passengers: number[];
  dead: boolean;
}

/** Ein fliegendes Geschoss. */
export interface Projectile {
  readonly id: number;
  readonly owner: number;
  readonly weapon: WeaponDef;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  /** Startpunkt (für Flugbögen in der Darstellung). */
  readonly startX: number;
  readonly startY: number;
  /** Verfolgtes Ziel (0 = festes Ziel tx/ty). */
  targetId: number;
  tx: number;
  ty: number;
  dead: boolean;
}

/** Ein Eintrag in einer Bauschlange. */
export interface QueueItem {
  defId: string;
  kind: 'unit' | 'building';
  /** Fortschritt (0 … total). */
  done: number;
  total: number;
  /** Bereits bezahltes Glimmerit. */
  spent: number;
  cost: number;
  paused: boolean;
}

/** Zuletzt gesehener Stand eines fremden Gebäudes (für den Nebel). */
export interface Ghost {
  id: number;
  defId: string;
  owner: number;
  faction: Faction;
  tx: number;
  ty: number;
}

export interface PlayerStats {
  unitsBuilt: number;
  unitsLost: number;
  buildingsBuilt: number;
  buildingsLost: number;
  kills: number;
  harvested: number;
}

export interface Player {
  readonly id: number;
  readonly faction: Faction;
  /** Team (0 = allein). Spieler im selben Team (≠0) sind verbündet. */
  readonly team: number;
  readonly color: number;
  readonly name: string;
  credits: number;
  storage: number;
  powerProduced: number;
  powerUsed: number;
  lowPower: boolean;
  hasRadar: boolean;
  defeated: boolean;
  queues: Record<ProductionCategory, QueueItem[]>;
  /** Fertig gebaute Gebäude, die auf das Platzieren warten. */
  ready: Partial<Record<'building' | 'defense', string>>;
  stats: PlayerStats;
  /** Sicht: 1 = gerade sichtbar (inkl. Verbündete). */
  visible: Uint8Array;
  /** 1 = schon einmal erkundet. */
  explored: Uint8Array;
  ghosts: Map<number, Ghost>;
  /** Interne Zeitstempel, damit Meldungen nicht im Sekundentakt kommen. */
  notifyTicks: Record<string, number>;
  /** Kampagne: Einheiten/Gebäude, die in dieser Mission nicht gebaut werden dürfen. */
  locked?: Set<string>;
}
