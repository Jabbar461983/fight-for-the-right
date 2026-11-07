import * as Phaser from 'phaser';
import {
  Simulation,
  TICK_MS,
  TILE_PX,
  parseTiledMap,
  parseUnitDefs,
  pxToUnits,
  tileOf,
  unitsToPx,
  Rng,
  type Unit,
} from '@fftr/shared';
import mapJson from '@data/maps/kristalltal.json';
import commonUnits from '@data/units/common.json';
import type { InputTarget } from '../input/InputController';
import { InputController } from '../input/InputController';
import { Hud, type SelectionEntry } from '../ui/Hud';
import {
  CRYSTAL_TEXTURE,
  TERRAIN_TEXTURE,
  TERRAIN_TILESET,
  TERRAIN_VARIANTS,
  UNIT_TEXTURE_SCALE,
  createCrystalTexture,
  createTerrainTexture,
  createUnitTextures,
  unitTextureKey,
} from './textures';

/** Der lokale Spieler. */
const LOCAL_PLAYER = 1;
/** Spielerfarben (Index = Spielernummer). */
const PLAYER_COLORS = [0x888888, 0x3fa9f5, 0xe8a33d, 0x8bd450, 0xd45fd0];

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
/** Treffertoleranz beim Antippen/Anklicken in Bildschirm-Pixeln. */
const PICK_TOLERANCE_MOUSE = 6;
const PICK_TOLERANCE_TOUCH = 22;
/** Drehgeschwindigkeit der Grafik (Bogenmass pro Sekunde). */
const TURN_SPEED = 9;

interface UnitView {
  body: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image | null;
  angle: number;
  /** Interpolierte Darstellungsposition in Pixel. */
  x: number;
  y: number;
}

interface MoveMarker {
  x: number;
  y: number;
  age: number;
}

/**
 * Die Spielszene: verbindet Simulation (Spielkern), Darstellung und Eingabe.
 * Die Simulation läuft mit festem Takt (15 Ticks/s), gezeichnet wird mit
 * Bildschirmfrequenz – dazwischen werden Positionen interpoliert.
 */
export class GameScene extends Phaser.Scene implements InputTarget {
  private sim!: Simulation;
  private views = new Map<number, UnitView>();
  private selection = new Set<number>();
  private groups = new Map<number, number[]>();
  private markers: MoveMarker[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private controls!: InputController;
  private hud!: Hud;
  private accumulator = 0;
  private hudTimer = 0;
  private debug = false;

  constructor() {
    super('game');
  }

  create(): void {
    const params = new URLSearchParams(location.search);
    this.debug = params.has('debug');

    // ── Spielkern ──
    const map = parseTiledMap(mapJson);
    const defs = parseUnitDefs(commonUnits);
    this.sim = new Simulation({ map, unitDefs: defs });

    // ── Grafiken ──
    createTerrainTexture(this);
    createUnitTextures(this, defs.values(), PLAYER_COLORS);
    createCrystalTexture(this);
    this.buildTerrain();
    this.buildCrystals();

    // ── Startarmee ──
    const spawn = map.objectsOfKind('spawn').find((o) => o.props.player === LOCAL_PLAYER) ?? map.objects[0];
    const total = Math.min(400, Math.max(1, Number(params.get('units')) || 20));
    const tanks = Math.round(total * 0.3);
    const arty = Math.round(total * 0.1);
    const rockets = Math.round(total * 0.2);
    this.sim.spawnFormation(
      [
        { type: 'lightTank', count: tanks },
        { type: 'artillery', count: arty },
        { type: 'rifleman', count: total - tanks - arty - rockets },
        { type: 'rocketeer', count: rockets },
      ],
      LOCAL_PLAYER,
      tileOf(spawn.x),
      tileOf(spawn.y),
    );

    this.overlay = this.add.graphics().setDepth(100);

    // ── Kamera ──
    const cam = this.cameras.main;
    cam.setBackgroundColor('#1b1d2e');
    cam.setBounds(0, 0, map.width * TILE_PX, map.height * TILE_PX);
    cam.centerOn(unitsToPx(spawn.x), unitsToPx(spawn.y));

    // ── Eingabe und Oberfläche ──
    this.controls = new InputController(document.getElementById('game')!, document.getElementById('dragbox')!, this);
    this.hud = new Hud(document.getElementById('sidebar')!, document.getElementById('commandbar')!, this);
    this.scale.on('resize', () => this.clampCamera());

    // Nur in der Entwicklung: Zugriff von der Browser-Konsole aus (window.fftr).
    if (import.meta.env.DEV) (window as unknown as { fftr: unknown }).fftr = { scene: this, sim: this.sim };
  }

  // ───────────────────────────── Aufbau ─────────────────────────────

  private buildTerrain(): void {
    const m = this.sim.map;
    const rnd = new Rng(12345);
    const data: number[][] = [];
    for (let y = 0; y < m.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < m.width; x++) {
        // Variante zufällig, aber Variante 3 (Blumen etc.) seltener
        const r = rnd.nextInt(10);
        const variant = r < 4 ? 0 : r < 7 ? 1 : r < 9 ? 2 : 3;
        row.push(m.terrainAt(x, y) * TERRAIN_VARIANTS + (variant % TERRAIN_VARIANTS));
      }
      data.push(row);
    }
    const tm = this.make.tilemap({ data, tileWidth: TILE_PX, tileHeight: TILE_PX });
    const ts = tm.addTilesetImage(
      TERRAIN_TEXTURE,
      TERRAIN_TEXTURE,
      TILE_PX,
      TILE_PX,
      TERRAIN_TILESET.margin,
      TERRAIN_TILESET.spacing,
    );
    if (!ts) throw new Error('Tileset konnte nicht erstellt werden');
    tm.createLayer(0, ts, 0, 0)?.setDepth(0);
  }

  /** Glimmerit-Felder als Deko (abbaubar ab Etappe 2). */
  private buildCrystals(): void {
    const m = this.sim.map;
    const rnd = new Rng(777);
    for (const field of m.objectsOfKind('crystalField')) {
      const radius = Number(field.props.radius ?? 2);
      const cx = unitsToPx(field.x);
      const cy = unitsToPx(field.y);
      const count = Math.round(radius * radius * 2.5);
      for (let i = 0; i < count; i++) {
        const a = rnd.nextFloat() * Math.PI * 2;
        const d = Math.sqrt(rnd.nextFloat()) * radius * TILE_PX;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const tx = Math.floor(x / TILE_PX);
        const ty = Math.floor(y / TILE_PX);
        if (!m.passable(tx, ty, 1)) continue; // nicht auf Wasser/Klippen
        const img = this.add.image(x, y, CRYSTAL_TEXTURE).setScale(0.45 + rnd.nextFloat() * 0.3).setDepth(1);
        this.tweens.add({
          targets: img,
          alpha: { from: 0.75, to: 1 },
          duration: 900 + rnd.nextFloat() * 900,
          yoyo: true,
          repeat: -1,
        });
      }
    }
  }

  private createView(u: Unit): UnitView {
    const color = PLAYER_COLORS[u.owner] ?? PLAYER_COLORS[0];
    const x = unitsToPx(u.x);
    const y = unitsToPx(u.y);
    const infantry = u.def.category === 'infantry';
    const body = this.add
      .image(x, y, unitTextureKey(u.def.sprite, color))
      .setScale(UNIT_TEXTURE_SCALE)
      .setDepth(infantry ? 10 : 20);
    const turret = u.def.turret
      ? this.add.image(x, y, unitTextureKey(u.def.sprite, color, 'turret')).setScale(UNIT_TEXTURE_SCALE).setDepth(21)
      : null;
    const angle = Math.atan2(u.dirY, u.dirX);
    return { body, turret, angle, x, y };
  }

  // ───────────────────────────── Spielschleife ─────────────────────────────

  override update(_time: number, delta: number): void {
    this.controls.update(delta);

    // Fester Simulationstakt; nach langen Pausen (Tab im Hintergrund) nicht aufholen.
    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= TICK_MS) {
      this.sim.step();
      this.accumulator -= TICK_MS;
    }
    const alpha = this.accumulator / TICK_MS;

    this.syncViews(alpha, delta / 1000);
    this.drawOverlay(delta / 1000);

    this.hudTimer -= delta;
    if (this.hudTimer <= 0) {
      this.hudTimer = 250;
      this.updateHud();
    }
  }

  private syncViews(alpha: number, dt: number): void {
    for (const u of this.sim.units) {
      let v = this.views.get(u.id);
      if (!v) {
        v = this.createView(u);
        this.views.set(u.id, v);
      }
      v.x = unitsToPx(u.prevX + (u.x - u.prevX) * alpha);
      v.y = unitsToPx(u.prevY + (u.y - u.prevY) * alpha);
      // Sanft in Fahrtrichtung drehen
      const target = Math.atan2(u.dirY, u.dirX);
      const diff = Phaser.Math.Angle.Wrap(target - v.angle);
      const maxTurn = TURN_SPEED * dt;
      v.angle += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;
      v.body.setPosition(v.x, v.y).setRotation(v.angle);
      v.turret?.setPosition(v.x, v.y).setRotation(v.angle);
    }
  }

  private drawOverlay(dt: number): void {
    const g = this.overlay;
    g.clear();
    // Auswahlringe
    g.lineStyle(2, 0x9dff5c, 1);
    for (const id of this.selection) {
      const u = this.sim.getUnit(id);
      const v = this.views.get(id);
      if (!u || !v) continue;
      g.strokeCircle(v.x, v.y, unitsToPx(u.def.radiusUnits) + 3);
    }
    // Bewegungsmarker
    this.markers = this.markers.filter((m) => (m.age += dt) < 0.6);
    for (const m of this.markers) {
      const k = m.age / 0.6;
      g.lineStyle(2, 0x9dff5c, 1 - k);
      g.strokeCircle(m.x, m.y, 14 * (1 - k) + 3);
    }
    // Debug: Wege anzeigen (?debug in der Adresse)
    if (this.debug) {
      g.lineStyle(1, 0xffffff, 0.6);
      for (const u of this.sim.units) {
        const o = u.order;
        const v = this.views.get(u.id);
        if (!o || !v) continue;
        g.beginPath();
        g.moveTo(v.x, v.y);
        if (o.mode === 'path') for (let i = o.pathIndex; i < o.path.length; i++) g.lineTo(unitsToPx(o.path[i].x), unitsToPx(o.path[i].y));
        else g.lineTo(unitsToPx(o.goalX), unitsToPx(o.goalY));
        g.strokePath();
      }
    }
  }

  private updateHud(): void {
    const counts = new Map<string, SelectionEntry>();
    for (const id of this.selection) {
      const u = this.sim.getUnit(id);
      if (!u) continue;
      const e = counts.get(u.def.id) ?? { nameKey: u.def.nameKey, count: 0 };
      e.count++;
      counts.set(u.def.id, e);
    }
    this.hud.setSelection([...counts.values()]);
    this.hud.setStats(this.game.loop.actualFps, this.sim.units.length);
  }

  // ───────────────────────────── Kamera ─────────────────────────────

  /** Bildschirm → Welt (Pixel). Gleiche Formel wie Phaser: Zoom um die Bildmitte. */
  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: cam.scrollX + cam.width * 0.5 + (sx - cam.width * 0.5) / cam.zoom,
      y: cam.scrollY + cam.height * 0.5 + (sy - cam.height * 0.5) / cam.zoom,
    };
  }

  /** Begrenzt die Kamera sofort (Phaser macht das sonst erst beim Zeichnen). */
  private clampCamera(): void {
    const cam = this.cameras.main;
    cam.scrollX = cam.clampX(cam.scrollX);
    cam.scrollY = cam.clampY(cam.scrollY);
  }

  panBy(dx: number, dy: number): void {
    const cam = this.cameras.main;
    cam.scrollX -= dx / cam.zoom;
    cam.scrollY -= dy / cam.zoom;
    this.clampCamera();
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const cam = this.cameras.main;
    const before = this.screenToWorld(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM));
    const after = this.screenToWorld(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.clampCamera();
  }

  centerOnSelection(): void {
    if (this.selection.size === 0) return;
    let x = 0;
    let y = 0;
    let n = 0;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v) continue;
      x += v.x;
      y += v.y;
      n++;
    }
    if (n > 0) {
      this.cameras.main.centerOn(x / n, y / n);
      this.clampCamera();
    }
  }

  // ───────────────────────────── Auswahl & Befehle ─────────────────────────────

  /** Eigene Einheit unter einem Bildschirmpunkt (nächste innerhalb der Toleranz). */
  private pickOwnUnit(sx: number, sy: number, touch: boolean): Unit | null {
    const p = this.screenToWorld(sx, sy);
    const tol = (touch ? PICK_TOLERANCE_TOUCH : PICK_TOLERANCE_MOUSE) / this.cameras.main.zoom;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of this.sim.units) {
      if (u.owner !== LOCAL_PLAYER) continue;
      const v = this.views.get(u.id);
      if (!v) continue;
      const r = unitsToPx(u.def.radiusUnits) + tol;
      const d = (v.x - p.x) ** 2 + (v.y - p.y) ** 2;
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  hitsOwnUnit(sx: number, sy: number, touch: boolean): boolean {
    return this.pickOwnUnit(sx, sy, touch) !== null;
  }

  hasSelection(): boolean {
    return this.selection.size > 0;
  }

  selectAt(sx: number, sy: number, additive: boolean, touch: boolean): boolean {
    const u = this.pickOwnUnit(sx, sy, touch);
    if (!u) return false;
    if (additive) {
      if (this.selection.has(u.id)) this.selection.delete(u.id);
      else this.selection.add(u.id);
    } else {
      this.selection = new Set([u.id]);
    }
    this.updateHud();
    return true;
  }

  selectSameTypeAt(sx: number, sy: number, touch: boolean): void {
    const picked = this.pickOwnUnit(sx, sy, touch);
    if (!picked) return;
    const view = this.cameras.main.worldView;
    this.selection = new Set(
      this.sim.units
        .filter((u) => {
          const v = this.views.get(u.id);
          return u.owner === LOCAL_PLAYER && u.def.id === picked.def.id && v && view.contains(v.x, v.y);
        })
        .map((u) => u.id),
    );
    this.updateHud();
  }

  selectInBox(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    const a = this.screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
    const next = additive ? new Set(this.selection) : new Set<number>();
    for (const u of this.sim.units) {
      if (u.owner !== LOCAL_PLAYER) continue;
      const v = this.views.get(u.id);
      if (!v) continue;
      const r = unitsToPx(u.def.radiusUnits) * 0.5;
      if (v.x + r >= a.x && v.x - r <= b.x && v.y + r >= a.y && v.y - r <= b.y) next.add(u.id);
    }
    this.selection = next;
    this.updateHud();
  }

  clearSelection(): void {
    this.selection.clear();
    this.updateHud();
  }

  /** Nur noch existierende Einheiten in der Auswahl behalten. */
  private selectedIds(): number[] {
    return [...this.selection].filter((id) => this.sim.getUnit(id));
  }

  commandAt(sx: number, sy: number): void {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    const p = this.screenToWorld(sx, sy);
    this.sim.issue(LOCAL_PLAYER, { type: 'move', units: ids, x: pxToUnits(p.x), y: pxToUnits(p.y) });
    this.markers.push({ x: p.x, y: p.y, age: 0 });
  }

  stop(): void {
    const ids = this.selectedIds();
    if (ids.length > 0) this.sim.issue(LOCAL_PLAYER, { type: 'stop', units: ids });
  }

  saveGroup(n: number): void {
    const ids = this.selectedIds();
    this.groups.set(n, ids);
    this.hud.setGroupSize(n, ids.length);
    this.hud.showToast(`${n}: ${ids.length}`);
  }

  recallGroup(n: number): void {
    const ids = (this.groups.get(n) ?? []).filter((id) => this.sim.getUnit(id));
    if (ids.length === 0) return;
    this.selection = new Set(ids);
    this.updateHud();
  }
}
