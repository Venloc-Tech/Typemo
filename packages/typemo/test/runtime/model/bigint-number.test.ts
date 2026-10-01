/*
 * On the real server: a `BigInt` field accepts a JavaScript number only when it is a safe integer. Any other
 * number (fractional, beyond `Number.MAX_SAFE_INTEGER`, NaN, Infinity) is a `CastError` that says to pass a
 * `bigint` or a decimal integer string — on create, in `$set` and `$inc`, and in filters.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { CastError, type CastReason, Entity, type Model, Prop, Schema } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A document with an int64 counter. */
@Schema({ collection: "bigint_numbers" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => BigInt)
  points?: bigint;
}

const t = ModelLifecycle.useTypemo("bigint_numbers");
let Accounts: Model<Account>;

beforeEach(() => {
  Accounts = t.connection.model(Account);
});

/** Numbers that are not safe integers, with the reason of the cast error. */
const UNSAFE: readonly (readonly [number, CastReason])[] = [
  [1.5, "integer"],
  [2 ** 53, "precision"],
  [Number.NaN, "finite"],
  [Number.POSITIVE_INFINITY, "finite"],
];

/**
 * Awaits an operation that must fail the cast of `points`.
 * @param run The operation.
 * @param reason The expected reason.
 */
const expectCastError = async (run: () => PromiseLike<unknown>, reason: CastReason): Promise<void> => {
  let error: unknown;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(CastError);
  const cast = error as CastError;
  expect(cast.reason).toBe(reason);
  expect(cast.message).toContain('pass a bigint (5n) or a decimal integer string ("5")');
};

describe("a number in a BigInt field", () => {
  test("a safe integer is accepted and stored as int64 (create, $set, $inc, filter)", async () => {
    /* cast: a JS number passed on purpose to test the run-time BigInt check */
    const created = await Accounts.create({ owner: "ann", points: 5 as unknown as bigint });
    expect(created.points).toBe(5n);
    /* cast: a JS number passed on purpose to test the run-time BigInt check */
    await Accounts.updateOne({ _id: created._id }, { $set: { points: 7 as unknown as bigint } });
    /* cast: a JS number passed on purpose to test the run-time BigInt check */
    await Accounts.updateOne({ _id: created._id }, { $inc: { points: 3 as unknown as bigint } });
    const raw = await t.mongo.db.collection("bigint_numbers").findOne({ _id: created._id, points: { $type: "long" } });
    expect(raw?.points).toBe(10n);
    /* cast: a JS number passed on purpose to test the run-time BigInt check */
    expect(await Accounts.countDocuments({ points: 10 as unknown as bigint })).toBe(1);
  });

  for (const [value, reason] of UNSAFE) {
    test(`${value} is a CastError (${reason}) with the hint, everywhere`, async () => {
      const created = await Accounts.create({ owner: "bob", points: 1n });
      /* cast: a JS number passed on purpose to test the run-time BigInt check */
      const points = value as unknown as bigint;
      await expectCastError(() => Accounts.create({ owner: "eve", points }), reason);
      await expectCastError(() => Accounts.updateOne({ _id: created._id }, { $set: { points } }), reason);
      await expectCastError(() => Accounts.updateOne({ _id: created._id }, { $inc: { points } }), reason);
      await expectCastError(() => Accounts.countDocuments({ points }), reason);
      await expectCastError(() => Accounts.find({ points: { $gt: points } }).exec(), reason);
      /* Nothing was written. */
      expect((await t.mongo.db.collection("bigint_numbers").findOne({ _id: created._id }))?.points).toBe(1n);
      expect(await t.mongo.db.collection("bigint_numbers").countDocuments({ owner: "eve" })).toBe(0);
    });
  }
});
