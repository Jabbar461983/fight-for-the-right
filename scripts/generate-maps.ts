/**
 * Erzeugt die Startkarten als Tiled-JSON (data/maps/*.json) plus ein einfaches
 * Tileset-Bild, damit man die Karten im Editor «Tiled» öffnen und weiter
 * bearbeiten kann.
 *
 * Aufruf: npm run maps
 *
 * Die Karten sind punktsymmetrisch (180° gedreht), damit beide Startplätze fair sind.
 * Dieses Skript läuft direkt mit Node (Typ-Stripping), daher keine Imports aus dem Projekt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data', 'maps');
const TILE_PX = 32;

const TERRAINS = ['grass', 'sand', 'road', 'forest', 'cliff', 'water', 'bridge'] as const;
type TerrainName = (typeof TERRAINS)[number];
const T: Record<TerrainName, number> = { grass: 0, sand: 1, road: 2, forest: 3, cliff: 4, water: 5, bridge: 6 };

// ───────────── Hilfen ─────────────

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Glatte Wertrausch-Funktion im Bereich [0,1]. */
function valueNoise(seed: number, cell: number, size: number) {
  const rnd = mulberry32(seed);
  const n = Math.ceil(size / cell) + 2;
  const grid = Array.from({ length: n * n }, () => rnd());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = smooth(gx - x0);
    const fy = smooth(gy - y0);
    const v = (xx: number, yy: number) => grid[yy * n + xx];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * fx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

class MapBuilder {
  readonly data: number[];
  readonly objects: { name: string; type: string; x: number; y: number; props: Record<string, number | string> }[] = [];

  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Array(w * h).fill(T.grass);
  }

  /** Gespiegelte Kachel (180° um die Kartenmitte). */
  mirror(x: number, y: number): [number, number] {
    return [this.w - 1 - x, this.h - 1 - y];
  }

  /** Kanonische Koordinate: aus jedem Spiegelpaar immer dieselbe – für symmetrisches Rauschen. */
  canon(x: number, y: number): [number, number] {
    const [mx, my] = this.mirror(x, y);
    return y * this.w + x <= my * this.w + mx ? [x, y] : [mx, my];
  }

  set(x: number, y: number, t: number, symmetric = true) {
    const put = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= this.w || py >= this.h) return;
      this.data[py * this.w + px] = t;
    };
    put(x, y);
    if (symmetric) put(...this.mirror(x, y));
  }

  get(x: number, y: number) {
    return this.data[y * this.w + x];
  }

  /** Füllt eine Kreisscheibe. `filter` entscheidet, ob eine bestehende Kachel überschrieben wird. */
  disc(cx: number, cy: number, r: number, t: number, filter: (old: number) => boolean = () => true) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        if (filter(this.get(x, y))) this.set(x, y, t);
      }
    }
  }

  /** Zeichnet eine dicke Linie (Strasse, Klippe). */
  line(x0: number, y0: number, x1: number, y1: number, thickness: number, t: (old: number) => number) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= steps; i++) {
      const fx = x0 + ((x1 - x0) * i) / steps;
      const fy = y0 + ((y1 - y0) * i) / steps;
      for (let oy = 0; oy < thickness; oy++) {
        for (let ox = 0; ox < thickness; ox++) {
          const x = Math.round(fx) + ox;
          const y = Math.round(fy) + oy;
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          this.set(x, y, t(this.get(x, y)));
        }
      }
    }
  }

  polyline(points: [number, number][], thickness: number, t: (old: number) => number) {
    for (let i = 0; i + 1 < points.length; i++) {
      this.line(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], thickness, t);
    }
  }

  /** Objekt (Kachelkoordinaten) plus gespiegeltes Gegenstück. */
  object(name: string, type: string, x: number, y: number, props: Record<string, number | string>, mirrorProps?: Record<string, number | string>) {
    this.objects.push({ name, type, x, y, props });
    if (mirrorProps) {
      const [mx, my] = [this.w - x, this.h - y];
      this.objects.push({ name: name.replace(/1$/, '2'), type, x: mx, y: my, props: mirrorProps });
    }
  }

  toTiled(props: Record<string, number | string>) {
    let nextId = 1;
    const prop = (name: string, value: number | string) => ({
      name,
      type: typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : 'string',
      value,
    });
    return {
      type: 'map',
      version: '1.10',
      tiledversion: '1.11.0',
      orientation: 'orthogonal',
      renderorder: 'right-down',
      width: this.w,
      height: this.h,
      tilewidth: TILE_PX,
      tileheight: TILE_PX,
      infinite: false,
      nextlayerid: 3,
      nextobjectid: this.objects.length + 1,
      properties: Object.entries(props).map(([k, v]) => prop(k, v)),
      tilesets: [
        {
          firstgid: 1,
          name: 'terrain',
          tilewidth: TILE_PX,
          tileheight: TILE_PX,
          tilecount: TERRAINS.length,
          columns: TERRAINS.length,
          margin: 0,
          spacing: 0,
          image: 'terrain-tiles.png',
          imagewidth: TILE_PX * TERRAINS.length,
          imageheight: TILE_PX,
          tiles: TERRAINS.map((name, id) => ({ id, properties: [prop('terrain', name)] })),
        },
      ],
      layers: [
        {
          id: 1,
          type: 'tilelayer',
          name: 'terrain',
          x: 0,
          y: 0,
          width: this.w,
          height: this.h,
          opacity: 1,
          visible: true,
          data: this.data.map((t) => t + 1),
        },
        {
          id: 2,
          type: 'objectgroup',
          name: 'objects',
          draworder: 'topdown',
          opacity: 1,
          visible: true,
          x: 0,
          y: 0,
          objects: this.objects.map((o) => ({
            id: nextId++,
            name: o.name,
            type: o.type,
            x: o.x * TILE_PX,
            y: o.y * TILE_PX,
            width: 0,
            height: 0,
            rotation: 0,
            visible: true,
            point: true,
            properties: Object.entries(o.props).map(([k, v]) => prop(k, v)),
          })),
        },
      ],
    };
  }
}

// ───────────── Karte «Kristalltal» (2 Spieler, reine Landkarte) ─────────────

function kristalltal() {
  const m = new MapBuilder(64, 64);
  const sand = valueNoise(11, 7, 64);
  const forest = valueNoise(23, 5, 64);

  // Grundgelände aus symmetrischem Rauschen
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const [cx, cy] = m.canon(x, y);
      if (forest(cx, cy) > 0.7) m.set(x, y, T.forest, false);
      else if (sand(cx, cy) > 0.66) m.set(x, y, T.sand, false);
    }
  }

  // Seen
  m.disc(31.5, 31.5, 3.2, T.water);
  m.disc(8, 24, 3.4, T.water);

  // Klippen schützen die Basis mit zwei Durchgängen (Spieler 1 unten links, gespiegelt für Spieler 2)
  const cliff = () => T.cliff;
  m.line(0, 41, 24, 41, 1, cliff);
  m.line(24, 41, 24, 63, 1, cliff);
  m.line(16, 18, 22, 24, 2, cliff);
  m.line(44, 52, 50, 58, 1, cliff);

  // Basisflächen frei räumen
  m.disc(10, 53, 6.5, T.grass);

  // Strassen (Wasser → Brücke)
  const road = (old: number) => (old === T.water || old === T.bridge ? T.bridge : T.road);
  m.polyline([[10, 53], [14, 49], [14, 38], [20, 32], [28, 28]], 2, road);
  m.polyline([[10, 53], [18, 51], [30, 51], [34, 44], [35, 35]], 2, road);
  // Ring um den Mittelsee
  m.polyline([[27, 27], [36, 27]], 2, road);
  m.polyline([[27, 27], [27, 36]], 2, road);

  // Startpunkte und Glimmerit-Felder (Kachelkoordinaten; Mitte der Kachel = +0.5)
  m.object('spawn1', 'spawn', 10.5, 53.5, { player: 1 }, { player: 2 });
  m.object('crystal1', 'crystalField', 17.5, 58, { radius: 2.5, amount: 6000 }, { radius: 2.5, amount: 6000 });
  m.object('crystalWest1', 'crystalField', 5, 33, { radius: 2, amount: 4000 }, { radius: 2, amount: 4000 });
  m.object('crystalEast1', 'crystalField', 42, 50, { radius: 2.5, amount: 5000 }, { radius: 2.5, amount: 5000 });

  return m.toTiled({ nameKey: 'map.kristalltal.name', maxPlayers: 2 });
}

// ───────────── Tileset-Bild (einfarbig, nur für den Editor) ─────────────

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function png(width: number, height: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const EDITOR_COLORS: [number, number, number][] = [
  [111, 191, 74], // Gras
  [232, 208, 138], // Sand
  [125, 127, 138], // Strasse
  [46, 120, 52], // Wald
  [138, 109, 75], // Klippe
  [59, 143, 214], // Wasser
  [176, 122, 69], // Brücke
];

// ───────────── Ausgabe ─────────────

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'kristalltal.json'), JSON.stringify(kristalltal()) + '\n');
writeFileSync(
  join(OUT_DIR, 'terrain-tiles.png'),
  png(TILE_PX * TERRAINS.length, TILE_PX, (x, y) => {
    const c = EDITOR_COLORS[Math.floor(x / TILE_PX)];
    const edge = x % TILE_PX === 0 || y === 0;
    return edge ? [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8].map(Math.round) as [number, number, number] : c;
  }),
);
console.log('Karten erzeugt in', OUT_DIR);
