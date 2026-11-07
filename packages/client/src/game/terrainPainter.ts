import { Rng, TILE_PX, Terrain, type GameMap } from '@fftr/shared';

/**
 * Malt das Gelände als grosse Bilder (Kacheln zu je CHUNK×CHUNK Feldern).
 * Statt harter Kachelkanten bekommen Wasser, Klippen, Sand und Strassen
 * abgerundete Ränder mit Comic-Kontur, Bäume stehen frei und überlappen.
 * Die Spiellogik bleibt kachelgenau – das hier ist nur Optik.
 */

export const CHUNK = 32;
const T = TILE_PX;
const OUTLINE = '#1d1a2b';

interface Layer {
  terrain: number;
  fill: (ctx: CanvasRenderingContext2D) => CanvasPattern | string;
  outline: string | null;
  outlineWidth: number;
  /** Eckenradius für freie Ecken. */
  radius: number;
  /** Eigenes Zeichnen nach dem Füllen (Details). */
  decorate?: (ctx: CanvasRenderingContext2D, tiles: [number, number][], rnd: Rng) => void;
}

function patternCanvas(size: number, paint: (ctx: CanvasRenderingContext2D, rnd: Rng) => void, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  paint(c.getContext('2d')!, new Rng(seed));
  return c;
}

/** Wiederholbare Muster für die Flächen. */
function makePatterns() {
  const grass = patternCanvas(
    128,
    (ctx, rnd) => {
      ctx.fillStyle = '#78c251';
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = rnd.nextFloat() < 0.5 ? 'rgba(88,166,58,0.35)' : 'rgba(160,220,110,0.3)';
        ctx.beginPath();
        ctx.arc(rnd.nextFloat() * 128, rnd.nextFloat() * 128, 4 + rnd.nextFloat() * 10, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 160; i++) {
        const x = rnd.nextFloat() * 128;
        const y = rnd.nextFloat() * 128;
        ctx.strokeStyle = rnd.nextFloat() < 0.5 ? '#5aa83c' : '#9ad96d';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd.nextFloat() - 0.5) * 3, y - 4);
        ctx.stroke();
      }
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = ['#fff6a8', '#ffffff', '#ffb3d1'][i % 3];
        const x = rnd.nextFloat() * 126;
        const y = rnd.nextFloat() * 126;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    1,
  );
  const sand = patternCanvas(
    96,
    (ctx, rnd) => {
      ctx.fillStyle = '#ecd590';
      ctx.fillRect(0, 0, 96, 96);
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = rnd.nextFloat() < 0.5 ? '#d8bd72' : '#f8e8b4';
        const s = rnd.nextFloat() < 0.3 ? 2 : 1.2;
        ctx.fillRect(rnd.nextFloat() * 96, rnd.nextFloat() * 96, s, s);
      }
      ctx.strokeStyle = 'rgba(190,160,90,0.45)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const x = rnd.nextFloat() * 96;
        const y = rnd.nextFloat() * 96;
        ctx.beginPath();
        ctx.arc(x, y, 8, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    },
    2,
  );
  const road = patternCanvas(
    64,
    (ctx, rnd) => {
      ctx.fillStyle = '#8f919c';
      ctx.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = rnd.nextFloat() < 0.5 ? '#7f818c' : '#a3a5b0';
        ctx.fillRect(rnd.nextFloat() * 64, rnd.nextFloat() * 64, 2, 1.5);
      }
    },
    3,
  );
  const water = patternCanvas(
    128,
    (ctx, rnd) => {
      ctx.fillStyle = '#3d92d8';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(160,215,255,0.7)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 16; i++) {
        const x = rnd.nextFloat() * 128;
        const y = rnd.nextFloat() * 128;
        ctx.beginPath();
        ctx.arc(x, y, 5, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    },
    4,
  );
  const rock = patternCanvas(
    96,
    (ctx, rnd) => {
      ctx.fillStyle = '#866a48';
      ctx.fillRect(0, 0, 96, 96);
      for (let i = 0; i < 22; i++) {
        const cx = rnd.nextFloat() * 96;
        const cy = rnd.nextFloat() * 96;
        const r = 6 + rnd.nextFloat() * 9;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + rnd.nextFloat() * 0.5;
          const rr = r * (0.7 + rnd.nextFloat() * 0.3);
          if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = i % 3 === 0 ? '#a88a62' : i % 3 === 1 ? '#977a54' : '#b9996d';
        ctx.fill();
        ctx.strokeStyle = '#4e3b27';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,235,200,0.35)';
        ctx.beginPath();
        ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    5,
  );
  const planks = patternCanvas(
    32,
    (ctx) => {
      ctx.fillStyle = '#b8824a';
      ctx.fillRect(0, 0, 32, 32);
      ctx.strokeStyle = '#6e4a2a';
      ctx.lineWidth = 1.5;
      for (let x = 0; x < 32; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, 32);
        ctx.stroke();
      }
    },
    6,
  );
  return { grass, sand, road, water, rock, planks };
}

/** Rechteck pro Kachel; freie Ecken werden abgerundet → organische Ränder. */
function blobPath(map: GameMap, tiles: [number, number][], terrain: number, radius: number, inflate: number, ox: number, oy: number): Path2D {
  const same = (x: number, y: number) => !map.inBounds(x, y) || map.terrainAt(x, y) === terrain || (terrain === Terrain.Water && map.terrainAt(x, y) === Terrain.Bridge);
  const p = new Path2D();
  for (const [x, y] of tiles) {
    const n = same(x, y - 1);
    const s = same(x, y + 1);
    const w = same(x - 1, y);
    const e = same(x + 1, y);
    const r = (a: boolean, b: boolean) => (a || b ? 0 : radius);
    const px = x * T - ox - inflate;
    const py = y * T - oy - inflate;
    p.roundRect(px, py, T + inflate * 2, T + inflate * 2, [r(n, w), r(n, e), r(s, e), r(s, w)]);
  }
  return p;
}

export interface TerrainChunk {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

/** Malt die ganze Karte in Bilder zu je CHUNK×CHUNK Kacheln. */
export function paintTerrain(map: GameMap): TerrainChunk[] {
  const pats = makePatterns();
  const chunks: TerrainChunk[] = [];
  const rnd = new Rng(4242);

  // Bäume einmal für die ganze Karte bestimmen (damit sie über Chunkgrenzen passen)
  const trees: { x: number; y: number; r: number; shade: number }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.terrainAt(x, y) !== Terrain.Forest) continue;
      const n = 2 + rnd.nextInt(2);
      for (let i = 0; i < n; i++) {
        trees.push({
          x: (x + 0.15 + rnd.nextFloat() * 0.7) * T,
          y: (y + 0.15 + rnd.nextFloat() * 0.7) * T,
          r: 8 + rnd.nextFloat() * 5,
          shade: rnd.nextFloat(),
        });
      }
    }
  }
  trees.sort((a, b) => a.y - b.y);

  for (let cy = 0; cy < map.height; cy += CHUNK) {
    for (let cx = 0; cx < map.width; cx += CHUNK) {
      const wTiles = Math.min(CHUNK, map.width - cx);
      const hTiles = Math.min(CHUNK, map.height - cy);
      const canvas = document.createElement('canvas');
      canvas.width = wTiles * T;
      canvas.height = hTiles * T;
      const ctx = canvas.getContext('2d')!;
      const ox = cx * T;
      const oy = cy * T;
      const pat = (c: HTMLCanvasElement) => {
        const p = ctx.createPattern(c, 'repeat')!;
        // Muster an Weltkoordinaten ausrichten, damit Chunks nahtlos sind
        p.setTransform(new DOMMatrix().translate(-ox, -oy));
        return p;
      };

      ctx.fillStyle = pat(pats.grass);
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Kacheln je Geländeart sammeln (mit 1 Kachel Rand für Übergänge)
      const byTerrain = new Map<number, [number, number][]>();
      for (let y = cy - 1; y < cy + hTiles + 1; y++) {
        for (let x = cx - 1; x < cx + wTiles + 1; x++) {
          if (!map.inBounds(x, y)) continue;
          const t = map.terrainAt(x, y);
          const list = byTerrain.get(t) ?? [];
          list.push([x, y]);
          byTerrain.set(t, list);
        }
      }

      const layers: Layer[] = [
        { terrain: Terrain.Sand, fill: () => pat(pats.sand), outline: 'rgba(170,140,70,0.55)', outlineWidth: 2, radius: 12 },
        { terrain: Terrain.Road, fill: () => pat(pats.road), outline: '#6a6c76', outlineWidth: 2, radius: 8 },
        {
          terrain: Terrain.Water,
          fill: () => pat(pats.water),
          outline: OUTLINE,
          outlineWidth: 3,
          radius: 14,
        },
        { terrain: Terrain.Bridge, fill: () => pat(pats.planks), outline: '#4b3220', outlineWidth: 2, radius: 0 },
        { terrain: Terrain.Cliff, fill: () => pat(pats.rock), outline: OUTLINE, outlineWidth: 3, radius: 12 },
      ];

      for (const layer of layers) {
        const tiles = byTerrain.get(layer.terrain);
        if (!tiles) continue;
        // Wasser: helles Ufer unter der Kontur
        if (layer.terrain === Terrain.Water) {
          ctx.fillStyle = '#e9dca0';
          ctx.fill(blobPath(map, tiles, layer.terrain, layer.radius + 4, 4, ox, oy));
        }
        // Klippen: Schattenwurf nach rechts unten
        if (layer.terrain === Terrain.Cliff) {
          ctx.save();
          ctx.translate(4, 5);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fill(blobPath(map, tiles, layer.terrain, layer.radius, 0, ox, oy));
          ctx.restore();
        }
        if (layer.outline) {
          ctx.fillStyle = layer.outline;
          ctx.fill(blobPath(map, tiles, layer.terrain, layer.radius + layer.outlineWidth, layer.outlineWidth, ox, oy));
        }
        ctx.fillStyle = layer.fill(ctx);
        ctx.fill(blobPath(map, tiles, layer.terrain, layer.radius, 0, ox, oy));
        // Wasser: helle Linie innen am Rand
        if (layer.terrain === Terrain.Water) {
          ctx.save();
          ctx.clip(blobPath(map, tiles, layer.terrain, layer.radius, 0, ox, oy));
          ctx.strokeStyle = 'rgba(200,235,255,0.6)';
          ctx.lineWidth = 3;
          ctx.stroke(blobPath(map, tiles, layer.terrain, layer.radius, -3, ox, oy));
          ctx.restore();
        }
        // Klippen: obere Lichtkante
        if (layer.terrain === Terrain.Cliff) {
          ctx.save();
          ctx.clip(blobPath(map, tiles, layer.terrain, layer.radius, 0, ox, oy));
          ctx.translate(-2, -2);
          ctx.strokeStyle = 'rgba(255,230,190,0.35)';
          ctx.lineWidth = 3;
          ctx.stroke(blobPath(map, tiles, layer.terrain, layer.radius, -2, ox, oy));
          ctx.restore();
        }
      }

      // Bäume (auch die vom Nachbar-Chunk, die hereinragen)
      for (const tr of trees) {
        const x = tr.x - ox;
        const y = tr.y - oy;
        if (x < -20 || y < -20 || x > canvas.width + 20 || y > canvas.height + 20) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.arc(x + 3, y + 4, tr.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = tr.shade < 0.5 ? '#2f8a3a' : '#3a9a3f';
        ctx.strokeStyle = '#174520';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, tr.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#5bbd5f';
        ctx.beginPath();
        ctx.arc(x - tr.r * 0.3, y - tr.r * 0.32, tr.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      chunks.push({ canvas, x: ox, y: oy });
    }
  }
  return chunks;
}

/** Grundfarben für die Minikarte. */
export const MINIMAP_COLORS = ['#78c251', '#ecd590', '#8f919c', '#2f8a3a', '#866a48', '#3d92d8', '#b8824a'];
