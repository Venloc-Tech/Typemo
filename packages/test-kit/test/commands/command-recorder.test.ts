/* Tests `CommandRecorder`: the exact wire commands, filters and updates a client sends. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { CommandRecorder } from "../../src/commands/command-recorder.ts";
import { MongoLifecycle } from "../../src/db/lifecycle.ts";

/* See db/lifecycle.test.ts for why `db`/`client` aren't destructured here. */
const mongo = MongoLifecycle.useMongo("command_recorder_demo");

/** The recorder attached to the client for the current test. */
let recorder: CommandRecorder;

beforeEach(() => {
  recorder = CommandRecorder.attach(mongo.client);
});

afterEach(() => {
  recorder.detach();
});

test("records the exact commands sent to the server, in order", async () => {
  const collection = mongo.db.collection("widgets");
  await collection.insertOne({ name: "a" });
  await collection.find({ name: "a" }).toArray();

  recorder.expectCommands(["insert", "find"]);
});

test("records the exact filter for a find", async () => {
  const collection = mongo.db.collection("widgets");
  await collection.find({ name: "b", qty: { $gt: 1 } }).toArray();

  const [record] = recorder.byName("find");
  expect(record?.filter).toEqual({ name: "b", qty: { $gt: 1 } });
  expect(record?.collectionName).toBe("widgets");
});

test("records the exact filter and update document for an updateOne", async () => {
  const collection = mongo.db.collection("widgets");
  await collection.insertOne({ name: "c", qty: 1 });
  await collection.updateOne({ name: "c" }, { $set: { qty: 2 } });

  const [record] = recorder.byName("update");
  expect(record?.updates).toEqual([{ filter: { name: "c" }, update: { $set: { qty: 2 } } }]);
});

test("byCollection filters across command types", async () => {
  await mongo.db.collection("a").insertOne({});
  await mongo.db.collection("b").insertOne({});

  expect(recorder.byCollection("a")).toHaveLength(1);
  expect(recorder.byCollection("b")).toHaveLength(1);
});

test("clear() empties the recorded history", async () => {
  await mongo.db.collection("widgets").insertOne({});
  recorder.clear();
  expect(recorder.all()).toHaveLength(0);
});
