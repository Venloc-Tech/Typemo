/*
 * Model administration on the real server: indexes (create, list, diff, sync with dryRun, every failure
 * collected), createCollection, and the POJO utilities hydrate / castObject / validate.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { CastError, IndexSyncError, type Model, ValidationError } from "../../../src/index.ts";
import { Counter, Person, Pet } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("admin");
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await t.mongo.db
    .collection("m_people")
    .dropIndexes()
    .catch(() => undefined);
});

describe("indexes", () => {
  test("createIndexes / listIndexes / diffIndexes", async () => {
    expect(await People.diffIndexes()).toEqual({ toCreate: ["email_1"], toDrop: [], toModify: [] });
    expect(await People.createIndexes()).toEqual(["email_1"]);
    const names = (await People.listIndexes()).map((index) => index.name);
    expect(names).toEqual(["_id_", "email_1"]);
    expect(await People.diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
  });

  test("syncIndexes: dryRun only reports; a real sync drops the undeclared and recreates the changed", async () => {
    const collection = t.mongo.db.collection("m_people");
    await collection.createIndex({ name: 1 }, { name: "stray" });
    await collection.createIndex({ email: 1 }, { name: "email_1" }); /* not unique: differs from the schema */
    const dry = await People.syncIndexes({ dryRun: true });
    expect(dry).toEqual({ toCreate: ["email_1"], toDrop: ["email_1", "stray"], toModify: [], dryRun: true });
    expect((await People.listIndexes()).map((index) => index.name)).toContain("stray");
    await People.syncIndexes();
    const after = await People.listIndexes();
    expect(after.map((index) => [index.name, index.unique === true])).toEqual([
      ["_id_", false],
      ["email_1", true],
    ]);
  });

  test("a failing index is reported with all failures (IndexSyncError), the rest applied", async () => {
    await t.mongo.db.collection("m_people").insertMany([{ email: "same" }, { email: "same" }]);
    const error = await People.createIndexes().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IndexSyncError);
    const failures = (error as IndexSyncError).failures;
    expect(failures.map((failure) => [failure.name, failure.action, failure.error.name])).toEqual([
      ["email_1", "create", "DuplicateKeyError"],
    ]);
  });

  test("listIndexes of a collection that does not exist is []", async () => {
    expect(await t.connection.model(Counter).listIndexes()).toEqual([]);
  });
});

describe("createCollection", () => {
  test("creates once; an existing collection is `false`, not an error", async () => {
    const Counters = t.connection.model(Counter);
    expect(await Counters.createCollection()).toBe(true);
    expect(await Counters.createCollection()).toBe(false);
  });
});

describe("POJO utilities", () => {
  test("hydrate: a stored document → entity instance (subdocuments too)", () => {
    const id = new ObjectId();
    const doc = People.hydrate({ _id: id, name: "Ann", email: "a", pets: [{ name: "Rex" }], scores: { a: 1 } });
    expect(doc).toBeInstanceOf(Person);
    expect(doc.pets[0]).toBeInstanceOf(Pet);
    /* A hydrated Map field is a TypedMap (a Map subclass) with the same entries. */
    expect(doc.scores).toBeInstanceOf(Map);
    expect(doc.scores?.$toObject()).toEqual(new Map([["a", 1]]));
  });

  test("castObject casts by the schema, refuses unknown keys, never mutates the input", () => {
    const input = Object.freeze({ name: "Ann", age: 3, lastSeen: "2026-01-02" });
    const cast = People.castObject(input);
    expect(cast.lastSeen).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect(() => People.castObject({ nmae: "x" })).toThrow(CastError);
  });

  test("validate collects every issue by path", async () => {
    const error = await People.validate({ age: -1 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).errors).sort()).toEqual(["age", "email", "name"]);
    const ok = await People.validate({ name: "A", email: "e", lastSeen: null });
    expect(ok.name).toBe("A");
    expect(ok.role).toBe("user");
    expect(ok._id).toBeInstanceOf(ObjectId);
  });
});
