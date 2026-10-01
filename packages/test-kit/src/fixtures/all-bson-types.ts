import { Binary, BSONRegExp, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from "bson";

/**
 * One document exercising every BSON type Typemo needs to reason about
 * Used by shape tests (type vs. runtime) and by codec round-trip tests.
 *
 * @example
 * ```ts
 * const doc: AllBsonTypesDocument = AllBsonTypesFixture.build();
 * ```
 */
export interface AllBsonTypesDocument {
  /** Document id. */
  _id: ObjectId;
  /** BSON string. */
  stringValue: string;
  /** BSON int32. */
  int32Value: Int32;
  /** BSON int64. */
  int64Value: Long;
  /** BSON double. */
  doubleValue: Double;
  /** BSON decimal128. */
  decimal128Value: Decimal128;
  /** BSON boolean. */
  boolValue: boolean;
  /** BSON date. */
  dateValue: Date;
  /** BSON null. */
  nullValue: null;
  /** BSON array. */
  arrayValue: number[];
  /** BSON embedded document. */
  embeddedValue: { nested: string };
  /** BSON binary. */
  binaryValue: Binary;
  /** BSON regular expression. */
  regexValue: BSONRegExp;
  /** BSON MinKey. */
  minKeyValue: MinKey;
  /** BSON MaxKey. */
  maxKeyValue: MaxKey;
  /** BSON timestamp. */
  timestampValue: Timestamp;
  /** BSON UUID (binary subtype 4). */
  uuidValue: UUID;
}

/** Builds `AllBsonTypesDocument` values for tests. */
export class AllBsonTypesFixture {
  /**
   * Builds a document with one value of every BSON type.
   *
   * @param overrides - Fields that replace the defaults.
   * @returns A new document with a fresh `_id`.
   */
  static build(overrides: Partial<AllBsonTypesDocument> = {}): AllBsonTypesDocument {
    return {
      _id: new ObjectId(),
      stringValue: "typemo",
      int32Value: new Int32(42),
      /* Beyond Number.MAX_SAFE_INTEGER on purpose (the whole point of Long),
         built from a string so the literal itself doesn't lose precision. */
      int64Value: Long.fromString("9007199254740993"),
      doubleValue: new Double(3.14),
      decimal128Value: Decimal128.fromString("19.99"),
      boolValue: true,
      dateValue: new Date("2026-01-01T00:00:00.000Z"),
      nullValue: null,
      arrayValue: [1, 2, 3],
      embeddedValue: { nested: "value" },
      binaryValue: new Binary(Buffer.from("typemo")),
      regexValue: new BSONRegExp("typemo", "i"),
      minKeyValue: new MinKey(),
      maxKeyValue: new MaxKey(),
      timestampValue: new Timestamp({ t: 1, i: 1 }),
      uuidValue: new UUID(),
      ...overrides,
    };
  }
}
