import { beforeEach, describe, test } from "bun:test";
import { expectShapeMatches } from "@venloc/typemo-test-kit";
import { Binary, Decimal128, ObjectId, Timestamp } from "mongodb";
import { Order } from "../../fixtures/document/document-entities.ts";
import { type ShapeDocuments, shapeDocuments } from "../../fixtures/document/shape-documents.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/*
 * The types of `$toObject()`/`$toJSON()` (and their options) and of `lean()` against the shape of what they really
 * return for a document read from the server — Map as `Map` in `$toObject`, a record in JSON and lean; the JSON
 * forms of the BSON scalars.
 */

const t = ModelLifecycle.useTypemo("doc_shape");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const id = new ObjectId();
let ops: ShapeDocuments;

beforeEach(async () => {
  ops = shapeDocuments(t.connection.model(Order), id);
  await t.mongo.db.collection("d_orders").insertOne({
    _id: id,
    customer: "ann",
    total: 1,
    tags: ["a"],
    lines: [{ _id: new ObjectId(), sku: "x", qty: 1 }],
    address: { city: "Paris", street: "Main" },
    notes: { k: "v" },
    status: "new",
    code: "c",
    discount: 1.5,
    views: 3n,
    price: Decimal128.fromString("1.5"),
    seenAt: new Timestamp({ t: 1, i: 2 }),
    blob: new Binary(new Uint8Array([1])),
    pattern: /x/,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    __v: 0,
  });
});

const target = (name: keyof ShapeDocuments) => ({
  code: `
import type { ShapeDocuments } from "./document/shape-documents.ts";
export type Shape = Awaited<ReturnType<ShapeDocuments["${name}"]>>;
`,
  type: "Shape",
  dir: FIXTURES,
});

describe("shape: document forms vs what they return", () => {
  const rows: readonly (readonly [keyof ShapeDocuments, string, () => PromiseLike<unknown>])[] = [
    ["plain", "$toObject(): plain, Map kept", () => ops.plain()],
    ["plainOptions", "$toObject({ virtuals, hidden: false, getters })", () => ops.plainOptions()],
    ["json", "$toJSON(): F8 forms, Map → record, Hidden out", () => ops.json()],
    ["jsonOptions", "$toJSON({ virtuals })", () => ops.jsonOptions()],
    ["transformed", "$toObject({ transform }): the transform's result", () => ops.transformed()],
    ["lean", "lean(): the driver's plain data", () => ops.lean()],
  ];
  for (const [name, what, run] of rows) {
    test(`${name}: ${what}`, async () => {
      expectShapeMatches(target(name), await run());
    });
  }
});
