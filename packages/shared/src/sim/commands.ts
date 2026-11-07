/**
 * Befehle, die ein Spieler an die Simulation schickt.
 * Im Multiplayer sind das genau die Nachrichten, die über das Netz gehen.
 * Koordinaten in Welteinheiten.
 */
export type Command =
  | { type: 'move'; units: number[]; x: number; y: number }
  | { type: 'stop'; units: number[] };

/** Höchstzahl Einheiten pro Befehl (Schutz vor Missbrauch). */
export const MAX_UNITS_PER_COMMAND = 500;

/** Prüft die Form eines Befehls (Typen, Grenzen). Besitzrechte prüft die Simulation. */
export function isWellFormedCommand(cmd: unknown): cmd is Command {
  if (typeof cmd !== 'object' || cmd === null) return false;
  const c = cmd as Record<string, unknown>;
  if (!Array.isArray(c.units) || c.units.length === 0 || c.units.length > MAX_UNITS_PER_COMMAND) return false;
  if (!c.units.every((u) => Number.isInteger(u) && (u as number) > 0)) return false;
  switch (c.type) {
    case 'move':
      return Number.isInteger(c.x) && Number.isInteger(c.y);
    case 'stop':
      return true;
    default:
      return false;
  }
}
