/*
 * The compiler budget, measured on the dense-graph project `packages/test-kit/fixtures/dense-graph`
 * (see VERSIONS.md).
 *
 * Each scenario is compiled on its own by a fresh `tsc --extendedDiagnostics` process (median of RUNS
 * runs), then the budget is checked:
 *   TIME is the cost of USER code: scenario `all` minus the baseline `empty` (the library sources
 *   checked with no usage) — total time over the baseline ≤ 0.5 s (check time over it is printed too);
 *   instantiations ≤ 1 000 000 (scenario `all`);
 *   instantiations per query chain over the baseline (`all` − `empty`) / chains ≤ 10 000;
 *   memory ≤ 400 MB (scenario `all`);
 *   0 × TS2589 / TS2590 in every scenario (including a depth-7 lean populate in a fresh file);
 *   the largest enumerated path union ≤ 5 000 members.
 * The baseline itself (the self-check of the library sources) is NOT budgeted: it is printed with its
 * growth against the previous run recorded in from-mongoose-to-typemo/reports/tsc-budget.csv.
 *
 * Usage: `bun run typecheck:budget [label]` (prints a markdown table; exit code 1 when over budget).
 * Env: RUNS (default 3); NO_RECORD=1 does not append a row to the CSV; TYPEMO_BUDGET_DTS=0 skips the .d.ts
 * measurement.
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

/** The repository root. */
const ROOT = resolve(import.meta.dir, "..");
/** The dense-graph project. */
const PROJECT = resolve(ROOT, "packages/test-kit/fixtures/dense-graph");
/** How many times each scenario is compiled. */
const RUNS = Number(process.env.RUNS ?? 3);
/** The CSV the measurements are appended to. */
const RECORD = resolve(ROOT, "from-mongoose-to-typemo/reports/tsc-budget.csv");
/** The CSV header. */
const RECORD_HEADER =
  "timestamp,label,empty_check_s,empty_total_s,all_check_s,all_total_s,over_baseline_total_s,over_baseline_check_s,all_instantiations,per_chain\n";

/** Scenario → number of query chains in it (for the per-chain cost). */
const SCENARIOS: Readonly<Record<string, number>> = {
  empty: 0,
  single: 1,
  "queries-50": 50,
  "deep-populate": 10,
  "then-usage": 6,
  "then-stress": 8,
  "deep-populate-7": 1,
  "map-union": 8,
  "model-ops": 10,
  all: 67,
};

/** The budget limits. */
const BUDGET = {
  /** Instantiations of scenario `all`. */
  instantiations: 1_000_000,
  /** Instantiations per query chain over the baseline. */
  perChain: 10_000,
  /** Seconds of `all` over `empty` (total time). */
  overBaselineS: 0.5,
  /** Memory of scenario `all`, MB. */
  memoryMB: 400,
  /** Members of the largest enumerated path union. */
  union: 5_000,
} as const;

/**
 * A build of `@venloc/typemo` declarations the scenarios are compiled against (the .d.ts measurement).
 *
 * @example
 * ```ts
 * const variant: DtsVariant = { name: "dts", skipLibCheck: true };
 * ```
 */
interface DtsVariant {
  /** Names the variant. */
  readonly name: string;
  /** The `skipLibCheck` setting the scenarios are compiled with. */
  readonly skipLibCheck: boolean;
}

/**
 * The measurement of one scenario.
 *
 * @example
 * ```ts
 * const row: Row = await BudgetRunner.measure("all");
 * ```
 */
interface Row {
  /** The scenario name. */
  readonly scenario: string;
  /** Median check time, s. */
  readonly checkS: number;
  /** Median total time, s. */
  readonly totalS: number;
  /** Type instantiations. */
  readonly instantiations: number;
  /** Memory used, MB. */
  readonly memoryMB: number;
  /** The `error TS` lines. */
  readonly errors: readonly string[];
}

/** Measures the scenarios and checks the budget. */
class BudgetRunner {
  /** A temporary directory for generated tsconfigs. */
  static readonly tmp = mkdtempSync(join(tmpdir(), "typemo-budget-"));

  /**
   * The tsconfig of one scenario; `variant` points `@venloc/typemo` at built declarations (the .d.ts measurement).
   *
   * @param scenario - The scenario name.
   * @param variant - The declarations to compile against; the sources when omitted.
   * @returns The path of the generated tsconfig.
   */
  static config(scenario: string, variant?: DtsVariant): string {
    const file = join(BudgetRunner.tmp, `tsconfig.${scenario}${variant === undefined ? "" : `.${variant.name}`}.json`);
    const config = {
      extends: resolve(ROOT, "tsconfig.test.json"),
      compilerOptions: {
        noEmit: true,
        typeRoots: [resolve(ROOT, "node_modules/@types")],
        ...(variant === undefined
          ? {}
          : {
              skipLibCheck: variant.skipLibCheck,
              paths: {
                "@venloc/typemo": [join(BudgetRunner.dtsDir, "index.d.ts")],
                "@venloc/typemo/testing": [join(BudgetRunner.dtsDir, "testing/index.d.ts")],
              },
            }),
      },
      include: [],
      files: [resolve(PROJECT, "usage", `${scenario}.ts`)],
    };
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    return file;
  }

  /**
   * Where the declarations of `@venloc/typemo` are built for the .d.ts measurement: inside the package's
   * `node_modules` (a cache dir, removed at the end), so that their imports of `mongodb`/`bson` resolve as they would
   * from an installed package.
   */
  static readonly dtsDir = resolve(ROOT, "packages/typemo/node_modules/.cache/typemo-budget-dts");

  /**
   * A number from the diagnostics output.
   *
   * @param text - The `tsc --extendedDiagnostics` output.
   * @param label - The line label, such as `Check time`.
   * @returns The number, or `NaN` when the line is missing.
   */
  static number(text: string, label: string): number {
    const match = new RegExp(`^${label}:\\s+([\\d.]+)`, "m").exec(text);
    return match?.[1] === undefined ? Number.NaN : Number(match[1]);
  }

  /**
   * The median of numbers.
   *
   * @param values - The numbers.
   * @returns The middle value after sorting.
   */
  static median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
  }

  /**
   * Rounds to two decimals.
   *
   * @param value - The number.
   * @returns The rounded number.
   */
  static round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /**
   * Compiles a project once.
   *
   * @param config - The tsconfig.
   * @returns The combined output.
   */
  static async runOnce(config: string): Promise<string> {
    const proc = Bun.spawn(["bunx", "tsc", "-p", config, "--extendedDiagnostics"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    return out + err;
  }

  /**
   * Compiles a scenario `RUNS` times and takes the medians.
   *
   * @param scenario - The scenario name.
   * @param variant - The declarations to compile against; the sources when omitted.
   * @returns The measurement.
   */
  static async measure(scenario: string, variant?: DtsVariant): Promise<Row> {
    const config = BudgetRunner.config(scenario, variant);
    const outputs: string[] = [];
    for (let run = 0; run < RUNS; run++) outputs.push(await BudgetRunner.runOnce(config));
    const last = outputs.at(-1) ?? "";
    return {
      scenario,
      checkS: BudgetRunner.median(outputs.map((out) => BudgetRunner.number(out, "Check time"))),
      totalS: BudgetRunner.median(outputs.map((out) => BudgetRunner.number(out, "Total time"))),
      instantiations: BudgetRunner.number(last, "Instantiations"),
      memoryMB: Math.round(BudgetRunner.number(last, "Memory used") / 1024),
      errors: [...last.matchAll(/error (TS\d+)[^\n]*/g)].map((match) => match[0]),
    };
  }

  /**
   * Members of the largest enumerated path unions of the public types on the dense graph.
   *
   * @returns The member count per union.
   * @throws Error - When `tsconfig.test.json` cannot be read.
   */
  static unions(): Readonly<Record<string, number>> {
    const file = join(BudgetRunner.tmp, "unions.ts");
    const aliases = {
      "Paths<User>": "Paths<User>",
      "FilterPaths<Post>": "FilterPaths<Post>",
      "WritePaths<Post>": "WritePaths<Post>",
      "WritePaths<Post, true>": "WritePaths<Post, true>",
      "PopulatePaths<User> (hint, depth 3)": "PopulatePaths<User>",
      "PopulatePaths<Post> (hint, depth 3)": "PopulatePaths<Post>",
      "PopulatePaths<Comment> (hint, depth 3)": "PopulatePaths<Comment>",
      "PopulatePaths<Post, 2>": "PopulatePaths<Post, 2>",
      "HiddenPaths<User>": "HiddenPaths<User>",
    } as const;
    const names = Object.keys(aliases);
    const source = [
      `import type { Paths, FilterPaths, WritePaths, PopulatePaths, HiddenPaths } from "@venloc/typemo";`,
      `import type { User, Post, Comment } from "${resolve(PROJECT, "entities.ts")}";`,
      ...names.map((name, index) => `export type U${index} = ${aliases[name as keyof typeof aliases]};`),
    ].join("\n");
    writeFileSync(file, source);
    const parsed = ts.getParsedCommandLineOfConfigFile(
      resolve(ROOT, "tsconfig.test.json"),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    );
    if (parsed === undefined) throw new Error("cannot read tsconfig.test.json");
    const program = ts.createProgram([file], { ...parsed.options, noEmit: true });
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(file);
    const counts: Record<string, number> = {};
    sourceFile?.statements.forEach((statement) => {
      if (!ts.isTypeAliasDeclaration(statement)) return;
      const type = checker.getTypeAtLocation(statement.name);
      const index = Number(statement.name.text.slice(1));
      counts[names[index] ?? statement.name.text] = type.isUnion() ? type.types.length : 1;
    });
    return counts;
  }

  /**
   * The previous baseline (`empty`) from the CSV record, for the growth line.
   *
   * @returns The check and total time, or `undefined` when nothing is recorded.
   */
  static previousBaseline(): { readonly checkS: number; readonly totalS: number } | undefined {
    if (!existsSync(RECORD)) return undefined;
    const last = readFileSync(RECORD, "utf8").trim().split("\n").slice(1).at(-1);
    if (last === undefined) return undefined;
    const [, , check, total] = last.split(",");
    return { checkS: Number(check), totalS: Number(total) };
  }

  /**
   * The growth of a number against the previous run.
   *
   * @param now - The current value.
   * @param before - The previous value.
   * @returns A text with the percentage, or `no previous run`.
   */
  static growth(now: number, before: number | undefined): string {
    return before === undefined || !Number.isFinite(before) || before === 0
      ? "no previous run"
      : `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}% (was ${before} s)`;
  }

  /**
   * The ADDITIONAL measurement "as the user sees it" — `@venloc/typemo` built to `.d.ts`
   * (a temp dir, the package's own tsconfig, declarations only) and the scenarios `empty` and `all` compiled
   * against the built declarations instead of the sources: with `skipLibCheck: true` (the repository's and most
   * users' setting: the library's `.d.ts` are not checked) and with `skipLibCheck: false` (they are). Comparison
   * only, never a gate. `TYPEMO_BUDGET_DTS=0` skips it.
   *
   * @param sources - The measurements against the sources, for the comparison rows.
   */
  static async measureDts(sources: readonly Row[]): Promise<void> {
    if (process.env.TYPEMO_BUDGET_DTS === "0") return;
    const buildConfig = join(BudgetRunner.tmp, "tsconfig.dts-build.json");
    writeFileSync(
      buildConfig,
      `${JSON.stringify(
        {
          extends: resolve(ROOT, "packages/typemo/tsconfig.json"),
          compilerOptions: {
            composite: false,
            incremental: false,
            tsBuildInfoFile: null,
            declaration: true,
            emitDeclarationOnly: true,
            declarationMap: false,
            sourceMap: false,
            rootDir: resolve(ROOT, "packages/typemo/src"),
            typeRoots: [resolve(ROOT, "node_modules/@types")],
            outDir: BudgetRunner.dtsDir,
          },
          include: [resolve(ROOT, "packages/typemo/src")],
          exclude: [resolve(ROOT, "packages/typemo/src/**/*.test.ts")],
        },
        null,
        2,
      )}\n`,
    );
    const started = performance.now();
    const build = Bun.spawnSync(["bunx", "tsc", "-p", buildConfig], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) {
      console.log(`\n.d.ts measurement: the build failed\n${build.stdout.toString()}${build.stderr.toString()}`);
      return;
    }
    const buildS = BudgetRunner.round((performance.now() - started) / 1000);
    const variants: readonly DtsVariant[] = [
      { name: "dts", skipLibCheck: true },
      { name: "dts-libcheck", skipLibCheck: false },
    ];
    const results = new Map<string, Row[]>();
    for (const variant of variants) {
      results.set(variant.name, [
        await BudgetRunner.measure("empty", variant),
        await BudgetRunner.measure("all", variant),
      ]);
    }
    const line = (label: string, rows: readonly Row[]) => {
      const [empty, all] = rows;
      if (empty === undefined || all === undefined) return;
      const errors = [...empty.errors, ...all.errors];
      console.log(
        `| ${label} | ${empty.checkS} | ${empty.totalS} | ${all.checkS} | ${all.totalS} | ${BudgetRunner.round(all.totalS - empty.totalS)} | ${all.instantiations.toLocaleString("en-US")} | ${Math.round((all.instantiations - empty.instantiations) / (SCENARIOS.all ?? 1)).toLocaleString("en-US")} | ${all.memoryMB} | ${errors.length === 0 ? "—" : errors.join("; ")} |`,
      );
    };
    console.log(`\n**The .d.ts measurement (L1, comparison only; the declarations built in ${buildS} s):**\n`);
    console.log(
      "| project | empty check s | empty total s | all check s | all total s | all − empty total s | all instantiations | per chain | memory MB | errors |",
    );
    console.log("|---|---|---|---|---|---|---|---|---|---|");
    line(
      "sources (paths → src)",
      sources.filter((row) => row.scenario === "empty" || row.scenario === "all"),
    );
    line(".d.ts, skipLibCheck: true", results.get("dts") ?? []);
    line(".d.ts, skipLibCheck: false", results.get("dts-libcheck") ?? []);
  }

  /**
   * Measures every scenario, prints the tables and checks the budget.
   *
   * @returns The process exit code: `1` when over budget.
   * @throws Error - When the `all` or `empty` scenario is missing.
   */
  static async run(): Promise<number> {
    const rows: Row[] = [];
    console.log("| scenario | check s | total s | instantiations | memory MB | errors |");
    console.log("|---|---|---|---|---|---|");
    for (const scenario of Object.keys(SCENARIOS)) {
      const row = await BudgetRunner.measure(scenario);
      rows.push(row);
      console.log(
        `| ${row.scenario} | ${row.checkS} | ${row.totalS} | ${row.instantiations.toLocaleString("en-US")} | ${row.memoryMB} | ${row.errors.length === 0 ? "—" : row.errors.join("; ")} |`,
      );
    }
    const unions = BudgetRunner.unions();
    console.log("\n| enumerated union | members |\n|---|---|");
    for (const [name, count] of Object.entries(unions)) console.log(`| ${name} | ${count} |`);

    const all = rows.find((row) => row.scenario === "all");
    const empty = rows.find((row) => row.scenario === "empty");
    const failures: string[] = [];
    if (all === undefined || empty === undefined) throw new Error("scenarios all/empty missing");
    const perChain = Math.round((all.instantiations - empty.instantiations) / (SCENARIOS.all ?? 1));
    const overTotal = BudgetRunner.round(all.totalS - empty.totalS);
    const overCheck = BudgetRunner.round(all.checkS - empty.checkS);
    const previous = BudgetRunner.previousBaseline();

    console.log("\n**User code (L1 budget):**");
    console.log(
      `- \`all\` over the baseline: total ${overTotal} s (budget ≤ ${BUDGET.overBaselineS} s), check ${overCheck} s`,
    );
    console.log(
      `- per chain over the baseline: ${perChain.toLocaleString("en-US")} instantiations (budget ≤ ${BUDGET.perChain.toLocaleString("en-US")})`,
    );
    console.log("\n**Baseline self-check of the library (`empty`, information only — report growth):**");
    console.log(`- check ${empty.checkS} s: ${BudgetRunner.growth(empty.checkS, previous?.checkS)}`);
    console.log(`- total ${empty.totalS} s: ${BudgetRunner.growth(empty.totalS, previous?.totalS)}`);

    if (all.instantiations > BUDGET.instantiations)
      failures.push(`instantiations ${all.instantiations} > ${BUDGET.instantiations}`);
    if (perChain > BUDGET.perChain) failures.push(`per chain ${perChain} > ${BUDGET.perChain}`);
    if (overTotal > BUDGET.overBaselineS)
      failures.push(`all over the baseline ${overTotal} s > ${BUDGET.overBaselineS} s`);
    if (all.memoryMB > BUDGET.memoryMB) failures.push(`memory ${all.memoryMB} MB > ${BUDGET.memoryMB} MB`);
    for (const row of rows) if (row.errors.length > 0) failures.push(`${row.scenario}: ${row.errors.join("; ")}`);
    for (const [name, count] of Object.entries(unions))
      if (count > BUDGET.union) failures.push(`${name}: ${count} members`);

    if (process.env.NO_RECORD !== "1") {
      if (!existsSync(RECORD)) writeFileSync(RECORD, RECORD_HEADER);
      const label = process.argv[2] ?? "run";
      appendFileSync(
        RECORD,
        `${new Date().toISOString()},${label},${empty.checkS},${empty.totalS},${all.checkS},${all.totalS},${overTotal},${overCheck},${all.instantiations},${perChain}\n`,
      );
    }
    await BudgetRunner.measureDts(rows);
    rmSync(BudgetRunner.tmp, { recursive: true, force: true });
    rmSync(BudgetRunner.dtsDir, { recursive: true, force: true });
    if (failures.length > 0) {
      console.error(`\nOVER BUDGET (E10/L1):\n- ${failures.join("\n- ")}`);
      return 1;
    }
    console.log("\nwithin budget (E10/L1)");
    return 0;
  }
}

process.exit(await BudgetRunner.run());
