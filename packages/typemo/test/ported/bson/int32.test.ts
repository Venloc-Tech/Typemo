/*
 * Ported from mongoose test/int32.test.js onto Typemo's Int32Caster. A Mongoose model with one
 * Int32 path becomes `SubdocumentCaster.of({ myInt: Int32Caster })` (cast of the document) or
 * `Int32Caster.cast(value, "myInt")`. Divergences: from-mongoose-to-typemo/DIVERGENCES.md.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { BSON, type Document } from "mongodb";
import { BsonOptions, Int32Caster, SubdocumentCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

const INT32_MAX = 0x7fffffff;
const INT32_MIN = -0x80000000;
const Test = SubdocumentCaster.of({ myInt: Int32Caster });

describe("Int32", () => {
  describe("special inputs", () => {
    // ported from mongoose test/int32.test.js:78 "supports INT32_MIN as input"
    test("supports INT32_MIN as input", () => {
      expect(Test.cast({ myInt: INT32_MIN }).myInt).toBe(INT32_MIN);
    });

    // ported from mongoose test/int32.test.js:92 "supports INT32_MAX as input"
    test("supports INT32_MAX as input", () => {
      expect(Test.cast({ myInt: INT32_MAX }).myInt).toBe(INT32_MAX);
    });

    // ported from mongoose test/int32.test.js:106 "supports undefined as input"
    test("supports undefined as input — divergence: CastError (omit the field instead)", () => {
      // Mongoose: new Test({ myInt: undefined }).myInt === undefined
      expect(castFailure(() => Test.cast({ myInt: undefined })).reason).toBe("undefined");
      expect(Test.cast({})).toEqual({});
    });

    // ported from mongoose test/int32.test.js:120 "supports null as input"
    test("supports null as input — divergence: only on a nullable path", () => {
      // Mongoose: new Test({ myInt: null }).myInt === null
      expect(castFailure(() => Test.cast({ myInt: null })).reason).toBe("null");
    });
  });

  describe("valid casts", () => {
    // ported from mongoose test/int32.test.js:136 "casts from string"
    test("casts from string — divergence: CastError", () => {
      // Mongoose: '-42' → -42
      expect(castFailure(() => Int32Caster.cast("-42", "myInt")).reason).toBe("type");
    });

    // ported from mongoose test/int32.test.js:150 "casts from number"
    test("casts from number — divergence: the numeric string '-997.0' is refused", () => {
      // Mongoose: '-997.0' → -997
      expect(castFailure(() => Int32Caster.cast("-997.0", "myInt")).reason).toBe("type");
      expect(Int32Caster.cast(-997, "myInt")).toBe(-997);
    });

    // ported from mongoose test/int32.test.js:162 "casts from bigint"
    test("casts from bigint — divergence: CastError", () => {
      // Mongoose: -997n → -997
      expect(castFailure(() => Int32Caster.cast(-997n, "myInt")).reason).toBe("type");
    });

    // ported from mongoose test/int32.test.js:174 "casts from BSON.Int32"
    test("casts from BSON.Int32", () => {
      expect(Int32Caster.cast(new BSON.Int32(-997), "myInt")).toBe(-997);
    });

    // ported from mongoose test/int32.test.js:191 "casts from BSON.Long provided its value is within bounds of Int32"
    test("casts from BSON.Long provided its value is within bounds of Int32 — divergence: CastError", () => {
      // Mongoose: Long(-997) → -997. A Long is another BSON type (int64).
      expect(castFailure(() => Int32Caster.cast(BSON.Long.fromNumber(-997), "myInt")).reason).toBe("type");
    });

    // ported from mongoose test/int32.test.js:203 "calls Long.toNumber when casting long"
    test("calls Long.toNumber when casting long — divergence: Long is refused, toNumber is never called", () => {
      // Mongoose stubs Long.prototype.toNumber (a perf detail) and expects its result. No global stubs here.
      const long = BSON.Long.fromNumber(-997);
      let called = false;
      const spy = Object.assign(Object.create(long) as object, {
        toNumber: (): number => {
          called = true;
          return 2;
        },
      });
      expect(castFailure(() => Int32Caster.cast(spy, "myInt")).reason).toBe("type");
      expect(called).toBe(false);
    });

    // ported from mongoose test/int32.test.js:222 "casts from BSON.Double provided its value is an integer"
    test("casts from BSON.Double provided its value is an integer — divergence: CastError", () => {
      // Mongoose: Double(-997) → -997. A Double is another BSON type.
      expect(castFailure(() => Int32Caster.cast(new BSON.Double(-997), "myInt")).reason).toBe("type");
    });

    // ported from mongoose test/int32.test.js:234 "casts boolean true to 1"
    test("casts boolean true to 1 — divergence: CastError", () => {
      expect(castFailure(() => Int32Caster.cast(true, "myInt")).reason).toBe("type");
    });

    // ported from mongoose test/int32.test.js:246 "casts boolean false to 0"
    test("casts boolean false to 0 — divergence: CastError", () => {
      expect(castFailure(() => Int32Caster.cast(false, "myInt")).reason).toBe("type");
    });

    // ported from mongoose test/int32.test.js:258 "casts empty string to null"
    test("casts empty string to null — divergence: CastError ('' is never null)", () => {
      expect(castFailure(() => Int32Caster.cast("", "myInt")).reason).toBe("type");
    });

    // ported from mongoose test/int32.test.js:270 "supports valueOf() function "
    test("supports valueOf() function — divergence: CastError", () => {
      const value = { a: "random", b: { c: "whatever" }, valueOf: () => 83 };
      expect(castFailure(() => Int32Caster.cast(value, "myInt")).reason).toBe("type");
    });
  });

  describe("cast errors", () => {
    const expectCastError = (value: unknown, printed: string): void => {
      const error = castFailure(() => Test.cast({ myInt: value }));
      expect(error.name).toBe("CastError");
      expect(error.path).toBe("myInt");
      // Mongoose: /^Cast to Int32 failed for value "…" \(type …\) at path "myInt"/ — same facts, Typemo's wording.
      expect(error.message.startsWith(`Cast to Int32 failed at path "myInt" for ${printed}`)).toBe(true);
    };

    // ported from mongoose test/int32.test.js:294 "throws a CastError upon validation"
    test("when a non-integer decimal input is provided to an Int32 field: throws a CastError", () => {
      expectCastError(-42.4, "-42.4 (number)");
    });

    // ported from mongoose test/int32.test.js:312 "throws a CastError upon validation"
    test("when a non-numeric string is provided to an Int32 field: throws a CastError", () => {
      expectCastError("helloworld", '"helloworld" (string)');
    });

    // ported from mongoose test/int32.test.js:330 "throws a CastError upon validation"
    test("when a non-integer decimal string is provided to an Int32 field: throws a CastError", () => {
      expectCastError("1.2", '"1.2" (string)');
    });

    // ported from mongoose test/int32.test.js:348 "throws a CastError upon validation"
    test("when NaN is provided to an Int32 field: throws a CastError", () => {
      expectCastError(Number.NaN, "NaN (number)");
    });

    // ported from mongoose test/int32.test.js:366 "throws a CastError upon validation"
    test("when value above INT32_MAX is provided to an Int32 field: throws a CastError", () => {
      expectCastError(INT32_MAX + 1, "2147483648 (number)");
    });

    // ported from mongoose test/int32.test.js:384 "throws a CastError upon validation"
    test("when value below INT32_MIN is provided to an Int32 field: throws a CastError", () => {
      expectCastError(INT32_MIN - 1, "-2147483649 (number)");
    });

    // ported from mongoose test/int32.test.js:402 "throws a CastError upon validation, even for a single-element or empty array" (history H015)
    test("when an array is provided to an Int32 field: throws a CastError, even for a single-element or empty array", () => {
      for (const value of [[5], [], [5, 6]])
        expect(castFailure(() => Test.cast({ myInt: value })).name).toBe("CastError");
    });
  });

  describe("mongoDB integration", () => {
    const mongo = MongoLifecycle.useMongo("ported_int32", BsonOptions.apply({}));
    const create = async (input: unknown) => {
      const collection = mongo.db.collection("tests");
      await collection.insertOne(Test.encode(Test.cast({ myInt: input })) as Document);
      return collection;
    };

    // ported from mongoose test/int32.test.js:490 "is queryable as a JS number in MongoDB"
    test("is queryable as a JS number in MongoDB (input 42: the string '42' is refused, see :136)", async () => {
      const doc = await (await create(42)).findOne({ myInt: { $type: "number" } });
      expect(doc?.myInt).toBe(42);
    });

    // ported from mongoose test/int32.test.js:497 "is queryable as a BSON Int32 in MongoDB"
    test("is queryable as a BSON Int32 in MongoDB", async () => {
      const doc = await (await create(42)).findOne({ myInt: { $type: "int" } });
      expect(doc?.myInt).toBe(42);
    });

    // ported from mongoose test/int32.test.js:504 "is NOT queryable as a BSON Double in MongoDB"
    test("is NOT queryable as a BSON Double in MongoDB", async () => {
      const doc = await (await create(42)).findOne({ myInt: { $type: "double" } });
      expect(doc).toBeNull();
    });
  });
});
