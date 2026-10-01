/* Constant-memory latency recording for the load groups (O, Q): full-length runs record millions of ops. */

/** Latency histogram: log buckets of 1% width from 1 µs; percentiles within 1%. */
export class LatencyHistogram {
  /** Natural log of the bucket growth factor. */
  private static readonly BASE = Math.log(1.01);
  /** Sample counts per bucket. */
  private readonly buckets = new Float64Array(2048);
  /** Samples recorded. */
  count = 0;
  /** The largest sample, ms. */
  private maxMs = 0;

  /**
   * Records one latency.
   *
   * @param ms - The latency in milliseconds.
   */
  record(ms: number): void {
    const us = Math.max(1, ms * 1000);
    const index = Math.min(this.buckets.length - 1, Math.floor(Math.log(us) / LatencyHistogram.BASE));
    this.buckets[index] = (this.buckets[index] ?? 0) + 1;
    this.count++;
    if (ms > this.maxMs) this.maxMs = ms;
  }

  /**
   * Percentile in ms.
   *
   * @param p - The percentile, 0 to 100.
   * @returns The latency, or `NaN` when nothing was recorded.
   */
  percentile(p: number): number {
    if (this.count === 0) return Number.NaN;
    const target = Math.ceil((p / 100) * this.count);
    let seen = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      seen += this.buckets[i] ?? 0;
      if (seen >= target) return Math.min(this.maxMs, Math.exp((i + 1) * LatencyHistogram.BASE) / 1000);
    }
    return this.maxMs;
  }

  /** The largest latency recorded, ms. */
  get max(): number {
    return this.maxMs;
  }
}
