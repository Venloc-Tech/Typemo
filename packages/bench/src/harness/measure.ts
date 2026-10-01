import { measure } from "mitata";
import type { IterationPolicy } from "./profiles.ts";
import type { ContestantImpl } from "./scenario.ts";
import type { TimeStats } from "./types.ts";

/**
 * The result of timing one contestant for one repeat.
 *
 * @example
 * ```ts
 * const median: number = measurement.stats.median;
 * ```
 */
export interface Measurement {
  /** Timing statistics of the samples. */
  readonly stats: TimeStats;
  /** What the last run returned. */
  readonly lastResult: unknown;
  /** The iteration index of the last run. */
  readonly lastIteration: number;
  /** Next free iteration index (unique keys continue across repeats). */
  readonly nextIteration: number;
}

/** Nanoseconds in a millisecond. */
const NS_PER_MS = 1e6;

/** Pure statistics over samples in milliseconds. */
export class Stats {
  /**
   * A quantile of sorted samples, interpolated linearly.
   *
   * @param sorted - The samples, ascending.
   * @param q - The quantile in `[0, 1]`.
   * @returns The value, or `NaN` for no samples.
   */
  static quantile(sorted: readonly number[], q: number): number {
    if (sorted.length === 0) return Number.NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const a = sorted[lo] ?? Number.NaN;
    const b = sorted[hi] ?? a;
    return a + (b - a) * (pos - lo);
  }

  /**
   * Statistics of a list of samples.
   *
   * @param samplesMs - The samples, in milliseconds.
   * @returns The statistics.
   */
  static of(samplesMs: readonly number[]): TimeStats {
    const sorted = [...samplesMs].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, v) => s + v, 0) / Math.max(1, n);
    const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
    const median = Stats.quantile(sorted, 0.5);
    return {
      samples: n,
      median,
      p95: Stats.quantile(sorted, 0.95),
      p99: Stats.quantile(sorted, 0.99),
      min: sorted[0] ?? Number.NaN,
      max: sorted[n - 1] ?? Number.NaN,
      mean,
      rsd: mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0,
      opsPerSec: median > 0 ? 1000 / median : 0,
    };
  }

  /**
   * Median of the repeats' medians, with the rest of the stats taken from that repeat.
   *
   * @param repeats - The statistics of every repeat.
   * @returns The statistics of the median repeat.
   * @throws Error - When there are no repeats.
   */
  static medianOfMedians(repeats: readonly TimeStats[]): TimeStats {
    const sorted = [...repeats].sort((a, b) => a.median - b.median);
    const middle = sorted[Math.floor((sorted.length - 1) / 2)];
    if (middle === undefined) throw new Error("medianOfMedians: no repeats");
    return middle;
  }
}

/**
 * Times one contestant for one repeat. mitata does the sampling (computed parameter = the untimed `before`,
 * batching disabled — every sample is one real operation); we choose the sample count from the warmup so that
 * "at least 30 iterations or at least 2 s" holds.
 */
export class Measurer {
  /** Forces a synchronous garbage collection. */
  static gc(): void {
    Bun.gc(true);
  }

  /**
   * Warms up and times one contestant.
   *
   * @param impl - The contestant's implementation.
   * @param policy - The iteration policy.
   * @param firstIteration - The first iteration index to use.
   * @returns The statistics, the last result and the next free iteration.
   */
  static async run(
    impl: ContestantImpl<unknown>,
    policy: IterationPolicy,
    firstIteration: number,
  ): Promise<Measurement> {
    let iteration = firstIteration;
    let last: unknown;
    let lastIteration = iteration;
    const before = async (): Promise<void> => {
      await impl.before?.(iteration);
    };

    /* Warmup (untimed by mitata, timed by us to size the sample count). */
    const warmupTimes: number[] = [];
    for (let k = 0; k < policy.warmup; k++) {
      await before();
      const t0 = Bun.nanoseconds();
      last = await impl.run(iteration);
      warmupTimes.push((Bun.nanoseconds() - t0) / NS_PER_MS);
      lastIteration = iteration;
      iteration++;
      /* A slow operation (≥ 5 % of the time budget) is warm after one run; more warmup only burns the budget. */
      if ((warmupTimes.at(-1) ?? 0) >= policy.maxTimeMs / 20) break;
    }

    if (policy.maxSamples <= 1) {
      /* Self-timed / one-shot scenarios (groups O, P, Q, R): one timed run, no mitata. */
      Measurer.gc();
      await before();
      const t0 = Bun.nanoseconds();
      last = await impl.run(iteration);
      const ms = (Bun.nanoseconds() - t0) / NS_PER_MS;
      return { stats: Stats.of([ms]), lastResult: last, lastIteration: iteration, nextIteration: iteration + 1 };
    }

    const estimate =
      warmupTimes.length === 0
        ? 1
        : Stats.quantile(
            [...warmupTimes].sort((a, b) => a - b),
            0.5,
          );
    const affordable = Math.ceil(policy.maxTimeMs / Math.max(estimate, 1e-3));
    const minSamples = Math.max(policy.floorSamples, Math.min(policy.minSamples, affordable));
    const slow = minSamples < policy.minSamples;

    Measurer.gc();
    const stats = await measure(
      function* () {
        yield {
          0: before,
          /* The declared parameter matters: mitata computes `[0]` (the untimed `before`) only for bench arity ≥ 1. */
          bench: async (_prepared: unknown): Promise<void> => {
            lastIteration = iteration;
            last = await impl.run(iteration);
            iteration++;
          },
        };
      },
      {
        min_samples: minSamples,
        max_samples: Math.max(minSamples, slow ? minSamples : policy.maxSamples),
        min_cpu_time: slow ? 0 : Math.min(policy.minTimeMs, policy.maxTimeMs) * NS_PER_MS,
        /* One sample = one operation: DB calls must never be batched/unrolled. */
        batch_threshold: -1,
        /* Our own warmup already ran; mitata still makes one untimed call first. */
        warmup_threshold: 0,
        samples_threshold: 1e9,
        gc: Measurer.gc,
      },
    );
    return {
      stats: Stats.of(stats.samples.map((ns) => ns / NS_PER_MS)),
      lastResult: last,
      lastIteration,
      nextIteration: iteration,
    };
  }
}
