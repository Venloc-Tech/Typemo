/* Tests `MongoLifecycle.useMongo`: a unique database per file, cleared after every test. */
import { expect, test } from "bun:test";
import { MongoLifecycle } from "../../src/db/lifecycle.ts";
import { MongoHarness } from "../../src/db/mongo-harness.ts";

/*
 * NOTE: don't destructure `client`/`db` here — they are getters backed by
 * values `beforeAll` fills in, and destructuring at module scope would call
 * the getter immediately, before `beforeAll` has run. Access `mongo.client`
 * / `mongo.db` from inside a test or hook instead. `dbName` is a plain,
 * already-known value, so it's safe to read eagerly.
 */
const mongo = MongoLifecycle.useMongo("lifecycle_demo");
const dbName = mongo.dbName;

test("connects to a database unique to this file, against the shared mongod", () => {
  expect(dbName).toStartWith("lifecycle_demo_");
  expect(mongo.db.databaseName).toBe(dbName);
  expect(mongo.client.db(dbName).databaseName).toBe(dbName);
});

test("MongoHarness reports which channel and version it actually started", () => {
  const status = MongoHarness.getStatus();
  expect(["upcoming", "stable"]).toContain(status.channel);
  expect(status.resolvedVersion.length).toBeGreaterThan(0);
  /* fellBackToStable is only true when the upcoming channel was requested but failed to start. */
  if (status.fellBackToStable) {
    expect(status.channel).toBe("upcoming");
  }
});

test("write in one test is visible within the same test", async () => {
  await mongo.db.collection("items").insertOne({ label: "a" });
  const count = await mongo.db.collection("items").countDocuments();
  expect(count).toBe(1);
});

test("afterEach cleared the collection written by the previous test", async () => {
  const count = await mongo.db.collection("items").countDocuments();
  expect(count).toBe(0);
});
