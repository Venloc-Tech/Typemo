/* Tests `DbSnapshot`: canonical, order-independent capture and diff of collections. */
import { expect, test } from "bun:test";
import { DbSnapshot } from "../../src/db/db-snapshot.ts";
import { MongoLifecycle } from "../../src/db/lifecycle.ts";

/* See db/lifecycle.test.ts for why `db`/`client` aren't destructured here. */
const mongo = MongoLifecycle.useMongo("db_snapshot_demo");

test("captures a canonical, order-independent snapshot of a collection", async () => {
  const { db } = mongo;
  const collection = db.collection<{ _id: number; n: number }>("docs");
  /* Explicit `_id`s: insertMany would otherwise generate a fresh ObjectId
     per document, and the two rounds below would never compare equal. */
  await collection.insertMany([
    { _id: 2, n: 2 },
    { _id: 1, n: 1 },
    { _id: 3, n: 3 },
  ]);

  const snapshotA = await DbSnapshot.capture(db, ["docs"]);

  /* Same documents, different insertion/scan order — snapshot must agree. */
  await collection.deleteMany({});
  await collection.insertMany([
    { _id: 3, n: 3 },
    { _id: 1, n: 1 },
    { _id: 2, n: 2 },
  ]);
  const snapshotB = await DbSnapshot.capture(db, ["docs"]);

  expect(snapshotA.documentsOf("docs").length).toBe(3);
  expect(DbSnapshot.diff(snapshotA, snapshotB).equal).toBe(true);
});

test("diff reports documents present on only one side", async () => {
  const { db } = mongo;
  const collection = db.collection("docs2");
  await collection.insertMany([{ n: 1 }, { n: 2 }]);
  const before = await DbSnapshot.capture(db, ["docs2"]);

  await collection.insertOne({ n: 3 });
  const after = await DbSnapshot.capture(db, ["docs2"]);

  const diff = DbSnapshot.diff(before, after);
  expect(diff.equal).toBe(false);
  expect(diff.onlyInLeft).toEqual([]);
  expect(diff.onlyInRight.length).toBe(1);
  expect(diff.onlyInRight[0]).toContain("docs2:");
});

test("uses canonical EJSON so BSON-typed values compare correctly", async () => {
  const { db } = mongo;
  const { Decimal128 } = await import("bson");
  const collection = db.collection("decimals");
  await collection.insertOne({ price: Decimal128.fromString("19.99") });
  const snapshot = await DbSnapshot.capture(db, ["decimals"]);
  const [doc] = snapshot.documentsOf("decimals");
  expect(doc).toContain("19.99");
  expect(doc).toContain('"$numberDecimal"');
});
