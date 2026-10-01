import { beforeEach, describe, expect, test } from "bun:test";
import { Decimal128, ObjectId } from "mongodb";
import { StrictModeError } from "../../../src/errors/strict-mode-error.ts";
import { CastError, ModelOperations, QueryError, ValidationError } from "../../../src/internal.ts";
import { Account, SEEN_CONTEXTS } from "../../fixtures/steps/step-entities.ts";
import { PlanCapture, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * `castUpdate`: every update operator by the type of its path, positional paths and arrayFilters by the element
 * of their `$[id]`. Values stay in code form until encode.
 */

const capture = new PlanCapture();
const Accounts = new ModelOperations(Account, capture);
const id = new ObjectId();

/** A plain object of unknown values. */
type Loose = Record<string, unknown>;

/** The plan of `Accounts.updateOne` for `update` and `options`, bypassing the static types. */
const updatePlan = async (update: Loose, options: Loose = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: runtime matrix: updates beyond the static types on purpose.
  capture.plan(Accounts.updateOne({ _id: id }, update as any, options as any));

/** The update after the cast step. */
const castUpdate = async (update: Loose, options: Loose = {}): Promise<Loose> => {
  const ctx = await StepHarness.cast(await updatePlan(update, options));
  return ctx.update as Loose;
};

beforeEach(() => {
  SEEN_CONTEXTS.length = 0;
});

describe("update operators by field type", () => {
  test("$set casts values (setters too), whole subdocuments strictly, null only on nullable paths", async () => {
    expect(await castUpdate({ $set: { name: " Ann ", lastLogin: null } })).toEqual({
      $set: { name: "Ann", lastLogin: null },
    });
    const updated = await castUpdate({ $set: { address: { city: "Paris", zip: null } } });
    expect(updated).toEqual({ $set: { address: { city: "Paris", zip: null } } });
    await expect(castUpdate({ $set: { age: null } })).rejects.toBeInstanceOf(CastError);
    await expect(castUpdate({ $set: { address: { city: "Paris", street: "x" } } })).rejects.toThrow(/street/);
  });

  test("$inc/$mul only on numbers, operand of the field's own kind (int64 → bigint, Decimal128)", async () => {
    expect(await castUpdate({ $inc: { age: 1, visits: 2n } })).toEqual({ $inc: { age: 1, visits: 2n } });
    expect(await castUpdate({ $mul: { balance: Decimal128.fromString("1.5") } })).toMatchObject({ $mul: {} });
    await expect(castUpdate({ $inc: { name: 1 } })).rejects.toBeInstanceOf(StrictModeError);
    await expect(castUpdate({ $inc: { age: "1" } })).rejects.toBeInstanceOf(CastError);
  });

  test("$min/$max/$currentDate/$unset/$rename", async () => {
    expect(await castUpdate({ $max: { age: 30 } })).toEqual({ $max: { age: 30 } });
    expect(await castUpdate({ $currentDate: { lastLogin: true } })).toEqual({ $currentDate: { lastLogin: true } });
    await expect(castUpdate({ $currentDate: { age: true } })).rejects.toBeInstanceOf(StrictModeError);
    expect(await castUpdate({ $unset: { age: 1 } })).toEqual({ $unset: { age: "" } });
    await expect(castUpdate({ $unset: { age: "yes" } })).rejects.toBeInstanceOf(CastError);
    await expect(castUpdate({ $rename: { age: "name" } })).rejects.toThrow(/types differ/);
  });

  test("$push/$addToSet cast elements ($each, $slice, $position, $sort by element paths)", async () => {
    expect(await castUpdate({ $push: { tags: "x" } })).toEqual({ $push: { tags: "x" } });
    const pushed = await castUpdate({
      $push: { items: { $each: [{ name: "a", price: 1 }], $slice: -5, $sort: { price: -1 } } },
    });
    const each = (pushed.$push as Loose).items as Loose;
    expect(each.$slice).toBe(-5);
    expect((each.$each as Loose[])[0]).toMatchObject({ name: "a", price: 1 });
    await expect(castUpdate({ $push: { items: { $each: [], $sort: { nope: 1 } } } })).rejects.toBeInstanceOf(
      StrictModeError,
    );
    await expect(castUpdate({ $addToSet: { tags: { $each: ["a"], $slice: 1 } } })).rejects.toBeInstanceOf(CastError);
    await expect(castUpdate({ $push: { age: 1 } })).rejects.toBeInstanceOf(StrictModeError);
  });

  test("$pull takes a condition on the element; $pullAll elements; $pop 1/-1", async () => {
    expect(await castUpdate({ $pull: { items: { price: { $gt: 5 } } } })).toEqual({
      $pull: { items: { price: { $gt: 5 } } },
    });
    expect(await castUpdate({ $pull: { tags: { $in: ["a"] } } })).toEqual({ $pull: { tags: { $in: ["a"] } } });
    expect(await castUpdate({ $pullAll: { tags: ["a", "b"] } })).toEqual({ $pullAll: { tags: ["a", "b"] } });
    await expect(castUpdate({ $pop: { tags: 2 } })).rejects.toBeInstanceOf(CastError);
  });

  test("positional paths and arrayFilters by the element of their $[id]", async () => {
    const ctx = await StepHarness.cast(
      await updatePlan(
        { $set: { "items.$[i].price": 3 } },
        { arrayFilters: [{ "i.name": "a", "i.price": { $gt: 1 } }] },
      ),
    );
    expect(ctx.update).toEqual({ $set: { "items.$[i].price": 3 } });
    expect(ctx.arrayFilters).toEqual([{ "i.name": "a", "i.price": { $gt: 1 } }]);
    await expect(
      StepHarness.cast(await updatePlan({ $set: { "items.$[i].price": 3 } }, { arrayFilters: [{ "i.price": "x" }] })),
    ).rejects.toBeInstanceOf(CastError);
    /* the positional $ needs a condition on its array in the filter (refused before sending otherwise) */
    const positional = await StepHarness.cast(
      await capture.plan(
        /* cast: an update beyond the static types on purpose (the runtime matrix) */
        Accounts.updateOne(
          { _id: id, "items.name": "a" } as never,
          { $set: { "items.$.price": 2, "tags.0": "z" } } as never,
        ),
      ),
    );
    expect(positional.update).toEqual({ $set: { "items.$.price": 2, "tags.0": "z" } });
    await expect(castUpdate({ $set: { "items.$.price": 2 } })).rejects.toBeInstanceOf(QueryError);
  });

  test("a path through an array without a positional token is refused (server code 28)", async () => {
    await expect(castUpdate({ $set: { "items.price": 1 } })).rejects.toMatchObject({ reason: "unknown-path" });
  });
});

describe("update validation (6.7)", () => {
  const validate = async (update: Loose, options: Loose = {}) => StepHarness.full(await updatePlan(update, options));

  test("$set runs the validators of the written value, with a typed context", async () => {
    await expect(validate({ $set: { age: 200 } })).rejects.toBeInstanceOf(ValidationError);
    await expect(validate({ $set: { name: "forbidden" } })).rejects.toThrow(/forbidden/);
    expect(SEEN_CONTEXTS.at(-1)).toMatchObject({ kind: "update", operator: "$set", path: "name", upsert: false });
  });

  test("$min/$max validate the operand (the result is it or the stored value)", async () => {
    await expect(validate({ $max: { age: 151 } })).rejects.toThrow(/at most 150/);
    await expect(validate({ $min: { age: -1 } })).rejects.toThrow(/at least 0/);
  });

  test("$push validates new elements, embedded `required` included", async () => {
    await expect(validate({ $push: { items: { name: "a", price: -1 } } })).rejects.toThrow(/at least 0/);
    await expect(validate({ $push: { items: { name: "a", price: 1, qty: 0 } } })).rejects.toThrow(/qty/);
  });

  test("$unset of a required path is a required issue; $inc is not validated (result unknown)", async () => {
    await expect(validate({ $unset: { name: "" } })).rejects.toThrow(/required/);
    await validate({ $inc: { age: 1000 } });
  });

  test("every issue is reported, not only the first", async () => {
    const error = await validate({ $set: { age: -5, name: "forbidden" } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues.map((issue) => issue.path.join("."))).toEqual(["age", "name"]);
  });
});
