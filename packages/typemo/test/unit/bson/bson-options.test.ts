import { describe, expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { BsonOptions, ConfigurationError } from "../../../src/index.ts";

/* The driver BSON options are forced, and a conflicting value is an error. */

describe("BsonOptions.apply", () => {
  test("adds every required option and keeps the other options; the input is not mutated", () => {
    const input = Object.freeze({ appName: "x", maxPoolSize: 5 });
    const result = BsonOptions.apply(input);
    expect(result).toEqual({ appName: "x", maxPoolSize: 5, ...BsonOptions.REQUIRED });
    expect(input).toEqual({ appName: "x", maxPoolSize: 5 });
  });

  test("the required values", () => {
    expect(BsonOptions.REQUIRED).toEqual({
      useBigInt64: true,
      promoteValues: true,
      promoteLongs: true,
      promoteBuffers: false,
      bsonRegExp: false,
      ignoreUndefined: false,
      serializeFunctions: false,
      raw: false,
      enableUtf8Validation: true,
    });
    expect(Object.isFrozen(BsonOptions.REQUIRED)).toBe(true);
  });

  test("an explicit value equal to the required one is accepted", () => {
    expect(BsonOptions.apply({ useBigInt64: true, bsonRegExp: false }).useBigInt64).toBe(true);
  });

  test.each([
    ["useBigInt64", false],
    ["promoteValues", false],
    ["promoteLongs", false],
    ["promoteBuffers", true],
    ["bsonRegExp", true],
    ["ignoreUndefined", true],
    ["serializeFunctions", true],
    ["raw", true],
    ["enableUtf8Validation", false],
  ])("%s: %p is a ConfigurationError", (key, value) => {
    /* cast: the conflict is also a compile error (see test/types/bson), here the runtime check is tested. */
    expect(() => BsonOptions.apply({ [key]: value } as object)).toThrow(ConfigurationError);
  });

  test("fieldsAsRaw is refused", () => {
    expect(() => BsonOptions.apply({ fieldsAsRaw: { a: true } })).toThrow(/fieldsAsRaw/);
    expect(BsonOptions.apply({ fieldsAsRaw: {} }).useBigInt64).toBe(true);
  });
});

describe("BsonOptions.verify: resolved options of driver objects", () => {
  test("a client built with apply() passes; the driver defaults do not", async () => {
    const good = new MongoClient("mongodb://127.0.0.1:1", BsonOptions.apply({}));
    const plain = new MongoClient("mongodb://127.0.0.1:1");
    try {
      expect(() => BsonOptions.verify(good.bsonOptions, "client")).not.toThrow();
      expect(() => BsonOptions.verify(good.db("x").collection("y").bsonOptions, "collection")).not.toThrow();
      expect(() => BsonOptions.verify(plain.bsonOptions, "client")).toThrow(/useBigInt64: false \(required: true\)/);
    } finally {
      await good.close();
      await plain.close();
    }
  });

  test("an override on a collection is caught", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:1", BsonOptions.apply({}));
    try {
      const collection = client.db("x").collection("y", { promoteBuffers: true });
      expect(() => BsonOptions.verify(collection.bsonOptions, "collection y")).toThrow(
        /collection y: .*promoteBuffers/,
      );
    } finally {
      await client.close();
    }
  });
});
