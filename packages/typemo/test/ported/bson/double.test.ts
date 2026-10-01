/*
 * Ported from mongoose test/double.test.js onto Typemo's DoubleCaster. Mongoose hydrates a Double
 * path as `BSON.Double`; Typemo hydrates it as `number` and wraps it on write (`encode`), so
 * "doc.myDouble deepStrictEqual new Double(x)" becomes "encode(cast(x)) equals new Double(x)".
 * Divergences: see from-mongoose-to-typemo/DIVERGENCES.md.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { BSON, type Document } from "mongodb";
import { BsonOptions, DoubleCaster, SubdocumentCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

const Test = SubdocumentCaster.of({ myDouble: DoubleCaster });
const stored = (input: unknown): BSON.Double => DoubleCaster.encode(DoubleCaster.cast(input, "myDouble"));

describe("Double", () => {
  describe("special inputs", () => {
    // ported from mongoose test/double.test.js:75 "supports undefined as input"
    test("supports undefined as input — divergence: CastError", () => {
      expect(castFailure(() => Test.cast({ myDouble: undefined })).reason).toBe("undefined");
    });

    // ported from mongoose test/double.test.js:89 "supports null as input"
    test("supports null as input — divergence: only on a nullable path", () => {
      expect(castFailure(() => Test.cast({ myDouble: null })).reason).toBe("null");
    });
  });

  describe("valid casts", () => {
    // ported from mongoose test/double.test.js:105 "casts from decimal string"
    test("casts from decimal string — divergence: CastError", () => {
      expect(castFailure(() => stored("-42.008")).reason).toBe("type");
    });

    // ported from mongoose test/double.test.js:119 "casts from exponential string"
    test("casts from exponential string — divergence: CastError", () => {
      expect(castFailure(() => stored("1.22008e45")).reason).toBe("type");
    });

    // ported from mongoose test/double.test.js:133 "casts from infinite string"
    test("casts from infinite string — divergence: CastError (and ±Infinity itself is refused)", () => {
      expect(castFailure(() => stored("Infinity")).reason).toBe("type");
      expect(castFailure(() => stored(Number.NEGATIVE_INFINITY)).reason).toBe("finite");
    });

    // ported from mongoose test/double.test.js:152 "casts from NaN string"
    test("casts from NaN string — divergence: CastError", () => {
      expect(castFailure(() => stored("NaN")).reason).toBe("type");
    });

    // ported from mongoose test/double.test.js:166 "casts from number"
    test("casts from number", () => {
      expect(stored(988)).toEqual(new BSON.Double(988));
    });

    // ported from mongoose test/double.test.js:178 "casts from bigint"
    test("casts from bigint — divergence: CastError", () => {
      expect(castFailure(() => stored(-997n)).reason).toBe("type");
    });

    // ported from mongoose test/double.test.js:190 "casts from BSON.Long"
    test("casts from BSON.Long — divergence: CastError", () => {
      expect(castFailure(() => stored(BSON.Long.fromNumber(-997987))).reason).toBe("type");
    });

    // ported from mongoose test/double.test.js:202 "casts from BSON.Double"
    test("casts from BSON.Double", () => {
      expect(stored(new BSON.Double(-997983.33))).toEqual(new BSON.Double(-997983.33));
    });

    // ported from mongoose test/double.test.js:214 "casts boolean true to 1"
    test("casts boolean true to 1 — divergence: CastError", () => {
      expect(castFailure(() => stored(true)).reason).toBe("type");
    });

    // ported from mongoose test/double.test.js:226 "casts boolean false to 0"
    test("casts boolean false to 0 — divergence: CastError", () => {
      expect(castFailure(() => stored(false)).reason).toBe("type");
    });

    // ported from mongoose test/double.test.js:238 "casts empty string to null"
    test("casts empty string to null — divergence: CastError", () => {
      expect(castFailure(() => stored("")).reason).toBe("type");
    });

    // ported from mongoose test/double.test.js:250 "supports valueOf() function "
    test("supports valueOf() function — divergence: CastError", () => {
      expect(castFailure(() => stored({ a: "random", b: { c: "whatever" }, valueOf: () => 83.008 })).reason).toBe(
        "type",
      );
    });
  });

  describe("cast errors", () => {
    // ported from mongoose test/double.test.js:274 "throws a CastError upon validation"
    test("when a non-numeric string is provided to an Double field: throws a CastError", () => {
      const error = castFailure(() => Test.cast({ myDouble: "helloworld" }));
      expect(error.name).toBe("CastError");
      expect(error.message.startsWith('Cast to Double failed at path "myDouble" for "helloworld" (string)')).toBe(true);
    });

    // ported from mongoose test/double.test.js:292 "throws a CastError upon validation, even for a single-element or empty array" (history H015)
    test("when an array is provided to a Double field: throws a CastError, even for a single-element or empty array", () => {
      for (const value of [[5], [], [5, 6]])
        expect(castFailure(() => Test.cast({ myDouble: value })).name).toBe("CastError");
    });
  });

  describe("mongoDB integration", () => {
    const mongo = MongoLifecycle.useMongo("ported_double", BsonOptions.apply({}));
    const create = async (input: number) => {
      const collection = mongo.db.collection("tests");
      await collection.insertOne(Test.encode(Test.cast({ myDouble: input })) as Document);
      return collection;
    };

    // ported from mongoose test/double.test.js:380 "is queryable as a JS number in MongoDB"
    test("is queryable as a JS number in MongoDB (input 42.04: strings are refused, see :105)", async () => {
      const doc = await (await create(42.04)).findOne({ myDouble: { $type: "number" } });
      expect(doc?.myDouble).toBe(42.04);
    });

    // ported from mongoose test/double.test.js:387 "is NOT queryable as a BSON Integer in MongoDB if the value is NOT integer"
    test("is NOT queryable as a BSON Integer in MongoDB if the value is NOT integer", async () => {
      expect(await (await create(42.04)).findOne({ myDouble: { $type: "int" } })).toBeNull();
    });

    // ported from mongoose test/double.test.js:393 "is queryable as a BSON Double in MongoDB when a non-integer is provided"
    test("is queryable as a BSON Double in MongoDB when a non-integer is provided", async () => {
      const doc = await (await create(42.04)).findOne({ myDouble: { $type: "double" } });
      expect(doc?.myDouble).toBe(42.04);
    });

    // ported from mongoose test/double.test.js:399 "is queryable as a BSON Double in MongoDB when an integer is provided"
    test("is queryable as a BSON Double in MongoDB when an integer is provided", async () => {
      const doc = await (await create(42)).findOne({ myDouble: { $type: "double" } });
      expect(doc?.myDouble).toBe(42);
    });
  });
});
