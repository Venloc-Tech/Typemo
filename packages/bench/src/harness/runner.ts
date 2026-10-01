import path from "node:path";
import type { BenchContext } from "../adapters/bench-context.ts";
import { Datasets } from "../data/datasets.ts";
import { Rng } from "../data/rng.ts";
import { CommandProbe } from "./commands.ts";
import { Measurer, Stats } from "./measure.ts";
import { type ProfileDefinition, Profiles } from "./profiles.ts";
import type { ContestantImpl, Scenario, ScenarioEnv } from "./scenario.ts";
import {
  type CommandStats,
  type ContestantId,
  type ContestantResult,
  type GroupId,
  type MemoryStats,
  type Outcome,
  type ScenarioResult,
  SIZE_COUNTS,
  type SizeName,
  type TimeStats,
} from "./types.ts";
import { OutcomeComparer } from "./verify.ts";

/** Iteration index of the dedicated, untimed verification run (the same for every contestant). */
export const VERIFY_ITERATION = 1_000_000;
/** Iteration index of the commands pass. */
export const COMMANDS_ITERATION = 2_000_000;

/**
 * Options of a benchmark run.
 *
 * @example
 * ```ts
 * const options: RunnerOptions = {
 *   profile: Profiles.get("quick"),
 *   commands: false,
 *   seed: 1,
 *   log: console.log,
 * };
 * ```
 */
export interface RunnerOptions {
  /** The run profile. */
  readonly profile: ProfileDefinition;
  /** Only these groups. */
  readonly groups?: readonly GroupId[];
  /** Only these sizes, instead of the profile's. */
  readonly sizes?: readonly SizeName[];
  /** Only these contestants. */
  readonly contestants?: readonly ContestantId[];
  /** Only scenarios whose id contains this text. */
  readonly filter?: string;
  /** Also run the monitored pass that counts commands and bytes. */
  readonly commands: boolean;
  /** Seed of the contestant-order shuffle. */
  readonly seed: number;
  /** Receives progress lines. */
  readonly log: (line: string) => void;
}

/**
 * One scenario at one size, as planned by `BenchRunner.plan`.
 *
 * @example
 * ```ts
 * const [first]: PlannedRun[] = runner.plan(scenarios);
 * ```
 */
export interface PlannedRun {
  /** The scenario. */
  readonly scenario: Scenario;
  /** The size to run it at. */
  readonly size: SizeName;
}

/**
 * What the memory worker prints (last stdout line, JSON).
 *
 * @example
 * ```ts
 * const report: MemoryWorkerReport = { ok: true, timeMs: 12 };
 * ```
 */
export interface MemoryWorkerReport {
  /** `false` when the worker failed. */
  readonly ok: boolean;
  /** The failure message. */
  readonly error?: string;
  /** The measured memory. */
  readonly memory?: MemoryStats;
  /** Duration of the operation, ms. */
  readonly timeMs?: number;
  /** What the contestant produced. */
  readonly outcome?: Outcome;
}

/**
 * A short, single-line description of an error.
 *
 * @param error - Anything that was thrown.
 * @returns The name and message, at most 500 characters.
 */
const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : String(error).slice(0, 500);

/**
 * Runs scenarios by this methodology: shuffled contestant order per repeat, 3 repeats → median of
 * medians, forced GC before each measurement, a dedicated verification run compared across contestants, a
 * separate monitored pass for command/byte counts, memory scenarios in separate processes.
 */
export class BenchRunner {
  /** Random source of the contestant-order shuffle. */
  readonly #rng: Rng;

  /**
   * @param options - Profile, filters and logging.
   * @param timing - The connections used for timed runs.
   * @param monitored - The connections used for the commands pass; `undefined` disables it.
   */
  constructor(
    readonly options: RunnerOptions,
    readonly timing: BenchContext,
    readonly monitored: BenchContext | undefined,
  ) {
    this.#rng = new Rng(options.seed);
  }

  /**
   * Builds the environment a scenario sees.
   *
   * @param ctx - The connections.
   * @param size - The dataset size.
   * @param profile - The run profile.
   * @returns The environment.
   */
  static envOf(ctx: BenchContext, size: SizeName, profile: ProfileDefinition): ScenarioEnv {
    return {
      ctx,
      size,
      count: SIZE_COUNTS[size],
      datasets: new Datasets(ctx),
      profile: profile.name,
      state: new Map(),
    };
  }

  /**
   * Scenario × size pairs selected by the profile and the CLI filters.
   *
   * @param scenarios - Every known scenario.
   * @returns The runs to execute, in order.
   */
  plan(scenarios: readonly Scenario[]): PlannedRun[] {
    const { profile, groups, sizes, filter } = this.options;
    const out: PlannedRun[] = [];
    for (const scenario of scenarios) {
      if (profile.excludedGroups.includes(scenario.group)) continue;
      if (groups !== undefined && !groups.includes(scenario.group)) continue;
      if (filter !== undefined && !scenario.id.includes(filter)) continue;
      const own = scenario.sizesFor(profile.name);
      if (own.length === 0) continue;
      /* --size overrides the sizes of the profile (T is always accepted: tiny smoke runs). */
      const planned = sizes === undefined ? own : sizes.filter((size) => size === "T" || scenario.sizes.includes(size));
      for (const size of planned) out.push({ scenario, size });
    }
    return out;
  }

  /**
   * The contestants that take part in a scenario under the CLI filter.
   *
   * @param scenario - The scenario.
   * @returns The contestant ids.
   */
  #contestantsOf(scenario: Scenario): ContestantId[] {
    const wanted = this.options.contestants;
    return scenario.contestants.filter((c) => wanted === undefined || wanted.includes(c));
  }

  /**
   * Shuffles a list (Fisher–Yates) with the seeded random source.
   *
   * @param items - The list.
   * @returns A shuffled copy.
   */
  #shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.#rng.next() * (i + 1));
      const a = out[i] as T;
      out[i] = out[j] as T;
      out[j] = a;
    }
    return out;
  }

  /**
   * Runs the planned scenarios one after another.
   *
   * @param planned - The runs from `plan`.
   * @returns One result per planned run.
   */
  async run(planned: readonly PlannedRun[]): Promise<ScenarioResult[]> {
    const results: ScenarioResult[] = [];
    let index = 0;
    for (const { scenario, size } of planned) {
      index++;
      const t0 = performance.now();
      this.options.log(`[${index}/${planned.length}] ${scenario.id} (${size}) …`);
      const result =
        scenario.kind === "memory" ? await this.#runMemory(scenario, size) : await this.#runTime(scenario, size);
      results.push(result);
      this.options.log(
        `    ${result.status}${result.problems.length > 0 ? `: ${result.problems.join("; ")}` : ""} ` +
          `(${((performance.now() - t0) / 1000).toFixed(1)} s)`,
      );
    }
    return results;
  }

  /**
   * Runs a timed scenario: build, repeated measurement, verification, optional commands pass.
   *
   * @param scenario - The scenario.
   * @param size - The dataset size.
   * @returns The scenario result.
   */
  async #runTime(scenario: Scenario, size: SizeName): Promise<ScenarioResult> {
    const started = performance.now();
    const profile = this.options.profile;
    const policy = Profiles.policyFor(profile, scenario.iterations);
    const env = BenchRunner.envOf(this.timing, size, profile);
    const contestants = this.#contestantsOf(scenario);
    const problems: string[] = [];
    try {
      await scenario.prepare(env);
    } catch (error) {
      return this.#failed(scenario, size, started, [`prepare: ${errorText(error)}`], contestants);
    }

    const impls = new Map<ContestantId, ContestantImpl<unknown>>();
    const errors = new Map<ContestantId, string>();
    for (const c of contestants) {
      try {
        impls.set(c, await scenario.build(c, env));
      } catch (error) {
        errors.set(c, `build: ${errorText(error)}`);
      }
    }

    const repeats = new Map<ContestantId, TimeStats[]>();
    const outcomes = new Map<ContestantId, Outcome>();
    const next = new Map<ContestantId, number>();
    for (let r = 0; r < policy.repeats; r++) {
      for (const c of this.#shuffle(contestants)) {
        const impl = impls.get(c);
        if (impl === undefined || errors.has(c)) continue;
        try {
          await impl.setup?.();
          const m = await Measurer.run(impl, policy, next.get(c) ?? 0);
          next.set(c, m.nextIteration);
          repeats.set(c, [...(repeats.get(c) ?? []), m.stats]);
          if (r === policy.repeats - 1) outcomes.set(c, await BenchRunner.verifyRun(impl, VERIFY_ITERATION));
          await impl.teardown?.();
        } catch (error) {
          errors.set(c, errorText(error));
          await Promise.resolve(impl.teardown?.()).catch(() => undefined);
        }
      }
    }

    const commands = this.options.commands ? await this.#commandsPass(scenario, size, contestants) : new Map();
    await Promise.resolve(scenario.cleanup(env)).catch((error: unknown) =>
      problems.push(`cleanup: ${errorText(error)}`),
    );

    return this.#assemble(scenario, size, started, contestants, {
      problems,
      errors,
      outcomes,
      commands,
      time: repeats,
      memory: new Map(),
    });
  }

  /**
   * The untimed verification run: `before(V)` + `run(V)` + `verify`, the same V for every contestant.
   *
   * @param impl - The contestant's implementation.
   * @param iteration - The iteration index to run with.
   * @returns The outcome to compare.
   */
  static async verifyRun(impl: ContestantImpl<unknown>, iteration: number): Promise<Outcome> {
    await impl.before?.(iteration);
    const result = await impl.run(iteration);
    return impl.verify(result, iteration);
  }

  /**
   * Counts commands and bytes of one operation per contestant, on the monitored connections.
   *
   * @param scenario - The scenario.
   * @param size - The dataset size.
   * @param contestants - The contestants to measure.
   * @returns The command statistics, or an error message, per contestant.
   */
  async #commandsPass(
    scenario: Scenario,
    size: SizeName,
    contestants: readonly ContestantId[],
  ): Promise<Map<ContestantId, CommandStats | string>> {
    const out = new Map<ContestantId, CommandStats | string>();
    if (this.monitored === undefined) return out;
    const env = BenchRunner.envOf(this.monitored, size, this.options.profile);
    try {
      await scenario.prepare(env);
      for (const c of contestants) {
        try {
          const impl = await scenario.build(c, env);
          await impl.setup?.();
          /* One warm run so lazy one-time work (model init, index checks) is not counted as per-operation cost. */
          await impl.before?.(COMMANDS_ITERATION - 1);
          await impl.run(COMMANDS_ITERATION - 1);
          await impl.before?.(COMMANDS_ITERATION);
          const probe = CommandProbe.attach(this.monitored.mongoOf(c));
          try {
            await impl.run(COMMANDS_ITERATION);
          } finally {
            out.set(c, probe.stop());
          }
          await impl.teardown?.();
        } catch (error) {
          out.set(c, errorText(error));
        }
      }
      await scenario.cleanup(env);
    } catch (error) {
      for (const c of contestants) if (!out.has(c)) out.set(c, `commands pass: ${errorText(error)}`);
    }
    return out;
  }

  /**
   * Runs a memory scenario: every measurement in a separate worker process.
   *
   * @param scenario - The scenario.
   * @param size - The dataset size.
   * @returns The scenario result.
   */
  async #runMemory(scenario: Scenario, size: SizeName): Promise<ScenarioResult> {
    const started = performance.now();
    const policy = Profiles.policyFor(this.options.profile, scenario.iterations);
    const contestants = this.#contestantsOf(scenario);
    const env = BenchRunner.envOf(this.timing, size, this.options.profile);
    try {
      /* Seed once here so that workers only find fresh datasets. */
      await scenario.prepare(env);
    } catch (error) {
      return this.#failed(scenario, size, started, [`prepare: ${errorText(error)}`], contestants);
    }
    const reports = new Map<ContestantId, MemoryWorkerReport[]>();
    for (let r = 0; r < policy.repeats; r++) {
      for (const c of this.#shuffle(contestants)) {
        reports.set(c, [
          ...(reports.get(c) ?? []),
          await BenchRunner.spawnMemoryWorker(scenario.id, size, c, this.options),
        ]);
      }
    }
    const errors = new Map<ContestantId, string>();
    const outcomes = new Map<ContestantId, Outcome>();
    const memory = new Map<ContestantId, MemoryStats>();
    const time = new Map<ContestantId, TimeStats[]>();
    for (const [c, list] of reports) {
      const failed = list.find((report) => !report.ok);
      if (failed !== undefined) {
        errors.set(c, failed.error ?? "memory worker failed");
        continue;
      }
      const ok = list.filter((report) => report.memory !== undefined);
      const byRetained = [...ok].sort((a, b) => (a.memory?.retained ?? 0) - (b.memory?.retained ?? 0));
      const middle = byRetained[Math.floor((byRetained.length - 1) / 2)];
      if (middle?.memory !== undefined) memory.set(c, middle.memory);
      if (middle?.outcome !== undefined) outcomes.set(c, middle.outcome);
      time.set(
        c,
        ok.map((report) => Stats.of([report.timeMs ?? Number.NaN])),
      );
    }
    const commands = this.options.commands ? await this.#commandsPass(scenario, size, contestants) : new Map();
    await Promise.resolve(scenario.cleanup(env)).catch(() => undefined);
    return this.#assemble(scenario, size, started, contestants, {
      problems: [],
      errors,
      outcomes,
      commands,
      time,
      memory,
    });
  }

  /**
   * Runs one memory measurement in a fresh process.
   *
   * @param id - The scenario id.
   * @param size - The dataset size.
   * @param contestant - Who runs.
   * @param options - The run options; the profile is passed to the worker.
   * @returns The worker's report, or a failure report when it printed nothing usable.
   */
  static async spawnMemoryWorker(
    id: string,
    size: SizeName,
    contestant: ContestantId,
    options: RunnerOptions,
  ): Promise<MemoryWorkerReport> {
    const worker = path.resolve(import.meta.dir, "../cli/memory-worker.ts");
    const proc = Bun.spawn(
      [
        process.execPath,
        "run",
        worker,
        "--scenario",
        id,
        "--size",
        size,
        "--contestant",
        contestant,
        "--profile",
        options.profile.name,
      ],
      { cwd: path.resolve(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe", env: process.env },
    );
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    const line = stdout.trim().split("\n").at(-1) ?? "";
    try {
      return JSON.parse(line) as MemoryWorkerReport;
    } catch {
      return { ok: false, error: `memory worker: no report (exit ${proc.exitCode}) ${stderr.slice(-400)}` };
    }
  }

  /**
   * The result of a scenario that could not run at all.
   *
   * @param scenario - The scenario.
   * @param size - The dataset size.
   * @param started - `performance.now()` at the start.
   * @param problems - What went wrong.
   * @param contestants - The contestants that were meant to run.
   * @returns A failed result.
   */
  #failed(
    scenario: Scenario,
    size: SizeName,
    started: number,
    problems: string[],
    contestants: readonly ContestantId[],
  ): ScenarioResult {
    return {
      id: scenario.id,
      group: scenario.group,
      title: scenario.title,
      size,
      kind: scenario.kind,
      unitsPerOp: scenario.unitsPerOp(size),
      status: "failed",
      problems,
      contestants: contestants.map((c) => ({ contestant: c, status: "error", error: problems[0] ?? "failed" })),
      durationMs: performance.now() - started,
    };
  }

  /**
   * Combines the collected parts into a scenario result and compares the outcomes.
   *
   * @param scenario - The scenario.
   * @param size - The dataset size.
   * @param started - `performance.now()` at the start.
   * @param contestants - The contestants that ran.
   * @param parts - Problems, errors, outcomes, commands, time and memory by contestant.
   * @returns The scenario result.
   */
  #assemble(
    scenario: Scenario,
    size: SizeName,
    started: number,
    contestants: readonly ContestantId[],
    parts: {
      readonly problems: string[];
      readonly errors: ReadonlyMap<ContestantId, string>;
      readonly outcomes: ReadonlyMap<ContestantId, Outcome>;
      readonly commands: ReadonlyMap<ContestantId, CommandStats | string>;
      readonly time: ReadonlyMap<ContestantId, TimeStats[]>;
      readonly memory: ReadonlyMap<ContestantId, MemoryStats>;
    },
  ): ScenarioResult {
    const problems = [...parts.problems, ...OutcomeComparer.compare(parts.outcomes)];
    const mismatched = new Set(
      problems.map((p) => p.split(":")[0] ?? "").filter((c) => contestants.includes(c as ContestantId)),
    );
    const results: ContestantResult[] = [];
    for (const c of scenario.contestants) {
      if (!contestants.includes(c)) {
        results.push({ contestant: c, status: "skipped" });
        continue;
      }
      const error = parts.errors.get(c);
      const reps = parts.time.get(c) ?? [];
      const cmd = parts.commands.get(c);
      const memory = parts.memory.get(c);
      const outcome = parts.outcomes.get(c);
      results.push({
        contestant: c,
        status: error !== undefined ? "error" : mismatched.has(c) ? "mismatch" : "ok",
        ...(error !== undefined ? { error } : {}),
        ...(reps.length > 0 ? { time: Stats.medianOfMedians(reps), repeats: reps.map((s) => s.median) } : {}),
        ...(memory !== undefined ? { memory } : {}),
        ...(typeof cmd === "object" ? { commands: cmd } : {}),
        ...(outcome !== undefined ? { outcome } : {}),
      });
      if (typeof cmd === "string") problems.push(`${c}: commands pass failed: ${cmd}`);
      if (error !== undefined) problems.push(`${c}: ${error}`);
    }
    const ran = results.filter((r) => r.status !== "skipped");
    const bad = ran.filter((r) => r.status !== "ok");
    return {
      id: scenario.id,
      group: scenario.group,
      title: scenario.title,
      size,
      kind: scenario.kind,
      unitsPerOp: scenario.unitsPerOp(size),
      status: bad.length === 0 ? "ok" : bad.length === ran.length || mismatched.size > 0 ? "failed" : "partial",
      problems,
      contestants: results,
      durationMs: performance.now() - started,
    };
  }
}
