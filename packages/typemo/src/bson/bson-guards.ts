import type {
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
} from "bson";

/**
 * The `_bsontype` of every class of the `bson` package (`ObjectID` of old copies is normalized).
 *
 * @example
 * ```ts
 * const tag: BsonTypeTag | undefined = BsonGuards.tagOf(new ObjectId()); // "ObjectId"
 * ```
 */
export type BsonTypeTag =
  | "ObjectId"
  | "Binary"
  | "Long"
  | "Decimal128"
  | "Double"
  | "Int32"
  | "Timestamp"
  | "BSONRegExp"
  | "BSONSymbol"
  | "Code"
  | "DBRef"
  | "MinKey"
  | "MaxKey";

const BSON_TYPE_TAGS: ReadonlySet<string> = new Set<BsonTypeTag>([
  "ObjectId",
  "Binary",
  "Long",
  "Decimal128",
  "Double",
  "Int32",
  "Timestamp",
  "BSONRegExp",
  "BSONSymbol",
  "Code",
  "DBRef",
  "MinKey",
  "MaxKey",
]);

/** The global-registry symbol every `bson` value exposes; it survives duplicate copies of the package. */
const BSON_TYPE_SYMBOL: symbol = Symbol.for("@@mdb.bson.type");

const UUID_SUBTYPE = 4;
const VECTOR_SUBTYPE = 9;
const UUID_BYTES = 16;

/**
 * Reads the `Object.prototype.toString` tag: works across realms and does not trust `instanceof`.
 *
 * @param value - The object to inspect.
 * @returns The tag string, e.g. `"[object Date]"`.
 */
const toStringTag = (value: object): string => Object.prototype.toString.call(value);

/**
 * Runtime identification of BSON and built-in values.
 *
 * BSON values are recognized by `Symbol.for("@@mdb.bson.type")` (the global-registry marker of the
 * `bson` package) with `_bsontype` as a fallback — **never by `instanceof`**: two copies of `bson`
 * in one install (a workspace, a bundled dependency) have different classes but the same tags, and
 * the driver itself duck-types them the same way. Built-ins (`Date`, `RegExp`, `Map`, typed arrays)
 * are recognized by their `Object.prototype.toString` tag for the same reason (other realms).
 *
 * @example
 * ```ts
 * BsonGuards.isObjectId(new ObjectId()); // true
 * BsonGuards.isDate(new Date());         // true
 * ```
 */
export class BsonGuards {
  /**
   * The BSON class tag of a value.
   *
   * @param value - Any value.
   * @returns The tag, or `undefined` for anything that is not a `bson` value.
   */
  static tagOf(value: unknown): BsonTypeTag | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const marked = (value as Readonly<Record<symbol, unknown>>)[BSON_TYPE_SYMBOL];
    const tag = typeof marked === "string" ? marked : (value as { _bsontype?: unknown })._bsontype;
    if (tag === "ObjectID") return "ObjectId";
    return typeof tag === "string" && BSON_TYPE_TAGS.has(tag) ? (tag as BsonTypeTag) : undefined;
  }

  /**
   * Whether the value is any `bson` package value.
   *
   * @param value - Any value.
   * @returns `true` when {@link tagOf} recognizes it.
   */
  static isBsonValue(value: unknown): boolean {
    return BsonGuards.tagOf(value) !== undefined;
  }

  /**
   * Whether the value is an `ObjectId`.
   *
   * @param value - Any value.
   * @returns `true` for an `ObjectId`.
   */
  static isObjectId(value: unknown): value is ObjectId {
    return BsonGuards.tagOf(value) === "ObjectId";
  }

  /**
   * Whether the value is a `Decimal128`.
   *
   * @param value - Any value.
   * @returns `true` for a `Decimal128`.
   */
  static isDecimal128(value: unknown): value is Decimal128 {
    return BsonGuards.tagOf(value) === "Decimal128";
  }

  /**
   * Whether the value is a `Long`.
   *
   * @param value - Any value.
   * @returns `true` for a `Long`.
   */
  static isLong(value: unknown): value is Long {
    return BsonGuards.tagOf(value) === "Long";
  }

  /**
   * Whether the value is an `Int32` wrapper.
   *
   * @param value - Any value.
   * @returns `true` for an `Int32`.
   */
  static isInt32(value: unknown): value is Int32 {
    return BsonGuards.tagOf(value) === "Int32";
  }

  /**
   * Whether the value is a `Double` wrapper.
   *
   * @param value - Any value.
   * @returns `true` for a `Double`.
   */
  static isDouble(value: unknown): value is Double {
    return BsonGuards.tagOf(value) === "Double";
  }

  /**
   * Whether the value is a BSON `Timestamp`.
   *
   * @param value - Any value.
   * @returns `true` for a `Timestamp`.
   */
  static isTimestamp(value: unknown): value is Timestamp {
    return BsonGuards.tagOf(value) === "Timestamp";
  }

  /**
   * Whether the value is a `BSONRegExp`.
   *
   * @param value - Any value.
   * @returns `true` for a `BSONRegExp`.
   */
  static isBsonRegExp(value: unknown): value is BSONRegExp {
    return BsonGuards.tagOf(value) === "BSONRegExp";
  }

  /**
   * Whether the value is a `BSONSymbol`.
   *
   * @param value - Any value.
   * @returns `true` for a `BSONSymbol`.
   */
  static isBsonSymbol(value: unknown): value is BSONSymbol {
    return BsonGuards.tagOf(value) === "BSONSymbol";
  }

  /**
   * Whether the value is a BSON `Code`.
   *
   * @param value - Any value.
   * @returns `true` for a `Code`.
   */
  static isCode(value: unknown): value is Code {
    return BsonGuards.tagOf(value) === "Code";
  }

  /**
   * Whether the value is a `DBRef`.
   *
   * @param value - Any value.
   * @returns `true` for a `DBRef`.
   */
  static isDbRef(value: unknown): value is DBRef {
    return BsonGuards.tagOf(value) === "DBRef";
  }

  /**
   * Whether the value is a `MinKey`.
   *
   * @param value - Any value.
   * @returns `true` for a `MinKey`.
   */
  static isMinKey(value: unknown): value is MinKey {
    return BsonGuards.tagOf(value) === "MinKey";
  }

  /**
   * Whether the value is a `MaxKey`.
   *
   * @param value - Any value.
   * @returns `true` for a `MaxKey`.
   */
  static isMaxKey(value: unknown): value is MaxKey {
    return BsonGuards.tagOf(value) === "MaxKey";
  }

  /**
   * Any Binary, whatever the subtype (a `UUID` instance is a Binary too: its `_bsontype` is `Binary`).
   *
   * @param value - Any value.
   * @returns `true` for a `Binary`.
   */
  static isBinary(value: unknown): value is Binary {
    return BsonGuards.tagOf(value) === "Binary";
  }

  /**
   * A Binary of subtype 4 with exactly 16 bytes — what the deserializer turns into a `UUID`.
   *
   * @param value - Any value.
   * @returns `true` for a UUID-shaped Binary.
   */
  static isUuid(value: unknown): value is UUID {
    return BsonGuards.isBinary(value) && value.sub_type === UUID_SUBTYPE && value.position === UUID_BYTES;
  }

  /**
   * A Binary of subtype 9 (vector). Its header (dtype, padding) is not validated here: see `VectorCaster`.
   *
   * @param value - Any value.
   * @returns `true` for a subtype-9 Binary.
   */
  static isVector(value: unknown): value is Binary {
    return BsonGuards.isBinary(value) && value.sub_type === VECTOR_SUBTYPE;
  }

  /**
   * Whether the value is a `Date` (possibly invalid), also from another realm.
   *
   * @param value - Any value.
   * @returns `true` for a `Date`.
   */
  static isDate(value: unknown): value is Date {
    return typeof value === "object" && value !== null && toStringTag(value) === "[object Date]";
  }

  /**
   * A `Date` whose time is a number (not `Invalid Date`).
   *
   * @param value - Any value.
   * @returns `true` for a valid `Date`.
   */
  static isValidDate(value: unknown): value is Date {
    return BsonGuards.isDate(value) && !Number.isNaN(value.getTime());
  }

  /**
   * Whether the value is a native `RegExp`, also from another realm.
   *
   * @param value - Any value.
   * @returns `true` for a `RegExp`.
   */
  static isRegExp(value: unknown): value is RegExp {
    return typeof value === "object" && value !== null && toStringTag(value) === "[object RegExp]";
  }

  /**
   * Whether the value is a `Map`, also from another realm.
   *
   * @param value - Any value.
   * @returns `true` for a `Map`.
   */
  static isMap(value: unknown): value is Map<unknown, unknown> {
    return typeof value === "object" && value !== null && toStringTag(value) === "[object Map]";
  }

  /**
   * Whether the value is a `Set`, also from another realm.
   *
   * @param value - Any value.
   * @returns `true` for a `Set`.
   */
  static isSet(value: unknown): value is Set<unknown> {
    return typeof value === "object" && value !== null && toStringTag(value) === "[object Set]";
  }

  /**
   * `Uint8Array` or `Buffer` (a `Buffer` is a `Uint8Array`).
   *
   * @param value - Any value.
   * @returns `true` for a `Uint8Array`.
   */
  static isUint8Array(value: unknown): value is Uint8Array {
    return ArrayBuffer.isView(value) && toStringTag(value) === "[object Uint8Array]";
  }

  /**
   * Runtime twin of the `OpaqueValue` type: a value stored as one BSON value (or a Map/Set
   * container), never walked into by a path.
   *
   * @param value - Any value.
   * @returns `true` for an opaque value.
   */
  static isOpaqueValue(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    if (BsonGuards.isBsonValue(value)) return true;
    if (ArrayBuffer.isView(value)) return true;
    const tag = toStringTag(value);
    return (
      tag === "[object Date]" ||
      tag === "[object RegExp]" ||
      tag === "[object Map]" ||
      tag === "[object Set]" ||
      tag === "[object ArrayBuffer]"
    );
  }

  /**
   * Runtime twin of `IsPlainObject<T>`: an object a path walks into (an embedded document). Plain
   * objects and instances of user classes qualify; arrays, functions, promises and opaque values
   * do not.
   *
   * @param value - Any value.
   * @returns `true` for an embedded-document-like object.
   */
  static isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null) return false;
    if (Array.isArray(value) || BsonGuards.isOpaqueValue(value)) return false;
    return toStringTag(value) === "[object Object]";
  }

  /**
   * A literal object: its prototype is `Object.prototype` or `null` (`{ a: 1 }`, `JSON.parse`
   * output, `Object.create(null)`). Unlike {@link isPlainObject}, class instances do not qualify:
   * used where a record of entries is accepted as input (a Map field).
   *
   * @param value - Any value.
   * @returns `true` for a literal object.
   */
  static isPojo(value: unknown): value is Readonly<Record<string, unknown>> {
    if (!BsonGuards.isPlainObject(value)) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
  }
}
