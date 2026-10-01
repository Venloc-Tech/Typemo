import { describe, expect, test } from "bun:test";
import { MongoHarness, MongoLifecycle } from "@venloc/typemo-test-kit";
import { Binary, BSONRegExp, type Document, Double, Int32, Long, MaxKey, MinKey, ObjectId, UUID } from "mongodb";
import { BsonOptions, BsonTypeTable } from "../../../src/index.ts";
import { ALL_TYPES_ALIASES, AllTypesCaster, allTypesInput } from "../../fixtures/bson-all-types.ts";

/*
 * Round trip of every BSON type: every row of the table survives cast → encode → insert → find through a real
 * mongod with the enforced driver options, the stored BSON type is the one of the row (`$type`), and
 * what comes back is exactly `BsonTypeTable.toLean(hydrated)`.
 */

/**
 * The document a find returned; a missing one fails the test here, not later with a TypeError.
 * @param document The value a find returned.
 * @returns The same document, never null or undefined.
 */
const found = <T>(document: T | null | undefined): T => {
  if (document === null || document === undefined) throw new Error("document not found");
  return document;
};

const mongo = MongoLifecycle.useMongo("bson_round_trip", BsonOptions.apply({}));
/* A second client with the driver defaults, to show what the enforced options change. */
const plain = MongoLifecycle.useMongo("bson_driver_defaults");

/**
 * Casts the all-types input, inserts it and reads it back.
 * @returns The collection, the hydrated value and the document the server returned.
 */
const insertAll = async () => {
  const collection = mongo.db.collection("all_types");
  const hydrated = AllTypesCaster.cast(allTypesInput());
  await collection.insertOne(AllTypesCaster.encode(hydrated) as Document);
  const read = await collection.findOne({ _id: hydrated._id as ObjectId });
  return { collection, hydrated, read };
};

describe("round trip of every BSON type through the real server", () => {
  test("the server is the one the harness booted", () => {
    console.log(`[bson round-trip] MongoDB ${MongoHarness.getStatus().resolvedVersion}`);
    expect(MongoHarness.getStatus().fellBackToStable).toBe(false);
  });

  test("what is read equals the lean form of what was cast", async () => {
    const { hydrated, read } = await insertAll();
    /* cast: BsonTypeTable.toLean is the runtime table (unknown in, unknown out) */
    expect(read).toEqual(BsonTypeTable.toLean(hydrated) as unknown as typeof read);
  });

  test("every field is stored with the BSON type of its row ($type)", async () => {
    const { collection, hydrated } = await insertAll();
    for (const [field, alias] of Object.entries(ALL_TYPES_ALIASES)) {
      const count = await collection.countDocuments({ _id: hydrated._id as ObjectId, [field]: { $type: alias } });
      expect([field, alias, count]).toEqual([field, alias, 1]);
    }
  });

  test("an integral Double is still a double, an Int32 is not a double", async () => {
    const { collection, hydrated } = await insertAll();
    expect(await collection.countDocuments({ _id: hydrated._id as ObjectId, dbl: { $type: "int" } })).toBe(0);
    expect(await collection.countDocuments({ _id: hydrated._id as ObjectId, i32: { $type: "double" } })).toBe(0);
  });

  test("the read values have the lean TS types of the table", async () => {
    const { read } = await insertAll();
    if (!read) throw new Error("document not found");
    expect(typeof read.i64).toBe("bigint");
    expect(read.i64).toBe(9_223_372_036_854_775_807n);
    expect(typeof read.dbl).toBe("number");
    expect(typeof read.i32).toBe("number");
    expect(read.uuid).toBeInstanceOf(UUID);
    expect(read.bin._bsontype).toBe("Binary");
    expect(read.bin.sub_type).toBe(0);
    expect(read.vec.sub_type).toBe(9);
    expect(Array.from((read.vec as Binary).toFloat32Array())).toEqual([0.5, -1, 2.25]);
    expect(read.re).toBeInstanceOf(RegExp);
    expect(read.re.flags).toBe("im");
    expect(read.map).toEqual({ small: 1n, big: -(2n ** 63n) });
    expect(read.map).not.toBeInstanceOf(Map);
    for (const [field, value] of Object.entries(read)) {
      expect([field, BsonTypeTable.kindOf(value) !== undefined]).toEqual([field, true]);
    }
  });

  test("MinKey and MaxKey (no casters) come back as themselves", async () => {
    const collection = mongo.db.collection("keys");
    const _id = new ObjectId();
    await collection.insertOne({ _id, min: new MinKey(), max: new MaxKey() });
    const read = await collection.findOne({ _id });
    expect(BsonTypeTable.kindOf(read?.min)).toBe("minKey");
    expect(BsonTypeTable.kindOf(read?.max)).toBe("maxKey");
    expect(await collection.countDocuments({ _id, min: { $type: "minKey" }, max: { $type: "maxKey" } })).toBe(1);
  });

  test("int8 and packedBit vectors round-trip too", async () => {
    const collection = mongo.db.collection("vectors");
    const _id = new ObjectId();
    await collection.insertOne({
      _id,
      int8: Binary.fromInt8Array(new Int8Array([-128, 127])),
      bits: Binary.fromBits([1, 0, 1]),
    });
    const read = await collection.findOne({ _id });
    expect(Array.from((found(read).int8 as Binary).toInt8Array())).toEqual([-128, 127]);
    expect(Array.from((found(read).bits as Binary).toBits())).toEqual([1, 0, 1]);
  });
});

describe("the enforced options matter: the driver defaults break the table", () => {
  test("defaults: int64 comes back as number or Long depending on the value; enforced: always bigint", async () => {
    const collection = plain.db.collection<{ _id: number; v: bigint }>("longs");
    await collection.insertMany([
      { _id: 1, v: 5n },
      { _id: 2, v: 2n ** 62n },
    ]);
    const small = await collection.findOne({ _id: 1 });
    const big = await collection.findOne({ _id: 2 });
    expect(typeof small?.v).toBe("number");
    expect(BsonTypeTable.kindOf(big?.v)).toBeUndefined(); /* a raw Long: no row in the table */
    expect(big?.v).toBeInstanceOf(Long);

    const enforced = plain.client
      .db(plain.dbName)
      .collection<{ _id: number; v: bigint }>("longs", BsonOptions.apply({}));
    expect(typeof (await enforced.findOne({ _id: 1 }))?.v).toBe("bigint");
    expect(typeof (await enforced.findOne({ _id: 2 }))?.v).toBe("bigint");
  });

  test("defaults are rejected by BsonOptions.verify", () => {
    expect(() => BsonOptions.verify(plain.client.bsonOptions, "client")).toThrow(/useBigInt64/);
  });
});

describe("RegExp flags: what bsonRegExp: false loses (documented)", () => {
  test("a BSON regex written by another client with s/x/u flags reads back as g", async () => {
    const collection = mongo.db.collection("regex");
    const _id = new ObjectId();
    await collection.insertOne({ _id, re: new BSONRegExp("a.b", "imsux") });
    const read = await collection.findOne({ _id });
    /* s → g (a different meaning), x and u are lost. This is why RegExpCaster writes only i and m. */
    expect((found(read).re as RegExp).flags).toBe("gim");
    const raw = await collection.findOne({ _id }, { bsonRegExp: true });
    expect((found(raw).re as BSONRegExp).options).toBe("imsux");
  });

  test("a JS /g/ would be stored as BSON s (dotAll on the server) — the reason RegExpCaster refuses g", async () => {
    const collection = mongo.db.collection("regex_g");
    const _id = new ObjectId();
    await collection.insertOne({ _id, re: /a/g });
    const raw = await collection.findOne({ _id }, { bsonRegExp: true });
    expect((found(raw).re as BSONRegExp).options).toBe("s");
  });
});

describe("wrappers and undefined", () => {
  test("Int32/Double wrappers are promoted to number on read (promoteValues)", async () => {
    const collection = mongo.db.collection("wrappers");
    const _id = new ObjectId();
    await collection.insertOne({ _id, i: new Int32(1), d: new Double(2) });
    const read = await collection.findOne({ _id });
    expect(read).toEqual({ _id, i: 1, d: 2 });
  });

  test("ignoreUndefined: false — a raw undefined would be stored as null; casters never let it through", async () => {
    const collection = mongo.db.collection("undefined");
    const _id = new ObjectId();
    await collection.insertOne({ _id, u: undefined });
    const read = await collection.findOne({ _id });
    expect(read).toEqual({ _id, u: null });
    /* BSON null (0x0A), not BSON undefined (0x06): bson serializer.ts:626. */
    expect(await collection.countDocuments({ _id, u: { $type: "null" } })).toBe(1);
  });
});
