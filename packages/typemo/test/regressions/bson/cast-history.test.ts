/*
 * Regressions from research/mongoose/M11-history/history.yaml, area `cast`, that belong to value casting.
 * Test names start with the history id. Entries about filters, updates, `$expr`,
 * setters, validators and models are covered by the tests of the layers that own them.
 */
import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { Binary, type Document, Double, UUID } from "mongodb";
import {
  ArrayCaster,
  BigIntCaster,
  BinaryCaster,
  BooleanCaster,
  BsonOptions,
  CastError,
  DateCaster,
  DoubleCaster,
  Int32Caster,
  NullableCaster,
  NumberCaster,
  StringCaster,
  SubdocumentCaster,
  UnionCaster,
  UuidCaster,
} from "../../../src/internal.ts";

/** The document a find returned; a missing one fails the test here, not later with a TypeError. */
const found = <T>(document: T | null | undefined): T => {
  if (document === null || document === undefined) throw new Error("document not found");
  return document;
};

const mongo = MongoLifecycle.useMongo("regressions_cast", BsonOptions.apply({}));

const failure = (run: () => unknown): CastError => {
  try {
    run();
  } catch (error) {
    if (error instanceof CastError) return error;
    throw error;
  }
  throw new Error("expected a CastError");
};

describe("history.yaml, area cast", () => {
  test("H015: an array is never cast to Int32/Double ([5] → CastError)", () => {
    for (const caster of [Int32Caster, DoubleCaster, NumberCaster, BigIntCaster, DateCaster]) {
      for (const value of [[5], [], [5, 6]]) expect(failure(() => caster.cast(value)).reason).toBe("type");
    }
  });

  test("H079: Double — cast('1.5') and cast('abc') fail, cast(new Double(1)) passes", () => {
    expect(failure(() => DoubleCaster.cast("1.5")).reason).toBe("type");
    expect(failure(() => DoubleCaster.cast("abc")).reason).toBe("type");
    expect(DoubleCaster.cast(new Double(1))).toBe(1);
  });

  test("H135: bigint outside int64 → CastError; 2^63 - 1 passes; a Long from the DB reads as bigint", async () => {
    expect(failure(() => BigIntCaster.cast(2n ** 63n)).reason).toBe("range");
    expect(BigIntCaster.cast(2n ** 63n - 1n)).toBe(2n ** 63n - 1n);
    const collection = mongo.db.collection("h135");
    const { insertedId } = await collection.insertOne({ v: BigIntCaster.encode(2n ** 63n - 1n) });
    expect((await collection.findOne({ _id: insertedId }))?.v).toBe(2n ** 63n - 1n);
  });

  test("H329: round trip bigint ↔ Long and UUID ↔ Binary subtype 4", async () => {
    const Doc = SubdocumentCaster.of({ n: BigIntCaster, u: UuidCaster });
    const hydrated = Doc.cast({ n: -5n, u: "0f8fad5b-d9cb-469f-a165-70867728950e" });
    const collection = mongo.db.collection("h329");
    const { insertedId } = await collection.insertOne(Doc.encode(hydrated) as Document);
    expect(await collection.countDocuments({ _id: insertedId, n: { $type: "long" }, u: { $type: "binData" } })).toBe(1);
    const read = await collection.findOne({ _id: insertedId });
    expect(read?.n).toBe(-5n);
    expect(read?.u).toBeInstanceOf(UUID);
    expect(read?.u.sub_type).toBe(4);
    expect((found(read).u as UUID).toHexString()).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
  });

  test("H504: Boolean — no string table at all ('true', 'false', '1', '0', 'yes', 'no', 'abc' all fail)", () => {
    for (const value of ["true", "false", "1", "0", "yes", "no", "abc", 1, 0]) {
      expect(failure(() => BooleanCaster.cast(value)).reason).toBe("type");
    }
    expect(BooleanCaster.cast(false)).toBe(false);
  });

  test("H504: Date — no moment-like or valueOf parsing", () => {
    expect(failure(() => DateCaster.cast({ valueOf: () => 0 })).reason).toBe("type");
    expect(failure(() => DateCaster.cast("January 1, 2020")).reason).toBe("format");
  });

  test("H167: EJSON { $binary } is not cast to Binary (strict: only Binary / Uint8Array)", () => {
    expect(failure(() => BinaryCaster.cast({ $binary: { base64: "AQID", subType: "00" } })).reason).toBe("type");
    expect(BinaryCaster.cast(new Binary(new Uint8Array([1, 2, 3]))).position).toBe(3);
  });

  test("H042: the reason stays in the message", () => {
    const error = failure(() => Int32Caster.cast(1.5, "n"));
    expect(error.reason).toBe("integer");
    expect(error.message).toContain("[integer]");
    expect(error.message).toContain("a fractional number is not an Int32");
  });

  test("H195: a CastError has no model/schema reference; inspect output is compact", () => {
    const error = failure(() => SubdocumentCaster.of({ n: Int32Caster }).cast({ n: "x" }));
    expect(Object.keys(error).sort()).toEqual(["detail", "expected", "path", "reason", "value"]);
    expect(inspect(error).length).toBeLessThan(2_000);
  });

  test("H039: null is refused unless the path is nullable; undefined is refused always", () => {
    expect(failure(() => StringCaster.cast(null)).reason).toBe("null");
    expect(NullableCaster.of(StringCaster).cast(null)).toBeNull();
    expect(failure(() => NullableCaster.of(StringCaster).cast(undefined)).reason).toBe("undefined");
  });

  test("H109: Union[Number, String] — '5' stays a string, 5 stays a number (no try-in-order)", () => {
    const union = UnionCaster.byGuard(
      UnionCaster.member("number", (value) => typeof value === "number", NumberCaster),
      UnionCaster.member("string", (value) => typeof value === "string", StringCaster),
    );
    expect(union.cast("5")).toBe("5");
    expect(union.cast(5)).toBe(5);
    expect(ArrayCaster.of(union).cast([1, "a"])).toEqual([1, "a"]); // array of unions (8.19.4 #15720)
  });

  test("H155 (casting part): a discriminated value is cast by its own member ({ kind: 'B', bField: '1' })", () => {
    const union = UnionCaster.byDiscriminator("kind", {
      A: SubdocumentCaster.of({ kind: StringCaster, aField: NumberCaster }),
      B: SubdocumentCaster.of({ kind: StringCaster, bField: StringCaster }),
    });
    expect(union.cast({ kind: "B", bField: "1" })).toEqual({ kind: "B", bField: "1" });
    expect(failure(() => union.cast({ kind: "A", bField: "1" })).path).toBe("bField");
  });

  test("H127 (casting part): casting never mutates the user's object or array", () => {
    const Doc = SubdocumentCaster.of({ n: Int32Caster, list: ArrayCaster.of(Int32Caster) });
    const input = Object.freeze({ n: 1, list: Object.freeze([1, 2]) });
    const result = Doc.cast(input);
    expect(result).not.toBe(input);
    expect(result.list).not.toBe(input.list);
    expect(input).toEqual({ n: 1, list: [1, 2] });
  });
});
