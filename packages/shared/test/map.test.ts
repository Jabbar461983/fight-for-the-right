import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/map/gameMap';
import { MoveClass, Terrain } from '../src/map/terrain';
import { parseTiledMap } from '../src/map/tiledLoader';
import { tileOf } from '../src/math/fixed';
import { loadData, loadMap } from './helpers';

describe('Karte', () => {
  it('Passierbarkeit je Bewegungsklasse', () => {
    const m = GameMap.fromAscii(['.T#~B']);
    expect(m.passable(1, 0, MoveClass.Infantry)).toBe(true); // Wald: Infanterie ja
    expect(m.passable(1, 0, MoveClass.Vehicle)).toBe(false); // Wald: Fahrzeug nein
    expect(m.passable(2, 0, MoveClass.Infantry)).toBe(false); // Klippe
    expect(m.passable(2, 0, MoveClass.Air)).toBe(true); // Luft ignoriert Gelände
    expect(m.passable(3, 0, MoveClass.Naval)).toBe(true);
    expect(m.passable(3, 0, MoveClass.Vehicle)).toBe(false);
    expect(m.passable(3, 0, MoveClass.Hover)).toBe(true);
    expect(m.passable(4, 0, MoveClass.Vehicle)).toBe(true); // Brücke
    expect(m.passable(4, 0, MoveClass.Naval)).toBe(true); // unter der Brücke durch
    expect(m.passable(-1, 0, MoveClass.Air)).toBe(false); // ausserhalb
  });

  it('Komponenten trennen Gebiete und respektieren Diagonalen', () => {
    const m = GameMap.fromAscii([
      '..#..', //
      '..#..',
      '#####',
      '...#.',
      '....#',
    ]);
    const v = MoveClass.Vehicle;
    expect(m.componentOf(0, 0, v)).toBe(m.componentOf(1, 1, v));
    expect(m.componentOf(0, 0, v)).not.toBe(m.componentOf(3, 0, v));
    expect(m.componentOf(2, 0, v)).toBe(-1);
    // (4,3) ist nur diagonal mit (3,4)… beide Klippen – also eigene Insel
    expect(m.componentOf(4, 3, v)).not.toBe(m.componentOf(0, 3, v));
  });

  it('nearestPassable findet die nächste freie Kachel', () => {
    const m = GameMap.fromAscii([
      '.....', //
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]);
    const p = m.nearestPassable(2, 2, MoveClass.Vehicle)!;
    expect(m.passable(p.tx, p.ty, MoveClass.Vehicle)).toBe(true);
    expect(Math.abs(p.tx - 2) + Math.abs(p.ty - 2)).toBe(2);
  });

  it('lädt Kristalltal und prüft das Format', () => {
    const m = loadMap('kristalltal');
    expect(m.width).toBe(64);
    expect(m.height).toBe(64);
    const spawns = m.objectsOfKind('spawn');
    expect(spawns.map((s) => s.props.player).sort()).toEqual([1, 2]);
    expect(m.objectsOfKind('crystalField').length).toBeGreaterThanOrEqual(4);
    // Kein Wasser-/Klippen-Startplatz
    for (const s of spawns) expect(m.passable(tileOf(s.x), tileOf(s.y), MoveClass.Vehicle)).toBe(true);
  });

  it('Kristalltal: beide Basen sind für Fahrzeuge und Infanterie verbunden', () => {
    const m = loadMap('kristalltal');
    const [a, b] = m.objectsOfKind('spawn');
    for (const cls of [MoveClass.Vehicle, MoveClass.Infantry]) {
      const ca = m.componentOf(tileOf(a.x), tileOf(a.y), cls);
      expect(ca).toBeGreaterThanOrEqual(0);
      expect(m.componentOf(tileOf(b.x), tileOf(b.y), cls)).toBe(ca);
    }
  });

  it('Kristalltal ist punktsymmetrisch (fair)', () => {
    const m = loadMap('kristalltal');
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        expect(m.terrainAt(x, y)).toBe(m.terrainAt(m.width - 1 - x, m.height - 1 - y));
      }
    }
  });

  it('Vier Winde: 4 verbundene Startplätze, vierfach drehsymmetrisch', () => {
    const m = loadMap('vier-winde');
    const spawns = m.objectsOfKind('spawn');
    expect(spawns.map((s) => s.props.player).sort()).toEqual([1, 2, 3, 4]);
    for (const cls of [MoveClass.Vehicle, MoveClass.Infantry]) {
      const comps = spawns.map((s) => m.componentOf(tileOf(s.x), tileOf(s.y), cls));
      expect(comps[0]).toBeGreaterThanOrEqual(0);
      expect(new Set(comps).size).toBe(1);
    }
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) expect(m.terrainAt(x, y)).toBe(m.terrainAt(m.width - 1 - y, x));
    }
    expect(m.objectsOfKind('crystalField').length).toBe(9);
  });

  it('lehnt kaputte Kartendateien mit verständlicher Meldung ab', () => {
    const good = loadData('maps/kristalltal.json') as Record<string, unknown>;
    expect(() => parseTiledMap({ ...good, layers: [] })).toThrow(/terrain/);
    expect(() => parseTiledMap({ ...good, orientation: 'isometric' })).toThrow(/Ungültige Kartendatei/);
    expect(() => parseTiledMap(null)).toThrow();
  });

  it('Tiled-Spiegelungsbits werden ignoriert', () => {
    const json = loadData('maps/kristalltal.json') as { layers: { data?: number[] }[] };
    const layer = json.layers[0];
    layer.data = layer.data!.map((g) => (g | 0x80000000) >>> 0);
    const m = parseTiledMap(json);
    expect(m.terrainAt(0, 0)).toBeLessThanOrEqual(Terrain.Bridge);
  });
});
