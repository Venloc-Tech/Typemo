import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  type CursorSource,
  type FindPlan,
  fn,
  ModelOperations,
  type ModifyPlan,
  type OperationPlan,
  type PlanExecutor,
  ProjectionPlanner,
  QueryError,
  SchemaCompiler,
  type ValuePlan,
  type WritePlan,
} from "../../../src/internal.ts";
import { Article, Member } from "../../fixtures/query/query-entities.ts";

/*
 * Builders are immutable, plans are frozen copies (user input is never mutated nor aliased), and what needs no
 * schema is checked while the plan is built (QueryError).
 */

/** A plan executor that records the plans it is given and returns empty results. */
class RecordingExecutor implements PlanExecutor {
  readonly plans: OperationPlan[] = [];
  async execute(plan: OperationPlan): Promise<unknown> {
    this.plans.push(plan);
    return plan.op === "find" ? [] : plan.op === "countDocuments" ? 0 : null;
  }
  cursor(plan: FindPlan): CursorSource<unknown> {
    this.plans.push(plan);
    return { async *[Symbol.asyncIterator]() {} };
  }
}

const executor = new RecordingExecutor();
const Members = new ModelOperations(Member, executor);
const Articles = new ModelOperations(Article, executor);
const id = new ObjectId();

/** True when `value` is frozen at every depth (BSON values, dates and regular expressions excepted). */
const deepFrozen = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return true;
  if (value instanceof ObjectId || value instanceof Date || value instanceof RegExp) return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
};

describe("immutable builders and frozen plans", () => {
  test("every call returns a new builder; the previous one and its plan never change", () => {
    const base = Members.find({ age: { $gt: 1 } });
    const before = base.build();
    const next = base.where({ name: "x" }).select({ name: 1 }).sort({ age: 1 }).limit(5).lean();
    expect(base.build()).toEqual(before);
    expect(next.build()).not.toEqual(before);
    expect(deepFrozen(next.build())).toBe(true);
  });

  test("user input is frozen-safe: never mutated, never aliased by the plan", () => {
    const filter = Object.freeze({ tags: Object.freeze(["a"]), age: Object.freeze({ $gt: 1 }) });
    const update = Object.freeze({ $set: Object.freeze({ name: "x" }) });
    const projection = Object.freeze({ name: 1 as const });
    const findPlan = Members.find(filter).select(projection).build();
    const writePlan = Members.updateOne(filter, update).build() as WritePlan;
    expect(findPlan.filter).toEqual(filter);
    expect(findPlan.filter).not.toBe(filter);
    expect(findPlan.filter.tags).not.toBe(filter.tags);
    expect(writePlan.update).not.toBe(update);
    expect(filter).toEqual({ tags: ["a"], age: { $gt: 1 } });
  });

  test("a `__proto__` key of the input stays a plain key (no prototype change)", () => {
    const filter = JSON.parse('{"__proto__": {"polluted": true}, "name": "x"}') as Record<string, unknown>;
    const plan = new ModelOperations(Member, executor).find(filter as never).build();
    expect(Object.getPrototypeOf(plan.filter)).toBe(Object.prototype);
    expect(Object.hasOwn(plan.filter, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("$expr callbacks are compiled into the plan: the plan holds data only", () => {
    const plan = Members.find({ $expr: (f) => fn.gt(f.age, 1) }).build();
    expect(typeof plan.filter.$expr).toBe("object");
    expect(plan.filter.$expr).toEqual({ $gt: ["$age", 1] });
  });
});

describe("runtime twins of the type rules (QueryError)", () => {
  const throws = (build: () => unknown, message: RegExp): void => {
    expect(build).toThrow(QueryError);
    expect(build).toThrow(message);
  };

  test("undefined anywhere is refused, in filters, updates, where chains", () => {
    throws(() => Members.find({ name: undefined as never }), /undefined at "name"/);
    throws(() => Members.find({ $or: [{ age: { $gt: undefined as never } }] }), /undefined at "\$or\.0\.age\.\$gt"/);
    throws(() => Members.updateOne({ _id: id }, { $set: { name: undefined as never } }), /undefined at "\$set\.name"/);
    throws(
      () =>
        Members.find()
          .where("age")
          .gt(undefined as never),
      /undefined/,
    );
  });

  test("empty $and/$or/$nor at any depth, a function that is not $expr", () => {
    throws(() => Members.find({ $or: [] as never }), /\$or must be a non-empty array/);
    throws(() => Members.find({ $and: [{ $nor: [] as never }] }), /\$nor must be a non-empty array/);
    throws(() => Members.find({ name: (() => "x") as never }), /a function at "name"/);
  });

  test("sort words are normalized to 1 / -1 in the plan", () => {
    const plan = Members.find()
      .sort({ age: "asc", name: "descending" })
      .sort([["_id", "desc"]])
      .build() as FindPlan;
    expect(plan.sort).toEqual([
      ["age", 1],
      ["name", -1],
      ["_id", -1],
    ]);
    expect((Members.findOne().sort({ age: "ascending" }).build() as FindPlan).sort).toEqual([["age", 1]]);
  });

  test("limit is a positive integer, skip/batchSize non-negative integers, sort directions once per path", () => {
    throws(() => Members.find().limit(0), /limit must be a positive integer/);
    throws(() => Members.find().limit(1.5), /limit must be a positive integer/);
    throws(() => Members.find().skip(-1), /skip must be a non-negative integer/);
    throws(
      () => Members.find().sort({ age: "up" as never }),
      /must be 1, -1, "asc", "desc", "ascending" or "descending"/,
    );
    throws(() => Members.find().sort({ age: "ASC" as never }), /must be 1, -1/);
    throws(() => Members.find().sort({ age: 1 }).sort({ age: -1 }), /"age" is sorted twice/);
    throws(() => Members.find().timeoutMS(-5), /timeoutMS must be a non-negative integer/);
  });

  test("find-only settings on another operation (for JS callers; the types refuse them already)", () => {
    /* cast: bypasses the type to test the runtime guard — find-only settings on findOne (JS caller) */
    const one = Members.findOne() as unknown as { skip: (n: number) => unknown; cursor: () => unknown };
    throws(() => one.skip(1), /skip applies to find\(\) only/);
    throws(() => one.cursor(), /cursor applies to find\(\) only/);
    /* cast: bypasses the type to test the runtime guard — a findOneAnd-only setting on find (JS caller) */
    const many = Members.find() as unknown as { includeResultMetadata: () => unknown };
    throws(() => many.includeResultMetadata(), /includeResultMetadata applies to findOneAnd/);
  });

  test("projections: no mixing, `+field` only true, a key selected twice", () => {
    throws(
      () => Members.find().select({ name: 1, age: 0 } as never),
      /cannot mix inclusion \(name\) and exclusion \(age\)/,
    );
    throws(() => Members.find().select({ "+passwordHash": false } as never), /takes only true/);
    throws(() => Members.find().select({ name: 1 }).select({ name: 1 }), /"name" is selected twice/);
    throws(
      () =>
        Members.find()
          .select({ name: 1 })
          .select({ age: 0 } as never),
      /cannot mix/,
    );
    expect(Members.find().select({ name: 1, _id: 0 }).build().projection).toEqual({ name: 1, _id: 0 });
  });

  test("updates: empty, a non-operator key, an empty operator, a pipeline array, arrayFilters", () => {
    throws(() => Members.updateOne({ _id: id }, {} as never), /an empty update changes nothing/);
    throws(() => Members.updateOne({ _id: id }, { name: "x" } as never), /"name" is not an update operator/);
    throws(() => Members.updateOne({ _id: id }, { $set: {} } as never), /operator "\$set" is empty/);
    throws(() => Members.updateOne({ _id: id }, [{ $set: { name: "x" } }] as never), /pipeline builder/);
    throws(
      () => Members.updateOne({ _id: id }, (p) => p.unset("nickname"), { arrayFilters: [{ "x.a": 1 }] } as never),
      /not allowed with an update pipeline/,
    );
    const piped = Members.updateOne({ _id: id }, (p) => p.unset("nickname")).build() as WritePlan;
    expect(piped.update).toEqual([{ $unset: "nickname" }]);
    throws(
      () => Articles.updateOne({ _id: id }, { $set: { "revisions.$[r].note": "x" } }, { arrayFilters: [] as never }),
      /non-empty/,
    );
    throws(() => Articles.replaceOne({ _id: id }, { $set: { title: "t" } } as never), /a replacement has no operators/);
  });

  test("merge of another model's query; populate with an unknown option or an empty list", () => {
    throws(
      () => Members.find().merge(Articles.find() as never),
      /a query of Article cannot be merged into a query of Member/,
    );
    throws(() => Members.find().populate({ path: "bestFriend", selct: {} } as never), /unknown option "selct"/);
    throws(() => Members.find().populate([] as never), /an empty list/);
    throws(() => Members.find().textScore("a.b"), /invalid field name/);
  });
});

describe("plans", () => {
  test("where(path) conditions on one path merge; a repeated operator starts a new clause; overlaps go to $and", () => {
    expect(Members.find().where("age").gte(18).lt(65).build().filter).toEqual({ age: { $gte: 18, $lt: 65 } });
    expect(Members.find().where("age").gte(18).gte(20).build().filter).toEqual({
      $and: [{ age: { $gte: 18 } }, { age: { $gte: 20 } }],
    });
    expect(Members.find({ name: "a" }).where({ age: 1 }).build().filter).toEqual({ name: "a", age: 1 });
    expect(Members.find({ name: "a" }).where({ name: "b" }).build().filter).toEqual({
      $and: [{ name: "a" }, { name: "b" }],
    });
  });

  test("find-and-modify: `after` by default, delete returns `before`, upsert and metadata flags", () => {
    const update = Members.findOneAndUpdate({ name: "a" }, { $set: { age: 1 } }).build() as ModifyPlan;
    expect([update.returnDocument, update.upsert, update.includeResultMetadata]).toEqual(["after", false, false]);
    const before = Members.findOneAndUpdate(
      { name: "a" },
      { $set: { age: 1 } },
      { returnDocument: "before", upsert: true },
    ).build() as ModifyPlan;
    expect([before.returnDocument, before.upsert]).toEqual(["before", true]);
    expect((Members.findOneAndDelete({ name: "a" }).build() as ModifyPlan).returnDocument).toBe("before");
    const raw = Members.findOneAndReplace({ _id: id }, { name: "n", email: "e", tags: [] })
      .includeResultMetadata()
      .build() as ModifyPlan;
    expect(raw.includeResultMetadata).toBe(true);
  });

  test("values: exists is a lean findOne of _id; count window; distinct field", () => {
    const exists = Members.exists({ name: "a" }).build() as FindPlan;
    expect([exists.op, exists.lean, exists.projection]).toEqual(["findOne", true, { _id: 1 }]);
    const count = Members.countDocuments({ age: 1 }).skip(2).limit(3).build() as ValuePlan;
    expect([count.op, count.skip, count.limit]).toEqual(["countDocuments", 2, 3]);
    expect((Members.distinct("tags").build() as ValuePlan).field).toBe("tags");
  });

  test("textScore adds the $meta projection and sort entry; populate paths are kept as written", () => {
    const plan = Articles.find({ $text: { $search: "x" } })
      .select({ title: 1 })
      .textScore("s", { sort: true })
      .build() as FindPlan;
    expect(plan.projection).toEqual({ title: 1, s: { $meta: "textScore" } });
    expect(plan.sort).toEqual([["s", { $meta: "textScore" }]]);
    const populated = Members.find()
      .populate({ path: "favorites", populate: "author" })
      .populate("bestFriend")
      .build() as FindPlan;
    expect(populated.populate.map((entry) => entry.path)).toEqual(["favorites", "bestFriend"]);
    expect(populated.populate[0]?.populate.map((entry) => entry.path)).toEqual(["author"]);
    const replaced = Members.find()
      .populate({ path: "bestFriend", select: { name: 1 } })
      .populate("bestFriend")
      .build() as FindPlan;
    expect(replaced.populate).toEqual([{ path: "bestFriend", populate: [] }]);
  });

  test("a read runs once per builder (awaits share the result); a derived builder is a new query; cursor and explain are plans of the same query", async () => {
    const query = Members.find({ age: 1 });
    const start = executor.plans.length;
    const first = await query;
    const second = await query;
    await query.then((rows) => rows.length);
    expect(second).toBe(first);
    expect(executor.plans.length - start).toBe(1);
    await query.limit(1);
    expect(executor.plans.length - start).toBe(2);
    query.cursor();
    await Members.findOne().explain("executionStats");
    const [cursorPlan, explainPlan] = executor.plans.slice(-2) as FindPlan[];
    expect([cursorPlan?.mode, explainPlan?.mode]).toEqual([
      { kind: "cursor" },
      { kind: "explain", verbosity: "executionStats" },
    ]);
  });
});

describe("ProjectionPlanner.effective (default exclusion of Hidden fields)", () => {
  const schema = SchemaCompiler.compile(Member);
  test.each([
    ["no projection", undefined, { passwordHash: 0, "profile.secretNote": 0 }],
    ["an exclusion keeps excluding the hidden ones", { age: 0 }, { age: 0, passwordHash: 0, "profile.secretNote": 0 }],
    ["an excluded parent covers its hidden child (no path collision)", { profile: 0 }, { profile: 0, passwordHash: 0 }],
    ["+field adds a hidden field", { "+passwordHash": true }, { "profile.secretNote": 0 }],
    ["an inclusion names what it wants", { name: 1 }, { name: 1 }],
    ["an inclusion with +field", { name: 1, "+passwordHash": true }, { name: 1, passwordHash: 1 }],
    ["{ _id: 1 } alone is an inclusion", { _id: 1 }, { _id: 1 }],
  ] as const)("%s", (_name, projection, expected) => {
    expect(ProjectionPlanner.effective(schema, projection)).toEqual(expected);
  });
});
