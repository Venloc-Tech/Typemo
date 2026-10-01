/*
 * Ported from mongoose test/schema.union.test.js onto Typemo's UnionCaster (a member is chosen
 * by a type guard or a discriminator, not by trying casters in order).
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import type { Document } from "mongodb";
import {
  BooleanCaster,
  BsonGuards,
  BsonOptions,
  NumberCaster,
  StringCaster,
  SubdocumentCaster,
  UnionCaster,
} from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

const mongo = MongoLifecycle.useMongo("ported_union", BsonOptions.apply({}));
const isNumber = (value: unknown): boolean => typeof value === "number";

describe("Union", () => {
  // ported from mongoose test/schema.union.test.js:27 "basic functionality should work"
  test("basic functionality should work", async () => {
    const TestModel = SubdocumentCaster.of({
      test: UnionCaster.byGuard(
        UnionCaster.member("number", isNumber, NumberCaster),
        UnionCaster.member("string", (value) => typeof value === "string", StringCaster),
      ),
    });
    const collection = mongo.db.collection("tests");

    const doc1 = TestModel.cast({ test: 1 });
    expect(doc1.test).toBe(1);
    const { insertedId: id1 } = await collection.insertOne(TestModel.encode(doc1) as Document);
    expect((await collection.findOne({ _id: id1 }))?.test).toBe(1);

    const doc2 = TestModel.cast({ test: "abc" });
    expect(doc2.test).toBe("abc");
    const { insertedId: id2 } = await collection.insertOne(TestModel.encode(doc2) as Document);
    expect((await collection.findOne({ _id: id2 }))?.test).toBe("abc");
  });

  // ported from mongoose test/schema.union.test.js:51 "should report last cast error"
  test("should report last cast error — divergence: union-no-match naming every member", () => {
    const TestModel = SubdocumentCaster.of({
      test: UnionCaster.byGuard(
        UnionCaster.member("number", isNumber, NumberCaster),
        UnionCaster.member("boolean", (value) => typeof value === "boolean", BooleanCaster),
      ),
    });
    // Mongoose: 'Cast to Boolean failed for value "taco tuesday"' (the last member's error only).
    const error = castFailure(() => TestModel.cast({ test: "taco tuesday" }));
    expect(error.reason).toBe("union-no-match");
    expect(error.path).toBe("test");
    expect(error.message).toContain("number, boolean");
  });

  // ported from mongoose test/schema.union.test.js:162 "does not bypass validation when a Union of Objects is used (gh-15732)"
  test("does not bypass validation when a Union of Objects is used (gh-15732)", () => {
    const product = UnionCaster.byGuard(
      UnionCaster.member(
        "schema1",
        BsonGuards.isPlainObject,
        SubdocumentCaster.of({ price: NumberCaster, title: StringCaster, isThisSchema1: BooleanCaster }),
        [(value) => value.price !== undefined || "price is required"],
      ),
      UnionCaster.member("number", isNumber, NumberCaster),
    );
    // The original input carries unknown fields (arbitraryNeverSave, isThisSchema2); Mongoose strips
    // them silently, Typemo refuses them (strict by default), so the known fields are used for the validation logic.
    expect(castFailure(() => product.cast({ title: "string", arbitraryNeverSave: true })).reason).toBe("unknown-key");
    const withoutPrice = product.cast({ title: "string", isThisSchema1: true });
    expect(product.validate(withoutPrice, "product").map((issue) => issue.message)).toEqual(["price is required"]);
    const withPrice = product.cast({ price: 42, title: "string", isThisSchema1: true });
    expect(product.validate(withPrice, "product")).toEqual([]);
  });
});
