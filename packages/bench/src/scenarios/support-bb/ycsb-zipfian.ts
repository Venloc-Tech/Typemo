/* YCSB key choice (groups O and Q): the zipfian generator of the YCSB core workloads. */
import type { Rng } from "../../data/rng.ts";

/** YCSB's ZipfianGenerator (Gray et al., "Quickly generating billion-record synthetic databases"), θ = 0.99. */
export class Zipfian {
  /** The zeta constant of the item count. */
  private readonly zetan: number;
  /** The exponent of the inverse transform. */
  private readonly alpha: number;
  /** The scaling constant of the inverse transform. */
  private readonly eta: number;
  /** The skew. */
  private readonly theta = 0.99;

  /**
   * @param items - The number of items to choose from.
   * @param rng - The random source.
   */
  constructor(
    private readonly items: number,
    private readonly rng: Rng,
  ) {
    this.zetan = Zipfian.zeta(items, this.theta);
    const zeta2 = Zipfian.zeta(2, this.theta);
    this.alpha = 1 / (1 - this.theta);
    this.eta = (1 - (2 / items) ** (1 - this.theta)) / (1 - zeta2 / this.zetan);
  }

  /**
   * The generalized harmonic number of order theta.
   *
   * @param n - The number of terms.
   * @param theta - The skew.
   * @returns The sum of `1 / i^theta`.
   */
  private static zeta(n: number, theta: number): number {
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += 1 / i ** theta;
    return sum;
  }

  /**
   * 0-based rank: 0 is the most popular item.
   *
   * @returns The rank.
   */
  next(): number {
    const u = this.rng.next();
    const uz = u * this.zetan;
    if (uz < 1) return 0;
    if (uz < 1 + 0.5 ** this.theta) return 1;
    return Math.min(this.items - 1, Math.floor(this.items * (this.eta * u - this.eta + 1) ** this.alpha));
  }

  /**
   * YCSB "scrambled": popular items spread over the key space (FNV hash of the rank).
   *
   * @returns A key in `[0, items)`.
   */
  nextScrambled(): number {
    let hash = 0x811c9dc5;
    let value = this.next();
    for (let i = 0; i < 4; i++) {
      hash ^= value & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
      value >>>= 8;
    }
    return hash % this.items;
  }
}
