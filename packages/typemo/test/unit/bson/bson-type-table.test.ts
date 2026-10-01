import { describe, expect, test } from "bun:test";
import { Binary, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from "mongodb";
import {
  type BsonTypeKey,
  BsonTypeTable,
  CastError,
  type JsonValue,
  type LeanValue,
  type PlainValue,
  VectorCaster,
} from "../../../src/internal.ts";

/* The runtime half of the table and the form conversions. */

describe("BsonTypeTable rows", () => {
  test("covers every BSON type (scalars + containers)", () => {
    expect([...BsonTypeTable.keys].sort()).toEqual(
      (
        [
          "array",
          "binary",
          "bool",
          "date",
          "decimal128",
          "double",
          "int32",
          "long",
          "map",
          "maxKey",
          "minKey",
          "null",
          "object",
          "objectId",
          "regex",
          "string",
          "timestamp",
          "uuid",
          "vector",
        ] satisfies BsonTypeKey[]
      ).sort(),
    );
  });

  test("BSON type numbers, $type aliases and Binary subtypes", () => {
    const summary = BsonTypeTable.keys.map((key) => {
      const row =
        key in BsonTypeTable.scalars
          ? BsonTypeTable.scalars[key as keyof typeof BsonTypeTable.scalars]
          : BsonTypeTable.containers[key as keyof typeof BsonTypeTable.containers];
      return [key, row.bsonType, row.alias, row.subtype ?? null];
    });
    expect(summary).toEqual([
      ["objectId", 7, "objectId", null],
      ["string", 2, "string", null],
      ["double", 1, "double", null],
      ["int32", 16, "int", null],
      ["long", 18, "long", null],
      ["decimal128", 19, "decimal", null],
      ["bool", 8, "bool", null],
      ["date", 9, "date", null],
      ["binary", 5, "binData", 0],
      ["uuid", 5, "binData", 4],
      ["vector", 5, "binData", 9],
      ["regex", 11, "regex", null],
      ["timestamp", 17, "timestamp", null],
      ["minKey", -1, "minKey", null],
      ["maxKey", 127, "maxKey", null],
      ["null", 10, "null", null],
      ["array", 4, "array", null],
      ["object", 3, "object", null],
      ["map", 3, "object", null],
    ]);
  });
});

describe("BsonTypeTable.kindOf: the row a value belongs to, as the serializer decides", () => {
  test.each([
    ["s", "string"],
    [true, "bool"],
    [5, "int32"],
    [-(2 ** 31), "int32"],
    [2 ** 31, "double"],
    [1.5, "double"],
    [-0, "double"],
    [Number.NaN, "double"],
    [5n, "long"],
    [null, "null"],
    [[1], "array"],
    [{ a: 1 }, "object"],
    [new Map(), "map"],
    [new Date(), "date"],
    [/a/, "regex"],
    [new ObjectId(), "objectId"],
    [Decimal128.fromString("1"), "decimal128"],
    [new Binary(new Uint8Array([1])), "binary"],
    [new UUID(), "uuid"],
    [Binary.fromFloat32Array(new Float32Array([1])), "vector"],
    [new Timestamp({ t: 1, i: 1 }), "timestamp"],
    [new MinKey(), "minKey"],
    [new MaxKey(), "maxKey"],
  ] as [unknown, BsonTypeKey][])("%p → %s", (value, kind) => {
    expect(BsonTypeTable.kindOf(value)).toBe(kind);
  });

  test("values outside every form have no row", () => {
    for (const value of [undefined, () => 1, Symbol("x"), Long.fromNumber(1), new Int32(1), new Double(1), new Set()]) {
      expect(BsonTypeTable.kindOf(value)).toBeUndefined();
    }
  });
});

describe("BsonTypeTable.toJson", () => {
  test("every scalar row has its JSON form", () => {
    const id = new ObjectId();
    const uuid = new UUID();
    const hydrated = {
      id,
      s: "x",
      n: 1.5,
      i: 5,
      l: 9_007_199_254_740_991n,
      d: Decimal128.fromString("19.99"),
      b: true,
      date: new Date("2026-01-01T00:00:00.000Z"),
      bin: new Binary(new Uint8Array([1, 2, 3])),
      uuid,
      vector: VectorCaster.of({ dtype: "int8" }).cast([1, -2]),
      re: /a.b/i,
      ts: new Timestamp({ t: 7, i: 3 }),
      min: new MinKey(),
      max: new MaxKey(),
      nil: null,
      list: [1n, 2n],
      nested: { at: new Date(0) },
      map: new Map([["k", 1n]]),
    };
    const json: JsonValue<typeof hydrated> = BsonTypeTable.toJson(hydrated);
    expect(json).toEqual({
      id: id.toHexString(),
      s: "x",
      n: 1.5,
      i: 5,
      l: "9007199254740991" /* a decimal string, not a JSON number */,
      d: "19.99",
      b: true,
      date: "2026-01-01T00:00:00.000Z",
      bin: "AQID",
      uuid: uuid.toHexString(true),
      vector: [1, -2] /* the values, not base64 */,
      re: "/a.b/i",
      ts: { t: 7, i: 3 },
      min: { $minKey: 1 },
      max: { $maxKey: 1 },
      nil: null,
      list: ["1", "2"],
      nested: { at: "1970-01-01T00:00:00.000Z" },
      map: { k: "1" },
    });
    /* The JSON form survives JSON itself unchanged. */
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  test("a UUID stored as a plain Binary subtype 4 still gets the UUID text", () => {
    const uuid = new UUID();
    expect(BsonTypeTable.toJson(new Binary(uuid.buffer.slice(), 4))).toBe(uuid.toHexString(true));
  });

  test("regression: an int64 is a decimal string at any size (no throw beyond ±(2^53−1))", () => {
    expect(BsonTypeTable.toJson({ big: 9_007_199_254_740_993n })).toEqual({ big: "9007199254740993" });
    expect(BsonTypeTable.toJson([-9_223_372_036_854_775_808n, 0n, 7n])).toEqual(["-9223372036854775808", "0", "7"]);
  });

  test("NaN, Infinity and Invalid Date have no JSON form (reason json, with path)", () => {
    for (const [value, path] of [
      [{ a: Number.NaN }, "a"],
      [{ list: [1, Number.POSITIVE_INFINITY] }, "list.1"],
      [{ when: new Date(Number.NaN) }, "when"],
    ] as const) {
      let error: unknown;
      try {
        BsonTypeTable.toJson(value);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(CastError);
      expect((error as CastError).reason).toBe("json");
      expect((error as CastError).path).toBe(path);
    }
  });

  test("undefined and raw wrappers are outside the table (reason type)", () => {
    for (const value of [{ a: undefined }, { a: Long.fromNumber(1) }, { a: new Int32(1) }]) {
      expect(() => BsonTypeTable.toJson(value)).toThrow(CastError);
    }
  });

  test("a function is a CastError (type) with its path at any depth, in every form", () => {
    const f = () => 1;
    const cases: readonly (readonly [unknown, string])[] = [
      [f, ""],
      [{ a: 1, f }, "f"],
      [{ a: { f } }, "a.f"],
      [[1, f], "1"],
      [{ list: [{ f }] }, "list.0.f"],
      [new Map([["k", f]]), "k"],
    ];
    for (const convert of [BsonTypeTable.toJson, BsonTypeTable.toPlain, BsonTypeTable.toLean]) {
      for (const [value, path] of cases) {
        let caught: unknown;
        try {
          convert(value);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(CastError);
        expect([(caught as CastError).reason, (caught as CastError).path]).toEqual(["type", path]);
      }
    }
  });

  test("NaN has one rule at any depth: kept by the lean and plain forms, refused (json) by the JSON form", () => {
    for (const value of [Number.NaN, { a: Number.NaN }, { a: { b: [Number.NaN] } }]) {
      expect(() => BsonTypeTable.toLean(value)).not.toThrow();
      expect(() => BsonTypeTable.toPlain(value)).not.toThrow();
      expect(() => BsonTypeTable.toJson(value)).toThrow(expect.objectContaining({ reason: "json" }));
    }
  });
});

describe("BsonTypeTable.toPlain", () => {
  test("every scalar row has its plain form: MongoDB types as strings, native types kept, nothing aliased", () => {
    const id = new ObjectId();
    const uuid = new UUID();
    const date = new Date("2026-01-01T00:00:00.000Z");
    const re = /a.b/i;
    const hydrated = {
      id,
      s: "x",
      n: 1.5,
      i: 5,
      l: 9_223_372_036_854_775_807n,
      d: Decimal128.fromString("19.99"),
      b: true,
      date,
      bin: new Binary(new Uint8Array([1, 2, 3])),
      uuid,
      vector: VectorCaster.of({ dtype: "float32" }).cast([0.5, -2]),
      re,
      ts: new Timestamp({ t: 7, i: 3 }),
      min: new MinKey(),
      max: new MaxKey(),
      nil: null,
      list: [1n, 2n],
      nested: { at: new Date(0) },
      map: new Map([["k", { n: 1n }]]),
    };
    const plain: PlainValue<typeof hydrated> = BsonTypeTable.toPlain(hydrated);
    expect(plain).toEqual({
      id: id.toHexString(),
      s: "x",
      n: 1.5,
      i: 5,
      l: "9223372036854775807",
      d: "19.99",
      b: true,
      date: new Date("2026-01-01T00:00:00.000Z"),
      bin: new Uint8Array([1, 2, 3]),
      uuid: uuid.toHexString(true),
      vector: [0.5, -2],
      re: /a.b/i,
      ts: { t: 7, i: 3 },
      min: { $minKey: 1 },
      max: { $maxKey: 1 },
      nil: null,
      list: ["1", "2"],
      nested: { at: new Date(0) },
      map: new Map([["k", { n: "1" }]]),
    });
    expect(plain.date).not.toBe(date);
    expect(plain.re).not.toBe(re);
    expect(plain.map).toBeInstanceOf(Map);
    /* Bytes are the platform's own detached array, never a Buffer or a view on the Binary. */
    expect(Object.getPrototypeOf(plain.bin)).toBe(Uint8Array.prototype);
    expect(plain.bin.buffer).not.toBe(hydrated.bin.buffer.buffer);
    /* No bigint is left: JSON.stringify of the plain form never throws. */
    expect(() => JSON.stringify(plain)).not.toThrow();
  });

  test("vectors: int8 and float32 values; a packed-bit vector as its bits 0/1 without the padding", () => {
    expect(BsonTypeTable.toPlain(VectorCaster.of({ dtype: "int8" }).cast([-128, 0, 127]))).toEqual([-128, 0, 127]);
    /* float32 values are the float32 numbers (0.1 is stored as the nearest float32) */
    expect(BsonTypeTable.toPlain(VectorCaster.of({ dtype: "float32" }).cast([0.1]))).toEqual([Math.fround(0.1)]);
    /* 10 bits: two bytes, 6 padding bits in the last one — only the 10 bits come back */
    const bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1];
    const packed = VectorCaster.of({ dtype: "packedBit" }).cast(bits);
    expect(packed.buffer[1]).toBe(6); /* the header's padding byte */
    expect(BsonTypeTable.toPlain(packed)).toEqual(bits);
    /* JSON: the same values, not base64 */
    expect(BsonTypeTable.toJson(packed)).toEqual(bits);
  });

  test("a Binary of subtype 9 whose bytes are not a vector: CastError (format) with the path", () => {
    let error: unknown;
    try {
      BsonTypeTable.toPlain({ v: new Binary(new Uint8Array([0x7f, 0, 1]), 9) });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CastError);
    expect((error as CastError).reason).toBe("format");
    expect((error as CastError).path).toBe("v");
  });

  test("NaN and Infinity stay numbers (the plain form is JavaScript, not JSON); Invalid Date stays a Date", () => {
    const plain = BsonTypeTable.toPlain({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: new Date(Number.NaN) });
    expect(plain.a).toBeNaN();
    expect(plain.b).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(plain.c.getTime())).toBe(true);
  });

  test("undefined and raw wrappers are outside the table (reason type)", () => {
    for (const value of [{ a: undefined }, { a: Long.fromNumber(1) }, { a: new Double(1) }]) {
      expect(() => BsonTypeTable.toPlain(value)).toThrow(CastError);
    }
  });

  test("the plain form is idempotent: toPlain of a plain value is an equal value (bytes copied)", () => {
    const once = BsonTypeTable.toPlain({ id: new ObjectId(), bin: new Binary(new Uint8Array([7])), n: 1n });
    const twice = BsonTypeTable.toPlain(once);
    expect(twice).toEqual(once);
    expect(twice.bin).not.toBe(once.bin);
  });

  test("a Map key __proto__ stays a Map key; an object key __proto__ an own property", () => {
    const plain = BsonTypeTable.toPlain({ m: new Map([["__proto__", 1n]]) });
    expect(plain.m.get("__proto__")).toBe("1");
  });
});

describe("BsonTypeTable.toLean", () => {
  test("Map → plain object, containers rebuilt, mutable scalars copied", () => {
    const date = new Date(0);
    const bin = new Binary(new Uint8Array([1]));
    const id = new ObjectId();
    const hydrated = { map: new Map([["a", { when: date }]]), list: [bin], id };
    const lean: LeanValue<typeof hydrated> = BsonTypeTable.toLean(hydrated);
    expect(lean).toEqual({ map: { a: { when: new Date(0) } }, list: [new Binary(new Uint8Array([1]))], id });
    expect(lean.map.a?.when).not.toBe(date);
    expect(lean.list[0]).not.toBe(bin);
    expect(lean.id).toBe(id);
  });

  test("a Map key __proto__ becomes an own property, never the prototype", () => {
    const lean = BsonTypeTable.toLean(new Map([["__proto__", 1]])) as Record<string, unknown>;
    expect(Object.hasOwn(lean, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(lean)).toBe(Object.prototype);
  });

  test("undefined is outside the table", () => {
    expect(() => BsonTypeTable.toLean({ a: undefined })).toThrow(CastError);
  });
});
