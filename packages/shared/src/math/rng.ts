/**
 * Deterministischer Zufallsgenerator (Mulberry32).
 * Gleicher Startwert → gleiche Zahlenfolge auf allen Geräten.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Nächste ganze Zahl im Bereich [0, 2^32). */
  nextUint(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Ganze Zahl im Bereich [0, max). */
  nextInt(max: number): number {
    return this.nextUint() % max;
  }

  /** Kommazahl im Bereich [0, 1) – nur ausserhalb der Simulation verwenden (z.B. Kartengenerator, Grafik). */
  nextFloat(): number {
    return this.nextUint() / 4294967296;
  }
}
