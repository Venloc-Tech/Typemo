/*
 * One rule for values that cannot be cast, on the real server: the error is always a `CastError` with the path of
 * the value, one error for the field; the constraints of that field (`min`, `enum`, validators) are not checked.
 * The same class at every depth (a root field, a subdocument field, an array element's field, a Map value) and on
 * every path: `Model.new(row)`, `$set`, `create`, updates, and a plain assignment, which cannot be intercepted and
 * is cast at the next `$validate()` or `$save()`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { CastError, Entity, type Model, Prop, Schema, Spec, Types, ValidationError } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A single subdocument with a constrained number. */
@Schema()
class CrAddress {
  @Prop(() => String)
  street?: string;

  @Prop(() => Number, { min: 0 })
  floor?: number;
}

/** An array element with a constrained number. */
@Schema()
class CrLine {
  @Prop(() => Number, { required: true, min: 1 })
  qty!: number;
}

/** Every depth a value can sit at. */
@Schema({ collection: "cr_ledgers" })
class CrLedger extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { min: 0 })
  balance?: number;

  @Prop(() => Types.ObjectId)
  customer?: ObjectId;

  @Prop(() => CrAddress)
  address?: CrAddress;

  @Prop(() => [CrLine])
  lines!: CrLine[];

  @Prop(() => Spec.map(Number))
  scores?: Map<string, number>;
}

const t = ModelLifecycle.useTypemo("cast_rule");
let Ledgers: Model<CrLedger>;

beforeEach(async () => {
  Ledgers = t.connection.model(CrLedger);
  t.commands.clear();
});

/**
 * The error `run` throws or rejects with.
 * @param run - The call.
 * @returns What it threw, or `undefined`.
 */
const errorOf = async (run: () => unknown): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
};

/**
 * Asserts a `CastError` at `path` (never a `ValidationError`, so no constraint issue rides along).
 * @param error - The error.
 * @param path - The expected path.
 */
const castAt = (error: unknown, path: string): void => {
  expect(error).toBeInstanceOf(CastError);
  expect(error).not.toBeInstanceOf(ValidationError);
  expect((error as CastError).path).toBe(path);
};

/** A stored ledger, read back hydrated. */
const stored = async () => {
  const created = await Ledgers.create({
    name: "L",
    balance: 5,
    address: { street: "Main", floor: 2 },
    lines: [{ qty: 3 }],
    scores: new Map([["a", 1]]),
  });
  t.commands.clear();
  return Ledgers.findById(created._id).orFail();
};

/** Whether a write reached the server since the last clear. */
const sent = () => [...t.commands.byName("insert"), ...t.commands.byName("update")].length > 0;

describe("a value that enters through a Typemo method is cast at once", () => {
  test("Model.new(row): CastError at the constructor, for a root field and a subdocument field", async () => {
    /* cast: values of the wrong type on purpose */
    castAt(await errorOf(() => Ledgers.new({ name: "a", lines: [], balance: "abc" as never })), "balance");
    castAt(await errorOf(() => Ledgers.new({ name: "a", lines: [{ qty: "x" as never }] })), "lines.0.qty");
  });

  test("$set, create and an update: CastError, the constraint of the field is not checked", async () => {
    const ledger = await stored();
    /* cast: a value of the wrong type on purpose */
    castAt(await errorOf(() => ledger.$set("balance", "abc" as never)), "balance");
    castAt(await errorOf(() => Ledgers.create({ name: "a", lines: [], balance: "abc" as never })), "balance");
    castAt(
      await errorOf(() => Ledgers.updateOne({ _id: ledger._id }, { $set: { balance: "abc" as never } })),
      "$set.balance" /* an update names the value by its place in the update */,
    );
    expect(sent()).toBe(false);
  });

  test("a Map value and an array element: CastError at once", async () => {
    const ledger = await stored();
    /* cast: values of the wrong type on purpose */
    castAt(await errorOf(() => ledger.scores?.set("b", "x" as never)), "scores.b");
    castAt(await errorOf(() => ledger.lines.push({ qty: "x" as never })), "lines.1.qty");
  });
});

describe("a plain assignment is cast at the next $validate() or $save(): the same CastError", () => {
  test("a root field of a new document: one CastError, no second error from min", async () => {
    const ledger = Ledgers.new({ name: "a", lines: [] });
    (ledger as { balance: unknown }).balance = "abc"; /* cast: a plain assignment of the wrong type on purpose */
    castAt(await errorOf(() => ledger.$validate()), "balance");
    castAt(await errorOf(() => ledger.$save()), "balance");
    expect(sent()).toBe(false);
  });

  test("a root field of a stored document, an ObjectId field", async () => {
    const ledger = await stored();
    (ledger as { customer: unknown }).customer = 5; /* cast: a plain assignment of the wrong type on purpose */
    castAt(await errorOf(() => ledger.$validate()), "customer");
    castAt(await errorOf(() => ledger.$save()), "customer");
    expect(sent()).toBe(false);
  });

  test("a subdocument field and an array element's field of a stored document", async () => {
    const ledger = await stored();
    (ledger.address as { floor: unknown }).floor = "abc"; /* cast: a plain assignment of the wrong type on purpose */
    castAt(await errorOf(() => ledger.$validate()), "address.floor");
    castAt(await errorOf(() => ledger.$save()), "address.floor");
    const other = await stored();
    (other.lines[0] as { qty: unknown }).qty = "abc"; /* cast: a plain assignment of the wrong type on purpose */
    castAt(await errorOf(() => other.$validate()), "lines.0.qty");
    castAt(await errorOf(() => other.$save()), "lines.0.qty");
    expect(sent()).toBe(false);
  });

  test("a subdocument field and an array element's field of a new document", async () => {
    const ledger = Ledgers.new({ name: "a", address: { floor: 1 }, lines: [{ qty: 1 }] });
    (ledger.address as { floor: unknown }).floor = "abc"; /* cast: a plain assignment of the wrong type on purpose */
    castAt(await errorOf(() => ledger.$validate()), "address.floor");
    castAt(await errorOf(() => ledger.$save()), "address.floor");
    const other = Ledgers.new({ name: "a", lines: [{ qty: 1 }] });
    (other.lines[0] as { qty: unknown }).qty = "abc"; /* cast: a plain assignment of the wrong type on purpose */
    castAt(await errorOf(() => other.$validate()), "lines.0.qty");
    castAt(await errorOf(() => other.$save()), "lines.0.qty");
    expect(sent()).toBe(false);
  });

  test("the cast failure comes first: the other fields' constraints are not reported with it", async () => {
    const ledger = Ledgers.new({ name: "a", lines: [] });
    (ledger as { balance: unknown }).balance = "abc"; /* cast: a plain assignment of the wrong type on purpose */
    (ledger as { name: unknown }).name = undefined; /* cast: a required field removed on purpose */
    castAt(await errorOf(() => ledger.$validate()), "balance");
  });

  test("a value that casts but breaks a constraint is a ValidationError; once fixed, the save goes through", async () => {
    const ledger = await stored();
    ledger.balance = -1;
    const invalid = await errorOf(() => ledger.$save());
    expect(invalid).toBeInstanceOf(ValidationError);
    expect((invalid as ValidationError).issues.map((issue) => issue.reason)).toEqual(["min"]);
    (ledger as { balance: unknown }).balance = "abc"; /* cast: a plain assignment of the wrong type on purpose */
    castAt(await errorOf(() => ledger.$save()), "balance");
    ledger.balance = 7;
    await ledger.$save();
    expect((await t.mongo.db.collection("cr_ledgers").findOne({ _id: ledger._id }))?.balance).toBe(7);
  });
});

describe("a stored id stays the same kind", () => {
  test("customer as an ObjectId saves", async () => {
    const ledger = await stored();
    const id = new ObjectId();
    ledger.customer = id;
    await ledger.$save();
    expect((await t.mongo.db.collection("cr_ledgers").findOne({ _id: ledger._id }))?.customer).toEqual(id);
  });
});
