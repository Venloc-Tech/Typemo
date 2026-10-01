/*
 * Ported from mongoose test/bigint.test.js onto Typemo's BigIntCaster (int64 is hydrated as `bigint`).
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import type { Document } from "mongodb";
import { BigIntCaster, BsonOptions, SubdocumentCaster } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

describe("BigInt", () => {
  // ported from mongoose test/bigint.test.js:12 "is a valid schema type"
  test("is a valid schema type", () => {
    const value = SubdocumentCaster.of({ myBigInt: BigIntCaster }).cast({ myBigInt: 42n }).myBigInt;
    expect(value).toBe(42n);
    expect(typeof value).toBe("bigint");
  });

  // ported from mongoose test/bigint.test.js:25 "casting from strings and numbers"
  test("casting from strings and numbers — numbers (safe list) and strictly decimal strings", () => {
    const Test = SubdocumentCaster.of({ bigint1: BigIntCaster, bigint2: BigIntCaster });
    expect(Test.cast({ bigint1: 42 }).bigint1).toBe(42n);
    // Mongoose: bigint2: '997' → 997n; Typemo agrees (only the canonical decimal form)
    expect(Test.cast({ bigint2: "997" }).bigint2).toBe(997n);
    // divergence: Mongoose's BigInt(" 0x10 ") takes spaces and prefixes; Typemo refuses them (format)
    expect(castFailure(() => Test.cast({ bigint2: " 0x10 " })).reason).toBe("format");
  });

  // ported from mongoose test/bigint.test.js:42 "handles cast errors"
  test("handles cast errors", () => {
    const error = castFailure(() => SubdocumentCaster.of({ bigint: BigIntCaster }).cast({ bigint: "foo bar" }));
    expect(error.name).toBe("CastError");
    expect(error.path).toBe("bigint");
    expect(error.message.startsWith('Cast to Long failed at path "bigint" for "foo bar" (string)')).toBe(true);
  });

  describe("MongoDB integration", () => {
    const mongo = MongoLifecycle.useMongo("ported_bigint", BsonOptions.apply({}));
    const Test = SubdocumentCaster.of({ myBigInt: BigIntCaster });

    // ported from mongoose test/bigint.test.js:108 "is stored as a long in MongoDB"
    test("is stored as a long in MongoDB", async () => {
      const collection = mongo.db.collection("tests");
      await collection.insertOne(Test.encode(Test.cast({ myBigInt: 9223372036854775807n })) as Document);
      const doc = await collection.findOne({ myBigInt: { $type: "long" } });
      expect(doc?.myBigInt).toBe(9223372036854775807n);
    });

    // ported from mongoose test/bigint.test.js:116 "becomes a bigint with lean using useBigInt64"
    test("becomes a bigint with lean using useBigInt64 (enforced by BsonOptions, no per-query option)", async () => {
      const collection = mongo.db.collection("tests");
      await collection.insertOne(Test.encode(Test.cast({ myBigInt: 9223372036854775807n })) as Document);
      const doc = await collection.findOne({ myBigInt: 9223372036854775807n });
      expect(doc?.myBigInt).toBe(9223372036854775807n);
    });
  });
});
