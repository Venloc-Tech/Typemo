import { describe, expect, test } from "bun:test";
import { BSON, Decimal128, ObjectId, UUID } from "mongodb";
import { expectShapeMatches, ShapeCompare } from "../../src/shape/shape-harness.ts";

/*
 * Type vs runtime with the raw `mongodb` driver. No server here: the "document from the database" is
 * built in memory and passed through the driver's own BSON serializer/deserializer, which is exactly
 * what `find`/`findOne` return. The type side is what `Collection<User>.findOne()` promises.
 * The same checks against a real `findOne` through MongoHarness are not run here.
 */

/** Source of the entity and collection the type side is read from. */
const ENTITY = `
import type { Collection, Decimal128, ObjectId, UUID } from "mongodb";

export class Address {
  city!: string;
  zip?: string;
}

export class User {
  _id!: ObjectId;
  name!: string;
  email!: string | null;
  balance!: Decimal128;
  externalId!: UUID;
  createdAt!: Date;
  tags!: string[];
  addresses!: Address[];
  lastLogin?: Date;
  visits!: bigint;
  get label(): string { return this.name; }
}

declare const users: Collection<User>;
`;

/**
 * Serialise and deserialise like a server round trip (driver defaults: promoteValues, promoteLongs).
 *
 * @param doc - The stored document.
 * @returns The document as the driver returns it.
 */
const roundTrip = (doc: Record<string, unknown>): BSON.Document => BSON.deserialize(BSON.serialize(doc));

/**
 * A valid stored user, without the `bigint` field.
 *
 * @returns A new document.
 */
const storedUser = (): Record<string, unknown> => ({
  _id: new ObjectId(),
  name: "Ann",
  email: null,
  balance: Decimal128.fromString("10.50"),
  externalId: new UUID(),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  tags: ["vip"],
  addresses: [{ city: "Riga" }, { city: "Oslo", zip: "0150" }],
});

describe("shape vs the mongodb driver (in-memory BSON round trip)", () => {
  test("findOne() result type matches a round-tripped document (without the bigint field)", () => {
    const loaded = roundTrip(storedUser());
    const target = { code: ENTITY.replace("visits!: bigint;", ""), expr: "users.findOne({})" };
    const result = expectShapeMatches(target, loaded);
    expect(result.ok).toBe(true);
    /* null is also a legal findOne() result. */
    expectShapeMatches(target, null);
  });

  test("negative: a `bigint` field comes back as a number (promoteLongs) — the type lies", () => {
    const loaded = roundTrip({ ...storedUser(), visits: 2n ** 40n });
    const result = ShapeCompare.check({ code: ENTITY, expr: "users.findOne({})" }, loaded);
    expect(result.mismatches.map((m) => m.message)).toEqual(["$.visits: the type says bigint, the data is number"]);
  });

  test("negative: an `undefined` field is dropped by the serializer — the required key goes missing", () => {
    const loaded = roundTrip({ ...storedUser(), email: undefined, visits: undefined });
    const messages = ShapeCompare.check({ code: ENTITY, type: "User" }, loaded).mismatches.map((m) => m.message);
    expect(messages).toEqual([
      "$.email: the type promises this key (string | null), the data lacks it",
      "$.visits: the type promises this key (bigint), the data lacks it",
    ]);
  });

  test("negative: a string where the type says ObjectId, and a stray field", () => {
    const loaded = roundTrip({ ...storedUser(), _id: "not-an-object-id", legacyFlag: true, visits: 1n });
    const messages = ShapeCompare.check({ code: ENTITY, type: "User" }, loaded).mismatches.map((m) => m.message);
    expect(messages).toEqual([
      "$._id: the type says ObjectId, the data is string",
      "$.legacyFlag: the data has this key (boolean), the type does not know it",
      "$.visits: the type says bigint, the data is number",
    ]);
  });
});
