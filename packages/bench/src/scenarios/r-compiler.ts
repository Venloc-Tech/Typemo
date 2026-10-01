/*
 * Group R — compiler and IDE: the same application (M models × Q queries per model) written for Typemo and for
 * Mongoose (`support-bb/compiler-project.ts`). One run per contestant = `tsc --extendedDiagnostics` of the
 * project minus the same numbers for a baseline project (the library imported, one model, no queries): the
 * difference is what the APPLICATION costs the checker — where Typemo is heavier, that is the price of
 * strictness. Hover latency: the test-kit `TypeProbe` (language service) on a snippet with `// ^?` markers
 * under query results — cold (first hover, builds the program), warm (same text), and after an edit.
 * standard: 5 × 50; full: 20 × 200. Verified: 0 compiler errors in both projects.
 */
import { TypeProbe } from "@venloc/typemo-test-kit";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { type CompilerContestant, CompilerProject } from "./support-bb/compiler-project.ts";

/** The iteration index from which the harness runs verification. */
const VERIFY_ITERATION = 1_000_000;

/**
 * Numbers read from `tsc --extendedDiagnostics`.
 *
 * @example
 * ```ts
 * const stats: TscStats = Tsc.run("tsconfig.json");
 * ```
 */
interface TscStats {
  /** Total compile time, ms. */
  readonly totalMs: number;
  /** Type-check time, ms. */
  readonly checkMs: number;
  /** Type instantiations. */
  readonly instantiations: number;
  /** Types created. */
  readonly types: number;
  /** Memory used, MB. */
  readonly memoryMb: number;
  /** The `error TS` lines. */
  readonly errors: readonly string[];
}

/**
 * The result of one compiler run.
 *
 * @example
 * ```ts
 * const extra: number = run.project.checkMs - run.baseline.checkMs;
 * ```
 */
interface CompilerRun {
  /** The application project. */
  readonly project: TscStats;
  /** The baseline project (library imported, one model, no queries). */
  readonly baseline: TscStats;
  /** First hover, ms. */
  readonly hoverColdMs: number;
  /** Average of the following hovers, ms. */
  readonly hoverWarmMs: number;
  /** Average hover after an edit, ms. */
  readonly hoverEditMs: number;
  /** The hover texts. */
  readonly hovers: readonly string[];
  /** Queries in the project. */
  readonly queries: number;
}

/** Runs `tsc`. */
class Tsc {
  /** Path of the TypeScript compiler script. */
  private static readonly TSC = `${CompilerProject.repo}/node_modules/typescript/lib/tsc.js`;

  /**
   * Compiles a project and reads the diagnostics.
   *
   * @param tsconfig - Path of the project's tsconfig.
   * @returns The statistics.
   */
  static run(tsconfig: string): TscStats {
    const out = Bun.spawnSync(
      [process.execPath, Tsc.TSC, "-p", tsconfig, "--extendedDiagnostics", "--pretty", "false"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const text = `${out.stdout.toString()}\n${out.stderr.toString()}`;
    const num = (label: string): number => {
      const match = new RegExp(`^${label}:\\s+([\\d.]+)(K|s)?`, "m").exec(text);
      if (match === null) return Number.NaN;
      const value = Number(match[1]);
      return match[2] === "s" ? value * 1000 : match[2] === "K" ? value / 1024 : value;
    };
    return {
      totalMs: num("Total time"),
      checkMs: num("Check time"),
      instantiations: num("Instantiations"),
      types: num("Types"),
      memoryMb: num("Memory used"),
      errors: text.split("\n").filter((line) => line.includes("error TS")),
    };
  }
}

/** Hover latency through the language service. */
class Hover {
  /**
   * Hover latencies of the snippet in a FRESH language service (so "cold" is cold every run).
   *
   * @param tsconfig - The project's tsconfig.
   * @param dir - The directory the snippet pretends to live in.
   * @param snippet - The snippet with `// ^?` markers.
   * @returns The cold, warm and after-edit latencies and the hover texts.
   */
  static measure(
    tsconfig: string,
    dir: string,
    snippet: string,
  ): { cold: number; warm: number; edit: number; texts: string[] } {
    const probe = new TypeProbe({ tsconfig });
    const source = probe.check(snippet, { dir });
    const markers = source.markers.length;
    let started = performance.now();
    const texts = [source.hover(0)];
    const cold = performance.now() - started;
    started = performance.now();
    for (let i = 1; i < markers; i++) texts.push(source.hover(i));
    const warm = (performance.now() - started) / Math.max(1, markers - 1);
    /* An edit: a changed literal forces the checker to recheck the snippet before answering. */
    started = performance.now();
    const edits = 5;
    for (let e = 0; e < edits; e++) probe.check(snippet.replaceAll("$gte: 1", `$gte: ${e + 2}`), { dir }).hover(0);
    const edit = (performance.now() - started) / edits;
    return { cold, warm, edit, texts };
  }
}

/** One result per contestant and size, shared across contexts (timing, commands, verify runs). */
const CACHE = new Map<string, CompilerRun>();

/** Compiles an equivalent application for each contestant and measures the checker and the hover. */
class CompilerScenario extends Scenario {
  readonly id = "R.compiler.project";
  readonly group = "R" as const;
  readonly title = "tsc + hover on an equivalent project (models × queries per model)";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  override readonly contestants: readonly ContestantId[] = ["mongoose", "typemo"];
  override readonly iterations = { warmup: 0, minSamples: 1, maxSamples: 1, repeats: 1 };
  override readonly notes =
    "Self-timed; see metrics. S = 5 models × 50 queries (standard), M = 20 × 200 (full). userCheckMs / " +
    "userInstantiations = project − baseline (library imported, 1 model, 0 queries). Typemo is typed from its " +
    "SOURCES (its emitted .d.ts break typed filters/pipelines — a Typemo bug), Mongoose from its .d.ts.";

  /**
   * The sizes to run under a profile.
   *
   * @param profile - The profile.
   * @returns S for `standard`, M for `full`, none otherwise.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return profile === "standard" ? ["S"] : profile === "full" ? ["M"] : [];
  }

  /**
   * The project shape of a size.
   *
   * @param size - The dataset size.
   * @returns The number of models and of queries per model.
   */
  private shape(size: SizeName): { models: number; queries: number } {
    return size === "M"
      ? { models: 20, queries: 200 }
      : size === "T"
        ? { models: 3, queries: 10 }
        : { models: 5, queries: 50 };
  }

  /**
   * Queries per operation.
   *
   * @param size - The dataset size.
   * @returns Models times queries.
   */
  override unitsPerOp(size: SizeName): number {
    const { models, queries } = this.shape(size);
    return models * queries;
  }

  /**
   * Builds a contestant that generates, compiles and hovers a project.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const kind = contestant as CompilerContestant;
    const { models, queries } = this.shape(env.size);
    const key = `${kind}:${env.size}`;
    const measure = (): CompilerRun => {
      const project = CompilerProject.generate(kind, models, queries, "app");
      const baseline = CompilerProject.generate(kind, 1, 0, "baseline");
      const projectStats = Tsc.run(project.tsconfig);
      const baselineStats = Tsc.run(baseline.tsconfig);
      const hover = Hover.measure(project.tsconfig, project.dir, project.hoverSnippet);
      return {
        project: projectStats,
        baseline: baselineStats,
        hoverColdMs: hover.cold,
        hoverWarmMs: hover.warm,
        hoverEditMs: hover.edit,
        hovers: hover.texts,
        queries: project.queries,
      };
    };
    return ScenarioKit.impl<CompilerRun>({
      run: (iteration) => {
        const cached = CACHE.get(key);
        if (iteration >= VERIFY_ITERATION && cached !== undefined) return cached;
        const run = measure();
        CACHE.set(key, run);
        return run;
      },
      verify: (run): Outcome => {
        const errors = [...run.project.errors, ...run.baseline.errors];
        if (errors.length > 0) throw new Error(`${contestant}: ${errors.length} tsc errors, first: ${errors[0]}`);
        if (run.hovers.some((text) => text.includes("any")))
          throw new Error(`${contestant}: a hover shows \`any\`: ${run.hovers.find((t) => t.includes("any"))}`);
        const round = (x: number): number => Math.round(x * 10) / 10;
        return {
          count: run.queries,
          checksum: "errors=0",
          metrics: {
            tscTotalMs: round(run.project.totalMs),
            checkMs: round(run.project.checkMs),
            instantiations: run.project.instantiations,
            memoryMb: round(run.project.memoryMb),
            userCheckMs: round(run.project.checkMs - run.baseline.checkMs),
            userInstantiations: run.project.instantiations - run.baseline.instantiations,
            baselineCheckMs: round(run.baseline.checkMs),
            hoverColdMs: round(run.hoverColdMs),
            hoverWarmMs: Math.round(run.hoverWarmMs * 100) / 100,
            hoverEditMs: round(run.hoverEditMs),
          },
        };
      },
    });
  }
}

/** The scenarios of group R. */
export const SCENARIOS: readonly Scenario[] = [new CompilerScenario()];
