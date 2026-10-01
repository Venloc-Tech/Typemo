/*
 * Can several operations run CONCURRENTLY in ONE session / ONE transaction
 * with driver 7.6 on the real server? Runs each scenario many times and counts outcomes.
 *
 * Usage (from packages/typemo): `bun run test/experiments/i3-session-concurrency.ts` (upcoming) and
 *        `TYPEMO_MONGO=stable bun run test/experiments/i3-session-concurrency.ts`.
 * Env: RUNS (default 30), WIDTH (parallel operations per scenario, default 8).
 */

import { MongoHarness } from "@venloc/typemo-test-kit";
import { type ClientSession, type Collection, type Document, MongoClient, ObjectId } from "mongodb";

const RUNS = Number(process.env.RUNS ?? 30);
const WIDTH = Number(process.env.WIDTH ?? 8);

type Outcome = { ok: number; errors: Map<string, number>; wrong: number };

class Experiment {
  static describe(error: unknown): string {
    const e = error as { code?: number; codeName?: string; message?: string; errorLabels?: string[] };
    const labels = e.errorLabels?.length ? ` [${e.errorLabels.join(",")}]` : "";
    return `${e.code ?? "-"} ${e.codeName ?? (error as Error).constructor?.name}: ${String(e.message).slice(0, 110)}${labels}`;
  }

  static async run(
    name: string,
    client: MongoClient,
    body: (session: ClientSession) => Promise<boolean>,
    transaction: boolean,
  ): Promise<void> {
    const outcome: Outcome = { ok: 0, errors: new Map(), wrong: 0 };
    for (let run = 0; run < RUNS; run++) {
      const session = client.startSession();
      try {
        let correct = true;
        if (transaction) {
          // Raw start/commit (no withTransaction retry) so every failure is visible.
          session.startTransaction();
          correct = await body(session);
          await session.commitTransaction();
        } else {
          correct = await body(session);
        }
        if (correct) outcome.ok++;
        else outcome.wrong++;
      } catch (error) {
        const key = Experiment.describe(error);
        outcome.errors.set(key, (outcome.errors.get(key) ?? 0) + 1);
        if (session.inTransaction()) await session.abortTransaction().catch(() => undefined);
      } finally {
        await session.endSession();
      }
    }
    const errors = [...outcome.errors].map(([key, count]) => `      ${count}× ${key}`).join("\n");
    console.log(
      `${transaction ? "txn " : "sess"} | ${name.padEnd(46)} | ok ${String(outcome.ok).padStart(3)} | wrong ${String(outcome.wrong).padStart(3)} | errors ${String(RUNS - outcome.ok - outcome.wrong).padStart(3)}${errors ? `\n${errors}` : ""}`,
    );
  }
}

await MongoHarness.ensureStarted();
const status = MongoHarness.getStatus();
const client = new MongoClient(MongoHarness.getUri());
await client.connect();
const db = client.db(`i3_${Date.now()}`);
const items: Collection<Document> = db.collection("items");
await db.createCollection("items");
await db.createCollection("other");
const other = db.collection("other");
console.log(
  `server ${status.resolvedVersion}, driver ${(await import("mongodb/package.json")).version}, runs ${RUNS}, width ${WIDTH}\n`,
);

const seed = async (): Promise<ObjectId[]> => {
  await items.deleteMany({});
  const ids = Array.from({ length: WIDTH }, () => new ObjectId());
  await items.insertMany(ids.map((_id, n) => ({ _id, n, v: 0 })));
  await other.deleteMany({});
  await other.insertMany(ids.map((_id) => ({ _id, ref: _id })));
  return ids;
};

const range = Array.from({ length: WIDTH }, (_, n) => n);

for (const transaction of [true, false]) {
  await Experiment.run(
    "Promise.all insertOne (first op concurrent)",
    client,
    async (session) => {
      await items.deleteMany({});
      const base = await items.countDocuments({}, transaction ? {} : { session });
      await Promise.all(range.map((n) => items.insertOne({ n }, { session })));
      return (await items.countDocuments({}, { session })) === base + WIDTH;
    },
    transaction,
  );
  await Experiment.run(
    "one op, then Promise.all insertOne",
    client,
    async (session) => {
      await items.deleteMany({});
      await items.insertOne({ n: -1 }, { session });
      await Promise.all(range.map((n) => items.insertOne({ n }, { session })));
      return (await items.countDocuments({}, { session })) === WIDTH + 1;
    },
    transaction,
  );
  await Experiment.run(
    "Promise.all find (first op concurrent)",
    client,
    async (session) => {
      const ids = await seed();
      const found = await Promise.all(ids.map((_id) => items.findOne({ _id }, { session })));
      return found.every((doc, n) => doc?.n === n);
    },
    transaction,
  );
  await Experiment.run(
    "one op, then Promise.all updateOne (distinct docs)",
    client,
    async (session) => {
      const ids = await seed();
      await items.findOne({}, { session });
      await Promise.all(ids.map((_id) => items.updateOne({ _id }, { $inc: { v: 1 } }, { session })));
      const docs = await items.find({}, { session }).toArray();
      return docs.every((doc) => doc.v === 1);
    },
    transaction,
  );
  await Experiment.run(
    "one op, then Promise.all $inc on the SAME doc",
    client,
    async (session) => {
      const ids = await seed();
      await items.findOne({}, { session });
      await Promise.all(range.map(() => items.updateOne({ _id: ids[0] as ObjectId }, { $inc: { v: 1 } }, { session })));
      return (await items.findOne({ _id: ids[0] as ObjectId }, { session }))?.v === WIDTH;
    },
    transaction,
  );
  await Experiment.run(
    "populate-like fan-out (find, then Promise.all by ref)",
    client,
    async (session) => {
      await seed();
      const refs = await other.find({}, { session }).toArray();
      const found = await Promise.all(refs.map((ref) => items.findOne({ _id: ref.ref }, { session })));
      return found.every((doc) => doc !== null);
    },
    transaction,
  );
  await Experiment.run(
    "one op, then Promise.all mixed insert/find/update/count",
    client,
    async (session) => {
      const ids = await seed();
      await items.findOne({}, { session });
      await Promise.all([
        items.insertOne({ n: 100 }, { session }),
        items.find({ n: { $lt: 3 } }, { session }).toArray(),
        items.updateOne({ _id: ids[1] as ObjectId }, { $set: { v: 5 } }, { session }),
        items.countDocuments({}, { session }),
        other.insertOne({ x: 1 }, { session }),
        items.findOneAndUpdate({ _id: ids[2] as ObjectId }, { $inc: { v: 1 } }, { session }),
      ]);
      return (await items.countDocuments({}, { session })) === WIDTH + 1;
    },
    transaction,
  );
  await Experiment.run(
    "cursor getMore interleaved with other ops",
    client,
    async (session) => {
      await seed();
      await items.findOne({}, { session });
      const cursor = items.find({}, { session, batchSize: 1 });
      const read = (async () => {
        let count = 0;
        for await (const _ of cursor) count++;
        return count;
      })();
      const writes = Promise.all(range.map((n) => other.insertOne({ n }, { session })));
      const [count] = await Promise.all([read, writes]);
      return count === WIDTH;
    },
    transaction,
  );
  console.log("");
}

await db.dropDatabase();
await client.close();
await MongoHarness.stop();
