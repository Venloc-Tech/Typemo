/*
 * YCSB-like load (groups O and Q): the core workloads A/B/C/E/F over a `usertable` of 10 string fields,
 * zipfian (or latest/uniform) key choice as in YCSB, N concurrent async clients for a fixed duration, latency
 * in a log-bucket histogram (≤ 1% error) so full-length runs keep constant memory.
 */
import { Rng } from "../../data/rng.ts";
import { LatencyHistogram } from "./latency-histogram.ts";
import { YcsbValues } from "./ycsb-values.ts";
import { Zipfian } from "./ycsb-zipfian.ts";

/**
 * A YCSB operation.
 *
 * @example
 * ```ts
 * const op: YcsbOp = "rmw";
 * ```
 */
export type YcsbOp = "read" | "update" | "scan" | "insert" | "rmw";
/**
 * A YCSB core workload.
 *
 * @example
 * ```ts
 * const workload: YcsbWorkload = "A";
 * ```
 */
export type YcsbWorkload = "A" | "B" | "C" | "E" | "F";

/** Operation mix of the YCSB core workloads (proportions sum to 1). */
export const YCSB_MIX: Readonly<Record<YcsbWorkload, Readonly<Partial<Record<YcsbOp, number>>>>> = {
  A: { read: 0.5, update: 0.5 },
  B: { read: 0.95, update: 0.05 },
  C: { read: 1 },
  E: { scan: 0.95, insert: 0.05 },
  F: { read: 0.5, rmw: 0.5 },
};

/** Fields per user. */
export const YCSB_FIELDS = 10;
/** Characters per field. */
export const YCSB_FIELD_LENGTH = 100;
/** The longest scan. */
export const YCSB_MAX_SCAN = 100;

/**
 * One contestant's implementation of the YCSB operations over the usertable.
 *
 * @example
 * ```ts
 * const row = await ops.read(42);
 * ```
 */
export interface YcsbOps {
  /**
   * Reads one user.
   *
   * @param key - The key number.
   * @returns The user.
   */
  read(key: number): Promise<unknown>;
  /**
   * Updates one field of one user.
   *
   * @param key - The key number.
   * @param field - The field index.
   * @param value - The new value.
   * @returns The write result.
   */
  update(key: number, field: number, value: string): Promise<unknown>;
  /**
   * Reads users from a key on, in key order.
   *
   * @param fromKey - The first key.
   * @param count - The most users to return.
   * @returns The users.
   */
  scan(fromKey: number, count: number): Promise<readonly unknown[]>;
  /**
   * Inserts one user.
   *
   * @param key - The key number.
   * @param fields - The field values.
   * @returns The insert result.
   */
  insert(key: number, fields: readonly string[]): Promise<unknown>;
}

/**
 * Options of a load run.
 *
 * @example
 * ```ts
 * const options: LoadOptions = {
 *   workload: "A",
 *   records: 10_000,
 *   clients: 10,
 *   durationMs: 2_000,
 *   warmupMs: 500,
 *   seed: 1,
 *   insertStart: 10_000,
 * };
 * ```
 */
export interface LoadOptions {
  /** The workload. */
  readonly workload: YcsbWorkload;
  /** Seeded users. */
  readonly records: number;
  /** Concurrent clients. */
  readonly clients: number;
  /** The measured duration, ms. */
  readonly durationMs: number;
  /** The warmup before measuring, ms. */
  readonly warmupMs: number;
  /** Seed of the key and operation choice. */
  readonly seed: number;
  /** First key used by inserts (keys above `records`). */
  readonly insertStart: number;
  /** Called every `sampleEveryMs` during the measured phase (memory sampling of group Q). */
  readonly onSample?: (elapsedMs: number) => void;
  /** Interval of `onSample`, ms. */
  readonly sampleEveryMs?: number;
}

/**
 * The result of a load run.
 *
 * @example
 * ```ts
 * const result: LoadResult = await LoadRunner.run(ops, options);
 * ```
 */
export interface LoadResult {
  /** Operations completed in the measured phase. */
  readonly ops: number;
  /** Operations that failed. */
  readonly errors: number;
  /** The first error message. */
  readonly firstError?: string;
  /** Operations per kind. */
  readonly byOp: Readonly<Partial<Record<YcsbOp, number>>>;
  /** Users inserted, including the warmup. */
  readonly inserted: number;
  /** The measured duration, ms. */
  readonly elapsedMs: number;
  /** Throughput. */
  readonly opsPerSec: number;
  /** Median latency, ms. */
  readonly p50: number;
  /** 95th percentile latency, ms. */
  readonly p95: number;
  /** 99th percentile latency, ms. */
  readonly p99: number;
  /** Highest latency, ms. */
  readonly max: number;
  /** Rows returned by scans (checks that scans did real work). */
  readonly scannedRows: number;
}

/** Runs a YCSB load. */
export class LoadRunner {
  /**
   * Runs `clients` concurrent loops for warmup + duration; only the measured phase is recorded.
   *
   * @param ops - The contestant's operations.
   * @param options - The workload, client count and timing.
   * @returns The measurements.
   */
  static async run(ops: YcsbOps, options: LoadOptions): Promise<LoadResult> {
    const mix = Object.entries(YCSB_MIX[options.workload]) as [YcsbOp, number][];
    const histogram = new LatencyHistogram();
    const byOp: Partial<Record<YcsbOp, number>> = {};
    let errors = 0;
    let firstError: string | undefined;
    let nextInsert = options.insertStart;
    let inserted = 0;
    let scannedRows = 0;
    let measuring = false;
    let stop = false;

    const pick = (rng: Rng): YcsbOp => {
      const u = rng.next();
      let acc = 0;
      for (const [op, share] of mix) {
        acc += share;
        if (u < acc) return op;
      }
      return mix[mix.length - 1]?.[0] ?? "read";
    };

    const client = async (index: number): Promise<void> => {
      const rng = new Rng(Rng.seedOf(options.seed, index));
      const zipf = new Zipfian(options.records, rng);
      while (!stop) {
        const op = pick(rng);
        const started = performance.now();
        try {
          switch (op) {
            case "read":
              await ops.read(zipf.nextScrambled());
              break;
            case "update":
              await ops.update(zipf.nextScrambled(), rng.int(0, YCSB_FIELDS - 1), YcsbValues.field(rng));
              break;
            case "rmw": {
              const key = zipf.nextScrambled();
              await ops.read(key);
              await ops.update(key, rng.int(0, YCSB_FIELDS - 1), YcsbValues.field(rng));
              break;
            }
            case "scan": {
              /* YCSB E: start key zipfian, length uniform 1..100. */
              const rows = await ops.scan(zipf.nextScrambled(), rng.int(1, YCSB_MAX_SCAN));
              if (measuring) scannedRows += rows.length;
              break;
            }
            case "insert": {
              const key = nextInsert++;
              await ops.insert(key, YcsbValues.record(rng));
              inserted++;
              break;
            }
          }
          if (measuring) {
            histogram.record(performance.now() - started);
            byOp[op] = (byOp[op] ?? 0) + 1;
          }
        } catch (error) {
          errors++;
          firstError ??= error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
      }
    };

    const loops = Array.from({ length: options.clients }, (_, i) => client(i));
    await Bun.sleep(options.warmupMs);
    measuring = true;
    const started = performance.now();
    let sampler: ReturnType<typeof setInterval> | undefined;
    if (options.onSample !== undefined) {
      const onSample = options.onSample;
      sampler = setInterval(() => onSample(performance.now() - started), options.sampleEveryMs ?? 10_000);
    }
    await Bun.sleep(options.durationMs);
    measuring = false;
    const elapsedMs = performance.now() - started;
    stop = true;
    if (sampler !== undefined) clearInterval(sampler);
    await Promise.all(loops);
    return {
      ops: histogram.count,
      errors,
      ...(firstError === undefined ? {} : { firstError }),
      byOp,
      inserted,
      elapsedMs,
      opsPerSec: (histogram.count / elapsedMs) * 1000,
      p50: histogram.percentile(50),
      p95: histogram.percentile(95),
      p99: histogram.percentile(99),
      max: histogram.max,
      scannedRows,
    };
  }
}
