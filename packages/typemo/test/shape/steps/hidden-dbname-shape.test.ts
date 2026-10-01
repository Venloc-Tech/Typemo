import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle, ShapeCompare, TypeProbe } from "@venloc/typemo-test-kit";
import { BsonOptions, DbNames } from "../../../src/internal.ts";
import { OperationView } from "../../../src/operation/steps/operation-view.ts";
import type { ResultShape } from "../../../src/operation/steps/result-shape.ts";
import { ShapePipelines } from "../../fixtures/steps/shape-pipelines.ts";
import { Account, Plain } from "../../fixtures/steps/step-entities.ts";
import { RawExecute, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * An aggregation over a model with `dbName` fields and `Hidden` fields, run through the operation steps and the
 * raw driver, translated back by `DbNames.toCode` — the rows have exactly the type the pipeline builder computes
 * (no hidden field unless included, code names), both ways.
 */

const mongo = MongoLifecycle.useMongo("steps_shape", BsonOptions.apply({}));
const FIXTURES = new URL("../../fixtures/steps/", import.meta.url).pathname;
const probe = TypeProbe.shared();
const SOURCE = `
import type { RowOf } from "@venloc/typemo";
import { ShapePipelines as P } from "./shape-pipelines.ts";
`;

beforeEach(async () => {
  for (const document of [
    {
      name: "Ann",
      email: "a@x.test",
      password: "s",
      age: 30,
      tags: ["a"],
      items: [{ name: "pen", price: 2 }],
      address: { city: "Paris", zip: null },
    },
    { name: "Bob", email: "b@x.test", age: 40, tags: [], items: [] },
  ]) {
    await RawExecute.run(mongo.db, await StepHarness.full(StepHarness.insert(Account, [document])));
  }
  await RawExecute.run(mongo.db, await StepHarness.full(StepHarness.insert(Plain, [{ title: "Ann", secret: "x" }])));
});

describe("shape: aggregation rows vs computed row types", () => {
  test.each(Object.keys(ShapePipelines))("%s", async (name) => {
    /* cast: a test double / bridge — the shape table holds builders of different sources; only plan() is used */
    const builder = ShapePipelines[name as keyof typeof ShapePipelines] as unknown as {
      plan(): Parameters<typeof StepHarness.aggregate>[1];
    };
    const ctx = await StepHarness.full(StepHarness.aggregate(Account, builder.plan()), [Plain]);
    const shape = ctx.locals.get(OperationView.RESULT_SHAPE) as ResultShape;
    const rows = ((await RawExecute.run(mongo.db, ctx)) as unknown[]).map((row) => DbNames.toCode(shape, row));
    expect(rows.length).toBeGreaterThan(0);
    const result = ShapeCompare.check({ code: SOURCE, type: `RowOf<typeof P.${name}>[]`, dir: FIXTURES, probe }, rows);
    expect(result.report).toBe("");
  });
});
