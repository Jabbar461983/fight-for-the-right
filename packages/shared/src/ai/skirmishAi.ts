import type { AiDifficulty, AiLevel, BuildingDef, ProductionCategory } from '../data/rules';
import { MoveClass } from '../map/terrain';
import { TICK_RATE, TILE, isqrt, tileOf } from '../math/fixed';
import { availability, canPlace } from '../sim/production';
import type { Simulation, TickListener } from '../sim/simulation';
import type { Building, Player, Unit } from '../sim/unit';

/**
 * Computergegner für Gefechte. Spielt nach denselben Regeln wie ein Mensch:
 * Er gibt nur Befehle über sim.issue(), sieht nur, was seine Einheiten sehen
 * (Nebel), und bezahlt alles mit eigenem Glimmerit.
 *
 * Ablauf (alle 1–2 Sekunden): Bauwagen ausfahren → Bauplan abarbeiten →
 * fertige Gebäude platzieren → Sammler ersetzen → Armee bauen → Ingenieure
 * zu Bonus-Punkten → ausbauen (Schwer) → Basis verteidigen → in Wellen angreifen.
 * Die Stufen unterscheiden sich nur durch Werte in data/rules/ai.json.
 */
export class SkirmishAi implements TickListener {
  private readonly cfg: AiDifficulty;
  private nextThink: number;
  private nextAttack: number;
  private waveSize: number;
  private deployAttempts = 0;
  /** Gebäude, die sich nicht platzieren liessen (z.B. Werft ohne Wasser) – nicht nochmal versuchen. */
  private impossible = new Set<string>();
  /** Erreicht die KI den Gegner über Land? (sonst Luft und See) */
  private landConnected: boolean | null = null;
  private wave = 0;
  private expansionWagon = 0;
  /** Gedächtnis: gesehene gegnerische Kampfeinheiten (id → Stärke, zuletzt gesehen). */
  private seenEnemies = new Map<number, { value: number; tick: number }>();

  constructor(
    readonly player: number,
    readonly level: AiLevel,
    sim: Simulation,
  ) {
    this.cfg = sim.rules.ai.difficulties[level];
    this.nextThink = 5 + player * 3; // gestaffelt, damit nicht alle KIs im selben Tick rechnen
    this.nextAttack = Math.round(this.cfg.firstAttackAfter * TICK_RATE);
    this.waveSize = this.cfg.waveSize;
  }

  update(sim: Simulation): void {
    if (sim.tick < this.nextThink) return;
    this.nextThink = sim.tick + Math.max(1, Math.round(this.cfg.thinkInterval * TICK_RATE));
    const p = sim.players[this.player];
    if (!p || p.defeated || sim.gameOver) return;

    const units = sim.units.filter((u) => !u.dead && u.owner === p.id);
    const buildings = sim.buildings.filter((b) => !b.dead && b.owner === p.id);
    const yards = buildings.filter((b) => b.def.constructionYard);

    if (yards.length === 0) {
      this.deployWagon(sim, units);
      return;
    }
    const base = { x: yards[0].x, y: yards[0].y };
    if (this.landConnected === null) this.landConnected = this.checkLand(sim, base);

    this.placeReady(sim, p, base);
    this.followBuildOrder(sim, p, buildings);
    this.manageHarvesters(sim, p, units, buildings);
    this.produceArmy(sim, p, units);
    this.useEngineers(sim, p, units);
    if (this.cfg.expand) this.expand(sim, p, units, buildings);
    if (this.cfg.repairBuildings) this.repair(sim, buildings);
    const army = units.filter((u) => u.def.weapon && !u.def.harvestCapacity && !u.def.deploysTo && u.ammo !== 0);
    this.rememberEnemies(sim, p);
    if (!this.defend(sim, p, army, base)) this.attack(sim, p, army, base);
  }

  /** Stärke einer Einheit für Vergleiche: Kosten, gewichtet mit verbleibender Gesundheit. */
  private value(u: Unit): number {
    return (u.def.cost * u.hp) / u.def.hp;
  }

  /** Merkt sich, welche gegnerischen Truppen die KI gesehen hat (vergisst nach 2 Minuten). */
  private rememberEnemies(sim: Simulation, p: Player): void {
    for (const u of sim.units) {
      if (u.dead || !u.def.weapon || !sim.isEnemy(p.id, u.owner) || !sim.canSee(p.id, u)) continue;
      this.seenEnemies.set(u.id, { value: this.value(u), tick: sim.tick });
    }
    for (const [id, e] of this.seenEnemies) {
      const u = sim.getUnit(id);
      // Gesehen, dass sie weg ist, oder lange nicht mehr gesehen → vergessen
      if ((!u && sim.tick - e.tick < 5) || sim.tick - e.tick > 15 * 120) this.seenEnemies.delete(id);
    }
  }

  /** Bekannte gegnerische Stärke: gemerkte Truppen + gesehene Abwehrtürme. */
  private knownEnemyStrength(sim: Simulation, p: Player): number {
    let s = 0;
    for (const e of this.seenEnemies.values()) s += e.value;
    for (const g of p.ghosts.values()) {
      if (!sim.isEnemy(p.id, g.owner)) continue;
      const def = sim.rules.building(g.faction, g.defId);
      if (def?.weapon || def?.garrison) s += def.cost * 1.5;
    }
    return s;
  }

  /** Ist ein gegnerischer Startplatz über Land erreichbar? */
  private checkLand(sim: Simulation, base: { x: number; y: number }): boolean {
    const m = sim.map;
    const start = m.nearestPassable(tileOf(base.x), tileOf(base.y) + 3, MoveClass.Vehicle);
    if (!start) return false;
    const comp = m.componentOf(start.tx, start.ty, MoveClass.Vehicle);
    return m.objectsOfKind('spawn').some((s) => {
      const owner = Number(s.props.player);
      if (owner === this.player || !sim.players[owner] || !sim.isEnemy(this.player, owner)) return false;
      const t = m.nearestPassable(tileOf(s.x), tileOf(s.y), MoveClass.Vehicle);
      return !!t && m.componentOf(t.tx, t.ty, MoveClass.Vehicle) === comp;
    });
  }

  // ───────────── Basis ─────────────

  private deployWagon(sim: Simulation, units: Unit[]): void {
    const wagon = units.find((u) => u.def.deploysTo);
    if (!wagon || wagon.task || wagon.order) return;
    this.deployAttempts++;
    if (this.deployAttempts % 3 === 0) {
      // Klappt das Ausfahren nicht, ein Stück weiterfahren
      const dir = (this.deployAttempts / 3) % 4;
      const dx = [2, 0, -2, 0][dir] * TILE;
      const dy = [0, 2, 0, -2][dir] * TILE;
      sim.issue(this.player, { type: 'move', units: [wagon.id], x: wagon.x + dx, y: wagon.y + dy });
    } else {
      sim.issue(this.player, { type: 'deploy', units: [wagon.id] });
    }
  }

  /** Bauplan aus ai.json abarbeiten; bei Strommangel zuerst ein Kraftwerk. */
  private followBuildOrder(sim: Simulation, p: Player, buildings: Building[]): void {
    const owned = new Map<string, number>();
    for (const b of buildings) owned.set(b.def.id, (owned.get(b.def.id) ?? 0) + 1);
    // Abwehr erst, wenn die Wirtschaft steht (Raffinerie + Fabrik) – sonst fehlt das Geld für Sammler
    const economyReady = (owned.get('refinery') ?? 0) > 0 && (owned.get('factory') ?? 0) > 0;
    const armySize = sim.units.filter((u) => !u.dead && u.owner === p.id && u.def.weapon && !u.def.harvestCapacity).length;
    // Mittel/Schwer: Türme und teure Technik erst mit Armee im Rücken oder vollem Konto
    const rich = this.level === 'easy' || p.credits > 1500 || (armySize >= 12 && sim.tick > 15 * 60 * 7);
    // Mittel/Schwer: steht die Fabrik, zuerst eine Mindestarmee (wächst mit der Spielzeit) –
    // sonst fliesst alles Geld in Gebäude und ein früher Angriff überrennt die Basis.
    // Kraftwerke und Raffinerien (Wirtschaft) gehen immer.
    const minutes = sim.tick / (15 * 60);
    const minArmy = Math.min(14, Math.floor(4 + minutes * 1.2));
    // Auf Inselkarten entsteht die Armee erst mit Flugfeld/Werft → dort keine Bremse (sonst Stillstand)
    const armyFirst = this.level !== 'easy' && this.landConnected !== false && economyReady && armySize < minArmy && p.credits < 1500;
    for (const cat of ['building', 'defense'] as const) {
      if (p.queues[cat].length > 0 || p.ready[cat]) continue;
      if (cat === 'defense' && (!economyReady || (!rich && (owned.get('mgTower') ?? 0) > 0))) continue;
      const pick = this.nextBuilding(sim, p, owned, cat, rich);
      if (pick && armyFirst && pick !== 'powerPlant' && pick !== 'refinery') continue;
      if (pick) sim.issue(this.player, { type: 'queue', category: cat, item: pick, action: 'add' });
    }
  }

  private nextBuilding(
    sim: Simulation,
    p: Player,
    owned: Map<string, number>,
    cat: 'building' | 'defense',
    rich: boolean,
  ): string | null {
    // Strom wird knapp → Kraftwerk zuerst
    if (cat === 'building' && p.powerUsed + 20 > p.powerProduced) return 'powerPlant';
    // Neuer Aussenposten ohne Raffinerie → Raffinerie zuerst (dort liegen frische Kristalle)
    const yards = owned.get('constructionYard') ?? 0;
    const refineries = owned.get('refinery') ?? 0;
    if (cat === 'building' && yards > 1 && refineries < Math.min(yards, this.cfg.maxRefineries) && !this.impossible.has('refinery')) {
      return 'refinery';
    }
    const required = new Map<string, number>();
    const order = (this.cfg.buildOrder ?? sim.rules.ai.buildOrder).slice(0, this.cfg.buildOrderLength);
    for (const id of order) {
      required.set(id, (required.get(id) ?? 0) + 1);
      if (this.impossible.has(id)) continue;
      const def = sim.rules.building(p.faction, id);
      if (!def || def.category !== cat) continue;
      if ((owned.get(id) ?? 0) >= required.get(id)!) continue;
      if (def.refinery && (owned.get(id) ?? 0) >= this.cfg.maxRefineries) continue;
      if (!availability(sim, p.id, def).available) continue;
      // Teures (ausser erster Fabrik/Radar) erst, wenn es sich die KI leisten kann – dann aber
      // nicht überspringen, sondern warten (der Bauplan bleibt in der Reihenfolge)
      const essential = (id === 'factory' || id === 'radar') && (owned.get(id) ?? 0) === 0;
      if (!rich && def.cost >= 1000 && !essential && !def.refinery) return null;
      return id;
    }
    return null;
  }

  /** Fertige Gebäude platzieren: Raffinerien ans Kristallfeld, Türme Richtung Gegner, Rest um den Bauhof. */
  private placeReady(sim: Simulation, p: Player, base: { x: number; y: number }): void {
    for (const cat of ['building', 'defense'] as const) {
      const id = p.ready[cat];
      if (!id) continue;
      const def = sim.rules.building(p.faction, id);
      if (!def) continue;
      const enemy = this.enemyDirection(sim, base);
      let anchor = { tx: tileOf(base.x), ty: tileOf(base.y) };
      if (cat === 'defense') anchor = { tx: tileOf(base.x + enemy.dx * 6), ty: tileOf(base.y + enemy.dy * 6) };
      const field = def.refinery ? this.crystalAnchor(sim, p.id) : null;
      if (field) anchor = field;
      const spot = field ? this.findRefinerySpot(sim, p.id, def, field) : this.findSpot(sim, p.id, def, anchor);
      if (spot) sim.issue(this.player, { type: 'place', category: cat, tx: spot.tx, ty: spot.ty });
      else {
        // Werft ohne Wasser in der Nähe: nie wieder versuchen. Sonst später erneut (Platz wird frei).
        if (def.requiresWater) this.impossible.add(id);
        sim.issue(this.player, { type: 'queue', category: cat, item: id, action: 'cancel' });
      }
    }
  }

  /** Restliches Glimmerit eines Kristallfelds (Anteil 0…1). */
  private fieldFill(sim: Simulation, f: { x: number; y: number; props: Record<string, unknown> }): number {
    const r = Math.ceil(Number(f.props.radius ?? 2)) + 1;
    const eco = sim.economy;
    const m = sim.map;
    let cur = 0;
    let max = 0;
    for (let y = tileOf(f.y) - r; y <= tileOf(f.y) + r; y++) {
      for (let x = tileOf(f.x) - r; x <= tileOf(f.x) + r; x++) {
        if (!m.inBounds(x, y)) continue;
        cur += eco.crystal[m.index(x, y)];
        max += eco.crystalMax[m.index(x, y)];
      }
    }
    return max > 0 ? cur / max : 0;
  }

  /** Volles Kristallfeld nahe einem eigenen Gebäude (für Raffinerien). */
  private crystalAnchor(sim: Simulation, player: number): { tx: number; ty: number } | null {
    let best: { tx: number; ty: number } | null = null;
    let bestScore = Infinity;
    const own = sim.buildings.filter((b) => !b.dead && b.owner === player && !b.def.neutral);
    for (const f of sim.map.objectsOfKind('crystalField')) {
      const fill = this.fieldFill(sim, f);
      if (fill < 0.25) continue;
      for (const b of own) {
        const d = (f.x - b.x) ** 2 + (f.y - b.y) ** 2;
        if (d > (14 * TILE) ** 2) continue;
        const score = d / fill;
        if (score < bestScore) {
          bestScore = score;
          best = { tx: tileOf(f.x), ty: tileOf(f.y) };
        }
      }
    }
    return best;
  }

  /** Sucht einen gültigen Bauplatz nahe am Anker, mit einer Kachel Abstand zu anderen Gebäuden (Durchgänge!). */
  private findSpot(sim: Simulation, player: number, def: BuildingDef, anchor: { tx: number; ty: number }) {
    const cands: { tx: number; ty: number; d: number }[] = [];
    const R = 12;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) cands.push({ tx: anchor.tx + dx, ty: anchor.ty + dy, d: dx * dx + dy * dy });
    }
    cands.sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx);
    const m = sim.map;
    for (const c of cands) {
      const tx = c.tx - Math.floor(def.width / 2);
      const ty = c.ty - Math.floor(def.height / 2);
      let ringFree = true;
      if (def.category === 'building' && !def.requiresWater) {
        for (let y = ty - 1; y <= ty + def.height && ringFree; y++) {
          for (let x = tx - 1; x <= tx + def.width; x++) {
            if (m.isBlocked(x, y)) {
              ringFree = false;
              break;
            }
          }
        }
      }
      if (!ringFree) continue;
      if (canPlace(sim, player, def, tx, ty).ok) return { tx, ty };
    }
    return null;
  }

  /**
   * Raffinerie-Platz: Andockplatz möglichst nah am Kristallfeld, ohne Kristalle zu überbauen.
   * (Der Andockplatz liegt immer unter der Raffinerie – je nach Lage des Feldes muss die
   * Raffinerie also ober- oder unterhalb stehen.)
   */
  private findRefinerySpot(sim: Simulation, player: number, def: BuildingDef, field: { tx: number; ty: number }) {
    const eco = sim.economy;
    const m = sim.map;
    let best: { tx: number; ty: number } | null = null;
    let bestScore = Infinity;
    const R = 9;
    for (let ty = field.ty - R; ty <= field.ty + R; ty++) {
      for (let tx = field.tx - R; tx <= field.tx + R; tx++) {
        let covered = 0;
        for (let y = ty; y < ty + def.height; y++) {
          for (let x = tx; x < tx + def.width; x++) if (m.inBounds(x, y) && eco.crystal[m.index(x, y)] > 0) covered++;
        }
        const dx = tx + Math.floor(def.width / 2) - field.tx;
        const dy = ty + def.height - field.ty;
        const score = dx * dx + dy * dy + covered * 6;
        if (score >= bestScore) continue;
        if (!canPlace(sim, player, def, tx, ty).ok) continue;
        bestScore = score;
        best = { tx, ty };
      }
    }
    return best ?? this.findSpot(sim, player, def, field);
  }

  /** Normierte Richtung (Welteinheiten, Länge TILE) vom Stützpunkt zum vermuteten Gegner. */
  private enemyDirection(sim: Simulation, base: { x: number; y: number }): { dx: number; dy: number } {
    const target = this.attackTarget(sim, base);
    const dx = target.x - base.x;
    const dy = target.y - base.y;
    const d = Math.max(1, isqrt(dx * dx + dy * dy));
    return { dx: Math.trunc((dx * TILE) / d), dy: Math.trunc((dy * TILE) / d) };
  }

  private repair(sim: Simulation, buildings: Building[]): void {
    for (const b of buildings) {
      if (!b.repairing && !b.def.neutral && b.hp < b.def.hp * 0.6) sim.issue(this.player, { type: 'repair', building: b.id });
    }
  }

  // ───────────── Wirtschaft & Armee ─────────────

  private manageHarvesters(sim: Simulation, p: Player, units: Unit[], buildings: Building[]): void {
    const refineries = buildings.filter((b) => b.def.refinery).length;
    if (refineries === 0) return;
    const harvesters = units.filter((u) => u.def.harvestCapacity).length;
    const queued = p.queues.vehicle.filter((q) => q.defId === 'harvester').length;
    if (harvesters + queued < refineries * this.cfg.harvestersPerRefinery) {
      const def = sim.rules.unit(p.faction, 'harvester');
      if (def && availability(sim, p.id, def).available) {
        sim.issue(this.player, { type: 'queue', category: 'vehicle', item: 'harvester', action: 'add' });
      }
    }
  }

  private produceArmy(sim: Simulation, p: Player, units: Unit[]): void {
    const army = units.filter((u) => u.def.weapon && !u.def.harvestCapacity);
    if (army.length >= this.cfg.maxArmy) return;
    if (p.credits < this.cfg.reserveCredits) return;
    // «Leicht» baut erst die Basis fertig, bevor es Truppen baut (so bleibt es gemütlich)
    if (this.level === 'easy' && p.queues.building.length > 0 && p.credits < 800) return;
    // Ohne Sammler zuerst einen Sammler (sonst versiegt das Einkommen) – weitere Sammler laufen nebenher
    const refineries = sim.buildings.filter((b) => !b.dead && b.owner === p.id && b.def.refinery).length;
    const harvesters = units.filter((u) => u.def.harvestCapacity).length;
    if (refineries > 0 && harvesters === 0 && army.length >= 4) return;
    const mix = this.landConnected === false ? this.cfg.islandMix : this.cfg.unitMix;
    const counts = new Map<string, number>();
    for (const u of army) counts.set(u.def.id, (counts.get(u.def.id) ?? 0) + 1);
    // Bei wenig Geld nur je eine Einheit in der Schlange
    const maxQueue = p.credits > 1500 ? 2 : 1;
    for (const cat of ['infantry', 'vehicle', 'air', 'naval'] as ProductionCategory[]) {
      const queue = p.queues[cat];
      for (const q of queue) counts.set(q.defId, (counts.get(q.defId) ?? 0) + 1);
      if (queue.length >= maxQueue) continue;
      // Sammler in der Fahrzeugschlange haben Vorrang
      if (cat === 'vehicle' && queue.some((q) => q.defId === 'harvester')) continue;
      // Mittel/Schwer: Infanterie entsteht schneller als Panzer – nicht nur Fusstruppen bauen
      if (cat === 'infantry' && this.level !== 'easy') {
        const inf = army.filter((u) => u.def.category === 'infantry').length;
        const veh = army.length - inf;
        if (inf >= 4 && inf > veh * 1.5) continue;
      }
      // Typ mit dem kleinsten Anteil im Verhältnis zu seinem Gewicht
      let best: string | null = null;
      let bestRatio = Infinity;
      for (const [id, weight] of Object.entries(mix)) {
        if (weight <= 0) continue;
        const def = sim.rules.unit(p.faction, id);
        if (!def || def.category !== cat || !availability(sim, p.id, def).available) continue;
        const ratio = (counts.get(id) ?? 0) / weight;
        if (ratio < bestRatio || (ratio === bestRatio && best !== null && id < best)) {
          bestRatio = ratio;
          best = id;
        }
      }
      if (best) sim.issue(this.player, { type: 'queue', category: cat, item: best, action: 'add' });
    }
  }

  /** Ingenieure bauen und zum nächsten fremden Bonus-Punkt schicken. */
  private useEngineers(sim: Simulation, p: Player, units: Unit[]): void {
    if (this.cfg.engineers <= 0) return;
    const sources = sim.buildings.filter((b) => !b.dead && b.def.neutral && b.owner !== p.id && (b.owner === 0 || sim.isEnemy(p.id, b.owner)));
    if (sources.length === 0) return;
    const engineers = units.filter((u) => u.def.engineer);
    const queued = p.queues.infantry.filter((q) => q.defId === 'engineer').length;
    if (engineers.length + queued < this.cfg.engineers) {
      const def = sim.rules.unit(p.faction, 'engineer');
      if (def && availability(sim, p.id, def).available && sim.tick > 15 * 60 * 8) {
        sim.issue(this.player, { type: 'queue', category: 'infantry', item: 'engineer', action: 'add' });
      }
    }
    for (const e of engineers) {
      if (e.task) continue;
      let best: Building | null = null;
      let bestD = Infinity;
      for (const s of sources) {
        // Nur bekannte Quellen (gesehen oder als Geist erinnert) – kein Blick durch den Nebel
        if (!sim.canSee(p.id, s) && !p.ghosts.has(s.id) && !p.explored[sim.map.index(s.tx, s.ty)]) continue;
        const d = (s.x - e.x) ** 2 + (s.y - e.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best) sim.issue(this.player, { type: 'enter', units: [e.id], target: best.id });
    }
  }

  /** Schwer: einen zweiten Bauwagen bauen und an einem freien Kristallfeld ausfahren. */
  private expand(sim: Simulation, p: Player, units: Unit[], buildings: Building[]): void {
    const yards = buildings.filter((b) => b.def.constructionYard).length;
    if (yards >= this.cfg.maxRefineries || sim.tick < 15 * 60 * 3) return;
    // Ausbauen, sobald die Felder bei den bisherigen Raffinerien zur Neige gehen
    const fields = sim.map.objectsOfKind('crystalField');
    const homeFields = fields.filter((f) => buildings.some((b) => b.def.refinery && (b.x - f.x) ** 2 + (b.y - f.y) ** 2 < (10 * TILE) ** 2));
    const homeFill = homeFields.length ? Math.max(...homeFields.map((f) => this.fieldFill(sim, f))) : 0;
    const wagon = units.find((u) => u.def.deploysTo);
    if (!wagon) {
      if (homeFill > 0.6 && sim.tick < 15 * 60 * 8) return;
      // Der Bauwagen blockiert die Fahrzeugfabrik eine Weile – nur mit etwas Armee und Geld
      const armySize = units.filter((u) => u.def.weapon && !u.def.harvestCapacity).length;
      if (armySize < 8 || p.credits < 1200) return;
      const def = sim.rules.unit(p.faction, 'constructionWagon');
      const queued = p.queues.vehicle.some((q) => q.defId === 'constructionWagon');
      if (def && !queued && availability(sim, p.id, def).available) {
        sim.issue(this.player, { type: 'queue', category: 'vehicle', item: 'constructionWagon', action: 'add' });
      }
      return;
    }
    if (wagon.task || wagon.order) return;
    if (this.expansionWagon === wagon.id) {
      // Angekommen → ausfahren
      sim.issue(this.player, { type: 'deploy', units: [wagon.id] });
      this.expansionWagon = 0;
      return;
    }
    // Kristallfeld mit möglichst grossem Abstand zu allen Bauhöfen, aber nicht beim Gegner
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const f of fields) {
      // Kristallfelder sind (wie Startplätze) Teil der bekannten Karte
      if (this.fieldFill(sim, f) < 0.4) continue;
      const nearOwn = Math.min(...buildings.map((b) => (b.x - f.x) ** 2 + (b.y - f.y) ** 2));
      const nearEnemy = Math.min(
        Infinity,
        ...[...p.ghosts.values()].filter((g) => sim.isEnemy(p.id, g.owner)).map((g) => (g.tx * TILE - f.x) ** 2 + (g.ty * TILE - f.y) ** 2),
      );
      if (nearOwn < (12 * TILE) ** 2 || nearEnemy < (16 * TILE) ** 2) continue;
      const score = -nearOwn;
      if (score > bestScore) {
        bestScore = score;
        best = { x: f.x + 3 * TILE, y: f.y };
      }
    }
    if (best) {
      this.expansionWagon = wagon.id;
      sim.issue(this.player, { type: 'move', units: [wagon.id], x: best.x, y: best.y });
    }
  }

  // ───────────── Kampf ─────────────

  /** Gegner nahe der Basis sichtbar? → alle freien Truppen dorthin. Gibt true zurück, wenn verteidigt wird. */
  private defend(sim: Simulation, p: Player, army: Unit[], base: { x: number; y: number }): boolean {
    const R = 14 * TILE;
    let intruder: Unit | null = null;
    let bestD = Infinity;
    for (const u of sim.units) {
      if (u.dead || !sim.isEnemy(p.id, u.owner) || !sim.canSee(p.id, u)) continue;
      const dx = u.x - base.x;
      const dy = u.y - base.y;
      const d = dx * dx + dy * dy;
      if (d < R * R && d < bestD) {
        bestD = d;
        intruder = u;
      }
    }
    if (!intruder) return false;
    const free = army.filter((u) => u.task?.kind !== 'attack' && u.task?.kind !== 'rearm');
    if (free.length > 0) {
      sim.issue(this.player, { type: 'attackMove', units: free.map((u) => u.id), x: intruder.x, y: intruder.y });
    }
    return true;
  }

  /** Bekanntes Angriffsziel: nächstes gesehenes Gebäude, sonst ein gegnerischer Startplatz. */
  private attackTarget(sim: Simulation, base: { x: number; y: number }): { x: number; y: number } {
    const p = sim.players[this.player];
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const g of p.ghosts.values()) {
      if (!sim.isEnemy(p.id, g.owner)) continue;
      const x = g.tx * TILE + TILE;
      const y = g.ty * TILE + TILE;
      const d = (x - base.x) ** 2 + (y - base.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
    if (best) return best;
    // Startplätze sind auf der Karte für alle sichtbar – wie bei einem Menschen
    for (const s of sim.map.objectsOfKind('spawn')) {
      const owner = Number(s.props.player);
      const other = sim.players[owner];
      if (owner === p.id || !other || !sim.isEnemy(p.id, owner) || other.defeated) continue;
      const d = (s.x - base.x) ** 2 + (s.y - base.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: s.x, y: s.y };
      }
    }
    return best ?? { x: sim.map.worldWidth / 2, y: sim.map.worldHeight / 2 };
  }

  private attack(sim: Simulation, p: Player, army: Unit[], base: { x: number; y: number }): void {
    // Landeinheiten, die den Gegner nicht erreichen können (Inselkarte), bleiben zur Verteidigung daheim
    const mobile = army.filter((u) => this.landConnected !== false || u.def.moveClassId === MoveClass.Air || u.def.moveClassId === MoveClass.Naval || u.def.moveClassId === MoveClass.Hover);
    const far2 = (22 * TILE) ** 2;
    const isFar = (u: Unit) => (u.x - base.x) ** 2 + (u.y - base.y) ** 2 > far2;
    // Truppen, die schon weit draussen stehen (Welle am Ziel angekommen): weiter zum nächsten
    // bekannten Gebäude, statt quer durch die gegnerische Basis heimzulaufen
    const pushing = mobile.filter((u) => !u.task && !u.order && isFar(u));
    if (pushing.length > 0) {
      const cx = Math.trunc(pushing.reduce((s, u) => s + u.x, 0) / pushing.length);
      const cy = Math.trunc(pushing.reduce((s, u) => s + u.y, 0) / pushing.length);
      const next = this.attackTarget(sim, { x: cx, y: cy });
      sim.issue(this.player, { type: 'attackMove', units: pushing.map((u) => u.id), x: next.x, y: next.y });
    }
    const idle = mobile.filter((u) => !u.task && !u.order && !isFar(u));
    // Nur mit schlagkräftiger Welle angreifen: mindestens ein Drittel Fahrzeuge/Flieger/Schiffe
    const heavy = idle.filter((u) => u.def.category !== 'infantry').length;
    // Klügere Stufen greifen erst mit klarer Überlegenheit an (nur Gesehenes zählt)
    const strongEnough =
      this.cfg.attackAdvantage <= 0 ||
      idle.reduce((s, u) => s + this.value(u), 0) >= this.cfg.attackAdvantage * this.knownEnemyStrength(sim, p) ||
      army.length >= this.cfg.maxArmy * 0.8; // Armee voll → Warten bringt nichts mehr
    // Zu wenig Fahrzeuge? Bei grosser oder voller Armee trotzdem los – sonst wartet die KI ewig
    const mixOk = heavy * 3 >= idle.length || idle.length >= this.waveSize * 2 || army.length >= this.cfg.maxArmy * 0.8;
    if (sim.tick >= this.nextAttack && idle.length >= this.waveSize && mixOk && strongEnough) {
      const target = this.attackTarget(sim, base);
      const ids = idle.map((u) => u.id);
      if (this.cfg.twoFronts && ids.length >= 8) {
        // Zweite Gruppe greift seitlich versetzt an
        const dx = target.x - base.x;
        const dy = target.y - base.y;
        const d = Math.max(1, isqrt(dx * dx + dy * dy));
        const side = this.wave % 2 === 0 ? 1 : -1;
        const fx = target.x + Math.trunc((-dy * 10 * TILE * side) / d);
        const fy = target.y + Math.trunc((dx * 10 * TILE * side) / d);
        const half = Math.floor(ids.length / 2);
        sim.issue(this.player, { type: 'attackMove', units: ids.slice(0, half), x: target.x, y: target.y });
        sim.issue(this.player, {
          type: 'attackMove',
          units: ids.slice(half),
          x: Math.max(0, Math.min(sim.map.worldWidth - 1, fx)),
          y: Math.max(0, Math.min(sim.map.worldHeight - 1, fy)),
        });
      } else {
        sim.issue(this.player, { type: 'attackMove', units: ids, x: target.x, y: target.y });
      }
      this.wave++;
      this.waveSize = Math.min(this.cfg.maxWaveSize, this.waveSize + this.cfg.waveGrowth);
      this.nextAttack = sim.tick + Math.round(this.cfg.attackInterval * TICK_RATE);
      return;
    }
    // Sonst: freie Truppen am Sammelpunkt vor der Basis versammeln
    const dir = this.enemyDirection(sim, base);
    const rally = { x: base.x + dir.dx * 7, y: base.y + dir.dy * 7 };
    const stray = army.filter((u) => !u.task && !u.order && !isFar(u) && (u.x - rally.x) ** 2 + (u.y - rally.y) ** 2 > (6 * TILE) ** 2);
    if (stray.length > 0) sim.issue(this.player, { type: 'move', units: stray.map((u) => u.id), x: rally.x, y: rally.y });
  }
}
