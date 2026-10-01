/*
 * `@Schema({ readConcern, writeConcern })` are the defaults of the model's operations: they reach the
 * server on every read/write, an option on the operation overrides them, and inside a transaction the
 * transaction's own settings apply (the schema's are not sent).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, type Model, Prop, Schema } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A model with a default read and write concern. */
@Schema({ collection: "sc_notes", readConcern: { level: "majority" }, writeConcern: { w: 1, journal: true } })
class ConcernNote extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

const t = ModelLifecycle.useTypemo("schema_concerns");
let Notes: Model<ConcernNote>;

beforeEach(async () => {
  Notes = t.connection.model(ConcernNote);
  await Notes.create({ title: "seed" });
  t.commands.clear();
});

const last = (name: string) => {
  const command = t.commands.byName(name).at(-1)?.command;
  if (command === undefined) throw new Error(`no ${name} command was sent`);
  return command;
};

describe("schema readConcern / writeConcern", () => {
  test("reads send the schema readConcern (find, findOne, countDocuments, distinct, aggregate)", async () => {
    await Notes.find();
    expect(last("find").readConcern).toEqual({ level: "majority" });
    await Notes.findOne({ title: "seed" });
    expect(last("find").readConcern).toEqual({ level: "majority" });
    await Notes.countDocuments();
    expect(last("aggregate").readConcern).toEqual({ level: "majority" });
    t.commands.clear();
    await Notes.distinct("title");
    expect(last("distinct").readConcern).toEqual({ level: "majority" });
  });

  test("writes send the schema writeConcern (insert, update, delete, findAndModify)", async () => {
    await Notes.create({ title: "a" });
    expect(last("insert").writeConcern).toEqual({ w: 1, j: true });
    await Notes.updateOne({ title: "a" }, { $set: { title: "b" } });
    expect(last("update").writeConcern).toEqual({ w: 1, j: true });
    await Notes.findOneAndUpdate({ title: "b" }, { $set: { title: "c" } });
    expect(last("findAndModify").writeConcern).toEqual({ w: 1, j: true });
    await Notes.deleteOne({ title: "c" });
    expect(last("delete").writeConcern).toEqual({ w: 1, j: true });
  });

  test("an option on the operation overrides the schema default", async () => {
    await Notes.find().readConcern("local");
    expect(last("find").readConcern).toEqual({ level: "local" });
    await Notes.updateOne({ title: "seed" }, { $set: { title: "x" } }).writeConcern({ w: "majority" });
    expect(last("update").writeConcern).toEqual({ w: "majority" });
  });

  test("inside a transaction the schema concerns are not sent", async () => {
    await t.connection.transaction(async () => {
      await Notes.find();
      await Notes.create({ title: "tx" });
    });
    const find = last("find");
    expect(find.readConcern === undefined || (find.readConcern as { level?: string }).level !== "majority").toBe(true);
    expect(last("insert").writeConcern).toBeUndefined();
    expect(await Notes.countDocuments({ title: "tx" })).toBe(1);
  });
});
