/*
 * With the test-kit `CommandRecorder`: exactly what the executor sends to the driver —
 * options passed through (hint, collation, comment, read/write concern, batchSize, timeoutMS as the
 * server's maxTimeMS), the effective projection, sort words, find-and-modify defaults.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { Model } from "../../../src/index.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("commands");
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await People.createIndexes();
  t.commands.clear();
});

const last = (name: string) => {
  const command = t.commands.byName(name).at(-1)?.command;
  if (command === undefined) throw new Error(`no ${name} command was sent`);
  return command;
};

describe("what reaches the server", () => {
  test("find: filter, effective projection (Hidden excluded), sort, skip, limit, hint, collation, comment, batchSize", async () => {
    await People.find({ name: "Ann" })
      .sort({ age: "desc", name: 1 })
      .skip(2)
      .limit(5)
      .hint({ email: 1 })
      .collation({ locale: "en" })
      .comment("c1")
      .batchSize(7);
    const find = last("find");
    expect(find.filter).toEqual({ name: "Ann" });
    expect(find.projection).toEqual({ secret: 0 });
    expect(find.sort).toEqual(
      new Map([
        ["age", -1],
        ["name", 1],
      ]),
    );
    expect([find.skip, find.limit, find.batchSize, find.comment]).toEqual([2, 5, 7, "c1"]);
    expect(find.hint).toEqual({ email: 1 });
    expect(find.collation).toMatchObject({ locale: "en" });
  });

  test("timeoutMS becomes the server's maxTimeMS (driver CSOT), readConcern and readPreference pass through", async () => {
    await People.find().timeoutMS(5_000).readConcern("majority").readPreference("primaryPreferred");
    const find = last("find");
    expect(typeof find.maxTimeMS).toBe("number");
    expect(find.maxTimeMS as number).toBeLessThanOrEqual(5_000);
    expect(find.readConcern).toEqual({ level: "majority" });
    expect(find.$readPreference).toEqual({ mode: "primaryPreferred" });
  });

  test("update: the update document, upsert, arrayFilters, writeConcern", async () => {
    await People.updateOne(
      { name: "Ann" },
      { $set: { "pets.$[p].age": 3 } },
      { upsert: false, arrayFilters: [{ "p.name": "Rex" }] },
    ).writeConcern({ w: 1, journal: true });
    const update = last("update");
    expect((update.updates as { u: unknown; upsert: boolean; arrayFilters: unknown }[])[0]).toMatchObject({
      u: { $set: { "pets.$[p].age": 3 } },
      upsert: false,
      arrayFilters: [{ "p.name": "Rex" }],
    });
    expect(update.writeConcern).toEqual({ w: 1, j: true });
  });

  test("findOneAndUpdate: new: true ('after'), the effective projection, sort", async () => {
    await People.findOneAndUpdate({ name: "Ann" }, { $set: { age: 1 } }).sort({ age: 1 });
    const command = last("findAndModify");
    expect(command.new).toBe(true);
    expect(command.fields).toEqual({ secret: 0 });
    expect(command.sort).toEqual(new Map([["age", 1]]));
  });

  test("insert: the cast, encoded documents with defaults and _id (nothing added by the driver)", async () => {
    await People.create({ name: "Ann", email: "a@x.test", tags: [], pets: [], lastSeen: null, age: 3 });
    const insert = last("insert");
    const [doc] = insert.documents as Record<string, unknown>[];
    expect(Object.keys(doc ?? {}).sort()).toEqual(["_id", "age", "email", "lastSeen", "name", "pets", "role", "tags"]);
    expect(doc?.role).toBe("user");
  });

  test("countDocuments is the aggregate the driver builds; distinct/estimated their commands", async () => {
    await People.countDocuments({ name: "Ann" }).limit(3);
    expect(last("aggregate").pipeline).toEqual([
      { $match: { name: "Ann" } },
      { $limit: 3 },
      { $group: { _id: 1, n: { $sum: 1 } } },
    ]);
    await People.distinct("tags", { name: "Ann" });
    expect(last("distinct")).toMatchObject({ key: "tags", query: { name: "Ann" } });
    await People.estimatedDocumentCount();
    expect(last("count")).toMatchObject({ count: "m_people" });
  });
});
