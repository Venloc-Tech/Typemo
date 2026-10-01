import type { BenchContext } from "../adapters/bench-context.ts";
import type { Datasets } from "../data/datasets.ts";
import {
  CONTESTANTS,
  type ContestantId,
  type GroupId,
  type MeasureKind,
  type Outcome,
  PROFILE_SIZES,
  type ProfileName,
  SIZE_COUNTS,
  type SizeName,
} from "./types.ts";

/**
 * What one contestant does in a scenario. Only `run` is timed.
 *
 * Lifecycle per repeat: `setup` → warmup (`before` + `run`) → measured samples (`before` untimed, `run` timed)
 * → `verify(lastResult)` → `teardown`. The commands pass and the memory worker use the same lifecycle once.
 *
 * @example
 * ```ts
 * const impl: ContestantImpl<number> = {
 *   run: () => 1,
 *   verify: (result) => ({ count: result, checksum: "" }),
 * };
 * ```
 */
export interface ContestantImpl<R = unknown> {
  /** Untimed, once per repeat (e.g. reset a collection, compile a query). */
  readonly setup?: () => Promise<void> | void;
  /** Untimed, before every timed `run` (e.g. clear the target collection of an insert). */
  readonly before?: (iteration: number) => Promise<void> | void;
  /** The measured operation. `iteration` grows across warmup and samples (unique keys for inserts). */
  readonly run: (iteration: number) => Promise<R> | R;
  /** Turns the last result (and/or the DB state) into an Outcome compared across contestants. */
  readonly verify: (result: R, iteration: number) => Promise<Outcome> | Outcome;
  /** Untimed, once per repeat after `verify`. */
  readonly teardown?: () => Promise<void> | void;
}

/**
 * Per-scenario overrides of the iteration policy of the profile.
 *
 * @example
 * ```ts
 * const overrides: IterationOverrides = { warmup: 1, maxTimeMs: 500 };
 * ```
 */
export interface IterationOverrides {
  /** Untimed warmup iterations. */
  readonly warmup?: number;
  /** Samples to collect when one operation is fast enough. */
  readonly minSamples?: number;
  /** Hard cap on samples. */
  readonly maxSamples?: number;
  /** Stop after this much measured time once `floorSamples` are collected (ms). */
  readonly maxTimeMs?: number;
  /** Fewest samples accepted when `maxTimeMs` is reached first. */
  readonly floorSamples?: number;
  /** Repeats (median of medians), default from the profile (3). */
  readonly repeats?: number;
}

/**
 * Everything a scenario sees for one size in one context (timing or monitored).
 *
 * @example
 * ```ts
 * const docs: number = env.count;
 * ```
 */
export interface ScenarioEnv {
  /** The contestants' connections. */
  readonly ctx: BenchContext;
  /** The dataset size being run. */
  readonly size: SizeName;
  /** Document count of the size. */
  readonly count: number;
  /** Seeded datasets. */
  readonly datasets: Datasets;
  /** The profile being run. */
  readonly profile: ProfileName;
  /** Scenario-owned scratch state shared by `prepare` and `build` (per env). */
  readonly state: Map<string, unknown>;
}

/**
 * Base class of every benchmark scenario. One subclass per scenario; register instances in the
 * `SCENARIOS` export of a module under `src/scenarios/` (see ScenarioRegistry).
 */
export abstract class Scenario {
  /** Stable id, `<group>.<area>.<case>`, e.g. `C.find.byId`. */
  abstract readonly id: string;
  /** The scenario group. */
  abstract readonly group: GroupId;
  /** Human-readable title. */
  abstract readonly title: string;
  /** Profiles that include this scenario. */
  abstract readonly profiles: readonly ProfileName[];
  /** Sizes the scenario supports; the profile further restricts them (Profiles.sizesFor). */
  readonly sizes: readonly SizeName[] = ["S"];
  /**
   * Sizes in the `standard` profile when they differ from `sizes` (the 30-minute budget: M only where it adds
   * insight).
   */
  readonly standardSizes?: readonly SizeName[] | undefined;
  /** What is measured. */
  readonly kind: MeasureKind = "time";
  /** Contestants that take part; the others are reported as skipped. */
  readonly contestants: readonly ContestantId[] = CONTESTANTS;
  /** Overrides of the profile's iteration policy. */
  readonly iterations: IterationOverrides = {};
  /** Free text shown in the report (what exactly is compared, caveats). */
  readonly notes: string = "";

  /**
   * Sizes run under a profile. Default: `sizes` ∩ Profiles.SIZES[profile] when the profile is listed in
   * `profiles`, otherwise none. Override for per-profile sizes (e.g. S in standard, S+M in full).
   *
   * @param profile - The profile being run.
   * @returns The sizes to run.
   */
  sizesFor(profile: ProfileName): readonly SizeName[] {
    if (!this.profiles.includes(profile)) return [];
    if (profile === "standard" && this.standardSizes !== undefined) return this.standardSizes;
    const allowed = PROFILE_SIZES[profile];
    return this.sizes.filter((size) => allowed.includes(size));
  }

  /**
   * Documents processed by one operation (for per-document costs in the report).
   *
   * @param size - The dataset size.
   * @returns The number of documents per operation.
   */
  unitsPerOp(size: SizeName): number {
    void size;
    return 1;
  }

  /**
   * Once per size and context before any contestant (seed datasets, precompute inputs). Untimed.
   *
   * @param env - The scenario environment.
   */
  prepare(env: ScenarioEnv): Promise<void> | void {
    void env;
  }

  /**
   * Builds the implementation of one contestant.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The contestant's implementation.
   */
  abstract build(
    contestant: ContestantId,
    env: ScenarioEnv,
  ): ContestantImpl<unknown> | Promise<ContestantImpl<unknown>>;

  /**
   * Once per size and context after all contestants. Untimed.
   *
   * @param env - The scenario environment.
   */
  cleanup(env: ScenarioEnv): Promise<void> | void {
    void env;
  }

  /**
   * Document count of a size.
   *
   * @param size - The dataset size.
   * @returns The count.
   */
  static countOf(size: SizeName): number {
    return SIZE_COUNTS[size];
  }
}

/**
 * Helper type: an impl map a scenario can return from `build` via ScenarioKit.pick.
 *
 * @example
 * ```ts
 * const map: ImplMap = { driver: () => driverImpl, typemo: () => typemoImpl };
 * ```
 */
export type ImplMap = Partial<Record<ContestantId, () => ContestantImpl<unknown> | Promise<ContestantImpl<unknown>>>>;

/** Helpers for writing `Scenario.build`. */
export class ScenarioKit {
  /**
   * Picks the contestant's factory from a map; unknown contestant → a clear error.
   *
   * @param map - Factories by contestant.
   * @param contestant - Who runs.
   * @returns The contestant's implementation.
   * @throws Error - When the map has no factory for the contestant.
   */
  static pick(map: ImplMap, contestant: ContestantId): ContestantImpl<unknown> | Promise<ContestantImpl<unknown>> {
    const factory = map[contestant];
    if (factory === undefined) throw new Error(`no implementation for contestant "${contestant}"`);
    return factory();
  }

  /**
   * Typed identity for implementations: keeps `R` between `run` and `verify`.
   *
   * @param impl - The implementation.
   * @returns The same implementation, with `R` erased.
   */
  static impl<R>(impl: ContestantImpl<R>): ContestantImpl<unknown> {
    return impl as ContestantImpl<unknown>;
  }
}
