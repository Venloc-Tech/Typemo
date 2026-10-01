import { beforeEach, describe, test } from "bun:test";
import { expectShapeMatches } from "@venloc/typemo-test-kit";
import type { Model } from "../../../src/index.ts";
import { Circle9, type ShapeMechanisms, shapeMechanisms } from "../../fixtures/mechanisms/shape-mechanisms.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { seedPopulate } from "../../fixtures/populate/populate-seed.ts";

/* The hook, policy and plugin result types the compiler computes against the shape of what the server returns. */

const t = ModelLifecycle.useTypemo("s9_shape");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
let queries: ShapeMechanisms;

beforeEach(async () => {
  const m = await seedPopulate(t);
  const Circles: Model<Circle9> = t.connection.model(Circle9);
  await Circles.create({ radius: 1, label: "c" });
  queries = shapeMechanisms(m, Circles);
});

/** The shape-harness target: the awaited result type of `name`, or of its first element. */
const target = (name: keyof ShapeMechanisms, element = false) => ({
  code: `
import type { ShapeMechanisms } from "./mechanisms/shape-mechanisms.ts";
type Result = Awaited<ReturnType<ShapeMechanisms["${name}"]>>;
export type Shape = ${element ? "NonNullable<Result>[number]" : "NonNullable<Result>"};
`,
  type: "Shape",
  dir: FIXTURES,
});

describe("shape: hook and policy results vs what the server returns", () => {
  const rows: readonly (readonly [keyof ShapeMechanisms, string, boolean, () => PromiseLike<unknown>])[] = [
    ["requiredRef", "L3: required populate (no null)", false, () => queries.requiredRef()],
    ["requiredVirtual", "L3: required justOne virtual", false, () => queries.requiredVirtual()],
    ["clonedRef", "L5: clone (same shape as without)", true, () => queries.clonedRef()],
    ["discriminatorLean", "L4: lean discriminator with its __t literal", false, () => queries.discriminatorLean()],
    ["updateOneOfDocument", "$updateOne: UpdateResult", false, () => queries.updateOneOfDocument()],
  ];
  for (const [name, title, element, run] of rows) {
    test(title, async () => {
      const value = await run();
      expectShapeMatches(target(name, element), element ? (value as unknown[])[0] : value);
    });
  }
});
