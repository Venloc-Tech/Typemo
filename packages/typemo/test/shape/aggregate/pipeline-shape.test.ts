import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle, ShapeCompare, TypeProbe } from "@venloc/typemo-test-kit";
import { BsonOptions } from "../../../src/index.ts";
import { AggregatePipelines } from "../../fixtures/aggregate-pipelines.ts";
import { AggregateFixtures } from "../../fixtures/aggregate-run.ts";

/*
 * For every named pipeline of the fixtures, the row type the builder computes
 * (`RowOf<typeof AggregatePipelines.<name>>`) is compared with the rows the server returns, both ways (unknown
 * keys, missing required keys, wrong kinds, `any`).
 */

const mongo = MongoLifecycle.useMongo("agg_shape", BsonOptions.apply({}));
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const probe = TypeProbe.shared();

const SOURCE = `
import type { RowOf } from "@venloc/typemo";
import { AggregatePipelines as P } from "./aggregate-pipelines.ts";
`;

/**
 * Pipelines whose rows depend on the server (statistics, sessions, operations): checked by kind in the pipeline
 * unit tests.
 */
const SERVER_ROWS = new Set([
  "collStats",
  "currentOp",
  "planCacheStats",
  "listClusterCatalog",
  "queryStats",
  "querySettings",
  "out",
  "merge",
]);

beforeEach(async () => {
  await AggregateFixtures.seed(mongo);
});

describe("shape: pipeline rows vs computed row types", () => {
  const names = Object.keys(AggregatePipelines).filter((name) => !SERVER_ROWS.has(name));
  test.each(names)("%s", async (name) => {
    const builder = AggregatePipelines[name as keyof typeof AggregatePipelines] as { plan(): never };
    const rows = await AggregateFixtures.run(mongo, builder.plan());
    const result = ShapeCompare.check({ code: SOURCE, type: `RowOf<typeof P.${name}>[]`, dir: FIXTURES, probe }, rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(result.report).toBe("");
  });
});
