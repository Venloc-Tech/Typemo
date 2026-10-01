/*
 * On the real server: a replacement must agree with the stored document on every immutable field. The server
 * compares them (a guard in the filter), so a replacement that changes, drops or adds an immutable value is never
 * written and fails with `StrictModeError` (rule `immutable`) naming the field; a replacement without an optional
 * immutable field the stored document does not have either goes through. `replaceOne`, `findOneAndReplace`,
 * `bulkWrite` `replaceOne`, upserts, transactions, the replacement pipeline of a timestamped model and `dbName`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  BulkWriteError,
  Entity,
  type Immutable,
  type Model,
  Prop,
  Schema,
  StrictModeError,
  Timestamped,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A required and an optional immutable field, the optional one stored under another name. */
@Schema({ collection: "ri_places" })
class Place extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String) owner?: string;
  @Prop(() => String, { required: true, immutable: true }) region!: Immutable<string>;
  @Prop(() => String, { immutable: true, dbName: "cd" }) code?: Immutable<string>;
}

/** Timestamped: the replacement goes as an update pipeline that keeps createdAt. */
@Schema({ collection: "ri_notes" })
class StampedNote extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) text!: string;
  @Prop(() => String, { required: true, immutable: true }) author!: Immutable<string>;
}

const t = ModelLifecycle.useTypemo("replacement_immutable");
const ids = { eu: new ObjectId(), coded: new ObjectId() };
let Places: Model<Place>;
let Notes: Model<StampedNote>;

beforeEach(async () => {
  Places = t.connection.model(Place);
  Notes = t.connection.model(StampedNote);
  await t.mongo.db.collection("ri_places").insertMany([
    { _id: ids.eu, title: "Main", region: "eu" },
    { _id: ids.coded, title: "Coded", region: "us", cd: "C1" },
  ]);
  t.commands.clear();
});

/**
 * The error a builder rejects with.
 * @param run - Starts the operation.
 * @returns What it rejected with, or `undefined` when it resolved.
 */
const errorOf = async (run: () => PromiseLike<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

/**
 * Checks an `immutable` refusal that names a field.
 * @param error - The caught error.
 * @param text - A part of the message.
 */
const refused = (error: unknown, text: string): void => {
  expect(error).toBeInstanceOf(StrictModeError);
  expect((error as StrictModeError).reason).toBe("immutable");
  expect((error as StrictModeError).message).toContain(text);
};

/**
 * The stored document, raw.
 * @param id - The `_id`.
 * @returns The document or `null`.
 */
const stored = (id: ObjectId) => t.mongo.db.collection("ri_places").findOne({ _id: id });

describe("replaceOne / findOneAndReplace compare the immutable values on the server", () => {
  test("the same value: replaced in one round trip", async () => {
    const result = await Places.replaceOne({ _id: ids.eu }, { title: "Renamed", region: "eu" });
    expect(result.modifiedCount).toBe(1);
    expect(await stored(ids.eu)).toEqual({ _id: ids.eu, title: "Renamed", region: "eu" });
    expect(t.commands.byName("find")).toHaveLength(0);
  });

  test("another value: StrictModeError, nothing written", async () => {
    refused(
      await errorOf(() => Places.replaceOne({ _id: ids.eu }, { title: "T3", region: "us" })),
      'changes the immutable field "region"',
    );
    refused(
      await errorOf(() => Places.findOneAndReplace({ title: "Main" }, { title: "T3", region: "fr" })),
      'changes the immutable field "region"',
    );
    expect(await stored(ids.eu)).toEqual({ _id: ids.eu, title: "Main", region: "eu" });
  });

  test("no document: the ordinary result, no error", async () => {
    const result = await Places.replaceOne({ _id: new ObjectId() }, { title: "x", region: "eu" });
    expect(result.matchedCount).toBe(0);
    expect(await Places.findOneAndReplace({ title: "nobody" }, { title: "x", region: "eu" })).toBeNull();
  });

  test("findOneAndReplace with the same value returns the document", async () => {
    const after = await Places.findOneAndReplace(
      { _id: ids.eu },
      { title: "Next", region: "eu" },
      { returnDocument: "after" },
    ).lean();
    expect(after).toEqual({ _id: ids.eu, title: "Next", region: "eu" });
  });
});

describe("an optional immutable field", () => {
  test("absent in the replacement and in the stored document: the replacement goes through", async () => {
    const result = await Places.replaceOne({ title: "Main" }, { title: "Main", owner: "carol", region: "eu" });
    expect(result.modifiedCount).toBe(1);
    expect(await stored(ids.eu)).toEqual({ _id: ids.eu, title: "Main", owner: "carol", region: "eu" });
  });

  test("absent in the replacement, present in the stored document: would drop it", async () => {
    refused(
      await errorOf(() => Places.replaceOne({ _id: ids.coded }, { title: "Coded", region: "us" })),
      'without the immutable field "code" would drop it',
    );
    expect((await stored(ids.coded))?.cd).toBe("C1");
  });

  test("present in the replacement, absent in the stored document: refused (set only on creation)", async () => {
    refused(
      await errorOf(() => Places.replaceOne({ _id: ids.eu }, { title: "Main", region: "eu", code: "NEW" })),
      'sets the immutable field "code", which the stored document does not have',
    );
    expect((await stored(ids.eu))?.cd).toBeUndefined();
  });

  test("the stored value under its dbName: the same value passes, another is refused", async () => {
    expect((await Places.replaceOne({ _id: ids.coded }, { title: "C", region: "us", code: "C1" })).modifiedCount).toBe(
      1,
    );
    refused(
      await errorOf(() => Places.replaceOne({ _id: ids.coded }, { title: "C", region: "us", code: "C2" })),
      'changes the immutable field "code"',
    );
  });
});

describe("upsert", () => {
  test("no document: inserted (the _id of the filter kept)", async () => {
    const id = new ObjectId();
    const result = await Places.replaceOne({ _id: id }, { title: "New", region: "eu" }, { upsert: true });
    expect(result.upsertedCount).toBe(1);
    expect(await stored(id)).toEqual({ _id: id, title: "New", region: "eu" });
  });

  test("a document that disagrees: StrictModeError before the write, no new document", async () => {
    refused(
      await errorOf(() => Places.replaceOne({ title: "Main" }, { title: "Main", region: "us" }, { upsert: true })),
      'changes the immutable field "region"',
    );
    refused(
      await errorOf(() =>
        Places.findOneAndReplace({ title: "Main" }, { title: "Main", region: "us" }, { upsert: true }),
      ),
      'changes the immutable field "region"',
    );
    expect(await t.mongo.db.collection("ri_places").countDocuments()).toBe(2);
    expect(t.commands.byName("update")).toHaveLength(0);
    expect(t.commands.byName("findAndModify")).toHaveLength(0);
  });

  test("a document that agrees: replaced", async () => {
    const result = await Places.replaceOne({ title: "Main" }, { title: "Main", region: "eu" }, { upsert: true });
    expect(result.matchedCount).toBe(1);
  });
});

describe("bulkWrite replaceOne", () => {
  test("unordered: the refused operation is in writeErrors, the others are written", async () => {
    const error = await errorOf(() =>
      Places.bulkWrite(
        [
          { replaceOne: { filter: { _id: ids.eu }, replacement: { title: "X", region: "us" } } },
          { replaceOne: { filter: { _id: ids.coded }, replacement: { title: "Y", region: "us", code: "C1" } } },
        ],
        { ordered: false },
      ),
    );
    expect(error).toBeInstanceOf(BulkWriteError);
    const bulk = error as BulkWriteError;
    expect(bulk.writeErrors.map((failure) => failure.index)).toEqual([0]);
    refused(bulk.writeErrors[0]?.error, 'changes the immutable field "region"');
    expect(bulk.result.modifiedCount).toBe(1);
    expect((await stored(ids.eu))?.region).toBe("eu");
    expect((await stored(ids.coded))?.title).toBe("Y");
  });

  test("ordered: refused before the bulk is sent", async () => {
    refused(
      await errorOf(() =>
        Places.bulkWrite([
          { replaceOne: { filter: { _id: ids.coded }, replacement: { title: "Y", region: "us", code: "C1" } } },
          { replaceOne: { filter: { _id: ids.eu }, replacement: { title: "X", region: "us" } } },
        ]),
      ),
      'changes the immutable field "region"',
    );
    expect(t.commands.byName("update")).toHaveLength(0);
    expect((await stored(ids.coded))?.title).toBe("Coded");
  });

  test("agreeing replacements are written", async () => {
    const result = await Places.bulkWrite([
      { replaceOne: { filter: { _id: ids.eu }, replacement: { title: "X", region: "eu" } } },
    ]);
    expect(result.modifiedCount).toBe(1);
  });
});

describe("transactions and the timestamped replacement pipeline", () => {
  test("inside a transaction the check read uses the same session", async () => {
    const error = await t.connection
      .transaction(async () => {
        await Places.replaceOne({ _id: ids.eu }, { title: "T", region: "us" });
      })
      .catch((caught: unknown) => caught);
    refused(error, 'changes the immutable field "region"');
    const finds = t.commands.byName("find");
    expect(finds.at(-1)?.command.lsid).toEqual(t.commands.byName("update").at(-1)?.command.lsid);
    expect((await stored(ids.eu))?.region).toBe("eu");
  });

  test("a timestamped model: the same value replaces and keeps createdAt, another value is refused", async () => {
    const note = await Notes.create({ text: "a", author: "ann" });
    expect((await Notes.replaceOne({ _id: note._id }, { text: "b", author: "ann" })).modifiedCount).toBe(1);
    refused(
      await errorOf(() => Notes.replaceOne({ _id: note._id }, { text: "c", author: "bob" })),
      'changes the immutable field "author"',
    );
    const raw = await t.mongo.db.collection("ri_notes").findOne({ _id: note._id });
    expect(raw?.author).toBe("ann");
    expect(raw?.text).toBe("b");
    expect(raw?.createdAt).toEqual(note.createdAt);
  });
});
