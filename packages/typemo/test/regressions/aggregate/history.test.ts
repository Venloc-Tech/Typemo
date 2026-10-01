/*
 * Regressions from research/mongoose/M11-history/history.yaml: `area: aggregate` and the `$expr` /
 * update-pipeline entries of other areas that the pipeline layer owns. Entries about
 * execution (cursor middleware H032/H131, ALS session H152) are covered by the model and connection tests.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { expectTypeError, MongoLifecycle } from "@venloc/typemo-test-kit";
import {
  BsonOptions,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  ExprCompiler,
  fn,
  Pipeline,
  Prop,
  Schema,
  UpdatePipelines,
} from "../../../src/internal.ts";
import { Order } from "../../fixtures/aggregate-entities.ts";
import { AggregateFixtures } from "../../fixtures/aggregate-run.ts";

const mongo = MongoLifecycle.useMongo("agg_history", BsonOptions.apply({}));
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `import { fn, Pipeline, type ExprFor } from "@venloc/typemo";\nimport { Order } from "./aggregate-entities.ts";\n`;

@Schema({ collection: "agg_history_notes", discriminatorKey: "kind" })
class Note extends Entity {
  @Prop(() => String, { required: true })
  kind!: string;
}

@Discriminator("todo")
class Todo extends Note {
  declare readonly kind: DiscriminatorValue<"todo">;
  @Prop(() => Boolean, { required: true })
  done!: boolean;
}

beforeEach(async () => {
  await AggregateFixtures.seed(mongo);
});

describe("history.yaml: aggregate and $expr", () => {
  test("H444: the builder never adds a discriminator $match of its own; the plan records the discriminator (it is filtered once, at execution)", () => {
    const plan = Pipeline.from(Todo).match({ kind: "todo" }).plan();
    expect(plan.pipeline).toEqual([{ $match: { kind: "todo" } }]);
    expect(plan.target).toMatchObject({
      kind: "collection",
      collection: "agg_history_notes",
      discriminator: { key: "kind", value: "todo" },
    });
  });

  test("H008/H184: a $expr comparison of a Date field with a string does not compile (no silent casting); a Date literal reaches the server as a Date", async () => {
    expectTypeError(`${HEAD}export const e: ExprFor<Order> = (f) => fn.eq(f.placedAt, "2024-01-10T10:00:00Z");`, {
      dir: FIXTURES,
    }).toContain("not assignable");
    expectTypeError(
      `${HEAD}export const e: ExprFor<Order> = (f) => fn.eq(fn.switch({ branches: [{ case: fn.eq(f.placedAt, "2024"), then: 1 }], default: 0 }), 1);`,
      { dir: FIXTURES },
    ).toContain("not assignable");
    const rows = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .match((f) =>
          fn.eq(
            fn.switch({
              // biome-ignore lint/suspicious/noThenProperty: `then` is the key of a MongoDB $switch branch
              branches: [{ case: fn.lt(f.placedAt, new Date("2024-02-01T00:00:00Z")), then: 1 }],
              default: 0,
            }),
            1,
          ),
        )
        .plan(),
    );
    expect(rows.map((row) => row.total)).toEqual([25]);
  });

  test("H485: $expr survives inside $and (never stripped), and $not works inside it (H458)", async () => {
    const filter = ExprCompiler.resolveFilter({
      $and: [{ status: "paid" }, { $expr: (f: never) => fn.not(fn.gt(f as never, 1)) }],
    });
    expect(filter).toEqual({ $and: [{ status: "paid" }, { $expr: { $not: [{ $gt: ["$$ROOT", 1] }] } }] });
    const rows = await AggregateFixtures.run(
      mongo,
      Pipeline.from(Order)
        .match({ $and: [{ status: "paid" }, { $expr: (f) => fn.not(fn.gt(f.total, 20)) }] })
        .plan(),
    );
    expect(rows.map((row) => row.total)).toEqual([12]);
  });

  test("H091: an update pipeline is built and typed by the builder in update mode (never an unchecked array)", async () => {
    const stages = UpdatePipelines.compile<Order>((p) => p.set((f) => ({ total: fn.add(f.total, 1) })));
    await mongo.db.collection("agg_orders").updateMany({}, [...stages]);
    const totals = (await mongo.db.collection("agg_orders").find().sort({ _id: 1 }).toArray()).map((doc) => doc.total);
    expect(totals).toEqual([26, 31, 13]);
    expectTypeError(`${HEAD}Pipeline.update(Order).set((f) => ({ total: fn.push(f.total) }));`, {
      dir: FIXTURES,
    }).toContain("an accumulator or window function is not an expression here");
  });
});
