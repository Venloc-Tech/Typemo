/*
 * Benchmark CLI: runs the scenarios of the selected profiles, saves the results, compares them with a baseline
 * and writes the Markdown report.
 *
 * Usage: bun run bench --profile quick|standard|full|heavy[,…] [--suite C,I] [--size S,M]
 *   [--contestants driver,typemo] [--filter C.find] [--no-commands] [--baseline results/x.json]
 *   [--report | --no-report] [--report-only results/a.json,results/b.json] [--list] [--seed 42]
 */
import { BenchContext, ConnectionDefaults } from "../adapters/bench-context.ts";
import { EnvironmentCapture } from "../harness/environment.ts";
import { MongoSetup } from "../harness/mongo-setup.ts";
import { Profiles } from "../harness/profiles.ts";
import { ScenarioRegistry } from "../harness/registry.ts";
import { BenchRunner } from "../harness/runner.ts";
import type { RunResult } from "../harness/types.ts";
import { MarkdownReport } from "../report/markdown-report.ts";
import { RegressionComparator, type RegressionReport } from "../report/regression.ts";
import { ResultStore } from "../report/result-store.ts";
import { Args } from "./args.ts";

/** The command-line entry point of the benchmark. */
class BenchCli {
  /**
   * Writes a progress line to stderr.
   *
   * @param line - The line, without a newline.
   */
  static log(line: string): void {
    process.stderr.write(`${line}\n`);
  }

  /**
   * Runs the CLI.
   *
   * @param argv - The command-line arguments.
   * @returns The process exit code: `0` when every scenario is ok.
   */
  static async main(argv: readonly string[]): Promise<number> {
    const args = new Args(argv);
    const reportOnly = args.list("report-only");
    if (reportOnly !== undefined) {
      const runs = ResultStore.mergeByProfile(await Promise.all(reportOnly.map((f) => ResultStore.load(f))));
      const baseline = args.get("baseline");
      const last = runs.at(-1);
      const regression =
        baseline !== undefined && last !== undefined
          ? RegressionComparator.compare(await ResultStore.load(baseline), last)
          : undefined;
      BenchCli.log(`report → ${await MarkdownReport.write(runs, MarkdownReport.DEFAULT_FILE, regression)}`);
      return 0;
    }

    const profiles = (args.list("profile") ?? ["quick"]).map(Profiles.get);
    const scenarios = await ScenarioRegistry.load();
    const filtered = ["suite", "size", "contestants", "filter"].some((k) => args.has(k));

    if (args.has("list")) {
      for (const profile of profiles) {
        const runner = new BenchRunner(
          { profile, commands: false, seed: 1, log: BenchCli.log, ...BenchCli.filters(args) },
          undefined as unknown as BenchContext,
          undefined,
        );
        const plan = runner.plan(scenarios);
        BenchCli.log(`${profile.name}: ${plan.length} scenario×size runs`);
        for (const p of plan) BenchCli.log(`  ${p.scenario.id} ${p.size} ${p.scenario.kind}`);
      }
      return 0;
    }

    const settings = ConnectionDefaults.settings();
    const mongoVersion = await MongoSetup.ensureReplicaSet(settings.uri);
    BenchCli.log(`MongoDB ${mongoVersion} at ${settings.uri}`);
    const timing = await BenchContext.open(settings);
    const commands = !args.has("no-commands");
    const monitored = commands ? await BenchContext.open({ ...settings, monitorCommands: true }) : undefined;
    const runs: RunResult[] = [];
    let failed = 0;
    try {
      await EnvironmentCapture.assertPinnedDriver(timing);
      const environment = await EnvironmentCapture.capture(timing);
      BenchCli.log(
        `driver ${environment.driver} (Mongoose uses ${environment.mongooseDriver}), Mongoose ${environment.mongoose}, Bun ${environment.bun}`,
      );
      for (const profile of profiles) {
        const seed = Number(args.get("seed") ?? 20260927);
        const runner = new BenchRunner(
          { profile, commands, seed, log: BenchCli.log, ...BenchCli.filters(args) },
          timing,
          monitored,
        );
        const plan = runner.plan(scenarios);
        BenchCli.log(
          `== profile ${profile.name}: ${plan.length} scenario×size runs (budget ~${profile.budgetMinutes} min)`,
        );
        const startedAt = new Date();
        const results = await runner.run(plan);
        const durationMs = Date.now() - startedAt.getTime();
        const draft: RunResult = {
          version: 1,
          profile: profile.name,
          environment,
          settings: {
            policy: profile.policy,
            filters: BenchCli.filters(args),
            maxPoolSize: settings.maxPoolSize,
            writeConcern: settings.writeConcern,
            commandsPass: commands,
            seed,
            file: "",
          },
          startedAt: startedAt.toISOString(),
          durationMs,
          scenarios: results,
        };
        const run: RunResult = { ...draft, settings: { ...draft.settings, file: ResultStore.fileName(draft) } };
        const file = await ResultStore.save(run);
        runs.push(run);
        failed += results.filter((r) => r.status !== "ok").length;
        BenchCli.log(`== ${profile.name} done in ${(durationMs / 60_000).toFixed(1)} min → ${file}`);
      }
    } finally {
      await timing.close();
      await monitored?.close();
    }

    let regression: RegressionReport | undefined;
    const last = runs.at(-1);
    if (last !== undefined) {
      const baselineFile =
        args.get("baseline") ??
        (await ResultStore.latest(last.profile, `${ResultStore.DIR}/${ResultStore.fileName(last)}`));
      if (baselineFile !== undefined && !baselineFile.endsWith(ResultStore.fileName(last))) {
        regression = RegressionComparator.compare(await ResultStore.load(baselineFile), last);
        BenchCli.log(`baseline ${baselineFile}\n${RegressionComparator.format(regression)}`);
      }
    }
    if ((args.has("report") || !filtered) && !args.has("no-report") && runs.length > 0) {
      BenchCli.log(`report → ${await MarkdownReport.write(runs, MarkdownReport.DEFAULT_FILE, regression)}`);
    }
    BenchCli.log(failed === 0 ? "all scenarios ok" : `${failed} scenario runs not ok (see report)`);
    return failed === 0 ? 0 : 1;
  }

  /**
   * The runner filters given on the command line.
   *
   * @param args - The parsed arguments.
   * @returns An object with only the filters that were given.
   */
  static filters(args: Args) {
    const groups = args.groups();
    const sizes = args.sizes();
    const contestants = args.contestants();
    const filter = args.get("filter");
    return {
      ...(groups !== undefined ? { groups } : {}),
      ...(sizes !== undefined ? { sizes } : {}),
      ...(contestants !== undefined ? { contestants } : {}),
      ...(filter !== undefined ? { filter } : {}),
    };
  }
}

process.exitCode = await BenchCli.main(process.argv.slice(2));
