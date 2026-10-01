/*
 * Ported from mongoose test/schema.uuid.test.js onto Typemo's UuidCaster. The query-casting half of
 * "basic functionality" (Model.findOne({ x: '<uuid string>' })) belongs to the filter cast
 * and is not ported here; the storage half is.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { Binary, type Document, UUID } from "mongodb";
import { ArrayCaster, BsonGuards, BsonOptions, SubdocumentCaster, UuidCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

const mongo = MongoLifecycle.useMongo("ported_uuid", BsonOptions.apply({}));
const TestSchema = SubdocumentCaster.of({ x: UuidCaster, y: ArrayCaster.of(UuidCaster) });

describe("SchemaUUID", () => {
  // ported from mongoose test/schema.uuid.test.js:36 "basic functionality should work"
  test("basic functionality should work", async () => {
    const doc = TestSchema.cast({ x: "09190f70-3d30-11e5-8814-0f4df9a59c41" });
    expect(doc.x).toBeInstanceOf(UUID);
    expect(doc.x?.toString()).toBe("09190f70-3d30-11e5-8814-0f4df9a59c41");
    const collection = mongo.db.collection("tests");
    await collection.insertOne(TestSchema.encode(doc) as Document);

    // check that the data is actually a buffer in the database with the correct subtype
    const rawDoc = await collection.findOne({
      x: new Binary(Buffer.from("09190f703d3011e588140f4df9a59c41", "hex"), 4),
    });
    expect(rawDoc).not.toBeNull();
    expect(BsonGuards.isBinary(rawDoc?.x)).toBe(true);
    expect(rawDoc?.x.sub_type).toBe(4);

    const rawDoc2 = await collection.findOne({ x: new UUID("09190f70-3d30-11e5-8814-0f4df9a59c41") });
    expect(rawDoc2?.x).toBeInstanceOf(UUID);
    expect(rawDoc2?.x.sub_type).toBe(4);
  });

  // ported from mongoose test/schema.uuid.test.js:64 "should throw error in case of invalid string"
  test("should throw error in case of invalid string", () => {
    const error = castFailure(() => TestSchema.cast({ x: "invalid" }));
    expect(error.path).toBe("x");
    expect(error.reason).toBe("format");
    expect(error.message).toContain("not a UUID string");
  });

  // ported from mongoose test/schema.uuid.test.js:175 "handles built-in UUID type (gh-13103)"
  test("handles built-in UUID type (gh-13103)", async () => {
    const Test = SubdocumentCaster.of({ _id: UuidCaster });
    const uuid = new UUID();
    const created = Test.cast({ _id: uuid });
    expect(created._id).toBeInstanceOf(UUID);
    expect(created._id?.toString()).toBe(uuid.toString());
    const collection = mongo.db.collection<{ _id: UUID }>("uuid_ids");
    await collection.insertOne(Test.encode(created) as { _id: UUID });
    const found = await collection.findOne({ _id: uuid });
    expect(found?._id).toBeInstanceOf(UUID);
    expect(found?._id.toString()).toBe(uuid.toString());
  });
});
