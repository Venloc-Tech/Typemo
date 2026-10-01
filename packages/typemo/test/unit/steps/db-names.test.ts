import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { ConfigurationError, DbNames, fn, ModelOperations, Pipeline } from "../../../src/internal.ts";
import { OperationView } from "../../../src/operation/steps/operation-view.ts";
import type { ResultShape } from "../../../src/operation/steps/result-shape.ts";
import { Account, Click, Event, Plain } from "../../fixtures/steps/step-entities.ts";
import { PlanCapture, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * Code paths → `dbName` names in every position of a query, an update and an aggregation while the documents are
 * stored documents; and the result rows back (`DbNames.toCode`).
 */

const capture = new PlanCapture();
const Accounts = new ModelOperations(Account, capture);
const id = new ObjectId();
/** A plain object of unknown values. */
type Loose = Record<string, unknown>;

/** Hands `value` to the builders without the static types getting in the way. */
// biome-ignore lint/suspicious/noExplicitAny: translation tables use paths beyond the static types on purpose.
const loose = (value: unknown): any => value;

describe("queries: code paths → stored names", () => {
  test.each([
    [{ name: "Ann" }, { nm: "Ann" }],
    [{ "items.name": "a" }, { "its.n": "a" }],
    [{ "items.0.name": "a" }, { "its.0.n": "a" }],
    [{ "address.city": "Paris" }, { "ad.c": "Paris" }],
    [{ "scores.math": 1 }, { "sc.math": 1 }],
    [{ items: { $elemMatch: { name: "a" } } }, { its: { $elemMatch: { n: "a" } } }],
    [{ $or: [{ name: "a" }, { tags: "t" }] }, { $or: [{ nm: "a" }, { tg: "t" }] }],
    [{ address: { city: "Paris", zip: null } }, { ad: { c: "Paris", zip: null } }],
  ])("filter %j → %j", async (filter, expected) => {
    const ctx = await StepHarness.full(await capture.plan(Accounts.find(loose(filter))));
    expect(ctx.filter).toEqual(expected);
  });

  test("$expr field references are translated", async () => {
    const ctx = await StepHarness.full(await capture.plan(Accounts.find({ $expr: (f) => fn.gt(f.name, f.email) })));
    expect(ctx.filter).toEqual({ $expr: { $gt: ["$nm", "$email"] } });
  });

  test("projection (Hidden excluded by default) and sort", async () => {
    const plan = await capture.plan(
      Accounts.find({}).select({ name: 1, "address.city": 1 }).sort({ "items.price": -1 }),
    );
    const ctx = await StepHarness.full(plan);
    expect(ctx.projection).toEqual({ nm: 1, "ad.c": 1 });
    expect(ctx.sort).toEqual([["its.price", -1]]);
    const hidden = await StepHarness.full(await capture.plan(Accounts.find({})));
    expect(hidden.projection).toEqual({ pw: 0 });
    const plus = await StepHarness.full(await capture.plan(Accounts.find({}).select({ "+password": true })));
    expect(plus.projection).toBeUndefined();
  });

  test("distinct path", async () => {
    const ctx = await StepHarness.full(await capture.plan(Accounts.distinct("items.name")));
    expect(ctx.locals.get(Symbol.for("never"))).toBeUndefined();
    const [value] = [...ctx.locals.values()].filter((v) => typeof v === "string");
    expect(value).toBe("its.n");
  });

  test("updates: operator paths, positional paths, arrayFilters, $push $sort, $rename target, pushed subdocuments", async () => {
    const plan = await capture.plan(
      Accounts.updateOne(
        { _id: id },
        loose({
          $set: { name: "B", "items.$[i].name": "x", "address.city": "Rome" },
          $push: { items: { $each: [{ name: "n", price: 1 }], $sort: { name: 1 } } },
        }),
        loose({ arrayFilters: [{ "i.name": "a" }] }),
      ),
    );
    const ctx = await StepHarness.full(plan);
    const update = ctx.update as Loose;
    expect(Object.keys(update.$set as Loose).sort()).toEqual(["ad.c", "its.$[i].n", "nm", "updatedAt"]);
    const push = (update.$push as Loose).its as Loose;
    expect(push.$sort).toEqual({ n: 1 });
    expect(Object.keys((push.$each as Loose[])[0] as Loose)).toEqual(["_id", "n", "qty", "price"]);
    expect(ctx.arrayFilters).toEqual([{ "i.n": "a" }]);
    const rename = await capture.plan(Accounts.updateOne({ _id: id }, loose({ $rename: { tags: "tags2" } })));
    await expect(StepHarness.full(rename)).rejects.toMatchObject({ reason: "unknown-path" });
  });

  test("inserted documents are stored under their stored names", async () => {
    const ctx = await StepHarness.full(
      StepHarness.insert(Account, [
        { name: "A", email: "a@b.c", tags: [], items: [{ name: "i", price: 1 }], address: { city: "X", zip: null } },
      ]),
    );
    const [document] = ctx.documents as Loose[];
    expect(Object.keys(document as Loose).sort()).toEqual(
      ["__v", "_id", "ad", "createdAt", "email", "its", "nm", "plan", "tg", "updatedAt"].sort(),
    );
    expect((document as Loose).ad).toEqual({ c: "X", zip: null });
  });
});

describe("aggregation: stored names while the documents are stored documents", () => {
  const run = async (pipeline: { plan(): Parameters<typeof StepHarness.aggregate>[1] }, models = [Account]) => {
    const ctx = await StepHarness.full(StepHarness.aggregate(Account, pipeline.plan()), models);
    return { stages: ctx.pipeline, shape: ctx.locals.get(OperationView.RESULT_SHAPE) as ResultShape };
  };

  test("$match/$sort/$project/$unset/$unwind/$group keys and references; Hidden unset first", async () => {
    const { stages, shape } = await run(
      Pipeline.from(Account)
        .match({ name: "Ann", "items.price": { $gt: 1 } })
        .sort({ age: -1 })
        .unwind("$items")
        .project({ name: 1, "address.city": 1, items: 1 }),
    );
    expect(stages).toEqual([
      { $unset: ["pw"] },
      { $match: { nm: "Ann", "its.price": { $gt: 1 } } },
      { $sort: { age: -1 } },
      { $unwind: "$its" },
      { $project: { nm: 1, "ad.c": 1, its: 1 } },
    ]);
    expect(shape.schema?.name).toBe("Account");
    const grouped = await run(Pipeline.from(Account).group((f) => ({ _id: f.address.city, n: fn.sum(f.age) })));
    expect(grouped.stages?.[1]).toEqual({ $group: { _id: "$ad.c", n: { $sum: "$age" } } });
    expect(grouped.shape.schema).toBeUndefined();
  });

  test("$addFields keeps stored names for schema paths, new names as given", async () => {
    const { stages } = await run(Pipeline.from(Account).addFields((f) => ({ label: fn.toUpper(f.name) })));
    expect(stages?.[1]).toEqual({ $addFields: { label: { $toUpper: "$nm" } } });
  });

  test("$lookup: localField/foreignField, sub-pipeline in the joined schema; rows translate back by shape", async () => {
    const { stages, shape } = await run(
      Pipeline.from(Account).lookup({ from: Account, localField: "name", foreignField: "name", as: "same" }),
    );
    expect(stages?.[1]).toEqual({
      $lookup: { from: "s_accounts", localField: "nm", foreignField: "nm", as: "same", pipeline: [{ $unset: ["pw"] }] },
    });
    const row = { _id: id, nm: "A", ad: { c: "X" }, same: [{ _id: id, nm: "B", its: [{ n: "i" }] }] };
    expect(DbNames.toCode(shape, row)).toEqual({
      _id: id,
      name: "A",
      address: { city: "X" },
      same: [{ _id: id, name: "B", items: [{ name: "i" }] }],
    });
  });

  test("untranslatable values are errors, not silent stored names", async () => {
    await expect(
      run(Pipeline.from(Account).group((f) => ({ _id: null, all: fn.push(f.address) }))),
    ).rejects.toBeInstanceOf(ConfigurationError);
    await expect(run(Pipeline.from(Account).addFields(() => ({ nm: fn.literal(1) })))).rejects.toThrow(/stored name/);
  });

  test("a model without aliases is left as it is (fast path)", async () => {
    const ctx = await StepHarness.full(StepHarness.aggregate(Plain, Pipeline.from(Plain).match({ title: "x" }).plan()));
    expect(ctx.pipeline).toEqual([{ $unset: ["secret"] }, { $match: { title: "x" } }]);
  });

  test("a discriminator model: its $match first, aliased fields of the discriminator translated", async () => {
    const ctx = await StepHarness.full(StepHarness.aggregate(Click, Pipeline.from(Click).match({ url: "u" }).plan()));
    expect(ctx.pipeline).toEqual([{ $match: { kind: "click" } }, { $match: { u: "u" } }]);
    const base = await StepHarness.full(StepHarness.aggregate(Event, Pipeline.from(Event).limit(1).plan()));
    expect(base.pipeline).toEqual([{ $limit: 1 }]);
  });
});
