/*
 * `Model.aggregate` on the real server runs the pipeline builder's plan through the
 * operation pipeline — await, cursor, explain; a read runs once per object, `$out` is a write;
 * words in `$sort`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ConfigurationError, fn, type Model, Pipeline, QueryError } from "../../../src/index.ts";
import { Order, Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("aggregate");
let People: Model<Person>;

beforeEach(async () => {
  People = t.connection.model(Person);
  await t.mongo.db.collection("m_people").insertMany([
    { name: "Ann", email: "a@x.test", age: 30, role: "admin", tags: ["x", "y"], pets: [], lastSeen: null },
    { name: "Bob", email: "b@x.test", age: 20, role: "user", tags: ["x"], pets: [], lastSeen: null },
    { name: "Cy", email: "c@x.test", age: 40, role: "user", tags: [], pets: [], lastSeen: null },
  ]);
  t.commands.clear();
});

describe("Model.aggregate", () => {
  test("a callback over the stored documents; rows typed by the builder", async () => {
    const rows = await People.aggregate((p) =>
      p.match({ role: "user" }).group((f) => ({ _id: f.role, total: fn.sum(f.age), count: fn.sum(1) })),
    );
    expect(rows).toEqual([{ _id: "user", total: 60, count: 2 }]);
  });

  test("sort words become 1 / -1 in the stage", async () => {
    const rows = await People.aggregate((p) => p.sort({ age: "descending" }).project(() => ({ name: 1, _id: 0 })));
    expect(rows.map((row) => row.name)).toEqual(["Cy", "Ann", "Bob"]);
    const [command] = t.commands.byName("aggregate");
    /* The $unset of Hidden fields goes first; the sort follows with 1 / -1. */
    expect(command?.command.pipeline as unknown[]).toContainEqual({ $sort: { age: -1 } });
  });

  test("a finished plan of Pipeline.from(Entity) is accepted; another collection's plan is refused", async () => {
    const plan = Pipeline.from(Person).match({ name: "Ann" }).plan();
    expect((await People.aggregate(plan)).length).toBe(1);
    const orders = Pipeline.from(Order).match({ total: 1 }).plan();
    expect(() => People.aggregate(orders as never)).toThrow(ConfigurationError);
    expect(() => People.aggregate({} as never)).toThrow(QueryError);
  });

  test("cursor() streams the rows; explain() gives the server plan", async () => {
    const query = People.aggregate((p) => p.match({ age: { $gte: 20 } }).sort({ age: 1 }));
    const names: string[] = [];
    for await (const row of query.batchSize(1).cursor()) names.push(row.name);
    expect(names).toEqual(["Bob", "Ann", "Cy"]);
    expect(await query.explain()).toBeDefined();
  });

  test("the same aggregation awaited twice runs once; `$out` is a write — a second await is an error", async () => {
    const query = People.aggregate((p) => p.match({ role: "user" }));
    const first = await query;
    expect(await query).toBe(first);
    expect(t.commands.byName("aggregate").length).toBe(1);
    const out = People.aggregate((p) => p.match({ role: "admin" }).out({ db: t.mongo.dbName, coll: "m_admins" }));
    await out;
    await expect(out.exec()).rejects.toThrow(/already executed/);
    expect(await t.mongo.db.collection("m_admins").countDocuments()).toBe(1);
  });

  test("`$out` by name writes into this database; `{ db, coll }` needs both fields (ConfigurationError before sending)", async () => {
    await People.aggregate((p) => p.match({ role: "admin" }).out("m_admins_by_name"));
    expect(await t.mongo.db.collection("m_admins_by_name").countDocuments()).toBe(1);
    await People.aggregate((p) => p.match({ role: "user" }).out({ db: t.mongo.dbName, coll: "m_users_out" }));
    expect(await t.mongo.db.collection("m_users_out").countDocuments()).toBe(2);
    /* cast: the runtime forms the type refuses; the builder says what is missing instead of the server's text */
    const noDb = { coll: "m_no_db" } as unknown as { db: string; coll: string };
    /* cast: the same, without "coll" */
    const noColl = { db: "other" } as unknown as { db: string; coll: string };
    t.commands.clear();
    for (const target of [noDb, noColl, {} as never]) {
      /* the aggregation callback runs when aggregate() is called: the error is thrown before anything is sent */
      expect(() => People.aggregate((p) => p.limit(1).out(target))).toThrow(ConfigurationError);
      expect(() => People.aggregate((p) => p.limit(1).out(target))).toThrow(
        `$out: a target object needs both "db" and "coll"`,
      );
    }
    expect(t.commands.byName("aggregate").length).toBe(0);
  });

  test("server-side JavaScript (fn.accumulator, fn.function) is refused before anything is sent", async () => {
    /* as never: both operators are compile errors; this is the call of a JavaScript caller. */
    const accumulator = {
      init: () => 0,
      accumulate: (n: number) => n + 1,
      accumulateArgs: [],
      merge: (a: number, b: number) => a + b,
    };
    await expect(
      People.aggregate((p) => p.group(() => ({ _id: null, count: fn.accumulator(accumulator as never) }))).exec(),
    ).rejects.toThrow(/"\$accumulator" runs JavaScript on the server and is not supported/);
    const fn1 = { body: (n: number) => n + 1, args: [1] };
    await expect(
      People.aggregate((p) => p.project(() => ({ next: fn.function(fn1 as never) }))).exec(),
    ).rejects.toThrow(/"\$function" runs JavaScript on the server and is not supported/);
    expect(t.commands.byName("aggregate")).toHaveLength(0);
  });

  test("an unknown explain verbosity is a QueryError before anything is sent", () => {
    /* as never: the type names the three levels; this is the call of a JavaScript caller. */
    expect(() => People.aggregate((p) => p.limit(1)).explain("nope" as never)).toThrow(QueryError);
  });

  test("`$merge` into an object without `coll` is a ConfigurationError (`db` is optional)", async () => {
    /* cast: the runtime form the type refuses */
    const noColl = { db: "other" } as unknown as { coll: string };
    expect(() => People.aggregate((p) => p.limit(1).merge({ into: noColl }))).toThrow(
      `$merge: a target object needs "coll"`,
    );
    await People.aggregate((p) => p.match({ role: "admin" }).merge({ into: { coll: "m_merge_no_db" } }));
    expect(await t.mongo.db.collection("m_merge_no_db").countDocuments()).toBe(1);
  });
});
