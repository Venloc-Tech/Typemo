import { beforeEach, describe, expect, test } from "bun:test";
import { MongoLifecycle, ShapeCompare, TypeProbe } from "@venloc/typemo-test-kit";
import { BsonOptions } from "../../../src/index.ts";
import { AggregateOperators } from "../../fixtures/aggregate-operators.ts";
import { AggregateFixtures } from "../../fixtures/aggregate-run.ts";

/*
 * Every operator family runs on the server (the server accepts what `fn.*` builds) and its result type — with
 * null propagation over rows that hold a value, `null` and a missing field — matches the rows (shape harness,
 * both ways).
 */

const mongo = MongoLifecycle.useMongo("agg_operator_shape", BsonOptions.apply({}));
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const probe = TypeProbe.shared();

const SOURCE = `
import type { RowOf } from "@venloc/typemo";
import { AggregateOperators as O } from "./aggregate-operators.ts";
`;

beforeEach(async () => {
  await AggregateFixtures.seed(mongo);
});

describe("shape: operator results vs computed types", () => {
  test.each(Object.keys(AggregateOperators))("%s", async (name) => {
    const builder = AggregateOperators[name as keyof typeof AggregateOperators] as { plan(): never };
    const rows = await AggregateFixtures.run(mongo, builder.plan());
    expect(rows.length).toBeGreaterThan(0);
    const result = ShapeCompare.check({ code: SOURCE, type: `RowOf<typeof O.${name}>[]`, dir: FIXTURES, probe }, rows);
    expect(result.report).toBe("");
  });
});
