import { describe, expect, test } from "bun:test";
import { Int32, ObjectId } from "mongodb";
import { StrictModeError } from "../../../src/errors/strict-mode-error.ts";
import { CastError, ModelOperations } from "../../../src/internal.ts";
import type { OperationContext } from "../../../src/operation/pipeline/operation-context.ts";
import { Account } from "../../fixtures/steps/step-entities.ts";
import { PlanCapture, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * The cast matrix of query operators by field type (the BSON casters, strict), pure (frozen input, new values).
 * The encode (dbName) is in `db-names.test.ts`.
 */

const capture = new PlanCapture();
const Accounts = new ModelOperations(Account, capture);

/** The filter of `Accounts.find(filter)` after the cast step. */
const castFilter = async (filter: Record<string, unknown>): Promise<Record<string, unknown>> => {
  // biome-ignore lint/suspicious/noExplicitAny: runtime matrix: filters beyond the static types on purpose.
  const plan = await capture.plan(Accounts.find(filter as any));
  const ctx: OperationContext = await StepHarness.cast(plan);
  return ctx.filter as Record<string, unknown>;
};

/** The filter of `Accounts.find(filter)` after every step, encoded to stored names. */
const encodeFilter = async (filter: Record<string, unknown>): Promise<Record<string, unknown>> => {
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  const plan = await capture.plan(Accounts.find(filter as any));
  const ctx = await StepHarness.full(plan);
  return ctx.filter as Record<string, unknown>;
};

describe("filter cast by field type", () => {
  test("ObjectId from a 24-hex string (safe list), kept as ObjectId", async () => {
    const id = new ObjectId();
    expect(await castFilter({ _id: id.toHexString() })).toEqual({ _id: id });
    expect(await castFilter({ _id: { $in: [id, id.toHexString()] } })).toEqual({ _id: { $in: [id, id] } });
  });

  test("comparison operators cast their operand; $in/$nin every element", async () => {
    expect(await castFilter({ age: { $gte: 18, $lt: 65, $nin: [30, 40] } })).toEqual({
      age: { $gte: 18, $lt: 65, $nin: [30, 40] },
    });
  });

  test("strict: no string → number, no fraction into int32, no NaN", async () => {
    await expect(castFilter({ age: "18" })).rejects.toBeInstanceOf(CastError);
    await expect(castFilter({ level: 1.5 })).rejects.toThrow(/Int32/);
    await expect(castFilter({ age: { $gt: Number.NaN } })).rejects.toBeInstanceOf(CastError);
  });

  test("the setters of a path apply to compared values (trim, lowercase), never to a regex", async () => {
    expect(await castFilter({ name: "  Bob  " })).toEqual({ name: "Bob" });
    expect(await castFilter({ email: "Ann@Example.TEST" })).toEqual({ email: "ann@example.test" });
    const regex = await castFilter({ email: /ANN/i });
    expect(regex.email).toEqual(/ANN/i);
    expect(await castFilter({ email: { $regex: "ANN", $options: "i" } })).toEqual({
      email: { $regex: "ANN", $options: "i" },
    });
  });

  test("null only on nullable paths; an absent field is $exists", async () => {
    expect(await castFilter({ lastLogin: null })).toEqual({ lastLogin: null });
    await expect(castFilter({ age: null })).rejects.toThrow(/nullable/);
    expect(await castFilter({ age: { $exists: false } })).toEqual({ age: { $exists: false } });
    await expect(castFilter({ age: { $exists: 1 } })).rejects.toBeInstanceOf(CastError);
  });

  test("arrays: an element, the whole array, $all/$size/$elemMatch", async () => {
    expect(await castFilter({ tags: "vip" })).toEqual({ tags: "vip" });
    expect(await castFilter({ tags: ["a", "b"] })).toEqual({ tags: ["a", "b"] });
    expect(await castFilter({ tags: { $all: ["a"], $size: 1 } })).toEqual({ tags: { $all: ["a"], $size: 1 } });
    await expect(castFilter({ tags: { $size: -1 } })).rejects.toBeInstanceOf(CastError);
    expect(await castFilter({ tags: { $elemMatch: { $in: ["a", "b"] } } })).toEqual({
      tags: { $elemMatch: { $in: ["a", "b"] } },
    });
    const id = new ObjectId();
    expect(
      await castFilter({ items: { $elemMatch: { _id: id.toHexString(), price: { $lt: 5 }, name: " x " } } }),
    ).toEqual({ items: { $elemMatch: { _id: id, price: { $lt: 5 }, name: " x " } } });
  });

  test("a path through an array of subdocuments reaches the element's field", async () => {
    expect(await castFilter({ "items.price": { $gt: 5 } })).toEqual({ "items.price": { $gt: 5 } });
    expect(await castFilter({ "items.0.price": 5 })).toEqual({ "items.0.price": 5 });
    await expect(castFilter({ "items.price": "5" })).rejects.toBeInstanceOf(CastError);
  });

  test("Map values by key, whole subdocuments by their schema", async () => {
    expect(await castFilter({ "scores.math": 5 })).toEqual({ "scores.math": 5 });
    await expect(castFilter({ "scores.math": "5" })).rejects.toBeInstanceOf(CastError);
    expect(await castFilter({ address: { zip: null, city: "Paris" } })).toEqual({
      address: { city: "Paris", zip: null },
    });
    await expect(castFilter({ address: { city: "Paris", street: "x" } })).rejects.toThrow(/street/);
  });

  test("$mod and $bits* only on integers; $regex only on strings", async () => {
    expect(await castFilter({ level: { $bitsAllSet: [1, 2] } })).toEqual({ level: { $bitsAllSet: [1, 2] } });
    expect(await castFilter({ age: { $mod: [2, 0] } })).toEqual({ age: { $mod: [2, 0] } });
    await expect(castFilter({ name: { $mod: [2, 0] } })).rejects.toBeInstanceOf(StrictModeError);
    await expect(castFilter({ name: { $bitsAllSet: 1 } })).rejects.toBeInstanceOf(StrictModeError);
    await expect(castFilter({ age: { $regex: "1" } })).rejects.toBeInstanceOf(StrictModeError);
    await expect(castFilter({ age: { $mod: [0, 1] } })).rejects.toBeInstanceOf(CastError);
  });

  test("$not and $type", async () => {
    expect(await castFilter({ age: { $not: { $gt: 5 } } })).toEqual({ age: { $not: { $gt: 5 } } });
    expect(await castFilter({ age: { $type: ["int", "double"] } })).toEqual({ age: { $type: ["int", "double"] } });
    await expect(castFilter({ age: { $type: "integer" } })).rejects.toBeInstanceOf(CastError);
  });

  test("an unknown path is a StrictModeError, never dropped", async () => {
    await expect(castFilter({ nmae: "x" })).rejects.toMatchObject({ name: "StrictModeError", reason: "unknown-path" });
    await expect(castFilter({ $or: [{ name: "a" }, { typo: 1 }] })).rejects.toMatchObject({ reason: "unknown-path" });
    await expect(castFilter({ "address.street": "x" })).rejects.toMatchObject({ reason: "unknown-path" });
  });

  test("the cast never mutates the plan's frozen values", async () => {
    const plan = await capture.plan(Accounts.find({ name: "  Bob ", age: { $in: [1, 2] } }));
    const before = JSON.stringify(plan.filter);
    const ctx = await StepHarness.full(plan);
    expect(JSON.stringify(plan.filter)).toBe(before);
    expect(Object.isFrozen(ctx.filter)).toBe(true);
    expect(ctx.filter).not.toBe(plan.filter);
  });
});

describe("filter encode: the wire form", () => {
  test("int32 paths go as Int32, database names as keys", async () => {
    const filter = await encodeFilter({ level: 5, name: "Ann" });
    expect(filter.level).toBeInstanceOf(Int32);
    expect(filter).toEqual({ level: new Int32(5), nm: "Ann" });
  });
});
