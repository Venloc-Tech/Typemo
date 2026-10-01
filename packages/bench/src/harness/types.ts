/**
 * Scenario groups (see from-mongoose-to-typemo/BENCHMARKS-PLAN.md): A–H are the basic operations, I–R the
 * heavier mechanisms.
 *
 * @example
 * ```ts
 * const group: GroupId = "C";
 * ```
 */
export type GroupId =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R";

/**
 * A run profile: which dataset sizes and how many repeats a run uses.
 *
 * @example
 * ```ts
 * const profile: ProfileName = "quick";
 * ```
 */
export type ProfileName = "quick" | "standard" | "full" | "heavy";

/**
 * Dataset sizes; `T` is a tiny size used only by self-tests and `--size T` smoke runs.
 *
 * @example
 * ```ts
 * const size: SizeName = "M";
 * ```
 */
export type SizeName = "T" | "S" | "M" | "L" | "XL";

/**
 * A library or mode that runs the same work: the raw driver, Mongoose (with and without its safety checks)
 * and Typemo (hydrated and lean).
 *
 * @example
 * ```ts
 * const contestant: ContestantId = "typemo-lean";
 * ```
 */
export type ContestantId = "driver" | "mongoose" | "mongoose-safe" | "typemo" | "typemo-lean";

/**
 * What a scenario measures.
 *
 * @example
 * ```ts
 * const kind: MeasureKind = "memory";
 * ```
 */
export type MeasureKind = "time" | "memory";

/** Every contestant, in report order. */
export const CONTESTANTS: readonly ContestantId[] = ["driver", "mongoose", "mongoose-safe", "typemo", "typemo-lean"];

/** Sizes each profile runs; a scenario narrows them with `sizes` / `sizesFor`. */
export const PROFILE_SIZES: Readonly<Record<ProfileName, readonly SizeName[]>> = {
  quick: ["S"],
  standard: ["S", "M"],
  full: ["S", "M", "L"],
  heavy: ["L", "XL"],
};

/** Document count of every dataset size. */
export const SIZE_COUNTS: Readonly<Record<SizeName, number>> = {
  T: 100,
  S: 1_000,
  M: 100_000,
  L: 1_000_000,
  XL: 5_000_000,
};

/**
 * Result summary of one contestant's work, compared across contestants (a contestant that did less work fails).
 *
 * @example
 * ```ts
 * const outcome: Outcome = { count: 1000, checksum: "9f2c" };
 * ```
 */
export interface Outcome {
  /** Number of documents / results the operation produced or touched. */
  readonly count: number;
  /** Canonical hash of the produced data (see Checksum). Empty string: not compared. */
  readonly checksum: string;
  /** Canonical hash of the final DB state of the scenario's collections. Empty string: not compared. */
  readonly state?: string;
  /**
   * Self-measured metrics of self-timed scenarios (throughput, latency percentiles, tsc numbers). Reported per
   * contestant as extra columns, never compared.
   */
  readonly metrics?: Readonly<Record<string, number>>;
}

/**
 * Timing statistics of one contestant; all durations are milliseconds per operation.
 *
 * @example
 * ```ts
 * const fastest: number = stats.min;
 * ```
 */
export interface TimeStats {
  /** Number of timed samples. */
  readonly samples: number;
  /** Median duration. */
  readonly median: number;
  /** 95th percentile. */
  readonly p95: number;
  /** 99th percentile. */
  readonly p99: number;
  /** Fastest sample. */
  readonly min: number;
  /** Slowest sample. */
  readonly max: number;
  /** Arithmetic mean. */
  readonly mean: number;
  /** Relative standard deviation, % */
  readonly rsd: number;
  /** Operations per second, from the median. */
  readonly opsPerSec: number;
}

/**
 * Memory statistics of one contestant.
 *
 * @example
 * ```ts
 * const retainedMb: number = stats.retained / 1024 / 1024;
 * ```
 */
export interface MemoryStats {
  /** Heap used after the operation minus before, bytes (no GC in between). */
  readonly heapDelta: number;
  /** Peak RSS during the operation minus RSS before, bytes. */
  readonly rssDelta: number;
  /** Heap still held after GC while the result is alive, bytes. */
  readonly retained: number;
  /** Highest RSS seen, bytes. */
  readonly rssPeak: number;
}

/**
 * Wire-command statistics of one contestant.
 *
 * @example
 * ```ts
 * const finds: number = stats.byName.find ?? 0;
 * ```
 */
export interface CommandStats {
  /** Number of commands sent. */
  readonly commands: number;
  /** Commands per wire command name. */
  readonly byName: Readonly<Record<string, number>>;
  /** BSON size of the commands sent. */
  readonly bytesOut: number;
  /** BSON size of the replies received. */
  readonly bytesIn: number;
}

/**
 * How one contestant's run ended.
 *
 * @example
 * ```ts
 * const status: ContestantStatus = "mismatch";
 * ```
 */
export type ContestantStatus = "ok" | "error" | "skipped" | "mismatch";

/**
 * The measured result of one contestant in one scenario.
 *
 * @example
 * ```ts
 * const median: number | undefined = result.time?.median;
 * ```
 */
export interface ContestantResult {
  /** Who ran. */
  readonly contestant: ContestantId;
  /** How the run ended. */
  readonly status: ContestantStatus;
  /** The error message, when the status is `error`. */
  readonly error?: string;
  /** Median of medians of the repeats (ms per operation) and the rest of the stats of the median repeat. */
  readonly time?: TimeStats;
  /** Median of every repeat, ms per operation. */
  readonly repeats?: readonly number[];
  /** Memory statistics, for memory scenarios. */
  readonly memory?: MemoryStats;
  /** Wire-command statistics. */
  readonly commands?: CommandStats;
  /** What the contestant produced, for comparison across contestants. */
  readonly outcome?: Outcome;
}

/**
 * How a scenario ended overall.
 *
 * @example
 * ```ts
 * const status: ScenarioStatus = "partial";
 * ```
 */
export type ScenarioStatus = "ok" | "failed" | "partial";

/**
 * The result of one scenario at one size.
 *
 * @example
 * ```ts
 * const ids: string[] = run.scenarios.map((scenario) => scenario.id);
 * ```
 */
export interface ScenarioResult {
  /** Scenario id. */
  readonly id: string;
  /** Scenario group. */
  readonly group: GroupId;
  /** Human-readable title. */
  readonly title: string;
  /** The dataset size the scenario ran at. */
  readonly size: SizeName;
  /** What was measured. */
  readonly kind: MeasureKind;
  /** Documents processed by one operation, to compute per-document costs. */
  readonly unitsPerOp: number;
  /** How the scenario ended overall. */
  readonly status: ScenarioStatus;
  /** Problems found, such as a checksum mismatch. */
  readonly problems: readonly string[];
  /** One result per contestant. */
  readonly contestants: readonly ContestantResult[];
  /** Wall time of the whole scenario, ms. */
  readonly durationMs: number;
}

/**
 * The machine and software a run happened on.
 *
 * @example
 * ```ts
 * const bun: string = run.environment.bun;
 * ```
 */
export interface Environment {
  /** ISO date of the run. */
  readonly date: string;
  /** Machine name. */
  readonly machine: string;
  /** CPU model. */
  readonly cpu: string;
  /** CPU core count. */
  readonly cores: number;
  /** Installed memory, GB. */
  readonly memoryGb: number;
  /** Operating system. */
  readonly os: string;
  /** Bun version. */
  readonly bun: string;
  /** MongoDB server version. */
  readonly mongodb: string;
  /** MongoDB topology (standalone or replica set). */
  readonly mongodbTopology: string;
  /** `mongodb` driver version used by Typemo and the raw driver contestant. */
  readonly driver: string;
  /** `mongodb` driver version used by Mongoose. */
  readonly mongooseDriver: string;
  /** Mongoose version. */
  readonly mongoose: string;
  /** Typemo version. */
  readonly typemo: string;
  /** mitata version. */
  readonly mitata: string;
  /** Git commit of the repository. */
  readonly gitCommit: string;
  /** Git branch of the repository. */
  readonly gitBranch: string;
  /** Docker image of the MongoDB server. */
  readonly dockerImage: string;
}

/**
 * A whole run: environment, settings and every scenario result.
 *
 * @example
 * ```ts
 * const failed = run.scenarios.filter((scenario) => scenario.status === "failed");
 * ```
 */
export interface RunResult {
  /** Format version of the result file. */
  readonly version: 1;
  /** Profile name the run used. */
  readonly profile: string;
  /** Where and with what the run happened. */
  readonly environment: Environment;
  /** The settings of the run, for reproduction. */
  readonly settings: Readonly<Record<string, unknown>>;
  /** ISO time the run started. */
  readonly startedAt: string;
  /** Wall time of the run, ms. */
  readonly durationMs: number;
  /** Every scenario result. */
  readonly scenarios: readonly ScenarioResult[];
}
