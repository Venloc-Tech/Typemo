/*
 * On the real server: an upsert never inserts a document without a required field. Before anything is sent, the
 * document an insert would create — the equality fields of the filter, `$set`, `$setOnInsert`, and whatever
 * another operator writes — is checked for every required field. An update without `upsert` is not affected.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { type Defaulted, Entity, type Model, Prop, Schema, Timestamped, ValidationError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** An embedded address with a required field. */
@Schema()
class Place {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String, { required: true }) zip!: string;
}

/** A root with required fields, a default and an embedded document. */
@Schema({ collection: "ur_notes" })
class Note extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { required: true, default: "draft" }) status!: Defaulted<string>;
  @Prop(() => Number, { required: true }) views!: number;
  @Prop(() => [String]) tags?: string[];
  @Prop(() => Place) place?: Place;
}

const t = ModelLifecycle.useTypemo("ur");
let Notes: Model<Note>;

/**
 * The raw notes collection.
 * @returns The driver collection.
 */
const raw = () => t.mongo.db.collection("ur_notes");

/**
 * Awaits an operation that must be refused.
 * @param promise The operation.
 * @returns The `ValidationError` it rejected with.
 */
const refused = async (promise: PromiseLike<unknown>): Promise<ValidationError> => {
  const error = await Promise.resolve(promise).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return error as ValidationError;
};

beforeEach(async () => {
  Notes = t.connection.model(Note);
  await raw().deleteMany({});
  t.commands.clear();
});

describe("an upsert that would insert a document without a required field", () => {
  test("is refused before sending, and the message names the field", async () => {
    const error = await refused(Notes.updateOne({ title: "UpG" }, { $set: { tags: [] } }, { upsert: true }));
    expect(error.issues.map((issue) => [issue.path.join("."), issue.reason])).toEqual([
      ["owner", "required"],
      ["views", "required"],
    ]);
    expect(error.message).toContain("upsert would create a document without the required field");
    expect(t.commands.byName("update").length).toBe(0);
    expect(await raw().countDocuments()).toBe(0);
  });

  test("the filter's equality fields, $set, $setOnInsert and other operators all count as given", async () => {
    const result = await Notes.updateOne(
      { title: "UpG", owner: { $eq: "ann" } },
      { $set: { tags: [] }, $inc: { views: 1 } },
      { upsert: true },
    );
    expect(result.upsertedCount).toBe(1);
    expect(await raw().findOne({ title: "UpG" })).toMatchObject({ owner: "ann", views: 1, status: "draft", tags: [] });
    await Notes.updateOne({ title: "Two" }, { $setOnInsert: { owner: "bob", views: 0 } }, { upsert: true });
    expect(await raw().findOne({ title: "Two" })).toMatchObject({ owner: "bob", views: 0 });
  });

  test("a filter operator that is not an equality gives nothing", async () => {
    const error = await refused(
      Notes.updateOne({ title: { $in: ["a"] }, owner: "ann" }, { $set: { views: 1 } }, { upsert: true }),
    );
    expect(error.issues.map((issue) => issue.path.join("."))).toEqual(["title"]);
  });

  test("findOneAndUpdate and bulkWrite are checked the same way", async () => {
    await refused(Notes.findOneAndUpdate({ title: "x" }, { $set: { views: 1 } }, { upsert: true }).lean());
    await refused(
      Notes.bulkWrite([{ updateOne: { filter: { title: "x" }, update: { $set: { views: 1 } }, upsert: true } }]),
    );
    expect(await raw().countDocuments()).toBe(0);
  });

  test("an embedded document built from dotted paths needs its required fields too", async () => {
    const base = { title: "p", owner: "ann", views: 0 };
    const error = await refused(Notes.updateOne(base, { $set: { "place.city": "Oslo" } }, { upsert: true }));
    expect(error.issues.map((issue) => issue.path.join("."))).toEqual(["place.zip"]);
    await Notes.updateOne(base, { $set: { "place.city": "Oslo", "place.zip": "0150" } }, { upsert: true });
    expect((await raw().findOne({ title: "p" }))?.place).toEqual({ city: "Oslo", zip: "0150" });
  });

  test("an update pipeline with upsert is checked by the fields its stages write", async () => {
    const error = await refused(
      Notes.updateOne({ title: "pipe" }, (p) => p.set(() => ({ owner: "ann" })), { upsert: true }),
    );
    /* A pipeline gets no schema defaults on insert, so the defaulted required field must be given too. */
    expect(error.issues.map((issue) => issue.path.join("."))).toEqual(["status", "views"]);
    await Notes.updateOne({ title: "pipe" }, (p) => p.set(() => ({ owner: "ann", views: 0, status: "new" })), {
      upsert: true,
    });
    expect(await raw().findOne({ title: "pipe" })).toMatchObject({ owner: "ann", views: 0, status: "new" });
  });
});

describe("what is not affected", () => {
  test("an update without upsert needs no required field", async () => {
    await raw().insertOne({ title: "old", owner: "ann", views: 1, status: "draft" });
    const result = await Notes.updateOne({ title: "old" }, { $set: { tags: ["x"] } });
    expect(result.modifiedCount).toBe(1);
    expect((await Notes.updateOne({ title: "none" }, { $set: { tags: ["x"] } })).matchedCount).toBe(0);
  });

  test("an upsert that gives every required field updates an existing document as before", async () => {
    await raw().insertOne({ title: "old", owner: "ann", views: 1, status: "draft" });
    const result = await Notes.updateOne(
      { title: "old", owner: "ann" },
      { $set: { tags: ["y"] }, $setOnInsert: { views: 0 } },
      { upsert: true },
    );
    expect([result.matchedCount, result.upsertedCount]).toEqual([1, 0]);
    expect(await raw().findOne({ title: "old" })).toMatchObject({ views: 1, tags: ["y"] });
  });
});
