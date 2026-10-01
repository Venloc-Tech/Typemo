/*
 * Two plans, two names: `PipelineBuilder.plan()` is the pipeline-level `AggregatePlan` (source and stages, no model,
 * no execution option); `Model.aggregate(...).build()` is the `AggregateExecutionPlan` (bound to a model, with the
 * run's options). The shapes are pinned here so the difference cannot blur.
 */
import { describe, expect, test } from "bun:test";
import { type AggregateExecutionPlan, type AggregatePlan, Pipeline, TypemoClient } from "../../../src/internal.ts";
import { Customer } from "../../fixtures/aggregate-entities.ts";

describe("the two forms of an aggregation plan", () => {
  test("the builder's plan: target, pipeline, options — no execution options", () => {
    const plan: AggregatePlan<unknown> = Pipeline.from(Customer).match({ name: "Ann" }).plan();
    expect(Object.keys(plan).sort()).toEqual(["op", "options", "pipeline", "target"]);
    expect(plan.target).toMatchObject({ kind: "collection", collection: "agg_customers" });
    expect("policy" in plan.options).toBe(false);
  });

  test("the query's build(): entity, pipeline, aggregateOptions, options with the run's options", () => {
    const client = new TypemoClient("mongodb://127.0.0.1:1", { dbName: "plans" });
    const Customers = client.db("plans").model(Customer);
    const execution: AggregateExecutionPlan = Customers.aggregate((p) => p.match({ name: "Ann" }))
      .timeoutMS(500)
      .build();
    expect(Object.keys(execution).sort()).toEqual(["aggregateOptions", "entity", "op", "options", "pipeline"]);
    expect(execution.entity).toBe(Customer);
    expect(execution.options.timeoutMS).toBe(500);
    /* The pipeline and the builder's options are the builder plan's. */
    const builder = Pipeline.from(Customer).match({ name: "Ann" }).plan();
    expect(execution.pipeline).toEqual(builder.pipeline);
    expect(execution.aggregateOptions).toEqual(builder.options);
    void client.close();
  });
});
