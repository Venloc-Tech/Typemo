/* Tests `DuplicateKeyScenario`: a deterministic, real duplicate-key error. */
import { expect, test } from "bun:test";
import { MongoLifecycle } from "../../src/db/lifecycle.ts";
import { DuplicateKeyScenario } from "../../src/failpoints/duplicate-key.ts";

/* See db/lifecycle.test.ts for why `db`/`client` aren't destructured here. */
const mongo = MongoLifecycle.useMongo("duplicate_key_demo");

test("triggers a real duplicate-key error via the default _id unique index", async () => {
  const collection = mongo.db.collection("dupes");
  const error = await DuplicateKeyScenario.trigger(collection, { _id: "fixed-id", name: "a" });

  expect(error.code).toBe(11000);
  expect(await collection.countDocuments()).toBe(1);
});

test("triggers a duplicate-key error via a user-defined unique index", async () => {
  const collection = mongo.db.collection("dupes2");
  await collection.createIndex({ email: 1 }, { unique: true });

  const error = await DuplicateKeyScenario.trigger(collection, { email: "a@test" });

  expect(error.code).toBe(11000);
  expect(error.message).toContain("email");
});
