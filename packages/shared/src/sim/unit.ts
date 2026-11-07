import type { UnitDef } from '../data/unitDefs';
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

/** Eine Einheit in der Simulation. Alle Werte ganzzahlig. */
export interface Unit {
  readonly id: number;
  readonly owner: number;
  readonly def: UnitDef;
  x: number;
  y: number;
  /** Position zu Beginn des letzten Ticks – für flüssige Darstellung (Interpolation). */
  prevX: number;
  prevY: number;
  /** Letzte Bewegungsrichtung (für die Ausrichtung der Grafik). */
  dirX: number;
  dirY: number;
  order: MoveOrder | null;
}
