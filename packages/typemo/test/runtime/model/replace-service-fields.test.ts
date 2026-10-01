/*
 * On the real server: `replaceOne`/`findOneAndReplace` take no service fields; the
 * core keeps `createdAt`/`__v` and bumps `updatedAt` ATOMICALLY with an update pipeline
 * (`$replaceWith` + `$mergeObjects`, the old values through `$ifNull`); an upsert gets new ones.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { Entity, type Model, Prop, Schema, StrictModeError, Timestamped, Versioned } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema({ collection: "j5_notes" })
class Note extends Versioned(Timestamped(Entity)) {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String)
  body?: string;
}

@Schema({ collection: "j5_plain" })
class PlainNote extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

const t = ModelLifecycle.useTypemo("j5");
const id = new ObjectId();
const created = new Date("2020-01-01T00:00:00Z");
let Notes: Model<Note>;

beforeEach(async () => {
  Notes = t.connection.model(Note);
  await t.mongo.db
    .collection("j5_notes")
    .insertOne({ _id: id, title: "a", body: "old", createdAt: created, updatedAt: created, __v: 7 });
  t.commands.clear();
});

/**
 * Reads the seeded note straight from the collection.
 * @returns The stored raw document.
 */
const stored = () => t.mongo.db.collection("j5_notes").findOne({ _id: id });

describe("replace keeps the service fields", () => {
  test("replaceOne: createdAt and __v kept, updatedAt bumped, the rest replaced (one update command)", async () => {
    const before = Date.now();
    const result = await Notes.replaceOne({ _id: id }, { title: "b" });
    expect(result.modifiedCount).toBe(1);
    const doc = await stored();
    expect(doc).toMatchObject({ _id: id, title: "b", createdAt: created, __v: 7 });
    expect(doc?.body).toBeUndefined();
    expect((doc?.updatedAt as Date | undefined)?.getTime() ?? 0).toBeGreaterThanOrEqual(before - 1000);
    const [command] = t.commands.byName("update");
    const pipeline = command?.command.updates[0].u as { $replaceWith: { $mergeObjects: unknown[] } }[];
    expect(pipeline[0]?.$replaceWith.$mergeObjects[0]).toEqual({ $literal: { title: "b" } });
    expect(pipeline[0]?.$replaceWith.$mergeObjects[1]).toMatchObject({
      createdAt: { $ifNull: ["$createdAt", expect.any(Date)] },
      __v: { $ifNull: ["$__v", 0] },
    });
  });

  test("upsert: a new document gets createdAt = updatedAt = now and __v = 0; _id from the filter", async () => {
    const newId = new ObjectId();
    const result = await Notes.replaceOne({ _id: newId }, { title: "n" }, { upsert: true });
    expect(result.upsertedId).toEqual(newId);
    const doc = await t.mongo.db.collection("j5_notes").findOne({ _id: newId });
    expect(doc).toMatchObject({ title: "n", __v: 0 });
    expect(doc?.createdAt).toEqual(doc?.updatedAt);
  });

  test("findOneAndReplace returns the replaced document with the kept service fields", async () => {
    const after = await Notes.findOneAndReplace({ _id: id }, { title: "c", body: "x" });
    expect(after).toMatchObject({ title: "c", body: "x", createdAt: created, __v: 7 });
    expect(after).toBeInstanceOf(Note);
    const before = await Notes.findOneAndReplace({ _id: id }, { title: "d" }, { returnDocument: "before" });
    expect(before?.title).toBe("c");
  });

  test("replacement data stays data: '$x' strings and '$'-free objects are stored as given", async () => {
    await Notes.replaceOne({ _id: id }, { title: "$notAPath" });
    expect((await stored())?.title).toBe("$notAPath");
  });

  test("a service field in the replacement is refused before sending", async () => {
    expect(() => Notes.replaceOne({ _id: id }, { title: "x", createdAt: new Date() } as never)).not.toThrow();
    await expect(Notes.replaceOne({ _id: id }, { title: "x", createdAt: new Date() } as never).exec()).rejects.toThrow(
      StrictModeError,
    );
    await expect(Notes.replaceOne({ _id: id }, { title: "x", __v: 1 } as never).exec()).rejects.toThrow(
      /bumps updatedAt itself; leave it out/,
    );
    expect(t.commands.byName("update").length).toBe(0);
  });

  test("a schema without service fields keeps the plain replacement command", async () => {
    const Plain = t.connection.model(PlainNote);
    const plainId = new ObjectId();
    await t.mongo.db.collection("j5_plain").insertOne({ _id: plainId, title: "a" });
    await Plain.replaceOne({ _id: plainId }, { title: "b" });
    expect(t.commands.byName("update")[0]?.command.updates[0].u).toEqual({ title: "b" });
  });
});
