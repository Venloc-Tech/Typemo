/*
 * Profiling workloads for slow spots of the heavier scenarios (Typemo side only; the same operations as the
 * scenarios, in a loop long enough for a CPU profile). Usage, from packages/bench:
 *   bun --cpu-prof --cpu-prof-dir=<dir> src/scenarios/support-bb/bb-profile.ts <case>
 *   bun run src/scenarios/support-bb/bb-profile-top.ts <dir>/<file>.cpuprofile   # self time by function
 * Cases: splice | delta | hydrate | build | set. `hydrate` needs the benchmark server (BENCH_MONGO_URI).
 */
import { TypemoClient } from "@venloc/typemo";
import { ConnectionDefaults } from "../../adapters/bench-context.ts";
import { JLong } from "../j-aggregate.ts";
import { YcsbTable, YcsbUser } from "../o-load.ts";
import { MBag, MRaw } from "./collection-models.ts";

/** The case to run. */
const which = process.argv[2] ?? "splice";
/** The Typemo client the cases use. */
const client = new TypemoClient(ConnectionDefaults.uri(), { dbName: "typemo_bench_bbprofile" });
/** Start time. */
const started = performance.now();
/** Consumes results so the work is not optimized away. */
let sink = 0;

/** The profiling cases by name. */
const cases: Readonly<Record<string, () => Promise<void> | void>> = {
  /** M.array.splice: splice(pos, 1, v) on a 1e6-element StrictArray. */
  splice: () => {
    const doc = client.connection.model(MBag).hydrate(MRaw.bag(1_000_000));
    for (let k = 0; k < 200; k++) doc.nums.splice((k * 997) % 1_000_000, 1, -k);
    sink += doc.nums.length;
  },
  /** M.array.set: set(i, v) over 1e6 elements. */
  set: () => {
    const doc = client.connection.model(MBag).hydrate(MRaw.bag(1_000_000));
    for (let r = 0; r < 5; r++) for (let i = 0; i < 1_000_000; i++) doc.nums.set(i, i + r + 1);
    sink += doc.nums.length;
  },
  /** M.delta.subdocs.1: $getChanges() after one change in 10k subdocuments. */
  delta: () => {
    const doc = client.connection.model(MBag).hydrate(MRaw.bag(0, 10_000));
    const row = doc.rows[7];
    if (row !== undefined) row.lines = -1;
    for (let r = 0; r < 500; r++) sink += Object.keys(doc.$getChanges()).length;
  },
  /** O.ycsb.E: hydrated scans of 100 usertable rows (needs the server). */
  hydrate: async () => {
    await client.connect();
    await YcsbTable.seed(client.unsafeDriver().db("typemo_bench_bbprofile"), 10_000);
    const Users = client.connection.model(YcsbUser);
    for (let r = 0; r < 300; r++) sink += (await Users.find({}).limit(100)).length;
  },
  /** J.build.pipeline15: building the typed 15-stage pipeline. */
  build: () => {
    for (let r = 0; r < 20_000; r++) sink += JLong.typed().plan().pipeline.length;
  },
};

const work = cases[which];
if (work === undefined) throw new Error(`unknown case "${which}" (${Object.keys(cases).join(", ")})`);
await work();
await client.close();
console.log(`${which}: ${(performance.now() - started).toFixed(0)} ms (sink ${sink})`);
