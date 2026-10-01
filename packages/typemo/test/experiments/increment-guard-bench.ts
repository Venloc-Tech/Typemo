/*
 * The cost of the range guard of `$inc`/`$mul` (a field with `min`/`max`) on the real
 * server. Each case runs OPS sequential operations (after a warm-up) and prints the median per operation
 * in microseconds and the round trips it sends (counted by the command recorder).
 *
 * Usage (from packages/typemo): `bun run test/experiments/increment-guard-bench.ts`
 *        (`TYPEMO_MONGO=stable` for the stable server). Env: OPS (default 400), RUNS (default 5), DOCS (default 200).
 */
import "reflect-metadata";
import { CommandRecorder, MongoHarness } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import { BsonOptions, Entity, Prop, Schema, TypemoClient } from "../../src/index.ts";

@Schema({ collection: "k5_accounts" })
class Account extends Entity {
  @Prop(() => Number, { min: 0, max: 1_000_000_000 }) guarded!: number;
  @Prop(() => Number) free!: number;
  @Prop(() => String) group!: string;
}

const OPS = Number(process.env.OPS ?? 400);
const RUNS = Number(process.env.RUNS ?? 5);
const DOCS = Number(process.env.DOCS ?? 200);

await MongoHarness.ensureStarted();
const client = new TypemoClient(MongoHarness.getUri(), {
  ...BsonOptions.apply({}),
  dbName: "k5_bench",
  monitorCommands: true,
});
await client.connect();
const recorder = CommandRecorder.attach(client.unsafeDriver());
const Accounts = client.connection.model(Account);

const seed = async (): Promise<ObjectId[]> => {
  await client.unsafeDriver().db(client.connection.name).collection("k5_accounts").deleteMany({});
  const docs = await Accounts.insertMany(
    Array.from({ length: DOCS }, (_, index) => ({ guarded: 1_000, free: 1_000, group: index < DOCS / 2 ? "a" : "b" })),
  );
  return docs.map((doc) => doc._id);
};

interface Row {
  readonly name: string;
  readonly microseconds: number;
  readonly roundTrips: number;
}

const measure = async (name: string, op: (index: number) => PromiseLike<unknown>): Promise<Row> => {
  for (let index = 0; index < 20; index++) await Promise.resolve(op(index)).catch(() => undefined);
  const samples: number[] = [];
  let roundTrips = 0;
  for (let run = 0; run < RUNS; run++) {
    recorder.clear();
    const started = performance.now();
    for (let index = 0; index < OPS; index++) await Promise.resolve(op(index)).catch(() => undefined);
    samples.push(((performance.now() - started) * 1000) / OPS);
    roundTrips = recorder.all().length / OPS;
  }
  samples.sort((a, b) => a - b);
  return { name, microseconds: samples[Math.floor(samples.length / 2)] ?? Number.NaN, roundTrips };
};

const ids = await seed();
const id = (index: number): ObjectId => ids[index % ids.length] as ObjectId;
const rows: Row[] = [];

rows.push(
  await measure("updateOne $inc, no min/max (baseline)", (i) =>
    Accounts.updateOne({ _id: id(i) }, { $inc: { free: 1 } }),
  ),
);
rows.push(
  await measure("updateOne $inc, guarded, in range", (i) =>
    Accounts.updateOne({ _id: id(i) }, { $inc: { guarded: 1 } }),
  ),
);
rows.push(
  await measure("updateOne $inc, guarded, out of range (ValidationError)", (i) =>
    Accounts.updateOne({ _id: id(i) }, { $inc: { guarded: -10_000_000 } }),
  ),
);
rows.push(
  await measure("updateOne $inc, guarded, no document", () =>
    Accounts.updateOne({ group: "none" }, { $inc: { guarded: 1 } }),
  ),
);
rows.push(
  await measure("findOneAndUpdate $inc, no min/max (baseline)", (i) =>
    Accounts.findOneAndUpdate({ _id: id(i) }, { $inc: { free: 1 } }).lean(),
  ),
);
rows.push(
  await measure("findOneAndUpdate $inc, guarded, in range", (i) =>
    Accounts.findOneAndUpdate({ _id: id(i) }, { $inc: { guarded: 1 } }).lean(),
  ),
);
rows.push(
  await measure("updateMany $inc by _id, no min/max (baseline)", (i) =>
    Accounts.updateMany({ _id: id(i) }, { $inc: { free: 1 } }),
  ),
);
rows.push(
  await measure("updateMany $inc by _id, guarded", (i) =>
    Accounts.updateMany({ _id: id(i) }, { $inc: { guarded: 1 } }),
  ),
);
rows.push(
  await measure(`updateMany $inc of ${DOCS / 2} docs, no min/max (baseline)`, () =>
    Accounts.updateMany({ group: "a" }, { $inc: { free: 1 } }),
  ),
);
rows.push(
  await measure(`updateMany $inc of ${DOCS / 2} docs, guarded`, () =>
    Accounts.updateMany({ group: "a" }, { $inc: { guarded: 1 } }),
  ),
);

console.log(
  `| case (MongoDB ${MongoHarness.getStatus().resolvedVersion}, ${OPS} ops × ${RUNS}, median) | µs / op | round trips / op |`,
);
console.log("|---|---|---|");
for (const row of rows) console.log(`| ${row.name} | ${row.microseconds.toFixed(0)} | ${row.roundTrips.toFixed(2)} |`);

recorder.detach();
await client.close();
await MongoHarness.stop();
