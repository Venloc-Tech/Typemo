/*
 * A smoke runner (not the harness): runs every scenario of the given scenario modules once per contestant
 * at size T, verifies and compares the outcomes, prints one line per scenario. Used to smoke-check groups
 * I–R before the harness CLI runs them.
 *
 * Usage (from packages/bench):
 *   bun run src/scenarios/support-bb/bb-smoke.ts i-populate [j-aggregate …] [--filter <id part>] [--size S]
 */
import { BenchContext, ConnectionDefaults } from "../../adapters/bench-context.ts";
import type { Scenario, ScenarioEnv } from "../../harness/scenario.ts";
import type { Outcome, SizeName } from "../../harness/types.ts";

/** The command-line arguments. */
const args = process.argv.slice(2);
/**
 * The value of a `--name value` option.
 *
 * @param name - The option, with dashes.
 * @returns The value, or `undefined` when the option is absent.
 */
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
/** Only scenarios whose id contains this text. */
const filter = flag("--filter");
/** The dataset size. */
const size = (flag("--size") ?? "T") as SizeName;
/** Only these contestants. */
const only = flag("--contestants")?.split(",");
/** The scenario modules to run. */
const modules = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));

/** The contestants' connections. */
const ctx = await BenchContext.open(ConnectionDefaults.settings({ dbPrefix: "typemo_bench_bbsmoke" }));
/** How many scenarios failed. */
let failed = 0;
try {
  for (const name of modules) {
    const mod = (await import(`../${name}.ts`)) as { SCENARIOS: readonly Scenario[] };
    for (const scenario of mod.SCENARIOS) {
      if (filter !== undefined && !scenario.id.includes(filter)) continue;
      const env: ScenarioEnv = {
        ctx,
        size,
        count: 0,
        datasets: undefined as never,
        profile: "quick",
        state: new Map(),
      };
      const started = performance.now();
      const outcomes = new Map<string, Outcome>();
      const problems: string[] = [];
      try {
        await scenario.prepare(env);
        for (const contestant of scenario.contestants) {
          if (only !== undefined && !only.includes(contestant)) continue;
          try {
            const impl = await scenario.build(contestant, env);
            await impl.setup?.();
            let result: unknown;
            const t0 = performance.now();
            for (let i = 0; i < 2; i++) {
              await impl.before?.(i);
              result = await impl.run(i);
            }
            const ms = (performance.now() - t0) / 2;
            const outcome = await impl.verify(result, 1);
            if (process.env.BB_SHOW !== undefined)
              console.log(`  ${contestant}: ${JSON.stringify(result)?.slice(0, 240)}`);
            await impl.teardown?.();
            outcomes.set(contestant, outcome);
            problems.push(
              `${contestant} ${ms.toFixed(1)}ms${outcome.metrics === undefined ? "" : ` ${JSON.stringify(outcome.metrics)}`}`,
            );
          } catch (error) {
            problems.push(`${contestant} ERROR ${(error as Error).stack ?? String(error)}`);
            failed++;
          }
        }
        await scenario.cleanup(env);
      } catch (error) {
        problems.push(`prepare/cleanup ERROR ${(error as Error).stack ?? String(error)}`);
        failed++;
      }
      const values = [...outcomes.entries()];
      const base = values[0]?.[1];
      const mismatch = values.filter(
        ([, o]) =>
          base !== undefined && (o.count !== base.count || o.checksum !== base.checksum || o.state !== base.state),
      );
      if (mismatch.length > 0) failed++;
      const verdict = mismatch.length > 0 ? `MISMATCH ${JSON.stringify(Object.fromEntries(values))}` : "ok";
      console.log(
        `${scenario.id} [${size}] ${verdict} (${(performance.now() - started).toFixed(0)}ms) count=${base?.count} :: ${problems.join(" | ")}`,
      );
    }
  }
} finally {
  await ctx.close();
}
console.log(failed === 0 ? "SMOKE OK" : `SMOKE FAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
