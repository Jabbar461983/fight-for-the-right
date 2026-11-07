import { z } from 'zod';
import { TILE } from '../math/fixed';
import { GameMap, type MapObject } from './gameMap';
import { terrainFromName } from './terrain';

/**
 * Lädt Karten im JSON-Format des Karteneditors «Tiled» (https://www.mapeditor.org).
 *
 * Erwartet wird:
 * - eine Kachelebene namens "terrain"; jede Kachel des Tilesets trägt die
 *   Eigenschaft `terrain` (grass, sand, road, forest, cliff, water, bridge),
 * - optional eine Objektebene mit Punkten/Rechtecken (z.B. Typ "spawn" mit
 *   Eigenschaft `player`, Typ "crystalField" mit Eigenschaft `radius`).
 */

const PropertySchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const TileLayerSchema = z.object({
  type: z.literal('tilelayer'),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  data: z.array(z.number().int().nonnegative()),
});

const ObjectSchema = z.object({
  id: z.number().int(),
  name: z.string().default(''),
  type: z.string().optional(),
  class: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().default(0),
  height: z.number().default(0),
  properties: z.array(PropertySchema).optional(),
});

const ObjectGroupSchema = z.object({
  type: z.literal('objectgroup'),
  name: z.string(),
  objects: z.array(ObjectSchema),
});

const OtherLayerSchema = z.looseObject({ type: z.string() });

const TilesetSchema = z.object({
  firstgid: z.number().int().positive(),
  name: z.string().optional(),
  source: z.string().optional(),
  tiles: z
    .array(z.object({ id: z.number().int().nonnegative(), properties: z.array(PropertySchema).optional() }))
    .optional(),
});

export const TiledMapSchema = z.object({
  type: z.literal('map'),
  orientation: z.literal('orthogonal'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  infinite: z.literal(false).optional(),
  layers: z.array(z.union([TileLayerSchema, ObjectGroupSchema, OtherLayerSchema])),
  tilesets: z.array(TilesetSchema),
  properties: z.array(PropertySchema).optional(),
});
export type TiledMap = z.infer<typeof TiledMapSchema>;

/** Tiled speichert Spiegelungen in den obersten Bits der Kachel-ID. */
const GID_MASK = 0x0fffffff;

function propsToRecord(props: z.infer<typeof PropertySchema>[] | undefined) {
  const out: Record<string, string | number | boolean> = {};
  for (const p of props ?? []) out[p.name] = p.value;
  return out;
}

/** Prüft eine Tiled-Karte und wandelt sie in eine GameMap um. Wirft bei Fehlern eine verständliche Meldung. */
export function parseTiledMap(json: unknown): GameMap {
  const parsed = TiledMapSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Ungültige Kartendatei: ${z.prettifyError(parsed.error)}`);
  }
  const map = parsed.data;

  // Kachel-ID → Geländeart
  const gidToTerrain = new Map<number, number>();
  for (const ts of map.tilesets) {
    if (ts.source) {
      throw new Error(`Externe Tilesets (${ts.source}) werden nicht unterstützt – bitte im Editor einbetten.`);
    }
    for (const tile of ts.tiles ?? []) {
      const name = propsToRecord(tile.properties).terrain;
      if (typeof name !== 'string') continue;
      const t = terrainFromName(name);
      if (t === undefined) throw new Error(`Unbekannte Geländeart "${name}" in Tileset ${ts.name ?? ''}`);
      gidToTerrain.set(ts.firstgid + tile.id, t);
    }
  }

  const layer = map.layers.find(
    (l): l is z.infer<typeof TileLayerSchema> => l.type === 'tilelayer' && 'name' in l && l.name === 'terrain',
  );
  if (!layer) throw new Error('Kartendatei braucht eine Kachelebene namens "terrain".');
  if (layer.width !== map.width || layer.height !== map.height || layer.data.length !== map.width * map.height) {
    throw new Error('Grösse der Ebene "terrain" passt nicht zur Karte.');
  }

  const terrain = new Uint8Array(map.width * map.height);
  for (let i = 0; i < layer.data.length; i++) {
    const gid = layer.data[i] & GID_MASK;
    const t = gidToTerrain.get(gid);
    if (t === undefined) {
      throw new Error(`Kachel ${i % map.width}/${Math.floor(i / map.width)} hat keine Geländeart (gid ${gid}).`);
    }
    terrain[i] = t;
  }

  // Objekte: Pixel → Welteinheiten
  const scale = TILE / map.tilewidth;
  const objects: MapObject[] = [];
  for (const l of map.layers) {
    if (l.type !== 'objectgroup' || !('objects' in l)) continue;
    for (const o of (l as z.infer<typeof ObjectGroupSchema>).objects) {
      objects.push({
        id: o.id,
        kind: o.type ?? o.class ?? '',
        name: o.name,
        x: Math.round(o.x * scale),
        y: Math.round(o.y * scale),
        width: Math.round(o.width * scale),
        height: Math.round(o.height * scale),
        props: propsToRecord(o.properties),
      });
    }
  }

  return new GameMap(map.width, map.height, terrain, objects, propsToRecord(map.properties));
}
