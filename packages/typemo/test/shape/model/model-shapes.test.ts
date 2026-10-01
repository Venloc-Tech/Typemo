import { beforeEach, describe, test } from "bun:test";
import { expectShapeMatches } from "@venloc/typemo-test-kit";
import { Decimal128 } from "mongodb";
import { Order, Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { SHAPE_IDS, type ShapeOperations, shapeOperations } from "../../fixtures/model/shape-operations.ts";

/*
 * The result type the compiler computes for a model operation is compared with the shape of what the operation
 * pipeline returns from the server (through the real DriverExecutor and postProcess).
 */

const t = ModelLifecycle.useTypemo("model_shape");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
let ops: ShapeOperations;

beforeEach(async () => {
  ops = shapeOperations(t.connection.model(Person), t.connection.model(Order));
  await t.mongo.db.collection("m_people").insertOne({
    _id: SHAPE_IDS.ann,
    name: "Ann",
    email: "ann@x.test",
    role: "admin",
    age: 40,
    tags: ["a"],
    pets: [{ name: "Tom" }],
    scores: { math: 5 },
    visits: 3n,
    balance: Decimal128.fromString("2.5"),
    lastSeen: new Date(),
    secret: "hidden",
  });
  await t.mongo.db.collection("m_orders").insertMany([
    { _id: SHAPE_IDS.order, buyer: SHAPE_IDS.ann, total: 10, status: "paid" },
    { buyer: SHAPE_IDS.ann, total: 5, status: "new" },
  ]);
});

/** The shape-harness target: the awaited result type of `name`, or of its first element. */
const target = (name: keyof ShapeOperations, element = false) => ({
  code: `
import type { ShapeOperations } from "./model/shape-operations.ts";
type Result = Awaited<ReturnType<ShapeOperations["${name}"]>>;
export type Shape = ${element ? "NonNullable<Result>[number]" : "NonNullable<Result>"};
`,
  type: "Shape",
  dir: FIXTURES,
});

describe("shape: model operation result type vs the pipeline's result", () => {
  /* A thunk per row: indexing `ops[name]` with a union of names would build every result type at once (TS2589). */
  const rows: readonly (readonly [keyof ShapeOperations, string, boolean, () => PromiseLike<unknown>])[] = [
    ["created", "create: the hydrated document with defaults and _id", false, () => ops.created()],
    ["inserted", "insertMany: the documents", true, () => ops.inserted()],
    ["leanFound", "lean findById: Hidden out, Map as record, bigint, Decimal128", false, () => ops.leanFound()],
    ["modified", "findByIdAndUpdate (after, D31), lean", false, () => ops.modified()],
    ["updated", "updateOne: UpdateResult with upsertedId null", false, () => ops.updated()],
    ["deleted", "deleteMany: DeleteResult", false, () => ops.deleted()],
    ["bulk", "bulkWrite: counts and ids by input index", false, () => ops.bulk()],
    ["grouped", "aggregate: the builder's rows", true, () => ops.grouped()],
    ["exists", "exists: { _id }", false, () => ops.exists()],
    ["distinct", "distinct: the values", true, () => ops.distinct()],
  ];
  for (const [name, what, element, run] of rows) {
    test(`${name}: ${what}`, async () => {
      const result = await run();
      expectShapeMatches(target(name, element), element ? (result as unknown[])[0] : result);
    });
  }
});
