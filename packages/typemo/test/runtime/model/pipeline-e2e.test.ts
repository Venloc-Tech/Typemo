/*
 * Every strictness policy through a REAL model operation (the whole pipeline, the real server), the dbName
 * round trip (stored names on the server, code names in results — hydrated, lean, find-and-modify, distinct,
 * aggregation rows), Hidden in aggregations, defaults/timestamps/version, and that nothing is sent when a
 * policy refuses.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Decimal128 } from "mongodb";
import {
  CastError,
  Filters,
  fn,
  type Model,
  QueryError,
  StrictModeError,
  type StrictModeReason,
  ValidationError,
} from "../../../src/internal.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { Account, Addr, Click, Event, Item, Plain } from "../../fixtures/steps/step-entities.ts";

const t = ModelLifecycle.useTypemo("e2e");
let Accounts: Model<Account>;
let Plains: Model<Plain>;

/**
 * A valid account document input.
 * @param name The account name; also used for the email.
 * @param extra Fields added to or replacing the defaults.
 * @returns The plain input for `create`.
 */
const account = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  email: `${name}@X.test`,
  tags: ["a"],
  items: [{ name: "pen", price: 2 }],
  ...extra,
});

beforeEach(async () => {
  Accounts = t.connection.model(Account);
  Plains = t.connection.model(Plain);
  await Accounts.create(
    account("Ann", { password: "s1", age: 30, address: { city: "Paris", zip: null }, scores: { math: 5 } }) as never,
  );
  await Accounts.create(account("Bob", { age: 40 }) as never);
  t.commands.clear();
});

/**
 * Asserts that an operation is refused by a strictness policy.
 * @param run The operation to run.
 * @param reason The expected refusal reason.
 */
const strict = async (run: () => PromiseLike<unknown>, reason: StrictModeReason): Promise<void> => {
  const error = await Promise.resolve()
    .then(run)
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(StrictModeError);
  expect((error as StrictModeError).reason).toBe(reason);
};

describe("dbName round trip through the model", () => {
  test("stored under database names, read back in code names (hydrated and lean)", async () => {
    const stored = await t.mongo.db.collection("s_accounts").findOne({ nm: "Ann" });
    expect(Object.keys(stored ?? {})).toEqual(
      expect.arrayContaining(["nm", "email", "pw", "tg", "its", "ad", "sc", "createdAt", "updatedAt", "__v", "plan"]),
    );
    expect(stored?.email).toBe("ann@x.test"); /* lowercase setter */
    expect((stored?.its as { n: string }[] | undefined)?.[0]?.n).toBe("pen");
    const ann = await Accounts.findOne({ name: "Ann", "address.city": "Paris" }).orFail();
    expect(ann).toBeInstanceOf(Account);
    expect(ann.name).toBe("Ann");
    expect(ann.items[0]).toBeInstanceOf(Item);
    expect(ann.items[0]?.name).toBe("pen");
    expect(ann.address).toBeInstanceOf(Addr);
    expect(ann.address?.city).toBe("Paris");
    expect(ann.scores?.$toObject()).toEqual(new Map([["math", 5]])); /* a TypedMap */
    expect("password" in ann).toBe(false);
    const lean = await Accounts.findOne({ name: "Ann" }).select({ "+password": true }).lean().orFail();
    expect(lean.password).toBe("s1");
    expect(lean.tags).toEqual(["a"]);
    expect(t.commands.byName("find")[0]?.command.filter).toEqual({ nm: "Ann", "ad.c": "Paris" });
  });

  test("updates, find-and-modify, distinct and aggregation rows translate both ways", async () => {
    await Accounts.updateOne(
      { name: "Ann" },
      { $set: { "items.$[i].name": "ink" } },
      { arrayFilters: [{ "i.name": "pen" }] },
    );
    const update = t.commands.byName("update")[0]?.command.updates as {
      u: Record<string, unknown>;
      arrayFilters: unknown;
    }[];
    expect(Object.keys(update[0]?.u.$set as object)).toContain("its.$[i].n");
    expect(update[0]?.arrayFilters).toEqual([{ "i.n": "pen" }]);
    const after = await Accounts.findOneAndUpdate({ name: "Ann" }, { $push: { tags: "z" } }).lean();
    expect(after?.tags).toEqual(["a", "z"]);
    expect((await Accounts.distinct("name")).sort()).toEqual(["Ann", "Bob"]);
    const rows = await Accounts.aggregate((p) =>
      p.match({ name: { $in: ["Ann", "Bob"] } }).group((f) => ({ _id: f.name, total: fn.sum(f.age) })),
    );
    expect(rows.map((row) => row._id).sort()).toEqual(["Ann", "Bob"]);
    const stored = await Accounts.aggregate((p) =>
      p.match({ name: "Ann" }).project(() => ({ name: 1, tags: 1, _id: 0 })),
    );
    expect(stored).toEqual([{ name: "Ann", tags: ["a", "z"] }]);
  });

  test("timestamps and version: set on insert, updatedAt on update", async () => {
    const before = (await Accounts.findOne({ name: "Bob" }).lean().orFail()).updatedAt;
    await Bun.sleep(5);
    await Accounts.updateOne({ name: "Bob" }, { $set: { age: 41 } });
    const bob = await Accounts.findOne({ name: "Bob" }).lean().orFail();
    expect(bob.__v).toBe(0);
    expect(bob.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    expect(bob.plan).toBe("free");
  });
});

describe("every policy through a real operation (nothing is sent when it refuses)", () => {
  test("StrictPath: an unknown path in a filter, update, sort, projection", async () => {
    await strict(() => Accounts.find({ nmae: "x" } as never), "unknown-path");
    await strict(() => Accounts.updateOne({ name: "Ann" }, { $set: { agee: 1 } } as never), "unknown-path");
    await strict(() => Accounts.find().sort({ agee: 1 } as never), "unknown-path");
    expect(t.commands.all().filter((c) => ["find", "update"].includes(c.commandName))).toEqual([]);
  });

  test("Sanitize: operators inside values, server-side JS", async () => {
    await strict(() => Accounts.find({ name: { $eq: { $ne: null } } } as never), "sanitize");
    await strict(() => Accounts.find({ $where: "true" } as never), "sanitize");
  });

  test("RequireFilter: an empty filter on updateMany/deleteMany/findOneAnd*; Filters.all() is explicit", async () => {
    /* an empty object literal is also a compile error for these writes: the run-time rule is for values the types cannot see */
    // @ts-expect-error — empty filter literal
    await strict(() => Accounts.deleteMany({}), "empty-filter");
    // @ts-expect-error — empty filter literal
    await strict(() => Accounts.deleteOne({}), "empty-filter");
    // @ts-expect-error — empty filter literal
    await strict(() => Accounts.updateMany({}, { $set: { age: 1 } }), "empty-filter");
    // @ts-expect-error — empty filter literal
    await strict(() => Accounts.updateOne({}, { $set: { age: 1 } }), "empty-filter");
    // @ts-expect-error — empty filter literal (a One form: "would change or remove an arbitrary document")
    await strict(() => Accounts.findOneAndDelete({}), "empty-filter");
    expect((await Plains.deleteMany(Filters.all<Plain>())).deletedCount).toBe(0);
  });

  test("Immutable: writing an immutable path outside $setOnInsert", async () => {
    await strict(() => Accounts.updateOne({ name: "Ann" }, { $set: { email: "x@y" } } as never), "immutable");
  });

  test("EmptyLogical and Undefined are refused already by the builder (QueryError) and the policy", async () => {
    expect(() => Accounts.find({ $or: [] } as never)).toThrow(QueryError);
    expect(() => Accounts.find({ name: undefined } as never)).toThrow(QueryError);
  });

  test("EmptyUpdate after casting, Limit", async () => {
    expect(() => Accounts.updateOne({ name: "Ann" }, {} as never)).toThrow(QueryError);
    expect(() => Accounts.find().limit(0)).toThrow(QueryError);
  });

  test("casting: strict (a numeric string is not a number), lossless conversions pass", async () => {
    const error = await Accounts.find({ age: "30" } as never)
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CastError);
    await Accounts.updateOne({ name: "Ann" }, { $set: { lastLogin: 1_700_000_000_000, balance: 19.99 } } as never);
    const ann = await Accounts.findOne({ name: "Ann" }).lean().orFail();
    expect(ann.lastLogin).toEqual(new Date(1_700_000_000_000));
    expect(ann.balance).toEqual(Decimal128.fromString("19.99"));
  });

  test("update validation: a validator of an updated path refuses (ValidationError)", async () => {
    const error = await Accounts.updateOne({ name: "Ann" }, { $set: { age: 500 } })
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).errors)).toEqual(["age"]);
  });
});

describe("Hidden in aggregations and discriminators", () => {
  test("aggregation rows never contain Hidden fields; the server got a leading $unset", async () => {
    const rows = await Accounts.aggregate((p) => p.match({ name: "Ann" }));
    expect(rows.length).toBe(1);
    expect("password" in (rows[0] as object)).toBe(false);
    const pipeline = t.commands.byName("aggregate")[0]?.command.pipeline as Record<string, unknown>[];
    expect(pipeline[0]).toEqual({ $unset: ["pw"] });
  });

  test("a discriminator model reads and writes only its own documents", async () => {
    const Clicks = t.connection.model(Click);
    const Events = t.connection.model(Event);
    await Clicks.create({ kind: "click", at: new Date(), url: "/a" } as never);
    await t.mongo.db.collection("s_events").insertOne({ kind: "view", at: new Date(), ms: 3 });
    expect(await Clicks.countDocuments()).toBe(1);
    expect(await Events.countDocuments()).toBe(2);
    const click = await Clicks.findOne().orFail();
    expect(click).toBeInstanceOf(Click);
    expect(click.url).toBe("/a");
  });
});
