/*
 * Ported from mongoose test/aggregate.test.js and test/model.aggregate.test.js onto the typed pipeline
 * builder. Only the pipeline-construction logic is ported (what each stage serializes to and what
 * the server returns for it); plans run through the raw driver (test-kit `AggregateRunner`), not a model.
 * Per-test headers name the source `it(...)`. String DSL forms, `append` of
 * raw stages and argument-type runtime errors are covered by the types instead (see INDEX.md).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { BsonOptions, Entity, fn, Index, Pipeline, Prop, Schema, Vars } from "../../../src/index.ts";
import { AggregateFixtures } from "../../fixtures/aggregate-run.ts";

const mongo = MongoLifecycle.useMongo("ported_aggregate", BsonOptions.apply({}));

@Schema({ collection: "ported_employees" })
class Employee extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  sal!: number;

  @Prop(() => String, { required: true })
  dept!: string;

  @Prop(() => [String])
  customers?: string[];

  @Prop(() => String)
  reportsTo?: string;

  @Prop(() => Number)
  level?: number;
}

@Schema({ collection: "ported_texts" })
@Index({ test: "text" })
class TextDoc extends Entity {
  @Prop(() => String, { required: true })
  test!: string;
}

@Schema({ collection: "ported_hinted" })
@Index({ qty: -1, name: -1 })
class Hinted extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  qty!: number;
}

// setupData() of aggregate.test.js
const seedEmployees = async (): Promise<void> => {
  await mongo.db.collection("ported_employees").insertMany([
    { name: "Alice", sal: 18000, dept: "sales", customers: ["Eve", "Fred"] },
    { name: "Bob", sal: 15000, dept: "sales", customers: ["Gary", "Herbert", "Isaac"], reportsTo: "Alice" },
    { name: "Carol", sal: 14000, dept: "r&d", reportsTo: "Bob" },
    { name: "Dave", sal: 14500, dept: "r&d", reportsTo: "Carol" },
  ]);
};

describe("construction (aggregate.test.js)", () => {
  // ported from mongoose test/aggregate.test.js:186 "works" (group)
  test("group works", () => {
    const one = Pipeline.from(Employee).group((f) => ({ _id: f.dept, a: fn.sum(1), b: fn.sum(2) }));
    expect(one.build()).toEqual([{ $group: { _id: "$dept", a: { $sum: 1 }, b: { $sum: 2 } } }]);
    const two = one.group(() => ({ _id: null, c: fn.sum(3) }));
    expect(two.build()).toEqual([
      { $group: { _id: "$dept", a: { $sum: 1 }, b: { $sum: 2 } } },
      { $group: { _id: null, c: { $sum: 3 } } },
    ]);
  });

  // ported from mongoose test/aggregate.test.js:198 "works" (skip) and :210 "works" (limit)
  test("skip and limit work (and accumulate)", () => {
    expect(Pipeline.from(Employee).skip(42).skip(42).build()).toEqual([{ $skip: 42 }, { $skip: 42 }]);
    expect(Pipeline.from(Employee).limit(42).limit(42).build()).toEqual([{ $limit: 42 }, { $limit: 42 }]);
  });

  // ported from mongoose test/aggregate.test.js:222 '("field")' (unwind)
  test("unwind", () => {
    expect(Pipeline.from(Employee).unwind("$customers").build()).toEqual([{ $unwind: "$customers" }]);
  });

  // ported from mongoose test/aggregate.test.js:239 "works" (match)
  test("match works", () => {
    const built = Pipeline.from(Employee).match({ name: "Alice" }).match({ dept: "sales" }).build();
    expect(built).toEqual([{ $match: { name: "Alice" } }, { $match: { dept: "sales" } }]);
  });

  // ported from mongoose test/aggregate.test.js:251 "(object)" (sort) — numeric directions only (divergence L3B-1)
  test("sort (object)", () => {
    const built = Pipeline.from(Employee).sort({ name: 1, sal: 1, dept: -1 }).sort({ sal: -1 }).build();
    expect(built).toEqual([{ $sort: { name: 1, sal: 1, dept: -1 } }, { $sort: { sal: -1 } }]);
  });

  // ported from mongoose test/aggregate.test.js:287 "works" (near)
  test("near works", () => {
    const built = Pipeline.from(Employee)
      .geoNear({ near: { type: "Point", coordinates: [1, 2] }, distanceField: "d" })
      .build();
    expect(built).toEqual([{ $geoNear: { near: { type: "Point", coordinates: [1, 2] }, distanceField: "d" } }]);
  });

  // ported from mongoose test/aggregate.test.js:331 "works" (lookup) — `from` is an entity
  test("lookup works", () => {
    const [stage] = Pipeline.from(Employee)
      .lookup({ from: Employee, localField: "reportsTo", foreignField: "name", as: "users" })
      .build();
    expect(stage).toEqual({
      $lookup: { from: "ported_employees", localField: "reportsTo", foreignField: "name", as: "users" },
    });
  });

  // ported from mongoose test/aggregate.test.js:348 "works" (unionWith)
  test("unionWith works", () => {
    const [stage] = Pipeline.from(Employee)
      .unionWith({ coll: Employee, pipeline: (p) => p.match({ name: "Alice" }) })
      .build();
    expect(stage).toEqual({ $unionWith: { coll: "ported_employees", pipeline: [{ $match: { name: "Alice" } }] } });
  });

  // ported from mongoose test/aggregate.test.js:367 "works" (sample)
  test("sample works", () => {
    expect(Pipeline.from(Employee).sample(3).build()).toEqual([{ $sample: { size: 3 } }]);
  });

  // ported from mongoose test/aggregate.test.js:397 "works" (fill)
  test("fill works", () => {
    const [stage] = Pipeline.from(Employee)
      .fill({ output: { sal: { value: () => 0 }, level: { value: () => 0 } } })
      .build();
    expect(stage).toEqual({ $fill: { output: { sal: { value: 0 }, level: { value: 0 } } } });
  });

  // ported from mongoose test/aggregate.test.js:431 "works" (redact) — the verdicts are typed Vars (divergence L3B-3)
  test("redact works", () => {
    const [stage] = Pipeline.from(Employee)
      .redact((f) => fn.cond(fn.eq(f.level, 5), Vars.PRUNE, Vars.DESCEND))
      .build();
    expect(stage).toEqual({ $redact: { $cond: [{ $eq: ["$level", 5] }, "$$PRUNE", "$$DESCEND"] } });
  });

  // ported from mongoose test/aggregate.test.js:455 "works" (graphLookup) and :473 (startWith gets its $)
  test("graphLookup works; startWith is an expression (a path gets its $)", () => {
    const [stage] = Pipeline.from(Employee)
      .graphLookup({
        from: Employee,
        startWith: (f) => f.reportsTo,
        connectFromField: "reportsTo",
        connectToField: "name",
        as: "chain",
      })
      .build();
    expect(stage).toEqual({
      $graphLookup: {
        from: "ported_employees",
        startWith: "$reportsTo",
        connectFromField: "reportsTo",
        connectToField: "name",
        as: "chain",
      },
    });
  });

  // ported from mongoose test/aggregate.test.js:506 "(object)" (addFields)
  test("addFields (object)", () => {
    const built = Pipeline.from(Employee)
      .addFields(() => ({ a: 1, b: 1, c: 0 }))
      .addFields((f) => ({ d: fn.add(f.a, f.b) }))
      .build();
    expect(built).toEqual([{ $addFields: { a: 1, b: 1, c: 0 } }, { $addFields: { d: { $add: ["$a", "$b"] } } }]);
  });

  // ported from mongoose test/aggregate.test.js:518 "works" (facet)
  test("facet works", () => {
    const [stage] = Pipeline.from(Employee)
      .facet({
        heights: (b) => b.group((f) => ({ _id: f.sal, count: fn.sum(1) })).sort({ count: -1, _id: -1 }),
        players: (b) => b.group((f) => ({ _id: f.name, count: fn.sum(1) })).sort({ count: -1, _id: -1 }),
      })
      .build();
    expect(stage).toEqual({
      $facet: {
        heights: [{ $group: { _id: "$sal", count: { $sum: 1 } } }, { $sort: { count: -1, _id: -1 } }],
        players: [{ $group: { _id: "$name", count: { $sum: 1 } } }, { $sort: { count: -1, _id: -1 } }],
      },
    });
  });

  // ported from mongoose test/aggregate.test.js:564 "works with a string" and :572 "works with an object (gh-6474)" (replaceRoot)
  test("replaceRoot with a field and with an object", () => {
    const [byField] = Pipeline.from(Employee)
      .addFields((f) => ({ myNewRoot: { n: f.name } }))
      .replaceRoot((f) => f.myNewRoot)
      .build()
      .slice(1);
    expect(byField).toEqual({ $replaceRoot: { newRoot: "$myNewRoot" } });
    const [byObject] = Pipeline.from(Employee)
      .replaceRoot((f) => ({ x: fn.concat(f.name, f.dept) }))
      .build();
    expect(byObject).toEqual({ $replaceRoot: { newRoot: { x: { $concat: ["$name", "$dept"] } } } });
  });

  // ported from mongoose test/aggregate.test.js:583 "works" (count)
  test("count works", () => {
    expect(Pipeline.from(Employee).count("countResult").build()).toEqual([{ $count: "countResult" }]);
  });

  // ported from mongoose test/aggregate.test.js:593 "works with a string argument" and :601 "works with an object argument" (sortByCount)
  test("sortByCount with a field and with an object", () => {
    expect(
      Pipeline.from(Employee)
        .sortByCount((f) => f.dept)
        .build(),
    ).toEqual([{ $sortByCount: "$dept" }]);
    expect(
      Pipeline.from(Employee)
        .sortByCount((f) => ({ lname: f.name }))
        .build(),
    ).toEqual([{ $sortByCount: { lname: "$name" } }]);
  });

  // ported from mongoose test/aggregate.test.js:680 "unwind with obj"
  test("unwind with obj", () => {
    const [stage] = Pipeline.from(Employee).unwind({ path: "$customers", preserveNullAndEmptyArrays: true }).build();
    expect(stage).toEqual({ $unwind: { path: "$customers", preserveNullAndEmptyArrays: true } });
  });

  // ported from mongoose test/aggregate.test.js:808 "pipeline() (gh-5825)"
  test("pipeline() (gh-5825): build() returns the stages", () => {
    expect(
      Pipeline.from(Employee)
        .match({ sal: { $lt: 16000 } })
        .build(),
    ).toEqual([{ $match: { sal: { $lt: 16000 } } }]);
  });

  // ported from mongoose test/aggregate.test.js:849 "without a callback" (error when empty pipeline)
  test("an empty pipeline does not run", () => {
    // The type already refuses `plan()` on an empty builder; the cast stands for an untyped caller.
    const empty = Pipeline.from(Employee) as unknown as { plan(): unknown };
    expect(() => empty.plan()).toThrow("empty pipeline");
  });
});

describe("execution (aggregate.test.js exec)", () => {
  beforeEach(seedEmployees);

  // ported from mongoose test/aggregate.test.js:625 "project"
  test("project", async () => {
    const docs = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Employee)
        .project((f) => ({ sal: 1, sal_k: fn.divide(f.sal, 1000) }))
        .plan(),
    );
    for (const doc of docs) expect(doc.sal / 1000).toBe(doc.sal_k);
  });

  // ported from mongoose test/aggregate.test.js:636 "group"
  test("group", async () => {
    const docs = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Employee)
        .group((f) => ({ _id: f.dept }))
        .plan(),
    );
    expect(docs).toHaveLength(2);
    expect(docs.map((doc) => doc._id).sort()).toEqual(["r&d", "sales"]);
  });

  // ported from mongoose test/aggregate.test.js:650 "skip", :660 "limit", :670 "unwind"
  test("skip, limit, unwind", async () => {
    expect(await AggregateFixtures.run(mongo, Pipeline.from(Employee).skip(1).plan())).toHaveLength(3);
    expect(await AggregateFixtures.run(mongo, Pipeline.from(Employee).limit(3).plan())).toHaveLength(3);
    expect(await AggregateFixtures.run(mongo, Pipeline.from(Employee).unwind("$customers").plan())).toHaveLength(5);
  });

  // ported from mongoose test/aggregate.test.js:705 "match" and :713 "sort"
  test("match and sort", async () => {
    expect(
      await AggregateFixtures.run(
        mongo,
        Pipeline.from(Employee)
          .match({ sal: { $gt: 15000 } })
          .plan(),
      ),
    ).toHaveLength(1);
    const sorted = await AggregateFixtures.run(mongo, Pipeline.from(Employee).sort({ sal: 1 }).plan());
    expect(sorted[0]?.sal).toBe(14000);
  });

  // ported from mongoose test/aggregate.test.js:721 "graphLookup"
  test("graphLookup", async () => {
    const docs = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Employee)
        .graphLookup({
          from: Employee,
          startWith: (f) => f.reportsTo,
          connectFromField: "reportsTo",
          connectToField: "name",
          as: "employeeHierarchy",
        })
        .sort({ name: 1 })
        .plan(),
    );
    const lowest = docs[3];
    expect(lowest?.name).toBe("Dave");
    expect(lowest?.employeeHierarchy.map((doc) => doc.name).sort()).toEqual(["Alice", "Bob", "Carol"]);
  });

  // ported from mongoose test/aggregate.test.js:754 "facet"
  test("facet", async () => {
    const [doc] = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Employee)
        .facet({
          departments: (b) => b.group((f) => ({ _id: f.dept, count: fn.sum(1) })),
          employeesPerCustomer: (b) =>
            b
              .unwind("$customers")
              .sortByCount((f) => f.customers)
              .sort({ _id: 1 }),
        })
        .plan(),
    );
    expect(doc?.departments.map((d) => d.count)).toEqual([2, 2]);
    expect(doc?.employeesPerCustomer).toEqual([
      { _id: "Eve", count: 1 },
      { _id: "Fred", count: 1 },
      { _id: "Gary", count: 1 },
      { _id: "Herbert", count: 1 },
      { _id: "Isaac", count: 1 },
    ]);
  });

  // ported from mongoose test/aggregate.test.js:792 "complex pipeline"
  test("complex pipeline", async () => {
    const docs = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Employee)
        .match({ sal: { $lt: 16000 } })
        .unwind("$customers")
        .project((f) => ({ emp: f.name, cust: f.customers }))
        .sort({ cust: -1 })
        .skip(2)
        .plan(),
    );
    expect(docs).toHaveLength(1);
    expect(docs[0]?.cust).toBe("Gary");
    expect(docs[0]?.emp).toBe("Bob");
  });

  // ported from mongoose test/aggregate.test.js:1235 "sort by text score (gh-5258)"
  test("sort by text score (gh-5258)", async () => {
    await mongo.db.collection("ported_texts").createIndex({ test: "text" });
    await mongo.db.collection("ported_texts").insertMany([{ test: "test test" }, { test: "a test" }]);
    const res = await AggregateFixtures.run(
      mongo,
      Pipeline.from(TextDoc)
        .match({ $text: { $search: "test" } })
        .sort({ score: { $meta: "textScore" } })
        .plan(),
    );
    expect(res.map((doc) => doc.test)).toEqual(["test test", "a test"]);
  });

  // ported from mongoose test/aggregate.test.js:1286 "adds hint option"
  test("adds hint option", async () => {
    await mongo.db.collection("ported_hinted").createIndex({ qty: -1, name: -1 });
    await mongo.db.collection("ported_hinted").insertMany([
      { name: "Andrew", qty: 4 },
      { name: "Betty", qty: 5 },
      { name: "Charlie", qty: 4 },
    ]);
    const found = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Hinted, { hint: { qty: -1, name: -1 } })
        .match({})
        .plan(),
    );
    expect(found.map((doc) => doc.name)).toEqual(["Betty", "Charlie", "Andrew"]);
  });
});

describe("model.aggregate.test.js", () => {
  beforeEach(seedEmployees);

  // ported from mongoose test/model.aggregate.test.js:75 "with Aggregate syntax"
  test("with Aggregate syntax: $group then $project", async () => {
    const res = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Employee)
        .group((f) => ({ _id: null, maxAge: fn.max(f.sal) }))
        .project({ _id: 0, maxAge: 1 })
        .plan(),
    );
    expect(res).toEqual([{ maxAge: 18000 }]);
  });
});
