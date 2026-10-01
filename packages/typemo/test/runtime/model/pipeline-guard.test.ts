/*
 * On the real server: an update pipeline does not bypass validation. A value the pipeline COMPUTES for a field
 * with constraints (`min`, `max`, `enum`, `minLength`, `maxLength`, `match`, `required`) is checked by the server
 * itself — the filter gets `$expr` over the same expression — so an invalid result is never written, and a
 * refused update is a `ValidationError`. A CONSTANT is cast and validated before anything is sent; removing a
 * required field is refused before anything is sent.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { CastError, Entity, fn, type Model, Prop, Schema, Timestamped, ValidationError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A nested object with a constrained counter. */
@Schema()
class Stock {
  @Prop(() => Number, { min: 0 })
  onHand?: number;
}

/** An array element with a constrained quantity. */
@Schema()
class Line {
  @Prop(() => Number, { min: 0 })
  qty!: number;
}

/** A root with constrained fields of every guarded kind. */
@Schema({ collection: "pg_accounts" })
class Account extends Timestamped(Entity) {
  @Prop(() => String, { required: true, minLength: 2, maxLength: 8, match: /^[a-z]+$/ })
  owner!: string;

  @Prop(() => Number, { min: 0, max: 100, dbName: "bal" })
  balance?: number;

  @Prop(() => String, { enum: ["open", "closed"] })
  state?: "open" | "closed";

  @Prop(() => Date, { min: new Date("2000-01-01T00:00:00Z") })
  since?: Date;

  @Prop(() => [String], { required: true })
  tags!: string[];

  @Prop(() => Number)
  free?: number;

  @Prop(() => Stock)
  stock?: Stock;

  @Prop(() => [Line])
  lines?: Line[];
}

const t = ModelLifecycle.useTypemo("pg");
const ann = new ObjectId();
const bob = new ObjectId();
let Accounts: Model<Account>;

/**
 * The raw accounts collection.
 * @returns The driver collection.
 */
const raw = () => t.mongo.db.collection("pg_accounts");

/**
 * Reads an account straight from the collection.
 * @param id The account id.
 * @returns The stored raw document.
 */
const stored = async (id: ObjectId) => raw().findOne({ _id: id });

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
  Accounts = t.connection.model(Account);
  await raw().deleteMany({});
  await raw().insertMany([
    {
      _id: ann,
      owner: "ann",
      bal: 10,
      state: "open",
      tags: ["a"],
      free: 1,
      stock: { onHand: 2 },
      lines: [{ qty: 1 }],
      createdAt: new Date("2020-01-01T00:00:00Z"),
    },
    { _id: bob, owner: "bob", bal: 95, state: "open", tags: [] },
  ]);
  t.commands.clear();
});

describe("a computed value is guarded by the server", () => {
  test("min: a result below the minimum is not written and is a ValidationError", async () => {
    const error = await refused(
      Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ balance: fn.add(f.balance, -50) }))),
    );
    expect(error.issues.map((issue) => [issue.path.join("."), issue.reason, issue.value])).toEqual([
      ["balance", "min", -40],
    ]);
    expect((await stored(ann))?.bal).toBe(10);
  });

  test("in range: applied in ONE round trip; the filter carries the guard in database names", async () => {
    const result = await Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ balance: fn.add(f.balance, 5) })));
    expect(result.modifiedCount).toBe(1);
    expect((await stored(ann))?.bal).toBe(15);
    expect(t.commands.byName("find").length).toBe(0);
    const [command] = t.commands.byName("update");
    const filter = command?.command.updates[0].q as { $and: [unknown, { $expr: unknown }] };
    expect(filter.$and[0]).toEqual({ _id: ann });
    expect(JSON.stringify(filter.$and[1].$expr)).toContain('"$bal"');
    expect(JSON.stringify(filter.$and[1].$expr)).not.toContain("$balance");
  });

  test("max, through findOneAndUpdate and updateMany", async () => {
    const one = await refused(
      Accounts.findOneAndUpdate({ _id: bob }, (p) => p.set((f) => ({ balance: fn.add(f.balance, 10) }))).lean(),
    );
    expect(one.issues.map((issue) => [issue.path.join("."), issue.reason, issue.value])).toEqual([
      ["balance", "max", 105],
    ]);
    /* updateMany: the documents the guard would skip are found before the write, nothing is written. */
    const many = await refused(
      Accounts.updateMany({ state: "open" }, (p) => p.set((f) => ({ balance: fn.add(f.balance, 10) }))),
    );
    expect(many.issues[0]?.reason).toBe("max");
    expect((await stored(ann))?.bal).toBe(10);
    expect((await stored(bob))?.bal).toBe(95);
  });

  test("a missing document is still 'no document', not a ValidationError", async () => {
    const result = await Accounts.updateOne({ _id: new ObjectId() }, (p) =>
      p.set((f) => ({ balance: fn.add(f.balance, 1) })),
    );
    expect(result.matchedCount).toBe(0);
  });

  test("enum, minLength, maxLength, match of a computed string", async () => {
    const state = await refused(
      Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ state: fn.concat(f.state, "ed") }))),
    );
    expect(state.issues.map((issue) => [issue.path.join("."), issue.reason, issue.value])).toEqual([
      ["state", "enum", "opened"],
    ]);
    const long = await refused(
      Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ owner: fn.concat(f.owner, "abcdefgh") }))),
    );
    expect(long.issues.map((issue) => issue.reason)).toEqual(["maxLength"]);
    const short = await refused(
      Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ owner: fn.substrCP(f.owner, 0, 1) }))),
    );
    expect(short.issues.map((issue) => issue.reason)).toEqual(["minLength"]);
    const pattern = await refused(
      Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ owner: fn.concat(f.owner, "9") }))),
    );
    expect(pattern.issues.map((issue) => issue.reason)).toEqual(["match"]);
    expect(await stored(ann)).toMatchObject({ owner: "ann", state: "open" });
    /* A valid computed string is written. */
    await Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ owner: fn.concat(f.owner, "a") })));
    expect((await stored(ann))?.owner).toBe("anna");
  });

  test("required: a computed null is refused", async () => {
    const error = await refused(
      Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ owner: fn.cond(fn.gt(f.free, 0), null, f.owner) }))),
    );
    expect(error.issues.map((issue) => [issue.path.join("."), issue.reason])).toEqual([["owner", "required"]]);
    expect((await stored(ann))?.owner).toBe("ann");
  });

  test("a date bound and a nested path", async () => {
    const date = await refused(
      Accounts.updateOne({ _id: ann }, (p) =>
        p.set((f) => ({ since: fn.dateSubtract({ startDate: f.createdAt, unit: "year", amount: 500 }) })),
      ),
    );
    expect(date.issues.map((issue) => issue.reason)).toEqual(["min"]);
    const nested = await refused(
      Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ "stock.onHand": fn.add(f.stock.onHand, -5) }))),
    );
    expect(nested.issues.map((issue) => [issue.path.join("."), issue.reason, issue.value])).toEqual([
      ["stock.onHand", "min", -3],
    ]);
    await Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ "stock.onHand": fn.add(f.stock.onHand, -2) })));
    expect((await stored(ann))?.stock).toEqual({ onHand: 0 });
  });

  test("a field without constraints is not guarded: the filter is the user's", async () => {
    await Accounts.updateOne({ _id: ann }, (p) => p.set((f) => ({ free: fn.add(f.free, -50) })));
    expect((await stored(ann))?.free).toBe(-49);
    const [command] = t.commands.byName("update");
    expect(command?.command.updates[0].q).toEqual({ _id: ann });
  });

  test("a later stage that reads what an earlier stage wrote cannot be guarded: refused before sending", async () => {
    const error = await refused(
      Accounts.updateOne({ _id: ann }, (p) =>
        p.set((f) => ({ free: fn.add(f.free, 1) })).set((f) => ({ balance: fn.add(f.free, 1) })),
      ),
    );
    expect(error.issues[0]?.path.join(".")).toBe("balance");
    expect(t.commands.byName("update").length).toBe(0);
    /* A later stage that reads untouched fields is guarded as usual. */
    await Accounts.updateOne({ _id: ann }, (p) =>
      p.set((f) => ({ free: fn.add(f.free, 1) })).set((f) => ({ balance: fn.add(f.balance, 1) })),
    );
    expect(await stored(ann)).toMatchObject({ free: 2, bal: 11 });
  });

  test("upsert and bulkWrite with a guarded value are refused before sending", async () => {
    await refused(
      Accounts.updateOne({ _id: new ObjectId() }, (p) => p.set((f) => ({ balance: fn.add(f.balance, 1) })), {
        upsert: true,
      }),
    );
    await refused(
      Accounts.bulkWrite([
        { updateOne: { filter: { _id: ann }, update: (p) => p.set((f) => ({ balance: fn.add(f.balance, 1) })) } },
      ]),
    );
    expect(t.commands.byName("update").length).toBe(0);
  });
});

describe("bulkWrite takes an update pipeline", () => {
  test("an update pipeline of an updateOne runs, typed like Model.updateOne", async () => {
    const result = await Accounts.bulkWrite([
      { updateOne: { filter: { _id: ann }, update: (p) => p.set((f) => ({ free: fn.add(f.free, 5) })) } },
    ]);
    expect(result.modifiedCount).toBe(1);
    expect((await stored(ann))?.free).toBe(6);
  });
});

describe("constants are cast and validated before anything is sent", () => {
  test("a constant of the wrong type is a CastError", async () => {
    const error = await Accounts.updateOne({ _id: ann }, (p) => p.set(() => ({ balance: "abc" as never })))
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CastError);
    expect(t.commands.byName("update").length).toBe(0);
    expect((await stored(ann))?.bal).toBe(10);
  });

  test("a constant that breaks a constraint is a ValidationError", async () => {
    const low = await refused(Accounts.updateOne({ _id: ann }, (p) => p.set(() => ({ balance: -1 }))));
    expect(low.issues.map((issue) => [issue.path.join("."), issue.reason])).toEqual([["balance", "min"]]);
    const state = await refused(Accounts.updateOne({ _id: ann }, (p) => p.set(() => ({ state: "lost" }))));
    expect(state.issues.map((issue) => issue.reason)).toEqual(["enum"]);
    /* `null` on a path that is not nullable is refused by the cast, as in `$set`. */
    const owner = await Accounts.updateOne({ _id: ann }, (p) => p.set(() => ({ owner: null as never })))
      .exec()
      .catch((caught: unknown) => caught);
    expect(owner).toBeInstanceOf(CastError);
    expect((owner as CastError).reason).toBe("null");
    expect(t.commands.byName("update").length).toBe(0);
  });

  test("a valid constant is written with no guard and no extra read", async () => {
    await Accounts.updateOne({ _id: ann }, (p) => p.set(() => ({ balance: 42, state: "closed" })));
    expect(await stored(ann)).toMatchObject({ bal: 42, state: "closed" });
    expect(t.commands.byName("update")[0]?.command.updates[0].q).toEqual({ _id: ann });
  });
});

describe("a required field cannot be removed", () => {
  test("unset of a required field is refused; an optional one is removed", async () => {
    const error = await refused(Accounts.updateOne({ _id: ann }, (p) => p.unset("tags")));
    expect(error.issues.map((issue) => [issue.path.join("."), issue.reason])).toEqual([["tags", "required"]]);
    expect(t.commands.byName("update").length).toBe(0);
    await Accounts.updateOne({ _id: ann }, (p) => p.unset("free"));
    expect(await stored(ann)).not.toHaveProperty("free");
    expect((await stored(ann))?.tags).toEqual(["a"]);
  });
});
