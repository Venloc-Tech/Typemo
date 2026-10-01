import { BsonGuards } from "../../bson/bson-guards.ts";

/**
 * A value with its own `equals` method (`ObjectId`, `Long`, `Timestamp`).
 *
 * @example
 * ```ts
 * const id: Comparable = new ObjectId();
 * ```
 */
type Comparable = { equals(other: unknown): boolean };

/**
 * Compares two byte arrays by content.
 *
 * @param a - The first array.
 * @param b - The second array.
 * @returns `true` when both have the same length and bytes.
 */
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
};

/**
 * Value equality of the elements of tracked collections (`pull`, `addToSet`, change detection of
 * subdocument fields). Mongoose patched `ObjectId.prototype.valueOf` so that `==` "worked" in
 * `MongooseArray.indexOf/pull`; Typemo never touches foreign prototypes and compares with the values'
 * own `equals` or by their content:
 * - BSON values by tag and content (`ObjectId#equals`, bytes + subtype of `Binary`/`UUID`,
 *   `Decimal128` by its string, `Long`/`Timestamp` by `equals`, `Int32`/`Double` by number);
 * - `Date` by time, `RegExp` by source and flags, `Uint8Array` by bytes;
 * - arrays and Maps element by element, objects by their own enumerable keys (the stored data);
 * - numbers by `===`, and a stored `NaN` equals itself (another program may have written one; the document must
 *   not count as modified).
 */
export class ValueEquality {
  /**
   * Whether two values are equal by the rules above.
   *
   * @param a - The first value.
   * @param b - The second value.
   * @returns `true` when the values are equal.
   */
  static equals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    /* A stored NaN is equal to itself: NaN !== NaN would make a document read from the database always modified. */
    if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    const tagA = BsonGuards.tagOf(a);
    if (tagA !== undefined || BsonGuards.tagOf(b) !== undefined) {
      return tagA === BsonGuards.tagOf(b) && ValueEquality.bson(tagA, a, b);
    }
    if (BsonGuards.isDate(a) || BsonGuards.isDate(b)) {
      return BsonGuards.isDate(a) && BsonGuards.isDate(b) && a.getTime() === b.getTime();
    }
    if (BsonGuards.isRegExp(a) || BsonGuards.isRegExp(b)) {
      return BsonGuards.isRegExp(a) && BsonGuards.isRegExp(b) && a.source === b.source && a.flags === b.flags;
    }
    if (BsonGuards.isUint8Array(a) || BsonGuards.isUint8Array(b)) {
      return BsonGuards.isUint8Array(a) && BsonGuards.isUint8Array(b) && bytesEqual(a, b);
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((item, index) => ValueEquality.equals(item, b[index]))
      );
    }
    if (a instanceof Map || b instanceof Map) {
      if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
      for (const [key, item] of a) if (!b.has(key) || !ValueEquality.equals(item, b.get(key))) return false;
      return true;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    const recordA = a as Readonly<Record<string, unknown>>;
    const recordB = b as Readonly<Record<string, unknown>>;
    return keysA.every((key) => Object.hasOwn(recordB, key) && ValueEquality.equals(recordA[key], recordB[key]));
  }

  /**
   * Whether one of `values` equals `value`.
   *
   * @param value - The value to look for.
   * @param values - The candidates.
   * @returns `true` when a candidate equals the value.
   */
  static isAmong(value: unknown, values: readonly unknown[]): boolean {
    return values.some((candidate) => ValueEquality.equals(value, candidate));
  }

  /**
   * Compares two BSON values of the same tag.
   *
   * @param tag - The BSON tag of both values.
   * @param a - The first value.
   * @param b - The second value.
   * @returns `true` when the values are equal.
   */
  private static bson(tag: string | undefined, a: object, b: object): boolean {
    switch (tag) {
      case "Binary":
        return (
          BsonGuards.isBinary(a) &&
          BsonGuards.isBinary(b) &&
          a.sub_type === b.sub_type &&
          bytesEqual(a.value(), b.value())
        );
      case "Decimal128":
        return String(a) === String(b);
      case "Int32":
      case "Double":
        return (a as { valueOf(): number }).valueOf() === (b as { valueOf(): number }).valueOf();
      default:
        return typeof (a as Partial<Comparable>).equals === "function" ? (a as Comparable).equals(b) : false;
    }
  }
}
