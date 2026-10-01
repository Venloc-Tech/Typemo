/*
 * Runs one contestant of one scenario in a loop, for `bun --cpu-prof`, to profile where Typemo is slower.
 *
 * Usage: bun --cpu-prof --cpu-prof-dir=<dir> scripts/profile-op.ts --scenario C.find.all --contestant typemo
 *   --size S --n 200
 */
import { BenchContext, ConnectionDefaults } from "../src/adapters/bench-context.ts";
import { Args } from "../src/cli/args.ts";
import { Datasets } from "../src/data/datasets.ts";
import { ScenarioRegistry } from "../src/harness/registry.ts";
import { type ContestantId, SIZE_COUNTS, type SizeName } from "../src/harness/types.ts";

const args = new Args(process.argv.slice(2));
const id = args.get("scenario") ?? "C.find.all";
const contestant = (args.get("contestant") ?? "typemo") as ContestantId;
const size = (args.get("size") ?? "S") as SizeName;
const n = Number(args.get("n") ?? 200);
const scenario = (await ScenarioRegistry.load()).find((s) => s.id === id);
if (scenario === undefined) throw new Error(`unknown scenario ${id}`);
const ctx = await BenchContext.open(ConnectionDefaults.settings());
const env = {
  ctx,
  size,
  count: SIZE_COUNTS[size],
  datasets: new Datasets(ctx),
  profile: "standard" as const,
  state: new Map(),
};
await scenario.prepare(env);
const impl = await scenario.build(contestant, env);
await impl.setup?.();
for (let i = 0; i < 5; i++) {
  await impl.before?.(i);
  await impl.run(i);
}
const t0 = performance.now();
for (let i = 5; i < n + 5; i++) {
  await impl.before?.(i);
  await impl.run(i);
}
console.log(`${id} ${contestant} ${size}: ${((performance.now() - t0) / n).toFixed(3)} ms/op over ${n}`);
await ctx.close();
