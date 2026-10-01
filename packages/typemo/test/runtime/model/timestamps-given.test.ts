/*
 * `Timestamped`: dates given consciously are kept (create, insertMany, an update's `$set`, a save that assigns
 * `updatedAt`); `updatedAt` moves on every write operation, even one the server finds changes nothing
 * (`$set` of the same value, `$addToSet` of a value already there: `modifiedCount: 1`). Real server.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, type Model, Prop, Schema, Timestamped } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A timestamped note with a set of tags. */
@Schema({ collection: "f113_notes" })
class Note extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [String]) tags!: string[];
}

const t = ModelLifecycle.useTypemo("f113_timestamps");
let Notes: Model<Note>;
const raw = () => t.mongo.db.collection("f113_notes");
const past = new Date("2001-02-03T04:05:06.000Z");

beforeEach(async () => {
  Notes = t.connection.model(Note);
  await raw().deleteMany({});
});

describe("dates given consciously are kept", () => {
  test("create and insertMany keep createdAt and updatedAt", async () => {
    const note = await Notes.create({ title: "a", createdAt: past, updatedAt: past });
    const stored = await raw().findOne({ _id: note._id });
    expect(stored?.createdAt).toEqual(past);
    expect(stored?.updatedAt).toEqual(past);
    const [other] = await Notes.insertMany([{ title: "b", createdAt: past }]);
    const storedOther = await raw().findOne({ title: "b" });
    expect(other?.createdAt).toEqual(past);
    expect(storedOther?.createdAt).toEqual(past);
    expect((storedOther?.updatedAt as Date | undefined)?.getTime() ?? 0).toBeGreaterThan(past.getTime());
  });

  test("an update's $set of updatedAt is kept; createdAt cannot be written", async () => {
    const note = await Notes.create({ title: "a" });
    await Notes.updateOne({ _id: note._id }, { $set: { title: "b", updatedAt: past } });
    expect((await raw().findOne({ _id: note._id }))?.updatedAt).toEqual(past);
    /* cast: createdAt is immutable, the type refuses it too */
    await expect(Notes.updateOne({ _id: note._id }, { $set: { createdAt: past } } as never).exec()).rejects.toThrow(
      /createdAt/,
    );
  });

  test("a save that assigns updatedAt keeps it; a save without it moves it", async () => {
    const note = await Notes.create({ title: "a" });
    note.title = "b";
    note.updatedAt = past;
    await note.$save();
    expect((await raw().findOne({ _id: note._id }))?.updatedAt).toEqual(past);
    note.title = "c";
    await note.$save();
    expect(((await raw().findOne({ _id: note._id }))?.updatedAt as Date | undefined)?.getTime() ?? 0).toBeGreaterThan(
      past.getTime(),
    );
  });
});

describe("updatedAt moves on every write operation", () => {
  test("$set of the same value and $addToSet of an existing value still move it (modifiedCount 1)", async () => {
    const note = await Notes.create({ title: "a", tags: ["x"], updatedAt: past });
    const same = await Notes.updateOne({ _id: note._id }, { $set: { title: "a" } });
    expect(same.modifiedCount).toBe(1);
    const first = (await raw().findOne({ _id: note._id }))?.updatedAt as Date;
    expect(first.getTime()).toBeGreaterThan(past.getTime());
    const existing = await Notes.updateOne({ _id: note._id }, { $addToSet: { tags: "x" } });
    expect(existing.modifiedCount).toBe(1);
    const stored = await raw().findOne({ _id: note._id });
    expect(stored?.tags).toEqual(["x"]);
    expect((stored?.updatedAt as Date | undefined)?.getTime() ?? 0).toBeGreaterThanOrEqual(first.getTime());
  });
});
