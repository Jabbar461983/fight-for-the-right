import type { AiLevel, Faction, Rules } from '../data/rules';
import type { GameMap } from '../map/gameMap';
import { tileOf } from '../math/fixed';
import { SkirmishAi } from '../ai/skirmishAi';
import { Simulation } from './simulation';

/** Ein Platz in einem Gefecht. */
export interface SlotSetup {
  /** Spieler-id (1…4). */
  id: number;
  name: string;
  faction: Faction;
  color: number;
  team: number;
  /** Gesetzt = Computergegner mit diesem Schwierigkeitsgrad. */
  ai?: AiLevel;
}

export interface SkirmishSetup {
  map: GameMap;
  rules: Rules;
  slots: SlotSetup[];
  startCredits: number;
}

/**
 * Startaufstellung eines Gefechts: Jeder Spieler bekommt auf seinem
 * Startplatz einen Bauwagen und eine kleine Eskorte.
 */
export function createSkirmish(setup: SkirmishSetup): Simulation {
  const sim = new Simulation({
    map: setup.map,
    rules: setup.rules,
    players: setup.slots.map((s) => ({ id: s.id, faction: s.faction, team: s.team, color: s.color, name: s.name })),
    startCredits: setup.startCredits,
  });
  const spawns = setup.map.objectsOfKind('spawn').sort((a, b) => Number(a.props.player) - Number(b.props.player));
  setup.slots.forEach((slot, i) => {
    const spawn = spawns.find((s) => Number(s.props.player) === slot.id) ?? spawns[i % spawns.length];
    if (!spawn) throw new Error('Karte hat zu wenige Startplätze.');
    sim.spawnFormation(
      [
        { type: 'constructionWagon', count: 1 },
        { type: 'lightTank', count: 1 },
        { type: 'rifleman', count: 3 },
      ],
      slot.id,
      tileOf(spawn.x),
      tileOf(spawn.y),
    );
    if (slot.ai) sim.listeners.push(new SkirmishAi(slot.id, slot.ai, sim));
  });
  return sim;
}

/** Startplatz (Weltkoordinaten) eines Spielers. */
export function spawnOf(map: GameMap, player: number): { x: number; y: number } | null {
  const s = map.objectsOfKind('spawn').find((o) => Number(o.props.player) === player);
  return s ? { x: s.x, y: s.y } : null;
}
