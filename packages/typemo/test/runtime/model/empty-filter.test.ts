/*
 * On the real server: an empty filter on a write that changes or removes documents — one or many — is a
 * `StrictModeError` with reason `empty-filter` before anything is sent. With one document the refusal matters as
 * much: which document would be "the first" is arbitrary. `Filters.all()` is the explicit "any document".
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Filters, type Model, StrictModeError } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("empty_filter");
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await t.mongo.db.collection("m_people").insertMany([
    { name: "Ann", email: "ann@x.test", role: "user", tags: [], pets: [], lastSeen: null },
    { name: "Bob", email: "bob@x.test", role: "user", tags: [], pets: [], lastSeen: null },
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

describe("an empty filter on a one-document write", () => {
  test.each([
    ["updateOne", () => People.updateOne({} as never, { $set: { role: "admin" } })],
    ["deleteOne", () => People.deleteOne({} as never)],
    ["replaceOne", () => People.replaceOne({} as never, {} as never)],
  ] as const)("%s({}) is refused before sending, nothing changes", async (_name, run) => {
    const error = await errorOf(run);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("empty-filter");
    expect(t.commands.byName("update")).toHaveLength(0);
    expect(t.commands.byName("delete")).toHaveLength(0);
    expect(await t.mongo.db.collection("m_people").countDocuments({ role: "admin" })).toBe(0);
    expect(await t.mongo.db.collection("m_people").countDocuments()).toBe(2);
  });

  test("the message of a one form speaks of an arbitrary document, that of a many form of every document", async () => {
    const one = (await errorOf(() => People.deleteOne({} as never))) as StrictModeError;
    expect(one.message).toContain("would change or remove an arbitrary document");
    expect(one.message).not.toContain("every document;");
    const oneAnd = (await errorOf(() =>
      People.findOneAndUpdate({} as never, { $set: { role: "x" } } as never),
    )) as StrictModeError;
    expect(oneAnd.message).toContain("would change or remove an arbitrary document");
    const many = (await errorOf(() => People.deleteMany({} as never))) as StrictModeError;
    expect(many.message).toContain("would affect every document");
  });

  test("the same for the many forms", async () => {
    const many = [
      () => People.updateMany({} as never, { $set: { role: "admin" } }),
      () => People.deleteMany({} as never),
    ];
    for (const run of many) expect(await errorOf(run)).toBeInstanceOf(StrictModeError);
    expect(await t.mongo.db.collection("m_people").countDocuments()).toBe(2);
  });

  test("Filters.all() is the explicit way: one document changes, one is removed", async () => {
    expect((await People.updateOne(Filters.all(), { $set: { role: "admin" } })).modifiedCount).toBe(1);
    expect((await People.deleteOne(Filters.all())).deletedCount).toBe(1);
    expect(await t.mongo.db.collection("m_people").countDocuments()).toBe(1);
  });

  test("a bulkWrite operation with an empty filter is refused as well", async () => {
    const error = await errorOf(() =>
      People.bulkWrite([{ updateOne: { filter: {} as never, update: { $set: { role: "admin" } } } }]),
    );
    expect(error).toBeInstanceOf(StrictModeError);
    expect(await t.mongo.db.collection("m_people").countDocuments({ role: "admin" })).toBe(0);
  });
});
