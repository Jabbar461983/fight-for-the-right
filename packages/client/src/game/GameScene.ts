import * as Phaser from 'phaser';
import {
  STANCES,
  TICK_MS,
  TILE_PX,
  availability,
  canPlace,
  createSkirmish,
  pxToUnits,
  tileOf,
  unitsToPx,
  type Building,
  type BuildingDef,
  type Ghost,
  type Rules,
  type SimEvent,
  type Simulation,
  type Unit,
  type UnitDef,
} from '@fftr/shared';
import { getRules, loadMap } from '../data';
import { t } from '../i18n';
import { InputController, type InputTarget } from '../input/InputController';
import { getSettings } from '../storage';
import { Hud, type BuildItemState, type BuildTab, type HudActions } from '../ui/Hud';
import type { GameConfig } from '../ui/Menu';
import { MINIMAP_COLORS, paintTerrain } from './terrainPainter';
import {
  BUILDING_PAD,
  CRYSTAL_TEXTURE,
  PLAYER_COLORS,
  TEX_SCALE,
  createCommonTextures,
  ensureBuildingTexture,
  ensureUnitTexture,
  iconFor,
} from './textures';

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2;
const PICK_TOLERANCE_MOUSE = 6;
const PICK_TOLERANCE_TOUCH = 22;
const TURN_SPEED = 9;

/** Zeichenebenen (Tiefe). */
const DEPTH = {
  terrain: 0,
  crystal: 2,
  building: 5,
  infantry: 10,
  vehicle: 20,
  turret: 21,
  projectile: 40,
  effect: 50,
  fog: 80,
  overlay: 90,
  marker: 95,
};

interface UnitView {
  body: Phaser.GameObjects.Image;
  turret: Phaser.GameObjects.Image | null;
  angle: number;
  turretAngle: number;
  x: number;
  y: number;
  visible: boolean;
}

interface BuildingView {
  body: Phaser.GameObjects.Image;
  top: Phaser.GameObjects.Image | null;
  topAngle: number;
  visible: boolean;
}

export interface GameSceneData {
  config: GameConfig;
  onExit: () => void;
}

/**
 * Die Spielszene: verbindet Simulation (Spielkern), Darstellung, Eingabe und Oberfläche.
 * Die Simulation läuft mit festem Takt (15 Ticks/s); gezeichnet wird mit
 * Bildschirmfrequenz – dazwischen werden Positionen interpoliert.
 */
export class GameScene extends Phaser.Scene implements InputTarget, HudActions {
  private cfg!: GameConfig;
  private onExit!: () => void;
  private sim!: Simulation;
  private rules!: Rules;
  private local = 1;

  private views = new Map<number, UnitView>();
  private bviews = new Map<number, BuildingView>();
  private ghostViews = new Map<number, Phaser.GameObjects.Image>();
  private projViews = new Map<number, Phaser.GameObjects.Image>();
  private crystals: { idx: number; img: Phaser.GameObjects.Image }[] = [];

  private selection = new Set<number>();
  private selectedBuilding = 0;
  private groups = new Map<number, number[]>();
  private markers: { x: number; y: number; age: number; color: number }[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private placeGfx!: Phaser.GameObjects.Graphics;
  private placeGhost: Phaser.GameObjects.Image | null = null;
  private placing: { category: 'building' | 'defense'; def: BuildingDef } | null = null;
  private placeTile: { tx: number; ty: number } | null = null;
  private lastPointerTouch = false;
  private armed = false;

  private fogCanvas!: HTMLCanvasElement;
  private fogTex!: Phaser.Textures.CanvasTexture;
  private fogData!: ImageData;
  private minimapBase!: HTMLCanvasElement;

  private controls!: InputController;
  private hud!: Hud;
  private accumulator = 0;
  private hudTimer = 0;
  private minimapTimer = 0;
  private frame = 0;
  private paused = false;
  private ended = false;
  private lastEventPos: { x: number; y: number } | null = null;
  private lastLostMsg = 0;
  private debug = false;

  constructor() {
    super('game');
  }

  init(data: GameSceneData): void {
    this.cfg = data.config;
    this.onExit = data.onExit;
    this.local = data.config.localPlayer;
    this.views = new Map();
    this.bviews = new Map();
    this.ghostViews = new Map();
    this.projViews = new Map();
    this.crystals = [];
    this.selection = new Set();
    this.selectedBuilding = 0;
    this.groups = new Map();
    this.markers = [];
    this.placing = null;
    this.placeTile = null;
    this.placeGhost = null;
    this.armed = false;
    this.accumulator = 0;
    this.paused = false;
    this.ended = false;
    this.lastEventPos = null;
  }

  create(): void {
    this.debug = new URLSearchParams(location.search).has('debug');
    this.rules = getRules();
    const map = loadMap(this.cfg.mapId);
    this.sim = createSkirmish({ map, rules: this.rules, slots: this.cfg.slots, startCredits: this.cfg.startCredits });

    createCommonTextures(this);
    this.buildTerrain();
    this.buildCrystals();
    this.buildFog();

    this.overlay = this.add.graphics().setDepth(DEPTH.overlay);
    this.placeGfx = this.add.graphics().setDepth(DEPTH.marker);

    const cam = this.cameras.main;
    cam.setBackgroundColor('#1b1d2e');
    cam.setBounds(0, 0, map.width * TILE_PX, map.height * TILE_PX);
    cam.setZoom(1);
    const mine = this.sim.units.find((u) => u.owner === this.local);
    if (mine) cam.centerOn(unitsToPx(mine.x), unitsToPx(mine.y));

    this.controls = new InputController(document.getElementById('game')!, document.getElementById('dragbox')!, this);
    this.hud = new Hud(document.getElementById('sidebar')!, document.getElementById('commandbar')!, document.getElementById('stage')!, this);
    this.prepareMinimap();
    this.scale.on('resize', this.clampCamera, this);
    this.events.once('shutdown', () => this.teardown());

    // Gleich den Bauwagen auswählen, damit Neulinge wissen, wo es losgeht
    const wagon = this.sim.units.find((u) => u.owner === this.local && u.def.deploysTo);
    if (wagon) this.selection.add(wagon.id);
    this.hud.message(t('msg.welcome'), 'info', true);
    this.updateHud();

    if (import.meta.env.DEV) (window as unknown as { fftr: unknown }).fftr = { scene: this, sim: this.sim };
  }

  private teardown(): void {
    this.controls.destroy();
    this.hud.destroy();
    this.scale.off('resize', this.clampCamera, this);
    this.input.enabled = true;
  }

  // ───────────────────────────── Aufbau ─────────────────────────────

  private buildTerrain(): void {
    const chunks = paintTerrain(this.sim.map);
    chunks.forEach((c, i) => {
      const key = `terrain_${this.cfg.mapId}_${i}`;
      if (!this.textures.exists(key)) this.textures.addCanvas(key, c.canvas);
      this.add.image(c.x, c.y, key).setOrigin(0).setDepth(DEPTH.terrain);
    });
  }

  private buildCrystals(): void {
    const eco = this.sim.economy;
    const m = this.sim.map;
    for (let i = 0; i < eco.crystalMax.length; i++) {
      if (eco.crystalMax[i] <= 0) continue;
      const tx = i % m.width;
      const ty = (i - tx) / m.width;
      // Leichter Versatz, damit es nicht wie ein Raster aussieht
      const jx = (((tx * 73 + ty * 31) % 11) - 5) * 0.9;
      const jy = (((tx * 17 + ty * 59) % 11) - 5) * 0.9;
      const img = this.add
        .image(tx * TILE_PX + TILE_PX / 2 + jx, ty * TILE_PX + TILE_PX / 2 + jy, CRYSTAL_TEXTURE)
        .setDepth(DEPTH.crystal)
        .setRotation((((tx + ty) % 5) - 2) * 0.12);
      this.crystals.push({ idx: i, img });
    }
    this.updateCrystals();
  }

  private updateCrystals(): void {
    const eco = this.sim.economy;
    for (const c of this.crystals) {
      const amount = eco.crystal[c.idx];
      const max = eco.crystalMax[c.idx];
      c.img.setVisible(amount > 0);
      c.img.setScale(0.32 + 0.45 * (amount / max));
    }
  }

  private buildFog(): void {
    const m = this.sim.map;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = m.width;
    this.fogCanvas.height = m.height;
    const ctx = this.fogCanvas.getContext('2d')!;
    this.fogData = ctx.createImageData(m.width, m.height);
    const key = `fog_${Date.now()}`;
    this.fogTex = this.textures.addCanvas(key, this.fogCanvas)!;
    this.add.image(0, 0, key).setOrigin(0).setScale(TILE_PX).setDepth(DEPTH.fog);
    this.updateFog();
  }

  private updateFog(): void {
    const p = this.sim.players[this.local];
    const d = this.fogData.data;
    for (let i = 0; i < p.visible.length; i++) {
      d[i * 4 + 3] = p.visible[i] ? 0 : p.explored[i] ? 140 : 255;
    }
    this.fogCanvas.getContext('2d')!.putImageData(this.fogData, 0, 0);
    this.fogTex.refresh();
  }

  private prepareMinimap(): void {
    const m = this.sim.map;
    const c = document.createElement('canvas');
    c.width = m.width;
    c.height = m.height;
    const ctx = c.getContext('2d')!;
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        ctx.fillStyle = MINIMAP_COLORS[m.terrainAt(x, y)] ?? '#000';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    this.minimapBase = c;
    const mm = this.hud.minimap;
    mm.width = 200;
    mm.height = Math.round((200 * m.height) / m.width);
  }

  private colorOf(player: number): number {
    return PLAYER_COLORS[this.sim.players[player]?.color ?? 0] ?? 0x888888;
  }

  private createUnitView(u: Unit): UnitView {
    const color = this.colorOf(u.owner);
    const x = unitsToPx(u.x);
    const y = unitsToPx(u.y);
    const depth = u.def.category === 'infantry' ? DEPTH.infantry : DEPTH.vehicle;
    const body = this.add.image(x, y, ensureUnitTexture(this, u.def, color)).setScale(TEX_SCALE).setDepth(depth);
    const turret = u.def.turret
      ? this.add.image(x, y, ensureUnitTexture(this, u.def, color, 'turret')).setScale(TEX_SCALE).setDepth(DEPTH.turret)
      : null;
    const angle = Math.atan2(u.dirY, u.dirX);
    return { body, turret, angle, turretAngle: angle, x, y, visible: true };
  }

  private createBuildingView(def: BuildingDef, owner: number, tx: number, ty: number): BuildingView {
    const tex = ensureBuildingTexture(this, def, this.colorOf(owner));
    const pad = BUILDING_PAD * TEX_SCALE;
    const body = this.add
      .image(tx * TILE_PX - pad, ty * TILE_PX - pad, tex.body)
      .setOrigin(0)
      .setScale(TEX_SCALE)
      .setDepth(DEPTH.building + ty * 0.001);
    const cx = (tx + def.width / 2) * TILE_PX;
    const cy = (ty + def.height / 2) * TILE_PX - (def.radar ? 4 : 0);
    const top = tex.top ? this.add.image(cx, cy, tex.top).setScale(TEX_SCALE).setDepth(DEPTH.building + 0.5) : null;
    return { body, top, topAngle: Math.PI / 2, visible: true };
  }

  // ───────────────────────────── Spielschleife ─────────────────────────────

  override update(_time: number, delta: number): void {
    this.frame++;
    // Nach dem Start ändert sich die Grösse der Spielfläche (Seitenleiste erscheint) –
    // danach die Kamera erneut auf die eigenen Einheiten setzen.
    if (this.frame === 3) {
      const mine = this.sim.units.find((u) => u.owner === this.local);
      if (mine) this.centerOnWorldPx(unitsToPx(mine.x), unitsToPx(mine.y));
    }
    this.controls.update(delta);
    const dt = delta / 1000;

    if (!this.paused && !this.ended) {
      this.accumulator += Math.min(delta, 250) * getSettings().gameSpeed;
      let steps = 0;
      while (this.accumulator >= TICK_MS && steps < 6) {
        this.sim.step();
        this.handleEvents(this.sim.drainEvents());
        this.accumulator -= TICK_MS;
        steps++;
      }
      if (steps === 6) this.accumulator = 0;
    }
    const alpha = this.paused ? 1 : Math.min(1, this.accumulator / TICK_MS);

    this.syncUnits(alpha, dt);
    this.syncBuildings(dt);
    this.syncProjectiles(alpha);
    if (this.frame % 4 === 0) this.updateFog();
    if (this.frame % 30 === 0) this.updateCrystals();
    this.drawOverlay(dt);
    this.drawPlacement();

    this.hudTimer -= delta;
    if (this.hudTimer <= 0) {
      this.hudTimer = 200;
      this.updateHud();
    }
    this.minimapTimer -= delta;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 400;
      this.drawMinimap();
    }

    if (this.sim.gameOver && !this.ended) this.showEnd();
  }

  private syncUnits(alpha: number, dt: number): void {
    for (const u of this.sim.units) {
      let v = this.views.get(u.id);
      if (!v) {
        v = this.createUnitView(u);
        this.views.set(u.id, v);
      }
      v.x = unitsToPx(u.prevX + (u.x - u.prevX) * alpha);
      v.y = unitsToPx(u.prevY + (u.y - u.prevY) * alpha);
      const visible = this.sim.isAlly(this.local, u.owner) || this.sim.isVisible(this.local, tileOf(u.x), tileOf(u.y));
      v.visible = visible;
      v.body.setVisible(visible);
      v.turret?.setVisible(visible);
      if (!visible) continue;
      const target = Math.atan2(u.dirY, u.dirX);
      v.angle = turnTowards(v.angle, target, TURN_SPEED * dt);
      v.body.setPosition(v.x, v.y).setRotation(v.angle);
      if (v.turret) {
        const aiming = u.targetId !== 0 || u.task?.kind === 'attack';
        const tAngle = aiming ? Math.atan2(u.aimY, u.aimX) : v.angle;
        v.turretAngle = turnTowards(v.turretAngle, tAngle, TURN_SPEED * 0.8 * dt);
        v.turret.setPosition(v.x, v.y).setRotation(v.turretAngle);
      }
    }
    // Entfernte Einheiten
    for (const [id, v] of this.views) {
      if (this.sim.getUnit(id)) continue;
      v.body.destroy();
      v.turret?.destroy();
      this.views.delete(id);
      this.selection.delete(id);
    }
  }

  private syncBuildings(dt: number): void {
    const p = this.sim.players[this.local];
    for (const b of this.sim.buildings) {
      let v = this.bviews.get(b.id);
      if (!v || v.body.texture.key !== ensureBuildingTexture(this, b.def, this.colorOf(b.owner)).body) {
        // Neu oder Besitzer gewechselt (übernommen) → neu zeichnen
        if (v) {
          v.body.destroy();
          v.top?.destroy();
        }
        v = this.createBuildingView(b.def, b.owner, b.tx, b.ty);
        this.bviews.set(b.id, v);
      }
      const visible = this.sim.isAlly(this.local, b.owner) || this.sim.canSee(this.local, b) || p.ghosts.has(b.id);
      v.visible = visible;
      v.body.setVisible(visible);
      if (v.top) {
        v.top.setVisible(visible);
        if (b.def.radar) v.topAngle += dt * (p.lowPower && b.owner === this.local ? 0.3 : 1.6);
        else if (b.targetId) v.topAngle = turnTowards(v.topAngle, Math.atan2(b.aimY, b.aimX), 6 * dt);
        v.top.setRotation(v.topAngle);
      }
    }
    for (const [id, v] of this.bviews) {
      if (this.sim.getBuilding(id)) continue;
      v.body.destroy();
      v.top?.destroy();
      this.bviews.delete(id);
      if (this.selectedBuilding === id) this.selectedBuilding = 0;
    }
    // Geister: zerstörte Gebäude, deren Ende der Spieler noch nicht gesehen hat
    for (const [id, g] of p.ghosts) {
      if (this.sim.getBuilding(id) || this.ghostViews.has(id)) continue;
      this.ghostViews.set(id, this.makeGhost(g));
    }
    for (const [id, img] of this.ghostViews) {
      if (p.ghosts.has(id) && !this.sim.getBuilding(id)) continue;
      img.destroy();
      this.ghostViews.delete(id);
    }
  }

  private makeGhost(g: Ghost): Phaser.GameObjects.Image {
    const def = this.rules.building(g.faction, g.defId)!;
    const tex = ensureBuildingTexture(this, def, this.colorOf(g.owner));
    const pad = BUILDING_PAD * TEX_SCALE;
    return this.add
      .image(g.tx * TILE_PX - pad, g.ty * TILE_PX - pad, tex.body)
      .setOrigin(0)
      .setScale(TEX_SCALE)
      .setDepth(DEPTH.building)
      .setAlpha(0.8);
  }

  private syncProjectiles(alpha: number): void {
    const seen = new Set<number>();
    for (const pr of this.sim.projectiles) {
      seen.add(pr.id);
      const x = unitsToPx(pr.prevX + (pr.x - pr.prevX) * alpha);
      let y = unitsToPx(pr.prevY + (pr.y - pr.prevY) * alpha);
      let img = this.projViews.get(pr.id);
      if (!img) {
        img = this.add.image(x, y, `proj_${pr.weapon.projectile}`).setDepth(DEPTH.projectile).setScale(0.8);
        this.projViews.set(pr.id, img);
      }
      // Granaten fliegen im Bogen
      if (pr.weapon.projectile === 'shell') {
        const total = Math.hypot(pr.tx - pr.startX, pr.ty - pr.startY) || 1;
        const done = Math.hypot(pr.x - pr.startX, pr.y - pr.startY) / total;
        y -= Math.sin(Math.PI * Math.min(1, done)) * unitsToPx(total) * 0.3;
        img.setScale(0.8 + Math.sin(Math.PI * Math.min(1, done)) * 0.6);
      }
      img.setPosition(x, y);
      img.setRotation(Math.atan2(pr.ty - pr.y, pr.tx - pr.x));
      img.setVisible(this.sim.isVisible(this.local, tileOf(pr.x), tileOf(pr.y)));
    }
    for (const [id, img] of this.projViews) {
      if (seen.has(id)) continue;
      img.destroy();
      this.projViews.delete(id);
    }
  }

  // ───────────────────────────── Ereignisse & Effekte ─────────────────────────────

  private visibleAt(x: number, y: number): boolean {
    return this.sim.isVisible(this.local, tileOf(x), tileOf(y));
  }

  private handleEvents(events: SimEvent[]): void {
    const me = this.local;
    for (const e of events) {
      switch (e.type) {
        case 'unitDied':
          if (this.visibleAt(e.x, e.y)) {
            if (e.category === 'infantry') this.fxInfantryOut(unitsToPx(e.x), unitsToPx(e.y));
            else this.fxBoom(unitsToPx(e.x), unitsToPx(e.y), 1);
          }
          break;
        case 'buildingDestroyed':
          if (e.owner === me || this.visibleAt(e.x, e.y)) {
            const n = Math.max(2, e.w * e.h);
            for (let i = 0; i < n; i++) {
              const ox = (Math.random() - 0.5) * e.w * TILE_PX * 0.8;
              const oy = (Math.random() - 0.5) * e.h * TILE_PX * 0.8;
              this.time.delayedCall(i * 120, () => this.fxBoom(unitsToPx(e.x) + ox, unitsToPx(e.y) + oy, 1.2));
            }
          }
          if (e.owner === me && performance.now() - this.lastLostMsg > 3000) {
            this.lastLostMsg = performance.now();
            this.hud.message(t('msg.lostBuilding'), 'warn');
          }
          break;
        case 'impact':
          if (this.visibleAt(e.x, e.y)) this.fxImpact(unitsToPx(e.x), unitsToPx(e.y), e.weaponId, e.splash);
          break;
        case 'underAttack':
          if (e.owner === me) {
            this.lastEventPos = { x: e.x, y: e.y };
            this.hud.message(t('msg.underAttack'), 'warn', true);
          }
          break;
        case 'buildingReady':
          if (e.owner === me) {
            const def = this.rules.building(this.sim.players[me].faction, e.defId);
            this.hud.message(t('msg.buildingReady', { name: def ? t(def.nameKey) : e.defId }), 'good');
          }
          break;
        case 'unitReady':
          if (e.owner === me) {
            const def = this.rules.unit(this.sim.players[me].faction, e.defId);
            this.hud.message(t('msg.unitReady', { name: def ? t(def.nameKey) : e.defId }), 'info');
          }
          break;
        case 'lowPower':
          if (e.owner === me) this.hud.message(t('msg.lowPower'), 'warn', true);
          break;
        case 'storageFull':
          if (e.owner === me) this.hud.message(t('msg.storageFull'), 'warn', true);
          break;
        case 'insufficientFunds':
          if (e.owner === me) this.hud.message(t('msg.insufficientFunds'), 'warn');
          break;
        case 'captured':
          if (e.owner === me) this.hud.message(t('msg.captured'), 'good', true);
          else if (e.previousOwner === me) this.hud.message(t('msg.lostBuilding'), 'warn', true);
          break;
        case 'cannotDeploy':
          if (e.owner === me) this.hud.message(t('msg.cannotDeploy'), 'warn', true);
          break;
        case 'playerDefeated':
          this.hud.message(t('msg.playerDefeated', { name: this.sim.players[e.owner]?.name ?? '?' }), e.owner === me ? 'warn' : 'good', true);
          break;
        default:
          break;
      }
    }
  }

  /** «Puff!» – Infanterie verschwindet in einer Wolke und schwebt am Fallschirm davon. */
  private fxInfantryOut(x: number, y: number): void {
    const puff = this.add.image(x, y, 'fx_puff').setDepth(DEPTH.effect).setScale(0.2);
    this.tweens.add({ targets: puff, scale: 0.6, alpha: 0, duration: 600, ease: 'Cubic.easeOut', onComplete: () => puff.destroy() });
    const chute = this.add.image(x, y, 'fx_parachute').setDepth(DEPTH.effect + 1).setScale(0.35).setAlpha(0.95);
    this.tweens.add({
      targets: chute,
      y: y - 46,
      x: x + 14,
      alpha: 0,
      duration: 1600,
      ease: 'Sine.easeOut',
      onComplete: () => chute.destroy(),
    });
  }

  /** Comic-Explosion mit Sternen und Rauch. */
  private fxBoom(x: number, y: number, size: number): void {
    const boom = this.add.image(x, y, 'fx_boom').setDepth(DEPTH.effect).setScale(0.15 * size).setRotation(Math.random() * 6);
    this.tweens.add({ targets: boom, scale: 0.6 * size, alpha: 0, duration: 500, ease: 'Back.easeOut', onComplete: () => boom.destroy() });
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const star = this.add.image(x, y, 'fx_star').setDepth(DEPTH.effect + 1).setScale(0.6);
      this.tweens.add({
        targets: star,
        x: x + Math.cos(a) * 30 * size,
        y: y + Math.sin(a) * 30 * size,
        angle: 360,
        alpha: 0,
        duration: 700,
        ease: 'Cubic.easeOut',
        onComplete: () => star.destroy(),
      });
    }
    const smoke = this.add.image(x, y, 'fx_smoke').setDepth(DEPTH.effect - 1).setScale(0.3 * size).setAlpha(0.8);
    this.tweens.add({ targets: smoke, y: y - 24, scale: 0.7 * size, alpha: 0, duration: 1400, onComplete: () => smoke.destroy() });
  }

  private fxImpact(x: number, y: number, weaponId: string, splash: number): void {
    const w = this.rules.weapons.get(weaponId);
    const kind = w?.projectile ?? 'bullet';
    if (kind === 'bullet' || kind === 'flak') {
      const s = this.add.image(x, y, kind === 'flak' ? 'fx_puff' : 'fx_star').setDepth(DEPTH.effect).setScale(kind === 'flak' ? 0.12 : 0.35);
      this.tweens.add({ targets: s, scale: s.scale * 1.8, alpha: 0, duration: 250, onComplete: () => s.destroy() });
    } else {
      this.fxBoom(x, y, splash > 0 ? 0.9 : 0.5);
    }
  }

  // ───────────────────────────── Overlay ─────────────────────────────

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
    const sb = this.selectedBuilding ? this.sim.getBuilding(this.selectedBuilding) : undefined;
    if (sb) g.strokeRect(sb.tx * TILE_PX - 2, sb.ty * TILE_PX - 2, sb.def.width * TILE_PX + 4, sb.def.height * TILE_PX + 4);

    // Lebensbalken: ausgewählt oder beschädigt
    for (const u of this.sim.units) {
      const v = this.views.get(u.id);
      if (!v || !v.visible) continue;
      if (u.hp >= u.def.hp && !this.selection.has(u.id)) continue;
      this.healthBar(g, v.x, v.y - unitsToPx(u.def.radiusUnits) - 6, unitsToPx(u.def.radiusUnits) * 2 + 6, u.hp / u.def.hp);
    }
    for (const b of this.sim.buildings) {
      const v = this.bviews.get(b.id);
      if (!v || !v.visible || !this.sim.canSee(this.local, b)) continue;
      if (b.hp >= b.def.hp && b.id !== this.selectedBuilding) continue;
      this.healthBar(g, (b.tx + b.def.width / 2) * TILE_PX, b.ty * TILE_PX - 4, b.def.width * TILE_PX - 8, b.hp / b.def.hp);
      if (b.repairing) {
        g.fillStyle(0x9dff5c, 1);
        g.fillCircle((b.tx + b.def.width) * TILE_PX - 6, b.ty * TILE_PX + 6, 4);
      }
    }

    // Bewegungsmarker
    this.markers = this.markers.filter((m) => (m.age += dt) < 0.6);
    for (const m of this.markers) {
      const k = m.age / 0.6;
      g.lineStyle(2, m.color, 1 - k);
      g.strokeCircle(m.x, m.y, 14 * (1 - k) + 3);
    }
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

  private healthBar(g: Phaser.GameObjects.Graphics, cx: number, y: number, w: number, f: number): void {
    const color = f > 0.6 ? 0x5cd65c : f > 0.3 ? 0xf2c230 : 0xe8503a;
    g.fillStyle(0x1d1a2b, 0.85);
    g.fillRect(cx - w / 2 - 1, y - 1, w + 2, 5);
    g.fillStyle(color, 1);
    g.fillRect(cx - w / 2, y, Math.max(1, w * f), 3);
  }

  private drawPlacement(): void {
    const g = this.placeGfx;
    g.clear();
    if (!this.placing || !this.placeTile) {
      this.placeGhost?.setVisible(false);
      return;
    }
    const def = this.placing.def;
    const { tx, ty } = this.placeTile;
    const check = canPlace(this.sim, this.local, def, tx, ty);
    let i = 0;
    for (let y = ty; y < ty + def.height; y++) {
      for (let x = tx; x < tx + def.width; x++, i++) {
        const ok = check.ok || (check.tiles[i] && check.reason === 'tooFar' ? false : check.tiles[i]);
        g.fillStyle(ok && check.ok ? 0x5cd65c : 0xe8503a, 0.4);
        g.fillRect(x * TILE_PX + 1, y * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
      }
    }
    if (!this.placeGhost) {
      const tex = ensureBuildingTexture(this, def, this.colorOf(this.local));
      this.placeGhost = this.add.image(0, 0, tex.body).setOrigin(0).setScale(TEX_SCALE).setAlpha(0.6).setDepth(DEPTH.marker - 1);
    }
    const pad = BUILDING_PAD * TEX_SCALE;
    this.placeGhost.setVisible(true).setPosition(tx * TILE_PX - pad, ty * TILE_PX - pad);
  }

  private drawMinimap(): void {
    const p = this.sim.players[this.local];
    const mm = this.hud.minimap;
    const ctx = mm.getContext('2d')!;
    const m = this.sim.map;
    const sx = mm.width / m.width;
    const sy = mm.height / m.height;
    this.hud.setRadar(p.hasRadar);
    ctx.imageSmoothingEnabled = false;
    if (!p.hasRadar) {
      ctx.fillStyle = '#11121d';
      ctx.fillRect(0, 0, mm.width, mm.height);
      return;
    }
    ctx.drawImage(this.minimapBase, 0, 0, mm.width, mm.height);
    const eco = this.sim.economy;
    ctx.fillStyle = '#5ff0ff';
    for (const c of this.crystals) {
      if (eco.crystal[c.idx] <= 0) continue;
      const tx = c.idx % m.width;
      ctx.fillRect(tx * sx, ((c.idx - tx) / m.width) * sy, Math.max(1, sx), Math.max(1, sy));
    }
    // Nebel
    for (let i = 0; i < p.explored.length; i++) {
      if (p.visible[i]) continue;
      const tx = i % m.width;
      ctx.fillStyle = p.explored[i] ? 'rgba(0,0,0,0.5)' : '#000';
      ctx.fillRect(tx * sx, ((i - tx) / m.width) * sy, Math.ceil(sx), Math.ceil(sy));
    }
    const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    for (const b of this.sim.buildings) {
      if (!this.sim.isAlly(this.local, b.owner) && !this.sim.canSee(this.local, b) && !p.ghosts.has(b.id)) continue;
      ctx.fillStyle = hex(this.colorOf(b.owner));
      ctx.fillRect(b.tx * sx, b.ty * sy, b.def.width * sx, b.def.height * sy);
    }
    for (const u of this.sim.units) {
      const v = this.views.get(u.id);
      if (v && !v.visible) continue;
      ctx.fillStyle = hex(this.colorOf(u.owner));
      ctx.fillRect(tileOf(u.x) * sx - 0.5, tileOf(u.y) * sy - 0.5, Math.max(2, sx), Math.max(2, sy));
    }
    // Kamera-Rahmen
    const view = this.cameras.main.worldView;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect((view.x / TILE_PX) * sx, (view.y / TILE_PX) * sy, (view.width / TILE_PX) * sx, (view.height / TILE_PX) * sy);
  }

  // ───────────────────────────── Oberfläche ─────────────────────────────

  private updateHud(): void {
    const p = this.sim.players[this.local];
    this.hud.setResources(p.credits, p.storage, p.powerProduced, p.powerUsed);
    this.hud.setBuildItems(this.buildItems());
    const counts = new Map<string, { name: string; count: number }>();
    for (const id of this.selection) {
      const u = this.sim.getUnit(id);
      if (!u) continue;
      const e = counts.get(u.def.id) ?? { name: t(u.def.nameKey), count: 0 };
      e.count++;
      counts.set(u.def.id, e);
    }
    const sb = this.selectedBuilding ? this.sim.getBuilding(this.selectedBuilding) : undefined;
    if (sb) counts.set('_b', { name: t(sb.def.nameKey), count: 1 });
    this.hud.setSelection([...counts.values()]);
    this.hud.setStats(this.game.loop.actualFps, this.sim.units.length);
    const units = this.selectedUnits();
    const armed = units.filter((u) => u.def.weapon);
    this.hud.setCommands({
      hasUnits: units.length > 0,
      armed: this.armed,
      stance: armed.length > 0 ? armed[0].stance : null,
      canDeploy: units.some((u) => u.def.deploysTo),
      building: sb && sb.owner === this.local ? { repairing: sb.repairing, damaged: sb.hp < sb.def.hp } : null,
      placing: !!this.placing && this.lastPointerTouch,
    });
    this.hud.setPlacing(!!this.placing, this.lastPointerTouch);
  }

  private buildItems(): BuildItemState[] {
    const p = this.sim.players[this.local];
    const color = this.colorOf(this.local);
    const out: BuildItemState[] = [];
    const nameOf = (id: string) => {
      const d = this.rules.building(p.faction, id);
      return d ? t(d.nameKey) : id;
    };
    const add = (def: UnitDef | BuildingDef, category: BuildTab) => {
      if (!def.buildable) return;
      const av = availability(this.sim, this.local, def);
      const queue = p.queues[category].filter((q) => q.defId === def.id);
      const head = p.queues[category][0];
      const isHead = head?.defId === def.id;
      const producerNames = category === 'building' || category === 'defense' ? ['constructionYard'] : category === 'infantry' ? ['barracks'] : ['factory'];
      out.push({
        id: def.id,
        category,
        nameKey: def.nameKey,
        cost: def.cost,
        icon: iconFor(def, color),
        available: av.available,
        missing: (av.missing.length > 0 ? av.missing : av.noProducer ? producerNames : []).map(nameOf),
        progress: isHead ? head.done / head.total : null,
        queued: queue.length,
        paused: queue.some((q) => q.paused),
        ready: (category === 'building' || category === 'defense') && p.ready[category] === def.id,
      });
    };
    for (const b of this.rules.buildingsOf(p.faction)) add(b, b.category);
    for (const u of this.rules.unitsOf(p.faction)) if (u.category === 'infantry' || u.category === 'vehicle') add(u, u.category);
    return out;
  }

  // ───────────────────────────── Kamera ─────────────────────────────

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: cam.scrollX + cam.width * 0.5 + (sx - cam.width * 0.5) / cam.zoom,
      y: cam.scrollY + cam.height * 0.5 + (sy - cam.height * 0.5) / cam.zoom,
    };
  }

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

  private centerOnWorldPx(x: number, y: number): void {
    this.cameras.main.centerOn(x, y);
    this.clampCamera();
  }

  centerOnSelection(): void {
    const units = this.selectedUnits();
    if (units.length > 0) {
      const x = units.reduce((s, u) => s + u.x, 0) / units.length;
      const y = units.reduce((s, u) => s + u.y, 0) / units.length;
      this.centerOnWorldPx(unitsToPx(x), unitsToPx(y));
    }
  }

  minimapJump(fx: number, fy: number): void {
    if (!this.sim.players[this.local].hasRadar) return;
    const m = this.sim.map;
    this.centerOnWorldPx(fx * m.width * TILE_PX, fy * m.height * TILE_PX);
  }

  // ───────────────────────────── Auswahl ─────────────────────────────

  private selectedUnits(): Unit[] {
    const out: Unit[] = [];
    for (const id of this.selection) {
      const u = this.sim.getUnit(id);
      if (u && u.owner === this.local) out.push(u);
    }
    return out;
  }

  private pickUnit(sx: number, sy: number, touch: boolean, filter: (u: Unit) => boolean): Unit | null {
    const p = this.screenToWorld(sx, sy);
    const tol = (touch ? PICK_TOLERANCE_TOUCH : PICK_TOLERANCE_MOUSE) / this.cameras.main.zoom;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const u of this.sim.units) {
      const v = this.views.get(u.id);
      if (!v || !v.visible || !filter(u)) continue;
      const r = unitsToPx(u.def.radiusUnits) + tol;
      const d = (v.x - p.x) ** 2 + (v.y - p.y) ** 2;
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best;
  }

  private pickBuilding(sx: number, sy: number, filter: (b: Building) => boolean): Building | null {
    const p = this.screenToWorld(sx, sy);
    const tx = Math.floor(p.x / TILE_PX);
    const ty = Math.floor(p.y / TILE_PX);
    for (const b of this.sim.buildings) {
      const v = this.bviews.get(b.id);
      if (!v || !v.visible || !filter(b)) continue;
      if (tx >= b.tx && tx < b.tx + b.def.width && ty >= b.ty && ty < b.ty + b.def.height) return b;
    }
    return null;
  }

  hasSelection(): boolean {
    return this.selection.size > 0 || this.selectedBuilding !== 0;
  }

  private selectUnitsOnly(ids: number[], additive = false): void {
    if (!additive) this.selection = new Set();
    for (const id of ids) this.selection.add(id);
    this.selectedBuilding = 0;
    this.armed = false;
    this.updateHud();
  }

  /** Normale Auswahl per Klick/Tippen. */
  private selectAt(sx: number, sy: number, additive: boolean, touch: boolean): boolean {
    const u = this.pickUnit(sx, sy, touch, (x) => x.owner === this.local);
    if (u) {
      if (additive && this.selection.has(u.id)) {
        this.selection.delete(u.id);
        this.updateHud();
      } else this.selectUnitsOnly([u.id], additive);
      return true;
    }
    const b = this.pickBuilding(sx, sy, (x) => x.owner === this.local);
    if (b) {
      this.selection = new Set();
      this.selectedBuilding = b.id;
      this.armed = false;
      this.updateHud();
      return true;
    }
    return false;
  }

  doubleSelect(sx: number, sy: number, touch: boolean): void {
    if (this.placing) return;
    const picked = this.pickUnit(sx, sy, touch, (x) => x.owner === this.local);
    if (!picked) return;
    const view = this.cameras.main.worldView;
    this.selectUnitsOnly(
      this.sim.units
        .filter((u) => {
          const v = this.views.get(u.id);
          return u.owner === this.local && u.def.id === picked.def.id && v && view.contains(v.x, v.y);
        })
        .map((u) => u.id),
    );
  }

  selectInBox(x0: number, y0: number, x1: number, y1: number, additive: boolean): void {
    if (this.placing) return;
    const a = this.screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
    const ids: number[] = [];
    for (const u of this.sim.units) {
      if (u.owner !== this.local) continue;
      const v = this.views.get(u.id);
      if (!v) continue;
      if (v.x >= a.x && v.x <= b.x && v.y >= a.y && v.y <= b.y) ids.push(u.id);
    }
    // Sammler/Bauwagen nur, wenn sonst nichts im Rahmen ist (wie in klassischen RTS)
    const combat = ids.filter((id) => this.sim.getUnit(id)?.def.weapon);
    this.selectUnitsOnly(combat.length > 0 ? combat : ids, additive);
  }

  clearSelection(): void {
    this.selection = new Set();
    this.selectedBuilding = 0;
    this.armed = false;
    this.updateHud();
  }

  // ───────────────────────────── Befehle ─────────────────────────────

  /** Kontextbefehl: Angriff, Ernten, Andocken, Betreten oder einfach Fahren. */
  private commandAt(sx: number, sy: number, touch: boolean): void {
    const units = this.selectedUnits();
    if (units.length === 0) return;
    const p = this.screenToWorld(sx, sy);
    const x = pxToUnits(p.x);
    const y = pxToUnits(p.y);
    const ids = (list: Unit[]) => list.map((u) => u.id);
    const issue = (cmd: object) => this.sim.issue(this.local, cmd);

    if (this.armed) {
      this.armed = false;
      const fighters = units.filter((u) => u.def.weapon);
      const others = units.filter((u) => !u.def.weapon);
      if (fighters.length) issue({ type: 'attackMove', units: ids(fighters), x, y });
      if (others.length) issue({ type: 'move', units: ids(others), x, y });
      this.markers.push({ x: p.x, y: p.y, age: 0, color: 0xff6a3d });
      this.updateHud();
      return;
    }

    const enemyUnit = this.pickUnit(sx, sy, touch, (u) => this.sim.isEnemy(this.local, u.owner));
    const enemyBuilding = enemyUnit ? null : this.pickBuilding(sx, sy, (b) => this.sim.isEnemy(this.local, b.owner));
    const ownBuilding = this.pickBuilding(sx, sy, (b) => b.owner === this.local);
    const rest: Unit[] = [];
    const fighters = units.filter((u) => u.def.weapon);
    const harvesters = units.filter((u) => u.def.harvestCapacity);
    const engineers = units.filter((u) => u.def.engineer);
    let markerColor = 0x9dff5c;

    if (enemyUnit || enemyBuilding) {
      const target = (enemyUnit ?? enemyBuilding)!;
      if (fighters.length) issue({ type: 'attack', units: ids(fighters), target: target.id });
      if (enemyBuilding && engineers.length) issue({ type: 'enter', units: ids(engineers), target: target.id });
      else rest.push(...engineers);
      rest.push(...units.filter((u) => !u.def.weapon && !u.def.engineer));
      markerColor = 0xff3b3b;
    } else if (ownBuilding && ownBuilding.def.refinery && harvesters.length) {
      issue({ type: 'dock', units: ids(harvesters), target: ownBuilding.id });
      rest.push(...units.filter((u) => !u.def.harvestCapacity));
    } else if (ownBuilding && ownBuilding.hp < ownBuilding.def.hp && engineers.length) {
      issue({ type: 'enter', units: ids(engineers), target: ownBuilding.id });
      rest.push(...units.filter((u) => !u.def.engineer));
    } else {
      const tx = Math.floor(p.x / TILE_PX);
      const ty = Math.floor(p.y / TILE_PX);
      const m = this.sim.map;
      const crystal = m.inBounds(tx, ty) && this.sim.economy.crystal[m.index(tx, ty)] > 0;
      if (crystal && harvesters.length) {
        issue({ type: 'harvest', units: ids(harvesters), tx, ty });
        rest.push(...units.filter((u) => !u.def.harvestCapacity));
        markerColor = 0x5ff0ff;
      } else rest.push(...units);
    }
    if (rest.length) issue({ type: 'move', units: ids(rest), x, y });
    this.markers.push({ x: p.x, y: p.y, age: 0, color: markerColor });
  }

  leftClick(sx: number, sy: number, shift: boolean): void {
    this.lastPointerTouch = false;
    if (this.placing) {
      this.hover(sx, sy);
      this.confirmPlacement();
      return;
    }
    if (this.armed) {
      this.commandAt(sx, sy, false);
      return;
    }
    if (!this.selectAt(sx, sy, shift, false) && !shift) this.clearSelection();
  }

  rightClick(sx: number, sy: number): void {
    this.lastPointerTouch = false;
    if (this.placing) {
      this.cancelPlacement();
      return;
    }
    if (this.armed) {
      this.armed = false;
      this.updateHud();
      return;
    }
    if (this.selectedBuilding && this.selection.size === 0) {
      this.clearSelection();
      return;
    }
    this.commandAt(sx, sy, false);
  }

  tap(sx: number, sy: number): void {
    this.lastPointerTouch = true;
    if (this.placing) {
      const tile = this.tileAt(sx, sy);
      if (this.placeTile && this.placeTile.tx === tile.tx && this.placeTile.ty === tile.ty) this.confirmPlacement();
      else this.placeTile = tile;
      this.updateHud();
      return;
    }
    if (this.armed) {
      this.commandAt(sx, sy, true);
      return;
    }
    const units = this.selectedUnits();
    const ownUnit = this.pickUnit(sx, sy, true, (u) => u.owner === this.local);
    if (ownUnit) {
      this.selectUnitsOnly([ownUnit.id]);
      return;
    }
    const ownBuilding = this.pickBuilding(sx, sy, (b) => b.owner === this.local);
    // Gebäude als Ziel eines Kontextbefehls (Sammler → Raffinerie, Ingenieur → Reparatur)?
    const contextual =
      ownBuilding &&
      ((ownBuilding.def.refinery && units.some((u) => u.def.harvestCapacity)) ||
        (ownBuilding.hp < ownBuilding.def.hp && units.some((u) => u.def.engineer)));
    if (ownBuilding && !contextual) {
      this.selectAt(sx, sy, false, true);
      return;
    }
    if (units.length > 0) this.commandAt(sx, sy, true);
    else if (this.selectedBuilding) this.clearSelection();
  }

  hover(sx: number, sy: number): void {
    if (this.placing) {
      const tile = this.tileAt(sx, sy);
      this.placeTile = tile;
    }
    // Mauszeiger je nach Ziel
    const el = document.getElementById('game')!;
    let cursor = 'default';
    if (this.placing) cursor = 'copy';
    else if (this.armed) cursor = 'crosshair';
    else if (this.selection.size > 0) {
      const enemy =
        this.pickUnit(sx, sy, false, (u) => this.sim.isEnemy(this.local, u.owner)) ??
        this.pickBuilding(sx, sy, (b) => this.sim.isEnemy(this.local, b.owner));
      cursor = enemy ? 'crosshair' : 'pointer';
    }
    if (el.style.cursor !== cursor) el.style.cursor = cursor;
  }

  /** Kachel unter dem Bildschirmpunkt – für Gebäude so, dass der Punkt die Mitte ist. */
  private tileAt(sx: number, sy: number): { tx: number; ty: number } {
    const p = this.screenToWorld(sx, sy);
    const w = this.placing?.def.width ?? 1;
    const h = this.placing?.def.height ?? 1;
    return { tx: Math.floor(p.x / TILE_PX - w / 2 + 0.5), ty: Math.floor(p.y / TILE_PX - h / 2 + 0.5) };
  }

  onKey(key: string): boolean {
    switch (key) {
      case 'escape':
        if (this.ended) return true;
        if (this.paused) this.resume();
        else if (this.placing) this.cancelPlacement();
        else if (this.armed) {
          this.armed = false;
          this.updateHud();
        } else if (this.hasSelection()) this.clearSelection();
        else this.pause();
        return true;
      case 's':
        this.stop();
        return true;
      case 'a':
        this.armAttack();
        return true;
      case 'd':
        this.deploy();
        return true;
      case 'space':
        if (this.lastEventPos) this.centerOnWorldPx(unitsToPx(this.lastEventPos.x), unitsToPx(this.lastEventPos.y));
        else this.centerOnSelection();
        return true;
    }
    return false;
  }

  stop(): void {
    const units = this.selectedUnits();
    if (units.length) this.sim.issue(this.local, { type: 'stop', units: units.map((u) => u.id) });
  }

  armAttack(): void {
    if (this.selectedUnits().some((u) => u.def.weapon)) {
      this.armed = !this.armed;
      this.updateHud();
    }
  }

  cycleStance(): void {
    const armed = this.selectedUnits().filter((u) => u.def.weapon);
    if (!armed.length) return;
    const next = STANCES[(STANCES.indexOf(armed[0].stance) + 1) % STANCES.length];
    this.sim.issue(this.local, { type: 'stance', units: armed.map((u) => u.id), stance: next });
    // Sofort anzeigen (der Befehl wirkt im nächsten Tick)
    for (const u of armed) u.stance = next;
    this.hud.message(t(`stance.${next}`), 'info');
    this.updateHud();
  }

  deploy(): void {
    const wagons = this.selectedUnits().filter((u) => u.def.deploysTo);
    if (wagons.length) this.sim.issue(this.local, { type: 'deploy', units: wagons.map((u) => u.id) });
  }

  sellSelected(): void {
    if (this.selectedBuilding) this.sim.issue(this.local, { type: 'sell', building: this.selectedBuilding });
    this.selectedBuilding = 0;
    this.updateHud();
  }

  repairSelected(): void {
    if (this.selectedBuilding) this.sim.issue(this.local, { type: 'repair', building: this.selectedBuilding });
    this.time.delayedCall(100, () => this.updateHud());
  }

  saveGroup(n: number): void {
    const ids = this.selectedUnits().map((u) => u.id);
    this.groups.set(n, ids);
    this.hud.setGroupSize(n, ids.length);
  }

  recallGroup(n: number): void {
    const ids = (this.groups.get(n) ?? []).filter((id) => this.sim.getUnit(id));
    if (ids.length) this.selectUnitsOnly(ids);
  }

  // ───────────────────────────── Bauleiste & Platzieren ─────────────────────────────

  buildItem(category: BuildTab, id: string, action: 'click' | 'alt'): void {
    const p = this.sim.players[this.local];
    const issue = (a: 'add' | 'pause' | 'cancel') => this.sim.issue(this.local, { type: 'queue', category, item: id, action: a });
    const isBuilding = category === 'building' || category === 'defense';
    const ready = isBuilding && p.ready[category] === id;
    const queued = p.queues[category].filter((q) => q.defId === id);
    if (action === 'click') {
      if (ready) {
        const def = this.rules.building(p.faction, id)!;
        this.startPlacement(category as 'building' | 'defense', def);
      } else issue('add');
    } else if (ready || queued.some((q) => q.paused)) {
      issue('cancel');
    } else if (queued.length > 0) {
      issue('pause');
    }
    this.time.delayedCall(80, () => this.updateHud());
  }

  private startPlacement(category: 'building' | 'defense', def: BuildingDef): void {
    this.placing = { category, def };
    this.placeGhost?.destroy();
    this.placeGhost = null;
    this.selection = new Set();
    this.selectedBuilding = 0;
    // Vorschau zuerst an einer gültigen Stelle nahe der Bildmitte (Touch: dann nur noch bestätigen)
    const cam = this.cameras.main;
    const center = this.screenToWorld(cam.width / 2, cam.height / 2);
    const ctx = Math.floor(center.x / TILE_PX - def.width / 2);
    const cty = Math.floor(center.y / TILE_PX - def.height / 2);
    this.placeTile = this.findFreeSpot(def, ctx, cty) ?? { tx: ctx, ty: cty };
    this.updateHud();
  }

  /** Nächste gültige Bauposition um (tx,ty) – spiralförmig nach aussen. */
  private findFreeSpot(def: BuildingDef, tx: number, ty: number): { tx: number; ty: number } | null {
    for (let r = 0; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (canPlace(this.sim, this.local, def, tx + dx, ty + dy).ok) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return null;
  }

  confirmPlacement(): void {
    if (!this.placing || !this.placeTile) return;
    const { category, def } = this.placing;
    const { tx, ty } = this.placeTile;
    if (!canPlace(this.sim, this.local, def, tx, ty).ok) {
      this.hud.message(t('msg.cannotPlace'), 'warn');
      return;
    }
    this.sim.issue(this.local, { type: 'place', category, tx, ty });
    this.cancelPlacement();
  }

  cancelPlacement(): void {
    this.placing = null;
    this.placeTile = null;
    this.placeGhost?.destroy();
    this.placeGhost = null;
    this.placeGfx.clear();
    this.updateHud();
  }

  // ───────────────────────────── Pause & Ende ─────────────────────────────

  pause(): void {
    if (this.ended) return;
    this.paused = true;
    this.controls.enabled = false;
    this.hud.showPause();
  }

  resume(): void {
    this.paused = false;
    this.controls.enabled = true;
    this.hud.hideOverlay();
  }

  surrender(): void {
    this.sim.issue(this.local, { type: 'surrender' });
    this.resume();
  }

  toMenu(): void {
    this.onExit();
  }

  playAgain(): void {
    const data: GameSceneData = { config: this.cfg, onExit: this.onExit };
    this.scene.restart(data);
  }

  private showEnd(): void {
    this.ended = true;
    this.controls.enabled = false;
    const winners = this.sim.gameOver?.winners ?? [];
    const victory = winners.some((w) => this.sim.isAlly(this.local, w));
    const rows = this.sim.playerList.map((p) => ({
      name: p.name,
      color: `#${this.colorOf(p.id).toString(16).padStart(6, '0')}`,
      stats: p.stats,
    }));
    // Kurz warten, damit die letzten Explosionen noch zu sehen sind
    this.time.delayedCall(1500, () => this.hud.showEnd(victory, rows, (this.sim.tick * TICK_MS) / 1000));
  }
}

/** Dreht einen Winkel um höchstens maxStep in Richtung Ziel. */
function turnTowards(current: number, target: number, maxStep: number): number {
  const diff = Phaser.Math.Angle.Wrap(target - current);
  return current + (Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep);
}
