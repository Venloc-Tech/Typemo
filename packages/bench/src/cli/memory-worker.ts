/*
 * Separate process for one memory measurement (memory scenarios run in their own process, so one contestant's
 * garbage never counts for another). Prints one JSON line (MemoryWorkerReport) as the LAST stdout line.
 *
 * Usage: `bun run src/cli/memory-worker.ts --scenario <id> --size <S|M|…> --contestant <id> [--profile <name>]`
 */
import { BenchContext, ConnectionDefaults } from "../adapters/bench-context.ts";
import { Datasets } from "../data/datasets.ts";
import { Profiles } from "../harness/profiles.ts";
import { ScenarioRegistry } from "../harness/registry.ts";
import { type MemoryWorkerReport, VERIFY_ITERATION } from "../harness/runner.ts";
import { type ContestantId, SIZE_COUNTS, type SizeName } from "../harness/types.ts";
import { Args } from "./args.ts";

/** Measures the memory cost of one contestant's operation. */
class MemoryWorker {
  /** The result of the measured operation, kept alive while the retained heap is measured. */
  static held: unknown;

  /**
   * The heap in use.
   *
   * @returns Bytes.
   */
  static heap(): number {
    return process.memoryUsage().heapUsed;
  }

  /**
   * Runs the measurement described by the command line.
   *
   * @returns The report to print.
   */
  static async main(): Promise<MemoryWorkerReport> {
    const args = new Args(process.argv.slice(2));
    const id = args.get("scenario");
    const size = (args.get("size") ?? "S") as SizeName;
    const contestant = args.get("contestant") as ContestantId | undefined;
    const profile = Profiles.get(args.get("profile") ?? "standard");
    if (id === undefined || contestant === undefined)
      return { ok: false, error: "usage: --scenario --size --contestant" };
    const scenario = (await ScenarioRegistry.load()).find((s) => s.id === id);
    if (scenario === undefined) return { ok: false, error: `unknown scenario ${id}` };

    const ctx = await BenchContext.open(ConnectionDefaults.settings());
    try {
      const env = {
        ctx,
        size,
        count: SIZE_COUNTS[size],
        datasets: new Datasets(ctx),
        profile: profile.name,
        state: new Map(),
      };
      await scenario.prepare(env);
      const impl = await scenario.build(contestant, env);
      await impl.setup?.();
      /* No warm run: JSC scans the stack conservatively, so a warm run's result can survive into the baseline
         and cancel the measurement (retained ≈ 0 for 100k documents was observed). One-time costs of the first run
         (model compilation, lazily built layers) are KB-sized next to the MB-sized results measured here. */
      await impl.before?.(VERIFY_ITERATION);
      Bun.gc(true);
      Bun.gc(true);
      const heapBefore = MemoryWorker.heap();
      const rssBefore = process.memoryUsage.rss();
      let rssPeak = rssBefore;
      const sampler = setInterval(() => {
        rssPeak = Math.max(rssPeak, process.memoryUsage.rss());
      }, 2);
      const t0 = Bun.nanoseconds();
      MemoryWorker.held = await impl.run(VERIFY_ITERATION);
      const timeMs = (Bun.nanoseconds() - t0) / 1e6;
      clearInterval(sampler);
      rssPeak = Math.max(rssPeak, process.memoryUsage.rss());
      const heapAfter = MemoryWorker.heap();
      Bun.gc(true);
      Bun.gc(true);
      const retained = MemoryWorker.heap() - heapBefore;
      const outcome = await impl.verify(MemoryWorker.held, VERIFY_ITERATION);
      MemoryWorker.held = undefined;
      await impl.teardown?.();
      return {
        ok: true,
        timeMs,
        outcome,
        memory: { heapDelta: heapAfter - heapBefore, rssDelta: rssPeak - rssBefore, retained, rssPeak },
      };
    } finally {
      await ctx.close();
    }
  }
}

MemoryWorker.main()
  .catch(
    (error: unknown): MemoryWorkerReport => ({
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }),
  )
  .then((report) => {
    process.stdout.write(`\n${JSON.stringify(report)}\n`);
    process.exit(0);
  });
