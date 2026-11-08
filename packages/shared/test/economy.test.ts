import { describe, expect, it } from 'vitest';
import { placeBuilding } from '../src/sim/production';
import { loadMap, makeSim, rules, run } from './helpers';

describe('Sammler', () => {
  /** Basis mit Raffinerie am Kristallfeld (Kristalltal unten links) und 3 Sammlern. */
  function setup() {
    const sim = makeSim(loadMap('kristalltal'), 0);
    const d = (id: string) => rules.building('aero', id)!;
    placeBuilding(sim, 1, d('constructionYard'), 8, 50);
    placeBuilding(sim, 1, d('powerPlant'), 12, 50);
    const ref = placeBuilding(sim, 1, d('refinery'), 14, 53);
    for (let i = 0; i < 2; i++) sim.spawnUnit('harvester', 1, ref.x, ref.y + 3 * 1024);
    // Grosses Lager, damit nie «Lager voll» bremst
    placeBuilding(sim, 1, d('silo'), 6, 54);
    placeBuilding(sim, 1, d('silo'), 4, 54);
    placeBuilding(sim, 1, d('silo'), 6, 47);
    return sim;
  }

  it('mehrere Sammler drängeln sich nicht auf einer Kachel', () => {
    const sim = setup();
    let sameTile = 0;
    let checks = 0;
    for (let s = 0; s < 120; s++) {
      run(sim, 15);
      const tiles = sim.units
        .filter((u) => u.task?.kind === 'harvest' && (u.task.phase === 'toField' || u.task.phase === 'harvesting'))
        .map((u) => (u.task as { fieldIdx: number }).fieldIdx);
      checks++;
      if (new Set(tiles).size < tiles.length) sameTile++;
      sim.players[1].credits = 0;
    }
    // Höchstens ausnahmsweise (wenn das Feld fast leer ist) dieselbe Kachel
    expect(sameTile).toBeLessThan(checks / 10);
  });

  it('das ganze Feld wird abgeerntet, nicht nur der Rand bei der Raffinerie', () => {
    const sim = setup();
    const start = Int32Array.from(sim.economy.crystal);
    // Kristalle wachsen nach – deshalb den tiefsten Stand je Kachel merken
    const lowest = Int32Array.from(start);
    for (let s = 0; s < 8 * 60; s++) {
      run(sim, 15);
      for (let i = 0; i < lowest.length; i++) lowest[i] = Math.min(lowest[i], sim.economy.crystal[i]);
      sim.players[1].credits = 0;
    }
    // Jede Kachel des Heimatfelds wurde mindestens einmal angezapft (liegt unter dem Startwert)
    const field: number[] = [];
    for (let i = 0; i < start.length; i++) {
      const tx = i % 64;
      const ty = Math.floor(i / 64);
      if (start[i] > 0 && tx >= 13 && tx <= 23 && ty >= 54 && ty <= 62 && sim.map.blocked[i] === 0) field.push(i);
    }
    expect(field.length).toBeGreaterThan(10);
    const untouched = field.filter((i) => lowest[i] >= start[i]);
    expect(untouched.length).toBe(0);
  });
});
