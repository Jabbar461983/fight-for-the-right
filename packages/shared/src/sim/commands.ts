import { z } from 'zod';
import { PRODUCTION_CATEGORIES } from '../data/rules';
import { STANCES } from './unit';

/**
 * Befehle, die ein Spieler an die Simulation schickt.
 * Im Multiplayer sind das genau die Nachrichten, die über das Netz gehen.
 * Koordinaten in Welteinheiten (x/y) bzw. Kacheln (tx/ty).
 */

/** Höchstzahl Einheiten pro Befehl (Schutz vor Missbrauch). */
export const MAX_UNITS_PER_COMMAND = 500;

const Id = z.number().int().positive();
const Ids = z.array(Id).min(1).max(MAX_UNITS_PER_COMMAND);
const Coord = z.number().int().min(-1_000_000).max(10_000_000);
const TileCoord = z.number().int().min(0).max(4096);

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), units: Ids, x: Coord, y: Coord }),
  z.object({ type: z.literal('attackMove'), units: Ids, x: Coord, y: Coord }),
  z.object({ type: z.literal('attack'), units: Ids, target: Id }),
  z.object({ type: z.literal('stop'), units: Ids }),
  z.object({ type: z.literal('stance'), units: Ids, stance: z.enum(STANCES) }),
  /** Sammler zu einem Kristallfeld schicken. */
  z.object({ type: z.literal('harvest'), units: Ids, tx: TileCoord, ty: TileCoord }),
  /** Sammler zu einer bestimmten Raffinerie schicken. */
  z.object({ type: z.literal('dock'), units: Ids, target: Id }),
  /** Betreten: Ingenieur (übernehmen/reparieren), Einsteigen in Transporter oder Bunker. */
  z.object({ type: z.literal('enter'), units: Ids, target: Id }),
  /** Transporter: hinfahren (optional) und alle aussteigen lassen. */
  z.object({ type: z.literal('unload'), units: Ids, x: Coord.optional(), y: Coord.optional() }),
  /** Bunker räumen. */
  z.object({ type: z.literal('evacuate'), building: Id }),
  /** Bauwagen ausfahren. */
  z.object({ type: z.literal('deploy'), units: Ids }),
  z.object({
    type: z.literal('queue'),
    category: z.enum(PRODUCTION_CATEGORIES),
    item: z.string().max(40),
    action: z.enum(['add', 'pause', 'cancel']),
  }),
  z.object({ type: z.literal('place'), category: z.enum(['building', 'defense']), tx: TileCoord, ty: TileCoord }),
  z.object({ type: z.literal('sell'), building: Id }),
  z.object({ type: z.literal('repair'), building: Id }),
  z.object({ type: z.literal('surrender') }),
]);

export type Command = z.infer<typeof CommandSchema>;

/** Prüft die Form eines Befehls. Besitzrechte prüft die Simulation. */
export function parseCommand(cmd: unknown): Command | null {
  const r = CommandSchema.safeParse(cmd);
  return r.success ? r.data : null;
}
