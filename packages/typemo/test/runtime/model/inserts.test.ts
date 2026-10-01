/*
 * create/insertOne/insertMany (ordered and unordered) and bulkWrite on the real server —
 * hydrated results with defaults and `_id`, typed errors with the server `code` kept and input
 * indexes (Mongoose lost `code`), no mutation of the input.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { BulkWriteError, DuplicateKeyError, type Model, QueryError, ValidationError } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("inserts");
let People: Model<Person>;

/**
 * A valid person document input.
 * @param name The person's name; also used for the email.
 * @param extra Fields added to or replacing the defaults.
 * @returns The plain input for `create`.
 */
const person = (name: string, extra: Partial<Record<string, unknown>> = {}) => ({
  name,
  email: `${name.toLowerCase()}@x.test`,
  tags: [],
  pets: [],
  lastSeen: null,
  ...extra,
});

beforeEach(async () => {
  People = t.connection.model(Person);
  await People.createIndexes();
});

describe("create / insertOne", () => {
  test("returns the hydrated document with defaults and a generated _id; the stored document matches", async () => {
    const ann = await People.create(person("Ann"));
    expect(ann).toBeInstanceOf(Person);
    expect(ann._id).toBeInstanceOf(ObjectId);
    expect(ann.role).toBe("user");
    const stored = await t.mongo.db.collection("m_people").findOne({ _id: ann._id });
    expect(stored?.role).toBe("user");
    const one = await People.insertOne(person("Bob", { age: 3 }));
    expect(one.age).toBe(3);
  });

  test("create([...]) inserts in order with ONE ordered insert (never in parallel, unlike Mongoose)", async () => {
    t.commands.clear();
    const docs = await People.create([person("A"), person("B"), person("C")]);
    expect(docs.map((doc) => doc.name)).toEqual(["A", "B", "C"]);
    expect(t.commands.byName("insert").length).toBe(1);
    expect(t.commands.byName("insert")[0]?.command.ordered).toBe(true);
  });

  test("an invalid document is a ValidationError before anything is sent", async () => {
    t.commands.clear();
    const error = await People.create(person("Neg", { age: -1 }) as never).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).errors)).toEqual(["age"]);
    expect(t.commands.byName("insert")).toEqual([]);
  });

  test("a duplicate key is a DuplicateKeyError with keyPattern / keyValue / code, the driver error as cause", async () => {
    await People.create(person("Dup"));
    const error = await People.create(person("Dup")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DuplicateKeyError);
    const dup = error as DuplicateKeyError;
    expect(dup.code).toBe(11000);
    expect(dup.keyPattern).toEqual({ email: 1 });
    expect(dup.keyValue).toEqual({ email: "dup@x.test" });
    expect(dup.index).toBe("email_1");
    expect((dup.cause as Error).name).toBe("MongoServerError");
  });

  test("the message is short: the index, the key value and the code; the server's full text is in serverMessage", async () => {
    await People.create(person("Short"));
    const created = (await People.create(person("Short")).catch((caught: unknown) => caught)) as DuplicateKeyError;
    expect(created.message).toBe('duplicate key on email_1: { email: "short@x.test" } (code 11000 DuplicateKey)');
    expect(created.serverMessage).toContain("E11000 duplicate key error collection:");
    await People.create(person("Other"));
    /* An update reports the same short text, not the server's `Plan executor error during update :: caused by ::`. */
    const updated = (await People.updateOne({ name: "Other" }, { $set: { email: "short@x.test" } }).catch(
      (caught: unknown) => caught,
    )) as DuplicateKeyError;
    expect(updated).toBeInstanceOf(DuplicateKeyError);
    expect(updated.message).toBe('duplicate key on email_1: { email: "short@x.test" } (code 11000 DuplicateKey)');
    expect(updated.message).not.toContain("caused by");
    expect(updated.serverMessage).toContain("caused by");
  });
});

describe("insertMany", () => {
  test("the text of a BulkWriteError names the failure with the lowest input index, not the first one found", async () => {
    await People.create(person("Taken"));
    /* Typemo's own check refuses index 2 before the server answers; the server refuses index 1: `writeErrors` is sorted. */
    const error = await People.insertMany(
      [person("A0"), person("Taken"), person("A2", { age: -5 }) as never, person("A3")],
      {
        ordered: false,
      },
    ).catch((caught: unknown) => caught);
    const bulk = error as BulkWriteError;
    expect(bulk.writeErrors.map((failure) => failure.index)).toEqual([1, 2]);
    expect(bulk.message).toStartWith(
      "Person.insertMany: 2 write(s) failed (first at index 1: duplicate key on email_1",
    );
    /* The failure keeps the server's own text; the text of the bulk error uses the short message of its error. */
    expect(bulk.writeErrors[0]?.message).toContain("E11000");
  });

  test("ordered (default): stops at the first failure; BulkWriteError with input indexes and code", async () => {
    await People.create(person("Taken"));
    const error = await People.insertMany([person("X1"), person("Taken"), person("X3")]).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BulkWriteError);
    const bulk = error as BulkWriteError;
    expect(bulk.ordered).toBe(true);
    expect(bulk.writeErrors.map((failure) => [failure.index, failure.code])).toEqual([[1, 11000]]);
    expect(bulk.writeErrors[0]?.error).toBeInstanceOf(DuplicateKeyError);
    expect(bulk.result.insertedCount).toBe(1);
    expect(await People.countDocuments()).toBe(2);
  });

  test("unordered: every valid document is inserted; invalid ones (client) and duplicates (server) are both reported", async () => {
    await People.create(person("Taken"));
    const error = await People.insertMany(
      [person("U0"), person("U1", { age: -5 }) as never, person("Taken"), person("U3")],
      { ordered: false },
    ).catch((caught: unknown) => caught);
    const bulk = error as BulkWriteError;
    expect(bulk).toBeInstanceOf(BulkWriteError);
    expect(bulk.ordered).toBe(false);
    expect(bulk.writeErrors.map((failure) => [failure.index, failure.code, failure.error.name])).toEqual([
      [1, undefined, "ValidationError"],
      [2, 11000, "DuplicateKeyError"],
    ]);
    expect(Object.keys(bulk.result.insertedIds).map(Number).sort()).toEqual([0, 3]);
    expect((await People.find().sort({ name: 1 }).lean()).map((doc) => doc.name)).toEqual(["Taken", "U0", "U3"]);
  });

  test("returns the documents in input order; an empty list sends nothing", async () => {
    const docs = await People.insertMany([person("M1"), person("M2")]);
    expect(docs.map((doc) => doc.name)).toEqual(["M1", "M2"]);
    t.commands.clear();
    expect(await People.insertMany([])).toEqual([]);
    expect(t.commands.byName("insert")).toEqual([]);
  });
});

describe("bulkWrite", () => {
  test("every operation kind; the result is in input indexes", async () => {
    const [ann] = await People.insertMany([person("Ann"), person("Bob")]);
    const result = await People.bulkWrite([
      { insertOne: { document: person("Cy") } },
      { updateOne: { filter: { name: "Ann" }, update: { $set: { age: 1 } } } },
      { updateMany: { filter: { age: { $exists: false } }, update: { $set: { age: 2 } } } },
      { replaceOne: { filter: { name: "Bob" }, replacement: person("Bob", { age: 9 }) } },
      { updateOne: { filter: { email: "new@x.test" }, update: { $set: { name: "N" } }, upsert: true } },
      { deleteOne: { filter: { _id: ann?._id as ObjectId } } },
      { deleteMany: { filter: { name: "Nobody" } } },
    ]);
    expect(result.insertedCount).toBe(1);
    expect(Object.keys(result.insertedIds)).toEqual(["0"]);
    expect(result.upsertedCount).toBe(1);
    expect(Object.keys(result.upsertedIds)).toEqual(["4"]);
    expect(result.deletedCount).toBe(1);
  });

  test("a failing operation: BulkWriteError with its input index and code", async () => {
    await People.create(person("Taken"));
    const error = await People.bulkWrite(
      [{ insertOne: { document: person("Ok") } }, { insertOne: { document: person("Taken") } }],
      { ordered: false },
    ).catch((caught: unknown) => caught);
    expect((error as BulkWriteError).writeErrors.map((failure) => [failure.index, failure.code])).toEqual([[1, 11000]]);
    expect((error as BulkWriteError).result.insertedCount).toBe(1);
  });

  test("malformed operations are QueryErrors naming the index; an empty list sends nothing (unordered too)", async () => {
    t.commands.clear();
    expect((await People.bulkWrite([])).insertedCount).toBe(0); /* an empty list: nothing sent (gh-9131) */
    expect((await People.bulkWrite([], { ordered: false })).insertedCount).toBe(0); /* never hangs */
    expect(t.commands.all()).toEqual([]);
    await expect(People.bulkWrite([{ upsertOne: {} } as never])).rejects.toThrow(/bulkWrite\[0\]: one of insertOne/);
    await expect(
      People.bulkWrite([{ updateOne: { filter: { name: "a" }, update: { $set: { age: undefined } } } } as never]),
    ).rejects.toThrow(QueryError);
  });
});
