/*
 * Group Q — long run and leaks (profile `heavy` only; NOT part of the quick and standard runs). YCSB A
 * (read/update 50/50) and E (scans of hydrated documents + inserts) with 50 clients for 10 minutes per
 * contestant; every 10 s the heap is sampled after a forced GC. Reported: heap after warmup and at the end,
 * the least-squares heap slope (MB/min) over the samples, RSS, throughput; `leakSuspected` = 1 when the
 * slope exceeds 1 MB/min. Smoke: `--size T` runs 6 s with a 1 s sampling step.
 */
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { YcsbTable } from "./o-load.ts";
import { type LoadResult, LoadRunner, type YcsbWorkload } from "./support-bb/ycsb.ts";

/** Seeded users of a real run. */
const RECORDS = 100_000;
/** Seeded users of a smoke run. */
const SMOKE_RECORDS = 1_000;
/** The iteration index from which the harness runs verification. */
const VERIFY_ITERATION = 1_000_000;
/** Bytes in a megabyte. */
const MB = 1024 * 1024;

/**
 * What one long run measured.
 *
 * @example
 * ```ts
 * const slope: number = LeakStats.slope(run.samples);
 * ```
 */
interface LeakRun {
  /** The load result. */
  readonly load: LoadResult;
  /** Heap samples: minutes since the start and heap size in MB. */
  readonly samples: readonly (readonly [minutes: number, heapMb: number])[];
  /** Heap after the first sample, MB. */
  readonly heapStartMb: number;
  /** Heap at the end, MB. */
  readonly heapEndMb: number;
  /** RSS at the end, MB. */
  readonly rssEndMb: number;
}

/** Heap statistics for leak detection. */
class LeakStats {
  /**
   * Least-squares slope of heap (MB) over time (min).
   *
   * @param samples - Minutes and heap MB.
   * @returns MB per minute; `0` for fewer than two samples.
   */
  static slope(samples: LeakRun["samples"]): number {
    const n = samples.length;
    if (n < 2) return 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const [x, y] of samples) {
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    const d = n * sxx - sx * sx;
    return d === 0 ? 0 : (n * sxy - sx * sy) / d;
  }

  /**
   * The heap in use after a forced garbage collection.
   *
   * @returns Megabytes.
   */
  static heapMb(): number {
    Bun.gc(true);
    return process.memoryUsage().heapUsed / MB;
  }
}

/** A ten-minute YCSB load with heap sampling. */
class LongRun extends Scenario {
  readonly id: string;
  readonly group = "Q" as const;
  readonly title: string;
  readonly profiles: readonly ProfileName[] = ["heavy"];
  override readonly sizes: readonly SizeName[] = ["L"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo", "typemo-lean"];
  override readonly iterations = { warmup: 0, minSamples: 1, maxSamples: 1, repeats: 1 };
  override readonly notes =
    "heavy only: 10 min per contestant, 50 clients, 100k records; heap sampled after forced GC every 10 s " +
    "(the GC pause is inside the run for everyone). Verify/commands passes run 2 s.";

  /**
   * @param workload - The YCSB workload.
   */
  constructor(private readonly workload: YcsbWorkload) {
    super();
    this.id = `Q.leak.ycsb${workload}`;
    this.title = `long run: YCSB ${workload}, 50 clients, heap slope`;
  }

  /**
   * The sizes to run under a profile.
   *
   * @param profile - The profile.
   * @returns L for `heavy`, none otherwise.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return profile === "heavy" ? ["L"] : [];
  }

  /**
   * The number of seeded users.
   *
   * @param env - The scenario environment.
   * @returns The smoke count for size T, otherwise the full count.
   */
  private records(env: ScenarioEnv): number {
    return env.size === "T" ? SMOKE_RECORDS : RECORDS;
  }

  /**
   * Seeds the table of every contestant.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    for (const contestant of this.contestants) await YcsbTable.seed(env.ctx.dbOf(contestant), this.records(env));
  }

  /**
   * Builds a contestant that runs the long load and samples the heap.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const records = this.records(env);
    const db = env.ctx.dbOf(contestant);
    const ops = YcsbTable.ops(contestant, env);
    let measured: LeakRun | undefined;
    return ScenarioKit.impl<LeakRun>({
      before: () => YcsbTable.reset(db, records),
      run: async (iteration) => {
        const smoke = env.size === "T";
        const short = iteration >= VERIFY_ITERATION;
        const samples: [number, number][] = [];
        const load = await LoadRunner.run(ops, {
          workload: this.workload,
          records,
          clients: 50,
          durationMs: smoke ? 6_000 : short ? 2_000 : 600_000,
          warmupMs: smoke || short ? 500 : 30_000,
          seed: 0x1ea4 + iteration,
          insertStart: records,
          sampleEveryMs: smoke || short ? 1_000 : 10_000,
          onSample: (elapsedMs) => {
            samples.push([elapsedMs / 60_000, LeakStats.heapMb()]);
          },
        });
        const run: LeakRun = {
          load,
          samples,
          heapStartMb: samples[0]?.[1] ?? Number.NaN,
          heapEndMb: LeakStats.heapMb(),
          rssEndMb: process.memoryUsage().rss / MB,
        };
        if (!short) measured = run;
        return run;
      },
      verify: async (run): Promise<Outcome> => {
        if (run.load.errors > 0) throw new Error(`${contestant}: ${run.load.errors} errors: ${run.load.firstError}`);
        if (run.load.ops === 0 || run.samples.length === 0) throw new Error(`${contestant}: no work or no samples`);
        const rows = await YcsbTable.count(db);
        if (rows !== records + run.load.inserted) throw new Error(`${contestant}: ${rows} rows after the run`);
        const m = measured ?? run;
        const slope = LeakStats.slope(m.samples);
        const round = (x: number): number => Math.round(x * 100) / 100;
        return {
          count: 1,
          checksum: "",
          metrics: {
            opsPerSec: Math.round(m.load.opsPerSec),
            p99Ms: round(m.load.p99),
            heapStartMb: round(m.heapStartMb),
            heapEndMb: round(m.heapEndMb),
            heapSlopeMbPerMin: round(slope),
            rssEndMb: round(m.rssEndMb),
            samples: m.samples.length,
            leakSuspected: slope > 1 ? 1 : 0,
          },
        };
      },
    });
  }
}

/** The scenarios of group Q. */
export const SCENARIOS: readonly Scenario[] = [new LongRun("A"), new LongRun("E")];
