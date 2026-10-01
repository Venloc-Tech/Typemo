import { describe, expect, test } from "bun:test";
import { expectShapeMatches, MongoLifecycle, ShapeCompare } from "@venloc/typemo-test-kit";
import type { Document, ObjectId } from "mongodb";
import { BsonOptions, BsonTypeTable } from "../../../src/index.ts";
import { ALL_TYPES_HYDRATED_SOURCE, AllTypesCaster, allTypesInput } from "../../fixtures/bson-all-types.ts";

/*
 * The compiler's `LeanValue<Hydrated>` is compared with the shape of the document the real server returns,
 * `JsonValue<Hydrated>` with what `toJson` produces and `PlainValue<Hydrated>` with what `toPlain` produces. This
 * is the test that keeps the ONE table honest: the type side and the runtime side cannot drift. The int64 values
 * include ±2^63 (the JSON and plain forms are exact strings).
 */

const mongo = MongoLifecycle.useMongo("bson_shape", BsonOptions.apply({}));
const plain = MongoLifecycle.useMongo("bson_shape_defaults");

/** Casts `input`, stores it through `db` and returns the hydrated value with the document read back. */
const readBack = async (db: typeof mongo.db, input = allTypesInput()) => {
  const hydrated = AllTypesCaster.cast(input);
  const collection = db.collection("all_types");
  await collection.insertOne(AllTypesCaster.encode(hydrated) as Document);
  return { hydrated, read: await collection.findOne({ _id: hydrated._id as ObjectId }) };
};

describe("shape: type vs real data", () => {
  test("LeanValue<Hydrated> matches the document read with the enforced options", async () => {
    const { read } = await readBack(mongo.db);
    expectShapeMatches({ code: ALL_TYPES_HYDRATED_SOURCE, type: "Lean" }, read);
  });

  test("JsonValue<Hydrated> matches BsonTypeTable.toJson of that document", async () => {
    const { read } = await readBack(mongo.db);
    const json = BsonTypeTable.toJson(read);
    expect(json?.i64).toBe("9223372036854775807"); /* exact beyond 2^53 too */
    expect(json?.vec).toEqual([0.5, -1, 2.25]); /* the values, not base64 */
    expectShapeMatches({ code: ALL_TYPES_HYDRATED_SOURCE, type: "Json" }, json);
  });

  test("JsonValue matches after a real JSON round trip too", async () => {
    const { hydrated } = await readBack(mongo.db);
    const wire = JSON.parse(JSON.stringify(BsonTypeTable.toJson(hydrated))) as unknown;
    expectShapeMatches({ code: ALL_TYPES_HYDRATED_SOURCE, type: "Json" }, wire);
  });

  test("PlainValue<Hydrated> matches BsonTypeTable.toPlain of the hydrated document", async () => {
    /*
     * The hydrated value (a Map is a Map there; a lean row has only a record — the schema-driven `.plain()` of a
     * query turns it back into a Map: plain-form.test.ts).
     */
    const { hydrated } = await readBack(mongo.db);
    const plain = BsonTypeTable.toPlain(hydrated);
    expect(plain.map).toBeInstanceOf(Map); /* a Map of the hydrated value stays a Map */
    expect(plain.bin).toBeInstanceOf(Uint8Array);
    expect(plain.date).toBeInstanceOf(Date);
    expectShapeMatches({ code: ALL_TYPES_HYDRATED_SOURCE, type: "Plain" }, plain);
    expect(() => JSON.stringify(plain)).not.toThrow(); /* no bigint left */
  });

  test("negative: with the driver defaults the same document does NOT match the table (int64)", async () => {
    const { read } = await readBack(plain.db);
    const result = ShapeCompare.check({ code: ALL_TYPES_HYDRATED_SOURCE, type: "Lean" }, read);
    expect(result.ok).toBe(false);
    /* big → Long, small → number */
    expect(result.mismatches.map((mismatch) => mismatch.path)).toEqual(["$.i64", "$.map.small", "$.map.big"]);
  });
});
