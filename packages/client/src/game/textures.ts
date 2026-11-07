import type * as Phaser from 'phaser';
import { Rng, TERRAIN_NAMES, TILE_PX, type UnitDef } from '@fftr/shared';

/**
 * Platzhalter-Grafiken, die zur Laufzeit auf Canvas gezeichnet werden.
 * Stil: Comic mit dunkler Kontur, kräftigen Farben, einfachen Lichtkanten.
 * Wird in Etappe 6 durch echte Sprites ersetzt – die Schlüssel (Texture-Keys)
 * bleiben dabei gleich, damit sich nichts anderes ändern muss.
 */

const OUTLINE = '#1d1a2b';

/** Varianten pro Geländeart (gegen sichtbare Wiederholung). */
export const TERRAIN_VARIANTS = 4;
/** Rand/Abstand im Tileset gegen Nähte beim Zoomen (Kanten werden «extrudiert»). */
const TS_MARGIN = 1;
const TS_SPACING = 2;

export const TERRAIN_TEXTURE = 'terrain';

// ───────────── Farben ─────────────

/** Hellt (f>1) oder dunkelt (f<1) eine Farbe ab. */
function shade(color: number, f: number): string {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ───────────── Gelände ─────────────

function drawGrassBase(ctx: CanvasRenderingContext2D, rnd: Rng, variant: number) {
  ctx.fillStyle = '#76c04f';
  ctx.fillRect(0, 0, 32, 32);
  // leichte Fleckigkeit
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = rnd.nextFloat() < 0.5 ? 'rgba(90,168,60,0.35)' : 'rgba(150,215,100,0.3)';
    ctx.beginPath();
    ctx.arc(rnd.nextFloat() * 32, rnd.nextFloat() * 32, 3 + rnd.nextFloat() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Grashalme
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const x = 2 + rnd.nextFloat() * 28;
    const y = 4 + rnd.nextFloat() * 26;
    ctx.strokeStyle = rnd.nextFloat() < 0.5 ? '#5aa83c' : '#93d968';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd.nextFloat() - 0.5) * 2, y - 3);
    ctx.stroke();
  }
  if (variant === 3) {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i % 2 ? '#fff6a8' : '#ffffff';
      ctx.fillRect(4 + rnd.nextFloat() * 24, 4 + rnd.nextFloat() * 24, 2, 2);
    }
  }
}

function drawTerrainTile(ctx: CanvasRenderingContext2D, terrain: number, variant: number) {
  const rnd = new Rng(terrain * 97 + variant * 13 + 5);
  switch (TERRAIN_NAMES[terrain]) {
    case 'grass':
      drawGrassBase(ctx, rnd, variant);
      break;
    case 'sand': {
      ctx.fillStyle = '#e9d18c';
      ctx.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = rnd.nextFloat() < 0.5 ? '#d4b86e' : '#f7e6ad';
        const s = rnd.nextFloat() < 0.3 ? 2 : 1;
        ctx.fillRect(rnd.nextFloat() * 31, rnd.nextFloat() * 31, s, s);
      }
      if (variant === 2) {
        ctx.fillStyle = '#b89c5c';
        ctx.beginPath();
        ctx.ellipse(10 + rnd.nextFloat() * 12, 10 + rnd.nextFloat() * 12, 2.5, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'road': {
      ctx.fillStyle = '#8b8d98';
      ctx.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = rnd.nextFloat() < 0.5 ? '#7b7d88' : '#9d9faa';
        ctx.fillRect(rnd.nextFloat() * 31, rnd.nextFloat() * 31, 2, 1);
      }
      if (variant === 1) {
        ctx.strokeStyle = '#6f717c';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(6, 20);
        ctx.lineTo(11, 17);
        ctx.lineTo(14, 21);
        ctx.stroke();
      }
      break;
    }
    case 'forest': {
      drawGrassBase(ctx, rnd, 0);
      const trees = 3 + (variant % 2);
      for (let i = 0; i < trees; i++) {
        const r = 6 + rnd.nextFloat() * 3;
        const x = r + 1 + rnd.nextFloat() * (30 - 2 * r);
        const y = r + 1 + rnd.nextFloat() * (30 - 2 * r);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.arc(x + 2, y + 2, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2f8a3a';
        ctx.strokeStyle = '#1b4d22';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#56b25e';
        ctx.beginPath();
        ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'cliff': {
      ctx.fillStyle = '#7a5f40';
      ctx.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 4; i++) {
        const cx = 4 + rnd.nextFloat() * 24;
        const cy = 4 + rnd.nextFloat() * 24;
        const r = 5 + rnd.nextFloat() * 5;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + rnd.nextFloat() * 0.5;
          const rr = r * (0.7 + rnd.nextFloat() * 0.3);
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = i % 2 ? '#a3845d' : '#94754f';
        ctx.fill();
        ctx.strokeStyle = '#4e3b27';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,230,190,0.35)';
        ctx.beginPath();
        ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'water':
    case 'bridge': {
      ctx.fillStyle = '#3b8fd6';
      ctx.fillRect(0, 0, 32, 32);
      ctx.strokeStyle = '#74b8ee';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const x = 3 + rnd.nextFloat() * 22;
        const y = 5 + i * 10 + rnd.nextFloat() * 3;
        ctx.beginPath();
        ctx.arc(x + 3, y, 3, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      if (TERRAIN_NAMES[terrain] === 'bridge') {
        ctx.fillStyle = '#b07a45';
        ctx.fillRect(0, 2, 32, 28);
        ctx.strokeStyle = '#6e4a2a';
        ctx.lineWidth = 1;
        for (let y = 2; y <= 30; y += 7) {
          ctx.beginPath();
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(32, y + 0.5);
          ctx.stroke();
        }
        ctx.fillStyle = '#4b3220';
        ctx.fillRect(0, 1, 32, 2);
        ctx.fillRect(0, 29, 32, 2);
      }
      break;
    }
  }
}

/**
 * Erzeugt das Gelände-Tileset: Zeile = Geländeart, Spalte = Variante.
 * Tile-Index = terrain * TERRAIN_VARIANTS + variant.
 */
export function createTerrainTexture(scene: Phaser.Scene): void {
  const cols = TERRAIN_VARIANTS;
  const rows = TERRAIN_NAMES.length;
  const step = TILE_PX + TS_SPACING;
  const [c, ctx] = canvas(TS_MARGIN * 2 + cols * step - TS_SPACING, TS_MARGIN * 2 + rows * step - TS_SPACING);
  const [tile, tctx] = canvas(TILE_PX, TILE_PX);
  for (let t = 0; t < rows; t++) {
    for (let v = 0; v < cols; v++) {
      tctx.clearRect(0, 0, TILE_PX, TILE_PX);
      drawTerrainTile(tctx, t, v);
      const x = TS_MARGIN + v * step;
      const y = TS_MARGIN + t * step;
      ctx.drawImage(tile, x, y);
      // Kanten um 1 px nach aussen kopieren (verhindert Nähte bei krummem Zoom)
      ctx.drawImage(tile, 0, 0, 1, TILE_PX, x - 1, y, 1, TILE_PX);
      ctx.drawImage(tile, TILE_PX - 1, 0, 1, TILE_PX, x + TILE_PX, y, 1, TILE_PX);
      ctx.drawImage(tile, 0, 0, TILE_PX, 1, x, y - 1, TILE_PX, 1);
      ctx.drawImage(tile, 0, TILE_PX - 1, TILE_PX, 1, x, y + TILE_PX, TILE_PX, 1);
    }
  }
  scene.textures.addCanvas(TERRAIN_TEXTURE, c);
}

export const TERRAIN_TILESET = { margin: TS_MARGIN, spacing: TS_SPACING };

// ───────────── Einheiten ─────────────

/** Einheiten werden doppelt so gross gezeichnet und mit Massstab 0.5 angezeigt (scharf beim Zoomen). */
export const UNIT_TEXTURE_SCALE = 0.5;

export function unitTextureKey(sprite: string, color: number, part: 'body' | 'turret' = 'body'): string {
  return `${sprite}_${part}_${color.toString(16)}`;
}

function drawShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 4, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Infanterie von oben, Blickrichtung nach rechts. */
function drawInfantry(color: number, rocket: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(40, 40);
  const cx = 18;
  const cy = 20;
  drawShadow(ctx, cx, cy, 10, 8);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  // Rucksack (Retro-Raketenrucksack)
  roundRect(ctx, cx - 11, cy - 6, 7, 12, 3);
  ctx.fillStyle = '#c9ccd6';
  ctx.fill();
  ctx.stroke();
  // Waffe
  if (rocket) {
    roundRect(ctx, cx - 6, cy - 12, 22, 6, 3);
    ctx.fillStyle = '#5b6a4a';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e8483b';
    ctx.fillRect(cx + 13, cy - 11, 3, 4);
  } else {
    ctx.fillStyle = '#3a3a46';
    roundRect(ctx, cx, cy + 2, 17, 4, 1.5);
    ctx.fill();
    ctx.stroke();
  }
  // Schultern
  ctx.fillStyle = shade(color, 1);
  ctx.beginPath();
  ctx.ellipse(cx, cy, 7, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Helm
  ctx.fillStyle = shade(color, 0.7);
  ctx.beginPath();
  ctx.arc(cx + 1, cy, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(cx - 0.5, cy - 2, 2, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Fahrzeugwanne mit Ketten, Blickrichtung nach rechts. */
function drawHull(color: number, long: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(72, 72);
  const cx = 36;
  const cy = 36;
  const hl = long ? 26 : 23; // halbe Länge
  drawShadow(ctx, cx, cy, hl + 2, 18);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  // Ketten
  for (const sy of [-1, 1]) {
    roundRect(ctx, cx - hl - 1, cy + sy * 13 - 6, hl * 2 + 2, 12, 5);
    ctx.fillStyle = '#3a3a46';
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#5c5c6c';
    ctx.lineWidth = 1.5;
    for (let x = cx - hl + 3; x < cx + hl; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x, cy + sy * 13 - 4);
      ctx.lineTo(x, cy + sy * 13 + 4);
      ctx.stroke();
    }
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
  }
  // Wanne
  roundRect(ctx, cx - hl + 2, cy - 11, hl * 2 - 2, 22, 6);
  ctx.fillStyle = shade(color, 0.95);
  ctx.fill();
  ctx.stroke();
  // Lichtkante vorne, Heckflossen
  ctx.fillStyle = shade(color, 1.3);
  roundRect(ctx, cx + hl - 10, cy - 8, 7, 16, 3);
  ctx.fill();
  ctx.fillStyle = shade(color, 0.6);
  ctx.beginPath();
  ctx.moveTo(cx - hl + 2, cy - 11);
  ctx.lineTo(cx - hl - 5, cy - 15);
  ctx.lineTo(cx - hl + 8, cy - 11);
  ctx.closePath();
  ctx.moveTo(cx - hl + 2, cy + 11);
  ctx.lineTo(cx - hl - 5, cy + 15);
  ctx.lineTo(cx - hl + 8, cy + 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return c;
}

/** Drehbarer Turm mit Kanone, Blickrichtung nach rechts. Drehpunkt = Bildmitte. */
function drawTurret(color: number, longBarrel: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(72, 72);
  const cx = 36;
  const cy = 36;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  // Rohr
  const len = longBarrel ? 34 : 24;
  roundRect(ctx, cx, cy - 3, len, 6, 2);
  ctx.fillStyle = '#4a4a58';
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, cx + len - 5, cy - 4.5, 6, 9, 2);
  ctx.fillStyle = '#2e2e3a';
  ctx.fill();
  ctx.stroke();
  // Turmkuppel
  ctx.fillStyle = shade(color, 1.1);
  ctx.beginPath();
  ctx.arc(cx, cy, longBarrel ? 8 : 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(cx - 3, cy - 3, 3, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** Erzeugt alle Einheiten-Texturen für alle Spielerfarben. */
export function createUnitTextures(scene: Phaser.Scene, defs: Iterable<UnitDef>, colors: number[]): void {
  for (const def of defs) {
    for (const color of colors) {
      const bodyKey = unitTextureKey(def.sprite, color);
      if (scene.textures.exists(bodyKey)) continue;
      switch (def.sprite) {
        case 'rifleman':
          scene.textures.addCanvas(bodyKey, drawInfantry(color, false));
          break;
        case 'rocketeer':
          scene.textures.addCanvas(bodyKey, drawInfantry(color, true));
          break;
        case 'artillery':
          scene.textures.addCanvas(bodyKey, drawHull(color, true));
          scene.textures.addCanvas(unitTextureKey(def.sprite, color, 'turret'), drawTurret(color, true));
          break;
        default:
          // Unbekannte Sprites bekommen den Panzer-Platzhalter.
          scene.textures.addCanvas(bodyKey, drawHull(color, false));
          scene.textures.addCanvas(unitTextureKey(def.sprite, color, 'turret'), drawTurret(color, false));
      }
    }
  }
}

// ───────────── Deko ─────────────

export const CRYSTAL_TEXTURE = 'crystal';

/** Leuchtende Glimmerit-Kristalle (Deko; ab Etappe 2 abbaubar). */
export function createCrystalTexture(scene: Phaser.Scene): void {
  const [c, ctx] = canvas(48, 48);
  const glow = ctx.createRadialGradient(24, 26, 2, 24, 26, 22);
  glow.addColorStop(0, 'rgba(120,255,255,0.55)');
  glow.addColorStop(1, 'rgba(120,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 48, 48);
  const gem = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + w, y - h * 0.35);
    ctx.lineTo(x + w * 0.7, y + h * 0.4);
    ctx.lineTo(x - w * 0.7, y + h * 0.4);
    ctx.lineTo(x - w, y - h * 0.35);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x - w * 0.4, y - h * 0.35);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  };
  gem(16, 30, 6, 12, '#c77dff');
  gem(31, 32, 6, 10, '#5ff0ff');
  gem(24, 24, 7, 16, '#7af7ff');
  scene.textures.addCanvas(CRYSTAL_TEXTURE, c);
}
