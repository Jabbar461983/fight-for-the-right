import type { AiDifficulty, AiLevel, BuildingDef, ProductionCategory } from '../data/rules';
import { TICK_RATE, TILE, isqrt, tileOf } from '../math/fixed';
import { availability, canPlace } from '../sim/production';
import type { Simulation, TickListener } from '../sim/simulation';
import type { Building, Player, Unit } from '../sim/unit';

/**
 * Computergegner für Gefechte. Spielt nach denselben Regeln wie ein Mensch:
 * Er gibt nur Befehle über sim.issue(), sieht nur, was seine Einheiten sehen
 * (Nebel), und bezahlt alles mit eigenem Glimmerit.
 *
 * Ablauf (alle paar Sekunden): Bauwagen ausfahren → Bauplan abarbeiten →
 * fertige Gebäude platzieren → Sammler ersetzen → Armee bauen →
 * Basis verteidigen → in Wellen angreifen.
 */
export class SkirmishAi implements TickListener {
  private readonly cfg: AiDifficulty;
  private nextThink: number;
  private nextAttack: number;
  private waveSize: number;
  private deployAttempts = 0;

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
    const yard = buildings.find((b) => b.def.constructionYard);

    if (!yard) {
      this.deployWagon(sim, units);
      return;
    }
    const base = { x: yard.x, y: yard.y };
    this.placeReady(sim, p, base);
    this.followBuildOrder(sim, p, buildings);
    this.manageHarvesters(sim, p, units, buildings);
    this.produceArmy(sim, p, units);
    const army = units.filter((u) => u.def.weapon && !u.def.harvestCapacity && !u.def.deploysTo);
    if (!this.defend(sim, p, army, base)) this.attack(sim, p, army, base);
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
    for (const cat of ['building', 'defense'] as const) {
      if (p.queues[cat].length > 0 || p.ready[cat]) continue;
      const pick = this.nextBuilding(sim, p, owned, cat);
      if (pick) sim.issue(this.player, { type: 'queue', category: cat, item: pick, action: 'add' });
    }
  }

  private nextBuilding(sim: Simulation, p: Player, owned: Map<string, number>, cat: 'building' | 'defense'): string | null {
    const powerPlant = sim.rules.building(p.faction, 'powerPlant');
    // Strom wird knapp → Kraftwerk zuerst
    if (cat === 'building' && powerPlant && p.powerUsed + 20 > p.powerProduced && (owned.get('constructionYard') ?? 0) > 0) {
      return 'powerPlant';
    }
    const required = new Map<string, number>();
    const order = sim.rules.ai.buildOrder.slice(0, this.cfg.buildOrderLength);
    for (const id of order) {
      required.set(id, (required.get(id) ?? 0) + 1);
      const def = sim.rules.building(p.faction, id);
      if (!def || def.category !== cat) continue;
      if ((owned.get(id) ?? 0) >= required.get(id)!) continue;
      if (def.refinery && (owned.get(id) ?? 0) >= this.cfg.maxRefineries) continue;
      if (!availability(sim, p.id, def).available) continue;
      return id;
    }
    return null;
  }

  /** Fertige Gebäude in der Nähe des Bauhofs platzieren (Türme Richtung Gegner). */
  private placeReady(sim: Simulation, p: Player, base: { x: number; y: number }): void {
    for (const cat of ['building', 'defense'] as const) {
      const id = p.ready[cat];
      if (!id) continue;
      const def = sim.rules.building(p.faction, id);
      if (!def) continue;
      const enemy = this.enemyDirection(sim, base);
      const anchor =
        cat === 'defense'
          ? { tx: tileOf(base.x + enemy.dx * 6), ty: tileOf(base.y + enemy.dy * 6) }
          : { tx: tileOf(base.x), ty: tileOf(base.y) };
      const spot = this.findSpot(sim, p.id, def, anchor);
      if (spot) sim.issue(this.player, { type: 'place', category: cat, tx: spot.tx, ty: spot.ty });
      else sim.issue(this.player, { type: 'queue', category: cat, item: id, action: 'cancel' });
    }
  }

  /** Sucht einen gültigen Bauplatz nahe am Anker, mit einer Kachel Abstand zu anderen Gebäuden (Durchgänge!). */
  private findSpot(sim: Simulation, player: number, def: BuildingDef, anchor: { tx: number; ty: number }) {
    const cands: { tx: number; ty: number; d: number }[] = [];
    const R = 12;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        cands.push({ tx: anchor.tx + dx, ty: anchor.ty + dy, d: dx * dx + dy * dy });
      }
    }
    cands.sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx);
    const m = sim.map;
    for (const c of cands) {
      const tx = c.tx - Math.floor(def.width / 2);
      const ty = c.ty - Math.floor(def.height / 2);
      // Ring um das Gebäude muss frei bleiben (ausser Mauern/Türme dürfen eng stehen)
      let ringFree = true;
      if (def.category === 'building') {
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

  /** Normierte Richtung (Welteinheiten, Länge TILE) vom Stützpunkt zum vermuteten Gegner. */
  private enemyDirection(sim: Simulation, base: { x: number; y: number }): { dx: number; dy: number } {
    const target = this.attackTarget(sim, base);
    const dx = target.x - base.x;
    const dy = target.y - base.y;
    const d = Math.max(1, isqrt(dx * dx + dy * dy));
    return { dx: Math.trunc((dx * TILE) / d), dy: Math.trunc((dy * TILE) / d) };
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
    // Erst die Basis: solange der Bauplan Geld braucht, sparsam bleiben
    if (p.queues.building.length > 0 && p.credits < 800) return;
    const counts = new Map<string, number>();
    for (const u of army) counts.set(u.def.id, (counts.get(u.def.id) ?? 0) + 1);
    for (const cat of ['infantry', 'vehicle'] as ProductionCategory[]) {
      const queue = p.queues[cat];
      for (const q of queue) counts.set(q.defId, (counts.get(q.defId) ?? 0) + 1);
      if (queue.length >= 2) continue;
      // Typ mit dem kleinsten Anteil im Verhältnis zu seinem Gewicht
      let best: string | null = null;
      let bestRatio = Infinity;
      for (const [id, weight] of Object.entries(this.cfg.unitMix)) {
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
    const free = army.filter((u) => u.task?.kind !== 'attack');
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
      if (owner === p.id || (other && !sim.isEnemy(p.id, owner)) || (other && other.defeated)) continue;
      const d = (s.x - base.x) ** 2 + (s.y - base.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: s.x, y: s.y };
      }
    }
    return best ?? { x: sim.map.worldWidth / 2, y: sim.map.worldHeight / 2 };
  }

  private attack(sim: Simulation, p: Player, army: Unit[], base: { x: number; y: number }): void {
    const idle = army.filter((u) => !u.task && !u.order);
    if (sim.tick >= this.nextAttack && idle.length >= this.waveSize) {
      const target = this.attackTarget(sim, base);
      sim.issue(this.player, { type: 'attackMove', units: idle.map((u) => u.id), x: target.x, y: target.y });
      this.waveSize = Math.min(this.cfg.maxWaveSize, this.waveSize + this.cfg.waveGrowth);
      this.nextAttack = sim.tick + Math.round(this.cfg.attackInterval * TICK_RATE);
      return;
    }
    // Sonst: freie Truppen am Sammelpunkt vor der Basis versammeln
    const dir = this.enemyDirection(sim, base);
    const rally = { x: base.x + dir.dx * 7, y: base.y + dir.dy * 7 };
    const stray = idle.filter((u) => (u.x - rally.x) ** 2 + (u.y - rally.y) ** 2 > (6 * TILE) ** 2);
    if (stray.length > 0) sim.issue(this.player, { type: 'move', units: stray.map((u) => u.id), x: rally.x, y: rally.y });
  }
}
