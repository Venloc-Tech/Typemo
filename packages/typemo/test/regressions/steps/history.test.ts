import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { StrictModeError } from "../../../src/errors/strict-mode-error.ts";
import { CastError, ModelOperations, QueryError, SanitizePolicy, untrusted } from "../../../src/internal.ts";
import type { ExecutionPlan } from "../../../src/operation/pipeline/execution-plan.ts";
import { Account } from "../../fixtures/steps/step-entities.ts";
import { PlanCapture, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * Regressions of research/mongoose/M11-history/history.yaml (`how_to_test`) for the pipeline steps and policies:
 * every hole of Mongoose's `sanitizeFilter`, the empty-filter entries, the cast-mutation entries, casting of
 * geo/bitwise operands, setters in filters, defaults and timestamps on upsert, prototype keys.
 */

const capture = new PlanCapture();
const Accounts = new ModelOperations(Account, capture);
const id = new ObjectId();
// biome-ignore lint/suspicious/noExplicitAny: regressions pass input beyond the static types on purpose.
const loose = (value: unknown): any => value;
const sanitize = { name: "StrictModeError", reason: "sanitize" };

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
};

describe("sanitizeFilter holes (one point for every filter)", () => {
  test("H016: countDocuments and cursor() are sanitized like find", async () => {
    const injected = loose({ name: { $eq: { $ne: null } } });
    await expect(StepHarness.full(await capture.plan(Accounts.countDocuments(injected)))).rejects.toMatchObject(
      sanitize,
    );
    const find = await capture.plan(Accounts.find(injected));
    await expect(StepHarness.full(loose({ ...find, mode: { kind: "cursor" } }))).rejects.toMatchObject(sanitize);
    await expect(StepHarness.full(await capture.plan(Accounts.distinct("name", injected)))).rejects.toMatchObject(
      sanitize,
    );
  });

  test("H063: operators nested in $nor (and $and/$or) are checked like top-level ones", () => {
    expect(() => SanitizePolicy.filter({ $nor: [{ name: { $eq: { $gt: "" } } }] }, "filter")).toThrow(StrictModeError);
    expect(() => SanitizePolicy.filter({ $nor: [{ $where: "sleep(1)" }] }, "filter")).toThrow(/JavaScript/);
    expect(() => SanitizePolicy.filter({ $or: [{ $and: [{ name: { $in: [{ $ne: 1 }] } }] }] }, "filter")).toThrow(
      StrictModeError,
    );
  });

  test("H164: an array on a scalar path is not an implicit $in", async () => {
    await expect(
      StepHarness.full(await capture.plan(Accounts.find(loose({ name: ["a", "b"] })))),
    ).rejects.toBeInstanceOf(CastError);
  });

  test("H420: an operator object from untrusted input where a scalar value is expected", async () => {
    // `{ name: req.body.name }` with `{ $ne: null }`: `name` is not nullable, so the operand is refused by the cast.
    await expect(
      StepHarness.full(await capture.plan(Accounts.find(loose({ name: { $ne: null } })))),
    ).rejects.toBeInstanceOf(CastError);
    // An operator object INSIDE an operand is data, never an operator.
    await expect(
      StepHarness.full(await capture.plan(Accounts.find(loose({ name: { $in: [{ $gt: "" }] } })))),
    ).rejects.toMatchObject(sanitize);
  });

  test('H420: `{ name: { $gt: "" } }` is a valid typed filter; from outside, untrusted() refuses it', async () => {
    // Written by the application, the operator is the typed grammar (there is no trusted() wrapping).
    const plan = await StepHarness.full(await capture.plan(Accounts.find({ name: { $gt: "" } })));
    expect(plan.filter).toEqual({ nm: { $gt: "" } }); // (Account stores name under dbName "nm")
    // The request body `{ "name": { "$gt": "" } }` marked as untrusted: refused before a plan exists.
    const body = JSON.parse('{ "name": { "$gt": "" } }') as { name: unknown };
    expect(() => Accounts.find({ name: untrusted<string>(loose(body.name)) })).toThrow(StrictModeError);
    expect(() => Accounts.find({ name: untrusted<string>(loose(body.name)) })).toThrow(
      /query selector injection\); validate the input/,
    );
  });

  test("H145 (CVE-2025-23061): $where in a populate match, also nested in $and/$or, is refused", async () => {
    const plan = await capture.plan(Accounts.find({}));
    const withPopulate = loose({
      ...plan,
      populate: [{ path: "x", match: { $and: [{ $or: [{ $where: "this.a" }] }] }, populate: [] }],
    });
    await expect(StepHarness.full(withPopulate)).rejects.toThrow(/JavaScript/);
  });

  test("$where, $function and $accumulator are refused everywhere", async () => {
    await expect(StepHarness.full(await capture.plan(Accounts.find(loose({ $where: "1" }))))).rejects.toMatchObject(
      sanitize,
    );
    const aggregate: ExecutionPlan = {
      op: "aggregate",
      entity: Account,
      pipeline: [
        {
          $lookup: {
            from: "s_accounts",
            as: "a",
            pipeline: [{ $match: { $expr: { $function: { body: "1", args: [], lang: "js" } } } }],
          },
        },
      ],
      aggregateOptions: {},
      options: {},
    };
    await expect(StepHarness.full(aggregate)).rejects.toThrow(/JavaScript/);
  });
});

describe("empty filters", () => {
  test("H090: findOne(null) is an error at build time; findOne() without a filter means every document", () => {
    expect(() => Accounts.findOne(loose(null))).toThrow(QueryError);
    expect(() => Accounts.findOne()).not.toThrow();
  });

  test("H300: an unknown filter key is an error, never dropped to {} (deleteMany would delete everything)", async () => {
    await expect(
      StepHarness.full(await capture.plan(Accounts.deleteMany(loose({ nmae: "Ann" })))),
    ).rejects.toMatchObject({
      reason: "unknown-path",
    });
    await expect(
      StepHarness.full(await capture.plan(Accounts.deleteMany(loose({ $or: [{ nope: 1 }] })))),
    ).rejects.toMatchObject({
      reason: "unknown-path",
    });
  });
});

describe("no mutation of input", () => {
  test("H127: the cast of a filter does not mutate the user's objects", async () => {
    const filter = deepFreeze({ age: { $in: [1, 2] }, name: " x " });
    const plan = await capture.plan(Accounts.find(filter));
    await StepHarness.full(plan);
    expect(filter).toEqual({ age: { $in: [1, 2] }, name: " x " });
  });

  test("H196: $or arrays are not mutated", async () => {
    const or = deepFreeze([{ name: "a" }]);
    await StepHarness.full(await capture.plan(Accounts.find(loose({ $or: or }))));
    expect(or).toEqual([{ name: "a" }]);
  });

  test("H211: a bulkWrite update with a subdocument does not mutate it", async () => {
    const address = deepFreeze({ city: "X", zip: null });
    const plan: ExecutionPlan = deepFreeze({
      op: "bulkWrite",
      entity: Account,
      ordered: true,
      options: {},
      operations: [{ updateOne: { filter: { _id: id }, update: { $set: { address } } } }],
    });
    const ctx = await StepHarness.full(plan);
    expect(address).toEqual({ city: "X", zip: null });
    expect(ctx.operations).not.toBe(plan.operations);
  });
});

describe("casting of operands", () => {
  test("H026: geo operands keep numbers; a string coordinate is refused (Typemo does not convert)", async () => {
    const plan = await capture.plan(
      Accounts.find(loose({ "address.city": { $near: { $geometry: { type: "Point", coordinates: ["1", "2"] } } } })),
    );
    await expect(StepHarness.cast(plan)).rejects.toBeInstanceOf(CastError);
  });

  test("H146: $bitsAllSet on an int32 path", async () => {
    const ctx = await StepHarness.cast(await capture.plan(Accounts.find(loose({ level: { $bitsAllSet: [1, 2] } }))));
    expect(ctx.filter).toEqual({ level: { $bitsAllSet: [1, 2] } });
  });

  test("H508: setters (lowercase) apply to filter values once; $regex is not touched", async () => {
    const ctx = await StepHarness.cast(
      await capture.plan(Accounts.find(loose({ email: "A@B", $or: [{ email: { $regex: "A" } }] }))),
    );
    expect(ctx.filter).toEqual({ email: "a@b", $or: [{ email: { $regex: "A" } }] });
  });

  test("H027: casting $in twice does not grow shared state of the schema", async () => {
    const plan = await capture.plan(Accounts.find({ email: { $in: ["A", "B"] } }));
    const first = await StepHarness.cast(plan);
    const second = await StepHarness.cast(plan);
    expect(first.filter).toEqual(second.filter);
    expect(first.filter).toEqual({ email: { $in: ["a", "b"] } });
  });
});

describe("defaults and timestamps in updates", () => {
  const sent = async (update: Record<string, unknown>, filter: Record<string, unknown>, upsert: boolean) => {
    /* An upsert must be able to insert a valid document: the required fields come from the filter's equality. */
    const given = upsert ? { name: "n", email: "n@x.test", ...filter } : filter;
    const ctx = await StepHarness.full(
      await capture.plan(Accounts.updateOne(loose(given), loose(update), loose({ upsert }))),
    );
    return ctx.update as Record<string, Record<string, unknown>>;
  };

  test("H021: no $setOnInsert.createdAt without upsert", async () => {
    expect((await sent({ $set: { age: 1 } }, { _id: id }, false)).$setOnInsert).toBeUndefined();
  });

  test("H402: upsert writes the defaults in $setOnInsert", async () => {
    expect((await sent({ $set: { age: 1 } }, { _id: id }, true)).$setOnInsert).toMatchObject({ plan: "free", __v: 0 });
  });

  test("H450: a default is not applied to a path the update writes below or above", async () => {
    const update = await sent({ $set: { plan: "pro" } }, { _id: id }, true);
    expect(update.$setOnInsert?.plan).toBeUndefined();
  });

  test("H056: a path fixed by the filter's equality gets no default; __proto__ in the filter pollutes nothing", async () => {
    const update = await sent({ $set: { age: 1 } }, { plan: "pro" }, true);
    expect(update.$setOnInsert?.plan).toBeUndefined();
    const polluted = JSON.parse('{"__proto__": {"polluted": 1}}') as Record<string, unknown>;
    await expect(
      StepHarness.full(await capture.plan(Accounts.updateOne(loose(polluted), { $set: { age: 1 } }, { upsert: true }))),
    ).rejects.toMatchObject({
      reason: "unknown-path",
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("H036: the user's own $setOnInsert.createdAt is kept on upsert", async () => {
    const at = new Date(0);
    expect((await sent({ $setOnInsert: { createdAt: at } }, { _id: id }, true)).$setOnInsert?.createdAt).toEqual(at);
  });
});

describe("prototype keys (H502)", () => {
  test("__proto__, constructor, prototype as filter or update keys are unknown paths", async () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const filter = JSON.parse(`{"${key}": {"x": 1}}`) as Record<string, unknown>;
      await expect(StepHarness.full(await capture.plan(Accounts.find(loose(filter))))).rejects.toMatchObject({
        reason: "unknown-path",
      });
      const update = JSON.parse(`{"$set": {"${key}.x": 1}}`) as Record<string, unknown>;
      await expect(
        StepHarness.full(await capture.plan(Accounts.updateOne({ _id: id }, loose(update)))),
      ).rejects.toMatchObject({
        reason: "unknown-path",
      });
    }
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
