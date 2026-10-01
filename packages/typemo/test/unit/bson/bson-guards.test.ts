import { describe, expect, test } from "bun:test";
import {
  Binary,
  BSONRegExp,
  BSONSymbol,
  Code,
  DBRef,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID,
} from "mongodb";
import { BsonGuards, type BsonTypeTag } from "../../../src/internal.ts";

/* Identification by `Symbol.for("@@mdb.bson.type")` / `_bsontype`, never `instanceof`. */

describe("BsonGuards.tagOf", () => {
  test("every bson class is recognized by its tag", () => {
    const values: [unknown, BsonTypeTag][] = [
      [new ObjectId(), "ObjectId"],
      [new Binary(new Uint8Array([1])), "Binary"],
      [new UUID(), "Binary"],
      [Long.fromNumber(1), "Long"],
      [Decimal128.fromString("1"), "Decimal128"],
      [new Double(1), "Double"],
      [new Int32(1), "Int32"],
      [new Timestamp({ t: 1, i: 1 }), "Timestamp"],
      [new BSONRegExp("a", "i"), "BSONRegExp"],
      [new BSONSymbol("s"), "BSONSymbol"],
      [new Code("x"), "Code"],
      [new DBRef("c", new ObjectId()), "DBRef"],
      [new MinKey(), "MinKey"],
      [new MaxKey(), "MaxKey"],
    ];
    for (const [value, tag] of values) expect(BsonGuards.tagOf(value)).toBe(tag);
  });

  test("non-BSON values have no tag", () => {
    for (const value of [null, undefined, 1, "ObjectId", {}, [], new Date(), { _bsontype: "Unknown" }]) {
      expect(BsonGuards.tagOf(value)).toBeUndefined();
    }
  });

  test("a value of another bson copy (a different class) is recognized without instanceof", () => {
    /* Simulates a second copy of `bson`: same markers, unrelated class. */
    class ForeignObjectId {
      get _bsontype(): "ObjectId" {
        return "ObjectId";
      }
      get [Symbol.for("@@mdb.bson.type")](): string {
        return "ObjectId";
      }
    }
    const foreign = new ForeignObjectId();
    expect(foreign instanceof ObjectId).toBe(false);
    expect(BsonGuards.isObjectId(foreign)).toBe(true);
  });

  test("the symbol marker wins over _bsontype; the legacy ObjectID tag is normalized", () => {
    expect(BsonGuards.tagOf({ [Symbol.for("@@mdb.bson.type")]: "Decimal128", _bsontype: "ObjectId" })).toBe(
      "Decimal128",
    );
    expect(BsonGuards.tagOf({ _bsontype: "ObjectID" })).toBe("ObjectId");
  });
});

describe("BsonGuards: Binary subtypes", () => {
  test("isUuid: subtype 4 with 16 bytes (a UUID instance or a plain Binary)", () => {
    expect(BsonGuards.isUuid(new UUID())).toBe(true);
    expect(BsonGuards.isUuid(new Binary(new Uint8Array(16), 4))).toBe(true);
    expect(BsonGuards.isUuid(new Binary(new Uint8Array(15), 4))).toBe(false);
    expect(BsonGuards.isUuid(new Binary(new Uint8Array(16), 3))).toBe(false);
  });

  test("isVector: subtype 9", () => {
    expect(BsonGuards.isVector(Binary.fromInt8Array(new Int8Array([1])))).toBe(true);
    expect(BsonGuards.isVector(new Binary(new Uint8Array([1])))).toBe(false);
  });
});

describe("BsonGuards: built-ins by toString tag", () => {
  test("Date, RegExp, Map, Set, Uint8Array", () => {
    expect(BsonGuards.isDate(new Date())).toBe(true);
    expect(BsonGuards.isValidDate(new Date(Number.NaN))).toBe(false);
    expect(BsonGuards.isRegExp(/a/)).toBe(true);
    expect(BsonGuards.isMap(new Map())).toBe(true);
    expect(BsonGuards.isSet(new Set())).toBe(true);
    expect(BsonGuards.isUint8Array(Buffer.from("x"))).toBe(true);
    expect(BsonGuards.isUint8Array(new Int8Array(1))).toBe(false);
    expect(BsonGuards.isDate({ getTime: () => 0 })).toBe(false);
  });
});

describe("BsonGuards.isOpaqueValue / isPlainObject (runtime twins of OpaqueValue / IsPlainObject)", () => {
  const opaque = [
    new Date(),
    /a/,
    new ObjectId(),
    new Binary(new Uint8Array(1)),
    new UUID(),
    new Uint8Array(1),
    Buffer.from("x"),
    new ArrayBuffer(1),
    Long.fromNumber(1),
    Decimal128.fromString("1"),
    new Double(1),
    new Int32(1),
    new Timestamp({ t: 1, i: 1 }),
    new BSONRegExp("a"),
    new BSONSymbol("s"),
    new Code("x"),
    new DBRef("c", new ObjectId()),
    new MinKey(),
    new MaxKey(),
    new Map(),
    new Set(),
  ];

  test("every OpaqueValue member is opaque and not a plain object", () => {
    for (const value of opaque) {
      expect(BsonGuards.isOpaqueValue(value)).toBe(true);
      expect(BsonGuards.isPlainObject(value)).toBe(false);
    }
  });

  test("plain objects, null-prototype objects and class instances are plain; the rest is not", () => {
    class Address {
      city = "x";
    }
    expect(BsonGuards.isPlainObject({ a: 1 })).toBe(true);
    expect(BsonGuards.isPlainObject(Object.create(null))).toBe(true);
    expect(BsonGuards.isPlainObject(new Address())).toBe(true);
    for (const value of [null, undefined, "x", 1, [], () => 1, Promise.resolve()]) {
      expect(BsonGuards.isPlainObject(value)).toBe(false);
    }
  });
});

describe("dual-package hazard: the ESM build of bson vs the driver's CommonJS copy", () => {
  test("`bson` (ESM) and `mongodb` (CJS bson) export different classes — instanceof cannot be trusted", async () => {
    const esm = await import("bson");
    expect(esm.ObjectId === ObjectId).toBe(false);
    const fromEsm = new esm.ObjectId();
    expect(fromEsm instanceof ObjectId).toBe(false);
    expect(BsonGuards.isObjectId(fromEsm)).toBe(true);
  });

  test("casters accept values of either copy and return the driver's classes (same as values read from the DB)", async () => {
    const esm = await import("bson");
    const { ObjectIdCaster, UuidCaster, BinaryCaster } = await import("../../../src/internal.ts");
    const id = new esm.ObjectId();
    expect(ObjectIdCaster.cast(id)).toBe(id); /* a native value passes as is */
    expect(UuidCaster.cast(new esm.UUID())).toBeInstanceOf(UUID);
    expect(BinaryCaster.cast(new esm.Binary(new Uint8Array([1])))).toBeInstanceOf(Binary);
  });
});
