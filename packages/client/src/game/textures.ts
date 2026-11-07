import type * as Phaser from 'phaser';
import type { BuildingDef, Faction, UnitDef } from '@fftr/shared';

/**
 * Platzhalter-Grafiken, zur Laufzeit auf Canvas gezeichnet.
 * Stil: Retro-Futurismus im Comic-Look – dunkle Kontur, kräftige Farben, Lichtkanten.
 *  - Aero-Liga: rund, Chrom-Zierleisten, Heckflossen, Glaskuppeln
 *  - Granit-Union: kantig, Messingplatten, Nieten, Dampfrohre
 * Die Spielerfarbe ist immer die Hauptfarbe, damit man Freund und Feind sofort erkennt.
 * In Etappe 6 durch echte Sprites ersetzbar – die Texture-Keys bleiben gleich.
 */

const OUTLINE = '#1d1a2b';
/** Grafiken werden doppelt so gross gezeichnet und mit 0.5 angezeigt (scharf beim Zoomen). */
export const TEX_SCALE = 0.5;
/** Pixel pro Kachel in den Texturen. */
const TP = 64;

/** Spielerfarben (Index = Farbnummer in der Lobby). */
export const PLAYER_COLORS = [0x3fa9f5, 0xe8503a, 0x5cc44a, 0xf2c230, 0xa45fd4, 0xf28c28];

const TRIM: Record<Faction, { trim: string; dark: string; accent: string }> = {
  aero: { trim: '#e9f1f7', dark: '#2b4a66', accent: '#9fd8ff' },
  granite: { trim: '#c9a04c', dark: '#4a3b22', accent: '#e0c27a' },
};

// ───────────── Hilfen ─────────────

function rgb(color: number, f = 1): string {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return [c, ctx];
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string, lw = 2.5) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(x + 4, y + 5, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function highlight(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  circle(ctx, x, y, r);
  ctx.fill();
}

function rivets(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  for (const [x, y] of pts) {
    ctx.fillStyle = '#e8d29a';
    circle(ctx, x, y, 1.6);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    circle(ctx, x + 0.6, y + 0.6, 0.8);
    ctx.fill();
  }
}

// ───────────── Einheiten (Blick nach rechts) ─────────────

function drawInfantry(color: number, faction: Faction, kind: string): HTMLCanvasElement {
  const [c, ctx] = canvas(44, 44);
  const cx = 20;
  const cy = 22;
  const f = TRIM[faction];
  shadow(ctx, cx, cy, 10, 8);
  // Rucksack
  if (faction === 'aero') {
    rr(ctx, cx - 13, cy - 7, 9, 14, 5);
    fillStroke(ctx, f.trim, 2);
    ctx.fillStyle = '#ff9d3b';
    ctx.fillRect(cx - 15, cy - 4, 3, 3);
    ctx.fillRect(cx - 15, cy + 1, 3, 3);
  } else {
    rr(ctx, cx - 13, cy - 7, 9, 14, 1.5);
    fillStroke(ctx, f.trim, 2);
    rivets(ctx, [
      [cx - 11, cy - 4],
      [cx - 11, cy + 4],
    ]);
  }
  // Ausrüstung
  if (kind === 'rocket') {
    rr(ctx, cx - 6, cy - 13, 24, 6, 3);
    fillStroke(ctx, faction === 'aero' ? '#c6d4de' : '#6b7a4a', 2);
    ctx.fillStyle = '#e8483b';
    ctx.fillRect(cx + 15, cy - 12, 3, 4);
  } else if (kind === 'engineer') {
    rr(ctx, cx + 2, cy + 3, 13, 4, 1.5);
    fillStroke(ctx, '#9aa0aa', 2);
    circle(ctx, cx + 16, cy + 5, 3);
    fillStroke(ctx, '#9aa0aa', 1.5);
  } else {
    rr(ctx, cx, cy + 2, 18, 4, 1.5);
    fillStroke(ctx, '#3a3a46', 2);
  }
  // Schultern
  ctx.beginPath();
  ctx.ellipse(cx, cy, 7, 10, 0, 0, Math.PI * 2);
  fillStroke(ctx, rgb(color), 2);
  // Helm
  if (kind === 'engineer') {
    circle(ctx, cx + 1, cy, 6);
    fillStroke(ctx, '#ffd23f', 2);
  } else if (faction === 'aero') {
    circle(ctx, cx + 1, cy, 5.5);
    fillStroke(ctx, f.trim, 2);
    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    circle(ctx, cx + 3, cy, 2.6);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy, 7, 6.5, 0, 0, Math.PI * 2);
    fillStroke(ctx, f.trim, 2);
    circle(ctx, cx + 1, cy, 3.6);
    fillStroke(ctx, rgb(color, 0.7), 1.5);
  }
  highlight(ctx, cx - 1, cy - 2.5, 1.8);
  return c;
}

/** Wanne mit Ketten. kind: tank | flak | artillery | harvester | wagon */
function drawVehicle(color: number, faction: Faction, kind: string): HTMLCanvasElement {
  const big = kind === 'harvester' || kind === 'wagon';
  const [c, ctx] = canvas(80, 80);
  const cx = 40;
  const cy = 40;
  const f = TRIM[faction];
  const hl = big ? 28 : kind === 'artillery' ? 26 : 23;
  const hw = big ? 14 : 12;
  shadow(ctx, cx, cy, hl + 2, hw + 8);
  // Ketten
  for (const sy of [-1, 1]) {
    rr(ctx, cx - hl - 2, cy + sy * (hw + 2) - 6, hl * 2 + 4, 12, faction === 'aero' ? 6 : 2);
    fillStroke(ctx, '#3a3a46', 2.5);
    ctx.strokeStyle = '#5c5c6c';
    ctx.lineWidth = 1.5;
    for (let x = cx - hl + 2; x < cx + hl; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x, cy + sy * (hw + 2) - 4);
      ctx.lineTo(x, cy + sy * (hw + 2) + 4);
      ctx.stroke();
    }
  }
  // Wanne
  if (faction === 'aero') {
    rr(ctx, cx - hl, cy - hw, hl * 2, hw * 2, [hw, hw * 1.2, hw * 1.2, hw]);
    fillStroke(ctx, rgb(color));
    // Chromleiste
    ctx.strokeStyle = f.trim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - hl + 6, cy);
    ctx.lineTo(cx + hl - 6, cy);
    ctx.stroke();
    // Heckflossen
    ctx.beginPath();
    ctx.moveTo(cx - hl + 4, cy - hw + 2);
    ctx.lineTo(cx - hl - 8, cy - hw - 6);
    ctx.lineTo(cx - hl + 12, cy - hw + 2);
    ctx.closePath();
    fillStroke(ctx, f.trim, 2);
    ctx.beginPath();
    ctx.moveTo(cx - hl + 4, cy + hw - 2);
    ctx.lineTo(cx - hl - 8, cy + hw + 6);
    ctx.lineTo(cx - hl + 12, cy + hw - 2);
    ctx.closePath();
    fillStroke(ctx, f.trim, 2);
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - hl, cy - hw + 4);
    ctx.lineTo(cx - hl + 4, cy - hw);
    ctx.lineTo(cx + hl - 6, cy - hw);
    ctx.lineTo(cx + hl, cy - hw + 6);
    ctx.lineTo(cx + hl, cy + hw - 6);
    ctx.lineTo(cx + hl - 6, cy + hw);
    ctx.lineTo(cx - hl + 4, cy + hw);
    ctx.lineTo(cx - hl, cy + hw - 4);
    ctx.closePath();
    fillStroke(ctx, rgb(color));
    // Messingplatte und Nieten
    rr(ctx, cx - hl + 4, cy - hw + 3, 10, hw * 2 - 6, 1.5);
    fillStroke(ctx, f.trim, 1.5);
    rivets(ctx, [
      [cx - hl + 7, cy - hw + 6],
      [cx - hl + 7, cy + hw - 6],
      [cx + hl - 6, cy - hw + 4],
      [cx + hl - 6, cy + hw - 4],
    ]);
    // Dampfrohr
    rr(ctx, cx - hl + 2, cy - hw - 5, 6, 8, 2);
    fillStroke(ctx, '#5a5a66', 1.5);
  }
  // Lichtkante vorne
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  rr(ctx, cx + hl - 10, cy - hw + 4, 5, hw * 2 - 8, 2);
  ctx.fill();

  if (kind === 'harvester') {
    // Kristall-Fräse vorne, Ladebehälter hinten
    rr(ctx, cx + hl - 2, cy - hw - 2, 10, hw * 2 + 4, 3);
    fillStroke(ctx, '#7c808c', 2);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.5;
    for (let y = cy - hw; y < cy + hw; y += 5) {
      ctx.beginPath();
      ctx.moveTo(cx + hl, y);
      ctx.lineTo(cx + hl + 6, y + 2);
      ctx.stroke();
    }
    rr(ctx, cx - hl + 6, cy - hw + 4, hl, hw * 2 - 8, 3);
    fillStroke(ctx, rgb(color, 0.6), 2);
    ctx.fillStyle = '#7af7ff';
    for (const [x, y] of [
      [cx - 12, cy - 3],
      [cx - 4, cy + 3],
      [cx - 16, cy + 4],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 3, y);
      ctx.lineTo(x, y + 3);
      ctx.lineTo(x - 3, y);
      ctx.closePath();
      ctx.fill();
    }
    // Fahrerkabine
    rr(ctx, cx + 6, cy - 7, 12, 14, 4);
    fillStroke(ctx, f.trim, 2);
    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    rr(ctx, cx + 12, cy - 5, 4, 10, 2);
    ctx.fill();
  } else if (kind === 'wagon') {
    // Kran und Warnstreifen
    rr(ctx, cx - hl + 4, cy - 8, hl + 8, 16, 3);
    fillStroke(ctx, '#ffd23f', 2);
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    for (let x = cx - hl - 10; x < cx + 20; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, cy + 10);
      ctx.lineTo(x + 12, cy - 10);
      ctx.stroke();
    }
    ctx.restore();
    rr(ctx, cx - 6, cy - 3, 34, 6, 2);
    fillStroke(ctx, f.trim, 2);
    circle(ctx, cx - 6, cy, 6);
    fillStroke(ctx, rgb(color, 0.7), 2);
    rr(ctx, cx + 14, cy - 9, 12, 18, 4);
    fillStroke(ctx, f.trim, 2);
    ctx.fillStyle = 'rgba(120,200,255,0.9)';
    rr(ctx, cx + 20, cy - 6, 4, 12, 2);
    ctx.fill();
  }
  return c;
}

/** Drehbarer Turm, Drehpunkt = Bildmitte, Blick nach rechts. */
function drawTurret(color: number, faction: Faction, kind: string): HTMLCanvasElement {
  const [c, ctx] = canvas(80, 80);
  const cx = 40;
  const cy = 40;
  const f = TRIM[faction];
  const barrel = (y: number, len: number, w: number) => {
    rr(ctx, cx, y - w / 2, len, w, 2);
    fillStroke(ctx, faction === 'aero' ? '#c6d4de' : '#5a5a66', 2);
    rr(ctx, cx + len - 5, y - w / 2 - 1.5, 6, w + 3, 2);
    fillStroke(ctx, faction === 'aero' ? '#e9f1f7' : f.trim, 2);
  };
  if (kind === 'flak') {
    barrel(cy - 4, 22, 4);
    barrel(cy + 4, 22, 4);
  } else if (kind === 'artillery') {
    barrel(cy, 36, 6);
  } else if (kind === 'mgTower') {
    barrel(cy - 3, 20, 3);
    barrel(cy + 3, 20, 3);
  } else if (kind === 'cannonTower') {
    barrel(cy, 30, 8);
  } else {
    barrel(cy, 25, 6);
  }
  const r = kind === 'artillery' ? 9 : kind === 'cannonTower' ? 13 : 11;
  if (faction === 'aero') {
    circle(ctx, cx, cy, r);
    fillStroke(ctx, rgb(color, 1.1));
    ctx.fillStyle = 'rgba(140,210,255,0.85)';
    circle(ctx, cx + 2, cy, r * 0.45);
    ctx.fill();
    highlight(ctx, cx - 3, cy - 3, 2.5);
  } else {
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(ctx, rgb(color, 1.05));
    rivets(ctx, [
      [cx - r + 4, cy],
      [cx, cy - r + 4],
      [cx, cy + r - 4],
    ]);
    circle(ctx, cx, cy, r * 0.4);
    fillStroke(ctx, f.trim, 1.5);
  }
  return c;
}

export function unitKey(sprite: string, faction: Faction, color: number, part: 'body' | 'turret' = 'body'): string {
  return `u_${sprite}_${faction}_${color.toString(16)}_${part}`;
}

function unitCanvas(def: UnitDef, faction: Faction, color: number, part: 'body' | 'turret'): HTMLCanvasElement {
  if (part === 'turret') {
    const kind = def.sprite === 'flakWagon' ? 'flak' : def.sprite === 'artillery' ? 'artillery' : 'tank';
    return drawTurret(color, faction, kind);
  }
  switch (def.sprite) {
    case 'rifleman':
      return drawInfantry(color, faction, 'rifle');
    case 'rocketeer':
      return drawInfantry(color, faction, 'rocket');
    case 'engineer':
      return drawInfantry(color, faction, 'engineer');
    case 'harvester':
      return drawVehicle(color, faction, 'harvester');
    case 'constructionWagon':
      return drawVehicle(color, faction, 'wagon');
    case 'artillery':
      return drawVehicle(color, faction, 'artillery');
    case 'flakWagon':
      return drawVehicle(color, faction, 'flak');
    default:
      return drawVehicle(color, faction, 'tank');
  }
}

/** Erzeugt (falls nötig) die Textur einer Einheit und gibt den Key zurück. */
export function ensureUnitTexture(scene: Phaser.Scene, def: UnitDef, color: number, part: 'body' | 'turret' = 'body'): string {
  const key = unitKey(def.sprite, def.forFaction, color, part);
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, unitCanvas(def, def.forFaction, color, part));
  return key;
}

// ───────────── Gebäude ─────────────

/** Gebäude von oben mit leichter Schrägsicht. Grösse: Breite×Höhe Kacheln (+ Rand). */
function drawBuilding(def: BuildingDef, color: number, faction: Faction): HTMLCanvasElement {
  const W = def.width * TP;
  const H = def.height * TP;
  const pad = 10;
  const [c, ctx] = canvas(W + pad * 2, H + pad * 2);
  ctx.translate(pad, pad);
  const f = TRIM[faction];
  const main = rgb(color);
  const roofDark = rgb(color, 0.7);
  const aero = faction === 'aero';
  const corner = aero ? 14 : 3;

  // Fundament (Betonplatte)
  if (!def.wall) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    rr(ctx, 6, 8, W - 4, H - 4, corner);
    ctx.fill();
    rr(ctx, 2, 2, W - 4, H - 4, corner);
    fillStroke(ctx, '#b7b2a6', 2.5);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let x = TP; x < W; x += TP) {
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x, H - 4);
      ctx.stroke();
    }
  }

  const body = (x: number, y: number, w: number, h: number, fill = main) => {
    rr(ctx, x, y, w, h, aero ? Math.min(w, h) / 4 : 3);
    fillStroke(ctx, fill, 3);
    if (!aero) {
      rivets(ctx, [
        [x + 5, y + 5],
        [x + w - 5, y + 5],
        [x + 5, y + h - 5],
        [x + w - 5, y + h - 5],
      ]);
    } else {
      ctx.strokeStyle = f.trim;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + h - 6);
      ctx.lineTo(x + w - 8, y + h - 6);
      ctx.stroke();
    }
  };
  const emblem = (x: number, y: number, r: number, draw: () => void) => {
    circle(ctx, x, y, r);
    fillStroke(ctx, f.trim, 2.5);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = OUTLINE;
    ctx.strokeStyle = OUTLINE;
    draw();
    ctx.restore();
  };
  const door = (x: number, w: number) => {
    rr(ctx, x, H - 22, w, 18, [6, 6, 0, 0]);
    fillStroke(ctx, '#3a3a46', 2.5);
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 4, H - 17 + i * 5);
      ctx.lineTo(x + w - 4, H - 17 + i * 5);
      ctx.stroke();
    }
  };

  switch (def.sprite) {
    case 'constructionYard': {
      body(10, 12, W - 20, H - 40);
      ctx.fillStyle = roofDark;
      rr(ctx, 18, 20, W - 36, 18, 4);
      ctx.fill();
      // Kran
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3;
      rr(ctx, W - 50, 6, 14, 14, 3);
      fillStroke(ctx, '#ffd23f', 2.5);
      rr(ctx, 24, 9, W - 64, 8, 2);
      fillStroke(ctx, '#ffd23f', 2.5);
      ctx.beginPath();
      ctx.moveTo(30, 17);
      ctx.lineTo(30, 46);
      ctx.stroke();
      rr(ctx, 25, 46, 10, 7, 2);
      fillStroke(ctx, '#5a5a66', 2);
      emblem(W / 2, H / 2 + 6, 20, () => {
        // Hammer + Schraubenschlüssel
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-9, 9);
        ctx.lineTo(9, -9);
        ctx.moveTo(-9, -9);
        ctx.lineTo(9, 9);
        ctx.stroke();
      });
      door(W / 2 - 24, 48);
      break;
    }
    case 'powerPlant': {
      body(8, 20, W - 16, H - 30);
      if (aero) {
        // Tesla-Kugeln
        for (const x of [W * 0.3, W * 0.7]) {
          rr(ctx, x - 5, 14, 10, 30, 3);
          fillStroke(ctx, f.trim, 2);
          circle(ctx, x, 14, 11);
          fillStroke(ctx, '#7af7ff', 2.5);
          highlight(ctx, x - 3, 10, 3);
        }
      } else {
        for (const x of [W * 0.3, W * 0.7]) {
          rr(ctx, x - 9, 6, 18, 36, 3);
          fillStroke(ctx, f.trim, 2.5);
          ctx.fillStyle = '#3a3a46';
          circle(ctx, x, 10, 6);
          ctx.fill();
        }
      }
      emblem(W / 2, H - 30, 13, () => {
        ctx.beginPath();
        ctx.moveTo(2, -10);
        ctx.lineTo(-6, 2);
        ctx.lineTo(0, 2);
        ctx.lineTo(-2, 10);
        ctx.lineTo(6, -2);
        ctx.lineTo(0, -2);
        ctx.closePath();
        ctx.fillStyle = '#ffd23f';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      break;
    }
    case 'refinery': {
      body(8, 8, W * 0.55, H - 26);
      // Kristall-Bottich
      circle(ctx, W * 0.78, H * 0.4, 26);
      fillStroke(ctx, f.trim, 3);
      circle(ctx, W * 0.78, H * 0.4, 17);
      fillStroke(ctx, '#5ff0ff', 2);
      highlight(ctx, W * 0.75, H * 0.33, 5);
      // Rohre
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(W * 0.55, H * 0.4);
      ctx.lineTo(W * 0.66, H * 0.4);
      ctx.stroke();
      ctx.strokeStyle = aero ? '#c6d4de' : f.trim;
      ctx.lineWidth = 5;
      ctx.stroke();
      emblem(W * 0.3, H * 0.42, 16, () => {
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(7, -2);
        ctx.lineTo(0, 10);
        ctx.lineTo(-7, -2);
        ctx.closePath();
        ctx.fillStyle = '#5ff0ff';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      // Andock-Rampe unten Mitte
      const dx = Math.floor(def.width / 2) * TP;
      rr(ctx, dx + 6, H - 18, TP - 12, 16, 3);
      fillStroke(ctx, '#ffd23f', 2.5);
      ctx.fillStyle = OUTLINE;
      ctx.beginPath();
      ctx.moveTo(dx + TP / 2 - 8, H - 14);
      ctx.lineTo(dx + TP / 2 + 8, H - 14);
      ctx.lineTo(dx + TP / 2, H - 5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'silo': {
      for (const y of [H * 0.27, H * 0.73]) {
        circle(ctx, W / 2, y, W * 0.4);
        fillStroke(ctx, main, 3);
        circle(ctx, W / 2, y, W * 0.24);
        fillStroke(ctx, '#5ff0ff', 2);
        highlight(ctx, W / 2 - 5, y - 6, 4);
      }
      break;
    }
    case 'barracks': {
      body(8, 14, W - 16, H - 24);
      // Dach mit Giebel
      ctx.fillStyle = roofDark;
      ctx.beginPath();
      ctx.moveTo(14, 20);
      ctx.lineTo(W / 2, 6);
      ctx.lineTo(W - 14, 20);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      emblem(W / 2, H / 2, 16, () => {
        // Helm
        ctx.beginPath();
        ctx.arc(0, 3, 9, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = '#6b863e';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      door(W / 2 - 14, 28);
      break;
    }
    case 'factory': {
      body(6, 8, W - 12, H - 14);
      // Sheddach
      ctx.fillStyle = roofDark;
      for (let x = 16; x < W - 30; x += 28) {
        ctx.beginPath();
        ctx.moveTo(x, 34);
        ctx.lineTo(x + 12, 16);
        ctx.lineTo(x + 24, 34);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = OUTLINE;
        ctx.stroke();
      }
      emblem(W - 34, 30, 15, () => {
        // Zahnrad
        ctx.lineWidth = 4;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
          ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10);
          ctx.stroke();
        }
        circle(ctx, 0, 0, 5);
        ctx.fillStyle = f.trim;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      door(Math.floor(def.width / 2) * TP + 4, TP - 8);
      break;
    }
    case 'radar': {
      body(10, 22, W - 20, H - 32);
      rr(ctx, W / 2 - 6, 18, 12, 30, 3);
      fillStroke(ctx, f.trim, 2.5);
      break;
    }
    case 'wall': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      rr(ctx, 6, 8, W - 4, H - 4, 4);
      ctx.fill();
      rr(ctx, 2, 2, W - 4, H - 4, aero ? 10 : 3);
      fillStroke(ctx, aero ? '#d4dde5' : '#a89a80', 3);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, H / 2);
      ctx.lineTo(W - 4, H / 2);
      ctx.moveTo(W / 2, 4);
      ctx.lineTo(W / 2, H / 2);
      ctx.stroke();
      ctx.fillStyle = main;
      ctx.fillRect(8, H - 12, W - 16, 5);
      break;
    }
    case 'mgTower':
    case 'cannonTower': {
      circle(ctx, W / 2, H / 2, W * 0.42);
      fillStroke(ctx, aero ? '#d4dde5' : '#a89a80', 3);
      circle(ctx, W / 2, H / 2, W * 0.3);
      fillStroke(ctx, main, 2.5);
      break;
    }
    default:
      body(8, 8, W - 16, H - 16);
  }
  return c;
}

export function buildingKey(sprite: string, faction: Faction, color: number, part = 'body'): string {
  return `b_${sprite}_${faction}_${color.toString(16)}_${part}`;
}

/** Erzeugt (falls nötig) Gebäude-Texturen. Türme und Radar haben ein drehbares Oberteil. */
export function ensureBuildingTexture(scene: Phaser.Scene, def: BuildingDef, color: number): { body: string; top: string | null } {
  const body = buildingKey(def.sprite, def.forFaction, color);
  if (!scene.textures.exists(body)) scene.textures.addCanvas(body, drawBuilding(def, color, def.forFaction));
  let top: string | null = null;
  if (def.weapon || def.radar) {
    top = buildingKey(def.sprite, def.forFaction, color, 'top');
    if (!scene.textures.exists(top)) {
      scene.textures.addCanvas(top, def.radar ? drawRadarDish(def.forFaction) : drawTurret(color, def.forFaction, def.sprite));
    }
  }
  return { body, top };
}

/** Pixel-Rand um Gebäude-Texturen (für die Positionierung). */
export const BUILDING_PAD = 10;

function drawRadarDish(faction: Faction): HTMLCanvasElement {
  const [c, ctx] = canvas(80, 80);
  const f = TRIM[faction];
  ctx.translate(40, 40);
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 26, 0, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  fillStroke(ctx, f.trim, 2.5);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(18, 0);
  ctx.stroke();
  circle(ctx, 18, 0, 4);
  fillStroke(ctx, '#e8483b', 2);
  return c;
}

// ───────────── Kristalle, Geschosse, Effekte ─────────────

export const CRYSTAL_TEXTURE = 'crystal';

function drawCrystal(): HTMLCanvasElement {
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
    fillStroke(ctx, fill, 2);
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
  return c;
}

/** Comic-Wolke (weiss) – für «Puff!» und Rauch. */
function drawPuff(fill: string): HTMLCanvasElement {
  const [c, ctx] = canvas(64, 64);
  const blobs: [number, number, number][] = [
    [32, 36, 14],
    [20, 32, 11],
    [44, 32, 11],
    [26, 22, 10],
    [40, 22, 10],
    [32, 18, 9],
  ];
  ctx.fillStyle = OUTLINE;
  for (const [x, y, r] of blobs) {
    circle(ctx, x, y, r + 2.5);
    ctx.fill();
  }
  ctx.fillStyle = fill;
  for (const [x, y, r] of blobs) {
    circle(ctx, x, y, r);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  circle(ctx, 26, 22, 4);
  ctx.fill();
  return c;
}

/** Comic-Explosion (Zacken-Stern). */
function drawBoom(): HTMLCanvasElement {
  const [c, ctx] = canvas(96, 96);
  const star = (r1: number, r2: number, n: number, fill: string) => {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const r = i % 2 ? r2 : r1;
      const x = 48 + Math.cos(a) * r;
      const y = 48 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    fillStroke(ctx, fill, 3);
  };
  star(44, 24, 10, '#ff7a2f');
  star(30, 16, 8, '#ffd23f');
  star(14, 8, 6, '#fffbe8');
  return c;
}

function drawStar(): HTMLCanvasElement {
  const [c, ctx] = canvas(24, 24);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 4.5 : 10;
    const x = 12 + Math.cos(a) * r;
    const y = 12 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  fillStroke(ctx, '#ffe14a', 2);
  return c;
}

/** Mini-Fallschirm: Infanterie «springt davon». */
function drawParachute(): HTMLCanvasElement {
  const [c, ctx] = canvas(40, 48);
  ctx.beginPath();
  ctx.arc(20, 18, 16, Math.PI, 0);
  ctx.closePath();
  fillStroke(ctx, '#ffffff', 2);
  ctx.fillStyle = '#e8483b';
  ctx.beginPath();
  ctx.moveTo(20, 2);
  ctx.arc(20, 18, 16, Math.PI * 1.33, Math.PI * 1.67);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  for (const x of [5, 20, 35]) {
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(20, 36);
    ctx.stroke();
  }
  circle(ctx, 20, 39, 4.5);
  fillStroke(ctx, '#c9ccd6', 1.5);
  return c;
}

function drawProjectile(kind: string): HTMLCanvasElement {
  const [c, ctx] = canvas(24, 12);
  switch (kind) {
    case 'rocket':
      ctx.fillStyle = '#ffb02e';
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(7, 3);
      ctx.lineTo(7, 9);
      ctx.closePath();
      ctx.fill();
      rr(ctx, 6, 3.5, 13, 5, 2.5);
      fillStroke(ctx, '#e9f1f7', 1.5);
      ctx.fillStyle = '#e8483b';
      ctx.fillRect(16, 4, 3, 4);
      break;
    case 'shell':
    case 'cannon':
      circle(ctx, 12, 6, kind === 'shell' ? 4.5 : 3.5);
      fillStroke(ctx, kind === 'shell' ? '#3a3a46' : '#ff9d3b', 1.5);
      break;
    case 'flak':
      circle(ctx, 12, 6, 3);
      fillStroke(ctx, '#fff6a8', 1.2);
      break;
    default:
      ctx.strokeStyle = '#fff3a0';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(6, 6);
      ctx.lineTo(18, 6);
      ctx.stroke();
  }
  return c;
}

/** Alle allgemeinen Texturen (Effekte, Kristalle, Geschosse). */
export function createCommonTextures(scene: Phaser.Scene): void {
  const add = (key: string, c: HTMLCanvasElement) => {
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, c);
  };
  add(CRYSTAL_TEXTURE, drawCrystal());
  add('fx_puff', drawPuff('#ffffff'));
  add('fx_smoke', drawPuff('#9a9aa8'));
  add('fx_boom', drawBoom());
  add('fx_star', drawStar());
  add('fx_parachute', drawParachute());
  for (const k of ['bullet', 'rocket', 'cannon', 'shell', 'flak']) add(`proj_${k}`, drawProjectile(k));
}

// ───────────── Symbole für die Bauleiste ─────────────

const iconCache = new Map<string, string>();

/** Bild (Data-URL) für die Bauleiste – gleiche Zeichnung wie im Spiel. */
export function iconFor(def: UnitDef | BuildingDef, color: number): string {
  const key = `${'width' in def ? 'b' : 'u'}_${def.id}_${def.forFaction}_${color}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const [c, ctx] = canvas(96, 72);
  ctx.fillStyle = '#3b4170';
  ctx.fillRect(0, 0, 96, 72);
  const grad = ctx.createLinearGradient(0, 0, 0, 72);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 96, 72);
  let img: HTMLCanvasElement;
  let turret: HTMLCanvasElement | null = null;
  if ('width' in def) {
    img = drawBuilding(def, color, def.forFaction);
    if (def.weapon) turret = drawTurret(color, def.forFaction, def.sprite);
    if (def.radar) turret = drawRadarDish(def.forFaction);
  } else {
    img = unitCanvas(def, def.forFaction, color, 'body');
    if (def.turret) turret = unitCanvas(def, def.forFaction, color, 'turret');
  }
  const s = Math.min(84 / img.width, 64 / img.height, 'width' in def ? 1 : 1.3);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, (96 - w) / 2, (72 - h) / 2, w, h);
  if (turret) {
    const ts = 'width' in def ? s : s;
    const tw = turret.width * ts;
    const th = turret.height * ts;
    ctx.drawImage(turret, (96 - tw) / 2, (72 - th) / 2, tw, th);
  }
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}
