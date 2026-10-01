/* Tests `ExplainHelpers`: index scan versus collection scan assertions on a real server. */
import { expect, test } from "bun:test";
import { MongoLifecycle } from "../../src/db/lifecycle.ts";
import { ExplainHelpers } from "../../src/explain/explain-helpers.ts";

/* See db/lifecycle.test.ts for why `db`/`client` aren't destructured here. */
const mongo = MongoLifecycle.useMongo("explain_demo");

test("expectIndexScan passes when the server actually used the index", async () => {
  const collection = mongo.db.collection("indexed");
  await collection.createIndex({ email: 1 });
  await collection.insertMany([{ email: "a@test" }, { email: "b@test" }]);

  await ExplainHelpers.expectIndexScan(collection, { email: "a@test" }, "email_1");
});

test("expectIndexScan throws with a readable message when the plan used COLLSCAN instead", async () => {
  const collection = mongo.db.collection("unindexed");
  await collection.insertMany([{ n: 1 }, { n: 2 }]);

  await expect(ExplainHelpers.expectIndexScan(collection, { n: 1 })).rejects.toThrow(/IXSCAN/);
});

test("expectCollScan passes for a query with no supporting index", async () => {
  const collection = mongo.db.collection("unindexed2");
  await collection.insertMany([{ n: 1 }, { n: 2 }]);

  await ExplainHelpers.expectCollScan(collection, { n: 1 });
});
