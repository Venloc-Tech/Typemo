import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  ConfigurationError,
  Entity,
  ExprCompiler,
  fn,
  Pipeline,
  Prop,
  Schema,
  UpdatePipelines,
  Vars,
  withWindow,
} from "../../../src/internal.ts";
import { Customer, Order, StatusTotal } from "../../fixtures/aggregate-entities.ts";

/*
 * Without a database: what the builder serializes, that it never mutates and never shares state, and the
 * run-time checks the types cannot make.
 */

describe("serialization", () => {
  test("field references, nested paths, $$ROOT and variables", () => {
    const [stage] = Pipeline.from(Customer)
      .project((f) => ({ city: f.address.city, whole: f, now: Vars.NOW, id: fn.toString_(f._id) }))
      .build();
    expect(stage).toEqual({
      $project: { city: "$address.city", whole: "$$ROOT", now: "$$NOW", id: { $toString: "$_id" } },
    });
  });

  test("a string literal that starts with $ becomes $literal (never a path by accident)", () => {
    expect(
      Pipeline.from(Order)
        .set(() => ({ price: "$5" }))
        .build(),
    ).toEqual([{ $set: { price: { $literal: "$5" } } }]);
    expect(
      Pipeline.from(Order)
        .set((f) => ({ x: fn.eq(f.notes, "$$ROOT") }))
        .build(),
    ).toEqual([{ $set: { x: { $eq: ["$notes", { $literal: "$$ROOT" }] } } }]);
  });

  test("a single array argument is wrapped (a gotcha of the old wrapper)", () => {
    expect(
      Pipeline.from(Order)
        .set(() => ({ n: fn.size([1, 2, 3]) }))
        .build(),
    ).toEqual([{ $set: { n: { $size: [[1, 2, 3]] } } }]);
  });

  test("nested $map/$filter get depth names; plain ones keep $$this", () => {
    const [plain] = Pipeline.from(Order)
      .set((f) => ({ skus: fn.map({ input: f.items, in: (i) => i.sku }) }))
      .build();
    expect(plain).toEqual({ $set: { skus: { $map: { input: "$items", in: "$$this.sku" } } } });
    const [nested] = Pipeline.from(Order)
      .set((f) => ({
        grid: fn.map({
          input: f.items,
          in: (i) => fn.filter({ input: f.items, cond: (j) => fn.gt(j.price, i.price) }),
        }),
      }))
      .build();
    expect(nested).toEqual({
      $set: {
        grid: {
          $map: {
            input: "$items",
            as: "tmoEl0",
            in: { $filter: { input: "$items", cond: { $gt: ["$$this.price", "$$tmoEl0.price"] } } },
          },
        },
      },
    });
  });

  test("a nested $reduce binds the outer variables through $let", () => {
    const [stage] = Pipeline.from(Order)
      .set((f) => ({
        x: fn.reduce({
          input: f.items,
          initialValue: 0,
          in: (acc, i) =>
            fn.add(acc, fn.reduce({ input: f.items, initialValue: 0, in: (inner) => fn.add(inner, i.price) })),
        }),
      }))
      .build();
    expect(stage).toEqual({
      $set: {
        x: {
          $reduce: {
            input: "$items",
            initialValue: 0,
            in: {
              $let: {
                vars: { tmoAcc0: "$$value", tmoEl0: "$$this" },
                in: {
                  $add: [
                    "$$tmoAcc0",
                    { $reduce: { input: "$items", initialValue: 0, in: { $add: ["$$value", "$$tmoEl0.price"] } } },
                  ],
                },
              },
            },
          },
        },
      },
    });
  });

  test("$top sortBy from field references; withWindow adds the window", () => {
    const [group] = Pipeline.from(Order)
      .group((f) => ({
        _id: null,
        best: fn.top({
          output: f.total,
          sortBy: [
            [f.placedAt, -1],
            [f.total, 1],
          ],
        }),
      }))
      .build();
    expect(group).toEqual({
      $group: { _id: null, best: { $top: { output: "$total", sortBy: { placedAt: -1, total: 1 } } } },
    });
    const [window] = Pipeline.from(Order)
      .setWindowFields({
        sortBy: { total: 1 },
        output: (f) => ({ s: withWindow(fn.sum(f.total), { documents: [-1, 0] }) }),
      })
      .build();
    expect(window).toEqual({
      $setWindowFields: { sortBy: { total: 1 }, output: { s: { $sum: "$total", window: { documents: [-1, 0] } } } },
    });
  });

  test("$lookup takes the collection name from the entity; let variables are proxies", () => {
    const [stage] = Pipeline.from(Customer)
      .lookup({
        from: Order,
        as: "orders",
        let: (f) => ({ cid: f._id }),
        pipeline: (p, v) => p.match((o) => fn.eq(o.customer, v.cid)),
      })
      .build();
    expect(stage).toEqual({
      $lookup: {
        from: "agg_orders",
        let: { cid: "$_id" },
        pipeline: [{ $match: { $expr: { $eq: ["$customer", "$$cid"] } } }],
        as: "orders",
      },
    });
  });

  test("$merge whenMatched gets $$new by default", () => {
    const [, merge] = Pipeline.from(Order)
      .group((f) => ({ _id: f.status, revenue: fn.sum(f.total), orders: fn.count() }))
      .merge({
        into: StatusTotal,
        whenMatched: (p, v) => p.set((f) => ({ revenue: fn.add(f.revenue, v.new.revenue) })),
      })
      .build();
    expect(merge).toEqual({
      $merge: {
        into: "agg_status_totals",
        whenMatched: [{ $set: { revenue: { $add: ["$revenue", "$$new.revenue"] } } }],
      },
    });
  });

  test("$match resolves $expr callbacks inside $and/$or (the query-layer contract)", () => {
    const filter = ExprCompiler.resolveFilter({
      $or: [{ $expr: (f: { a: unknown }) => fn.eq(f.a as never, 1) }, { b: 2 }],
    });
    expect(filter).toEqual({ $or: [{ $expr: { $eq: ["$a", 1] } }, { b: 2 }] });
    expect(() => ExprCompiler.resolveFilter({ $expr: { $eq: [1, 1] } })).toThrow(ConfigurationError);
  });
});

describe("immutability", () => {
  test("every stage returns a new builder; a shared prefix is not changed by its branches", () => {
    const base = Pipeline.from(Order).match({ status: "paid" });
    const a = base.limit(1);
    const b = base.skip(1);
    expect(base.build()).toHaveLength(1);
    expect(a.build()).toEqual([{ $match: { status: "paid" } }, { $limit: 1 }]);
    expect(b.build()).toEqual([{ $match: { status: "paid" } }, { $skip: 1 }]);
  });

  test("stages, plans and inputs are frozen / never mutated", () => {
    const spec = Object.freeze({ total: -1 as const });
    const builder = Pipeline.from(Order).sort(spec);
    expect(Object.isFrozen(builder.build())).toBe(true);
    expect(Object.isFrozen(builder.build()[0])).toBe(true);
    expect(Object.isFrozen(builder.plan())).toBe(true);
    const docs = Object.freeze([Object.freeze({ a: 1, note: "$x" })] as const);
    const [stage] = Pipeline.database().documents(docs).build();
    expect(stage).toEqual({ $documents: [{ a: 1, note: { $literal: "$x" } }] });
    expect(docs[0]).toEqual({ a: 1, note: "$x" });
  });
});

describe("run-time checks", () => {
  test("paging and names", () => {
    expect(() => Pipeline.from(Order).limit(0)).toThrow("$limit takes an integer ≥ 1");
    expect(() => Pipeline.from(Order).skip(-1)).toThrow(ConfigurationError);
    expect(() => Pipeline.from(Order).sample(1.5)).toThrow(ConfigurationError);
    expect(() => Pipeline.from(Order).count("$n" as "n")).toThrow("cannot be empty, start with $ or contain a dot");
    expect(() => Pipeline.from(Order).sort({})).toThrow("$sort needs at least one key");
  });

  test("an empty sub-pipeline and an empty update pipeline are refused", () => {
    expect(() => Pipeline.from(Order).facet({ empty: (b) => b as never })).toThrow("needs at least one stage");
    expect(() => UpdatePipelines.compile<Order>((p) => p as never)).toThrow("at least one stage");
  });

  test("a rank needs a sortBy of exactly one field (server rule)", () => {
    expect(() =>
      /* The types refuse this call too; the runtime guard is checked for untyped callers. */
      // @ts-expect-error — $rank needs a sortBy with exactly one field
      Pipeline.from(Order).setWindowFields({ sortBy: { total: 1, placedAt: 1 }, output: () => ({ r: fn.rank() }) }),
    ).toThrow("needs a sortBy with exactly one field");
  });

  test("the hint must name a declared index", () => {
    expect(() => Pipeline.from(Order, { hint: { status: 1, placedAt: -1 } })).not.toThrow();
    expect(() => Pipeline.from(Order, { hint: "status_1_placedAt_-1" })).not.toThrow();
    expect(() => Pipeline.from(Order, { hint: { total: 1 } })).toThrow("matches no declared index");
  });

  /*
   * An aliased entity is accepted; its stages name CODE paths and the operation steps translate them to the
   * stored names (test/unit/steps/db-names.test.ts).
   */
  test("an entity with dbName aliases is accepted: the stages name code paths", () => {
    @Schema({ collection: "agg_aliased" })
    class Aliased extends Entity {
      @Prop(() => String, { dbName: "n" })
      name?: string;
    }
    expect(Pipeline.from(Aliased).match({ name: "a" }).plan().pipeline).toEqual([{ $match: { name: "a" } }]);
  });

  test("the target records the collection and the entity", () => {
    const plan = Pipeline.from(Order).limit(1).plan();
    expect(plan.target).toEqual({
      kind: "collection",
      collection: "agg_orders",
      entity: Order,
      discriminator: undefined,
    });
    expect(Pipeline.admin().currentOp().plan().target).toEqual({ kind: "database", admin: true });
  });

  test("sortBy of $top takes only document fields", () => {
    expect(() => fn.top({ output: 1, sortBy: [[ObjectId as never, 1]] })).toThrow(ConfigurationError);
  });
});
