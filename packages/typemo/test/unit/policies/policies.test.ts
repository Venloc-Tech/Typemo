import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { StrictModeError } from "../../../src/errors/strict-mode-error.ts";
import {
  EmptyLogicalPolicy,
  EmptyUpdatePolicy,
  Filters,
  HiddenPolicy,
  ImmutablePolicy,
  LimitPolicy,
  ModelOperations,
  Pipeline,
  RequireFilterPolicy,
  SanitizePolicy,
  SchemaCompiler,
  UndefinedPolicy,
} from "../../../src/internal.ts";
import type { ExecutionPlan } from "../../../src/operation/pipeline/execution-plan.ts";
import { Account, Plain } from "../../fixtures/steps/step-entities.ts";
import { PlanCapture, StepHarness } from "../../fixtures/steps/step-harness.ts";

/* Every policy has a negative test (and the positive case it must not break). */

const capture = new PlanCapture();
const Accounts = new ModelOperations(Account, capture);
const id = new ObjectId();
const schema = SchemaCompiler.compileModel(Account);
/** Hands `value` to a policy without the static types getting in the way. */
// biome-ignore lint/suspicious/noExplicitAny: policies judge input beyond the static types on purpose.
const loose = (value: unknown): any => value;

/** The shape of a `StrictModeError` with the given `reason`. */
const strict = (reason: string) => ({ name: "StrictModeError", reason });

describe("UndefinedPolicy", () => {
  test("undefined anywhere in a filter, update, document or pipeline is refused with its path", () => {
    expect(() => UndefinedPolicy.check({ a: { $in: [1, undefined] } }, "filter")).toThrow(StrictModeError);
    expect(() => UndefinedPolicy.check({ $set: { a: undefined } }, "update")).toThrow(/update\.\$set\.a/);
    expect(() => UndefinedPolicy.check([{ $match: { x: undefined } }], "pipeline")).toThrow(/pipeline\.0\.\$match\.x/);
    expect(() => UndefinedPolicy.check({ a: null, b: [1] }, "filter")).not.toThrow();
  });

  test("an insert document with undefined is refused before any cast", async () => {
    await expect(
      StepHarness.full(StepHarness.insert(Account, [{ name: "a", email: "e", age: undefined }])),
    ).rejects.toMatchObject(strict("undefined"));
  });
});

describe("EmptyLogicalPolicy", () => {
  test("empty $and/$or/$nor in a filter, nested or in $pull, is refused; an $expr $and is not a filter", () => {
    expect(() => EmptyLogicalPolicy.filter({ $or: [] }, "filter")).toThrow(StrictModeError);
    expect(() => EmptyLogicalPolicy.filter({ $and: [{ $nor: [] }] }, "filter")).toThrow(/\$nor/);
    expect(() => EmptyLogicalPolicy.filter({ a: { $elemMatch: { $or: [] } } }, "filter")).toThrow(StrictModeError);
    expect(() => EmptyLogicalPolicy.filter({ $expr: { $and: [] } }, "filter")).not.toThrow();
  });

  test("in aggregation $match stages, also inside $lookup sub-pipelines", async () => {
    const plan: ExecutionPlan = {
      op: "aggregate",
      entity: Plain,
      pipeline: [{ $lookup: { from: "x", as: "y", pipeline: [{ $match: { $or: [] } }] } }],
      aggregateOptions: {},
      options: {},
    };
    await expect(StepHarness.full(plan)).rejects.toMatchObject(strict("empty-logical"));
  });
});

describe("RequireFilterPolicy", () => {
  test.each([
    "updateOne",
    "updateMany",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndUpdate",
    "findOneAndReplace",
    "findOneAndDelete",
  ] as const)("%s with {} is refused", (kind) => {
    expect(() => RequireFilterPolicy.check(kind, {})).toThrow(StrictModeError);
  });

  test("find with {} is allowed; updateOne/deleteOne/updateMany/deleteMany refuse it; Filters.all() is the explicit 'every document'", async () => {
    expect(() => RequireFilterPolicy.check("find", {})).not.toThrow();
    /* a one-document write with an empty filter changes an arbitrary document: refused at run time, through the steps */
    await expect(StepHarness.full(await capture.plan(loose(Accounts).deleteOne({})))).rejects.toMatchObject(
      strict("empty-filter"),
    );
    await expect(
      StepHarness.full(await capture.plan(loose(Accounts).updateOne({}, { $set: { name: "x" } }))),
    ).rejects.toMatchObject(strict("empty-filter"));
    await expect(StepHarness.full(await capture.plan(loose(Accounts).deleteMany({})))).rejects.toMatchObject(
      strict("empty-filter"),
    );
    const all = await StepHarness.full(await capture.plan(Accounts.deleteMany(Filters.all<Account>())));
    expect(all.filter).toEqual({ _id: { $exists: true } });
  });

  test("bulkWrite updateMany/deleteMany are checked per operation", async () => {
    const plan: ExecutionPlan = {
      op: "bulkWrite",
      entity: Account,
      ordered: true,
      options: {},
      operations: [{ deleteOne: { filter: { _id: id } } }, { deleteMany: { filter: {} } }],
    };
    await expect(StepHarness.full(plan)).rejects.toMatchObject(strict("empty-filter"));
  });
});

describe("LimitPolicy", () => {
  test("limit ≤ 0, fractional or negative skip are refused", () => {
    expect(() => LimitPolicy.limit(0, "limit")).toThrow(StrictModeError);
    expect(() => LimitPolicy.limit(-3, "limit")).toThrow(StrictModeError);
    expect(() => LimitPolicy.limit(1.5, "limit")).toThrow(StrictModeError);
    expect(() => LimitPolicy.skip(-1, "skip")).toThrow(StrictModeError);
    expect(() => LimitPolicy.limit(10, "limit")).not.toThrow();
  });

  test("a plan that bypassed the builder and a $limit stage are checked", async () => {
    const plan = await capture.plan(Accounts.find({}).limit(5));
    await expect(StepHarness.full(loose({ ...plan, limit: 0 }))).rejects.toMatchObject(strict("limit"));
    const aggregate: ExecutionPlan = {
      op: "aggregate",
      entity: Plain,
      pipeline: [{ $limit: 0 }],
      aggregateOptions: {},
      options: {},
    };
    await expect(StepHarness.full(aggregate)).rejects.toMatchObject(strict("limit"));
  });
});

describe("EmptyUpdatePolicy", () => {
  test("no operator, an empty operator, an empty pipeline", () => {
    expect(() => EmptyUpdatePolicy.check({}, "updateOne")).toThrow(StrictModeError);
    expect(() => EmptyUpdatePolicy.check({ $set: {} }, "updateOne")).toThrow(/\$set/);
    expect(() => EmptyUpdatePolicy.check([], "updateOne")).toThrow(/pipeline/);
    expect(() => EmptyUpdatePolicy.check({ $set: { a: 1 } }, "updateOne")).not.toThrow();
  });

  test("a bulkWrite update with {} is refused (it does not come through the builder)", async () => {
    const plan: ExecutionPlan = {
      op: "bulkWrite",
      entity: Account,
      ordered: true,
      options: {},
      operations: [{ updateOne: { filter: { _id: id }, update: {} } }],
    };
    await expect(StepHarness.full(plan)).rejects.toMatchObject(strict("empty-update"));
  });
});

describe("ImmutablePolicy", () => {
  test("$set/$unset/$inc/$rename of an immutable path (or _id) are refused; $setOnInsert is allowed", () => {
    expect(() => ImmutablePolicy.update(schema, { $set: { email: "x" } })).toThrow(StrictModeError);
    expect(() => ImmutablePolicy.update(schema, { $unset: { email: "" } })).toThrow(StrictModeError);
    expect(() => ImmutablePolicy.update(schema, { $set: { _id: id } })).toThrow(StrictModeError);
    expect(() => ImmutablePolicy.update(schema, { $set: { createdAt: new Date() } })).toThrow(StrictModeError);
    /* `immutable` of `_id` binds the root `_id` only; a subdocument `_id` may be written. */
    expect(() => ImmutablePolicy.update(schema, { $set: { "items.0._id": id } })).not.toThrow();
    expect(() =>
      ImmutablePolicy.update(schema, { $set: { "items.0": { _id: id, name: "a", price: 1 } } }),
    ).not.toThrow();
    expect(() => ImmutablePolicy.update(schema, { $setOnInsert: { email: "x" } })).not.toThrow();
    expect(() => ImmutablePolicy.update(schema, { $push: { items: { name: "a", price: 1 } } })).not.toThrow();
  });

  test("an update pipeline writing an immutable field, or rewriting the whole document, is refused", () => {
    expect(() => ImmutablePolicy.pipeline(schema, [{ $set: { email: "x" } }])).toThrow(StrictModeError);
    expect(() => ImmutablePolicy.pipeline(schema, [{ $replaceWith: { a: 1 } }])).toThrow(/whole document/);
    expect(() => ImmutablePolicy.pipeline(schema, [{ $set: { name: "x" } }])).not.toThrow();
  });

  test("a whole-document stage that carries every immutable field unchanged is allowed", () => {
    const carried = { email: "$email", createdAt: "$createdAt" };
    expect(() => ImmutablePolicy.pipeline(schema, [{ $replaceWith: { ...carried, name: "x" } }])).not.toThrow();
    expect(() =>
      ImmutablePolicy.pipeline(schema, [{ $replaceRoot: { newRoot: { ...carried, name: "x" } } }]),
    ).not.toThrow();
    expect(() => ImmutablePolicy.pipeline(schema, [{ $replaceWith: "$$ROOT" }])).not.toThrow();
    expect(() =>
      ImmutablePolicy.pipeline(schema, [{ $replaceWith: { $mergeObjects: ["$$ROOT", { name: "x" }] } }]),
    ).not.toThrow();
    expect(() => ImmutablePolicy.pipeline(schema, [{ $project: { email: 1, createdAt: 1, name: 1 } }])).not.toThrow();
    expect(() => ImmutablePolicy.pipeline(schema, [{ $project: { name: 0 } }])).not.toThrow();
  });

  test("a whole-document stage that changes or drops an immutable field is refused, naming the field", () => {
    const refused = (stage: Record<string, unknown>, fields: string) =>
      expect(() => ImmutablePolicy.pipeline(schema, [stage as never])).toThrow(fields);
    refused({ $replaceWith: { email: "$email", name: "x" } }, "createdAt");
    refused({ $replaceWith: { email: "x", createdAt: "$createdAt" } }, "email");
    refused({ $replaceWith: { email: "$createdAt", createdAt: "$createdAt" } }, "email");
    refused({ $replaceWith: "$nested" }, "createdAt, email");
    refused({ $replaceWith: { $mergeObjects: ["$$ROOT", { email: "x" }] } }, "email");
    refused({ $replaceWith: { $mergeObjects: [{ name: "x" }, "$$ROOT"] } }, "createdAt, email");
    refused({ $project: { name: 1 } }, "createdAt, email");
    refused({ $project: { email: 0 } }, "email");
    refused({ $project: { email: 1, createdAt: 1, _id: 0 } }, "createdAt, email");
    refused({ $project: { email: 1, "createdAt.x": 1 } }, "createdAt");
  });

  test("a replacement's immutable fields become a guard of the filter (the server compares them)", async () => {
    const plan = await capture.plan(
      Accounts.replaceOne({ _id: id }, loose({ name: "a", email: "A@x.io", tags: [], items: [] })),
    );
    const ctx = await StepHarness.full(plan);
    expect(ctx.filter).toEqual({ $and: [{ _id: id }, { $expr: { $eq: ["$email", { $literal: "a@x.io" }] } }] });
  });

  test("a replacement that carries a service field is refused before anything is sent", async () => {
    const plan = await capture.plan(
      Accounts.replaceOne({ _id: id }, loose({ name: "a", email: "a@x.io", tags: [], items: [], __v: 3 })),
    );
    await expect(StepHarness.full(plan)).rejects.toMatchObject(strict("immutable"));
  });
});

describe("StrictPathPolicy", () => {
  test("unknown paths in filter, update, projection, sort and distinct are refused", async () => {
    await expect(StepHarness.full(await capture.plan(Accounts.find(loose({ nope: 1 }))))).rejects.toMatchObject(
      strict("unknown-path"),
    );
    await expect(
      StepHarness.full(await capture.plan(Accounts.updateOne({ _id: id }, loose({ $set: { nope: 1 } })))),
    ).rejects.toMatchObject(strict("unknown-path"));
    await expect(
      StepHarness.full(await capture.plan(Accounts.find({}).select(loose({ nope: 1 })))),
    ).rejects.toMatchObject(strict("unknown-path"));
    await expect(
      StepHarness.full(await capture.plan(Accounts.find({}).sort(loose({ nope: 1 })))),
    ).rejects.toMatchObject(strict("unknown-path"));
    await expect(StepHarness.full(await capture.plan(Accounts.distinct(loose("nope"))))).rejects.toMatchObject(
      strict("unknown-path"),
    );
  });
});

describe("SanitizePolicy (every filter position)", () => {
  test.each([
    [{ $where: "1" }, "JavaScript"],
    [{ $and: [{ $where: "1" }] }, "JavaScript"],
    [{ $expr: { $function: { body: "", args: [], lang: "js" } } }, "JavaScript"],
    [{ $gt: 1 }, "field operator"],
    [{ name: { $and: [] } }, "top-level"],
    [{ name: { $foo: 1 } }, "not a query operator"],
    [{ name: { $ne: null, x: 1 } }, "mixes operators"],
    [{ name: { $eq: { $ne: null } } }, "inside a value"],
    [{ name: { $in: [{ $gt: "" }] } }, "inside a value"],
    [{ address: { city: { $ne: 1 } } }, "inside a value"],
  ])("%j is refused (%s)", (filter, message) => {
    expect(() => SanitizePolicy.filter(filter, "filter")).toThrow(message);
  });

  test("valid typed filters pass untouched", () => {
    expect(() =>
      SanitizePolicy.filter(
        { name: { $in: ["a"] }, $or: [{ age: { $gt: 1 } }], tags: { $all: [{ $elemMatch: { $eq: "a" } }] } },
        "f",
      ),
    ).not.toThrow();
    expect(() =>
      SanitizePolicy.filter(
        { loc: { $near: { $geometry: { type: "Point", coordinates: [0, 0] }, $maxDistance: 5 } } },
        "f",
      ),
    ).not.toThrow();
    expect(() => SanitizePolicy.filter({ $text: { $search: "x" } }, "f")).not.toThrow();
  });

  test("$pull conditions, arrayFilters and every aggregation filter position are sanitized", async () => {
    expect(() => SanitizePolicy.update({ $pull: { items: { $where: "1" } } })).toThrow(/JavaScript/);
    expect(() => SanitizePolicy.stages([{ $facet: { a: [{ $match: { $where: "1" } }] } }], "p")).toThrow(/JavaScript/);
    expect(() =>
      SanitizePolicy.stages([{ $graphLookup: { restrictSearchWithMatch: { x: { $eq: { $gt: 1 } } } } }], "p"),
    ).toThrow(/inside a value/);
    expect(() => SanitizePolicy.stages([{ $group: { _id: null, a: { $accumulator: {} } } }], "p")).toThrow(
      /JavaScript/,
    );
    const plan = await capture.plan(
      Accounts.updateOne(
        { _id: id },
        loose({ $set: { "items.$[i].price": 1 } }),
        loose({ arrayFilters: [{ "i.price": { $gt: 0 } }] }),
      ),
    );
    await expect(
      StepHarness.full(loose({ ...plan, arrayFilters: [{ "i.price": { $where: "1" } }] })),
    ).rejects.toMatchObject(strict("sanitize"));
  });
});

describe("HiddenPolicy", () => {
  const plain = SchemaCompiler.compileModel(Plain);
  const none = () => undefined;

  test("$unset of hidden fields first, unless included; after a first-only stage", () => {
    expect(HiddenPolicy.stages([{ $match: { title: "x" } }], plain, [], none)).toEqual([
      { $unset: ["secret"] },
      { $match: { title: "x" } },
    ]);
    expect(HiddenPolicy.stages([{ $match: {} }], plain, ["secret"], none)).toEqual([{ $match: {} }]);
    expect(HiddenPolicy.stages([{ $geoNear: {} }, { $limit: 1 }], plain, [], none)).toEqual([
      { $geoNear: {} },
      { $unset: ["secret"] },
      { $limit: 1 },
    ]);
  });

  test("joined documents: $lookup sub-pipeline, $unionWith pipeline, after $graphLookup", () => {
    const lookup = (collection: string) => (collection === "s_plain" ? plain : undefined);
    expect(
      HiddenPolicy.stages(
        [{ $lookup: { from: "s_plain", localField: "a", foreignField: "b", as: "j" } }],
        undefined,
        [],
        lookup,
      ),
    ).toEqual([
      { $lookup: { from: "s_plain", localField: "a", foreignField: "b", as: "j", pipeline: [{ $unset: ["secret"] }] } },
    ]);
    expect(HiddenPolicy.stages([{ $unionWith: "s_plain" }], undefined, [], lookup)).toEqual([
      { $unionWith: { coll: "s_plain", pipeline: [{ $unset: ["secret"] }] } },
    ]);
    expect(
      HiddenPolicy.stages(
        [{ $graphLookup: { from: "s_plain", startWith: "$a", connectFromField: "a", connectToField: "b", as: "g" } }],
        undefined,
        [],
        lookup,
      ),
    ).toEqual([
      { $graphLookup: { from: "s_plain", startWith: "$a", connectFromField: "a", connectToField: "b", as: "g" } },
      { $unset: ["g.secret"] },
    ]);
  });

  test("through the pipeline: Pipeline.from(Plain) never hands out `secret`", async () => {
    const ctx = await StepHarness.full(StepHarness.aggregate(Plain, Pipeline.from(Plain).limit(2).plan()));
    expect(ctx.pipeline).toEqual([{ $unset: ["secret"] }, { $limit: 2 }]);
  });
});
