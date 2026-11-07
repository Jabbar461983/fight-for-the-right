import { z } from 'zod';
import { MOVE_CLASS_NAMES, moveClassFromName, type MoveClass } from '../map/terrain';
import { tilesPerSecToUnitsPerTick, tilesToUnits } from '../math/fixed';

/**
 * Schema der Einheiten-Datendateien (data/units/*.json).
 * Werte stehen in «menschlichen» Einheiten (Kacheln, Kacheln pro Sekunde)
 * und werden beim Laden in Simulationseinheiten umgerechnet.
 */
export const UnitDefSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  /** Schlüssel für den Namen in den Sprachdateien. */
  nameKey: z.string(),
  faction: z.enum(['common', 'aero', 'granite']),
  category: z.enum(['infantry', 'vehicle', 'air', 'naval']),
  moveClass: z.enum(MOVE_CLASS_NAMES),
  /** Tempo in Kacheln pro Sekunde. */
  speed: z.number().positive().max(10),
  /** Kollisionsradius in Kacheln. */
  radius: z.number().positive().max(1),
  /** Sichtradius in Kacheln. */
  sight: z.number().positive(),
  hp: z.number().int().positive(),
  cost: z.number().int().nonnegative(),
  /** Name der Grafik (Platzhalter-Zeichnung oder Sprite). */
  sprite: z.string(),
  /** Hat einen drehbaren Turm. */
  turret: z.boolean().default(false),
});
export type UnitDefData = z.infer<typeof UnitDefSchema>;

export const UnitDefFileSchema = z.object({
  units: z.array(UnitDefSchema),
});

/** Einheitentyp, fertig umgerechnet für die Simulation. */
export interface UnitDef extends UnitDefData {
  moveClassId: MoveClass;
  /** Tempo in Welteinheiten pro Tick. */
  speedUnits: number;
  /** Radius in Welteinheiten. */
  radiusUnits: number;
  /** Sichtradius in Welteinheiten. */
  sightUnits: number;
}

/** Prüft eine oder mehrere Einheiten-Dateien und liefert die umgerechneten Typen. */
export function parseUnitDefs(...files: unknown[]): Map<string, UnitDef> {
  const out = new Map<string, UnitDef>();
  for (const json of files) {
    const parsed = UnitDefFileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Ungültige Einheiten-Datei: ${z.prettifyError(parsed.error)}`);
    }
    for (const u of parsed.data.units) {
      if (out.has(u.id)) throw new Error(`Einheit "${u.id}" ist doppelt definiert.`);
      out.set(u.id, {
        ...u,
        moveClassId: moveClassFromName(u.moveClass),
        speedUnits: tilesPerSecToUnitsPerTick(u.speed),
        radiusUnits: tilesToUnits(u.radius),
        sightUnits: tilesToUnits(u.sight),
      });
    }
  }
  return out;
}
