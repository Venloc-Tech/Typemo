import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";

/*
 * The values a populate puts into a HYDRATED document: a reference array becomes a read-only
 * array of documents, a Map of references a read-only Map. They are views of the populated state, not data
 * of the document: the stored ids stay behind them (`PopulatedFields`), and saving never writes them.
 * Changing one in place would be a change nobody saves (a silent loss), so every mutation is refused: to
 * change references, `$depopulate(key)` first or `$set(key, ids)`. Lean results get plain arrays and records.
 */

/**
 * Refuses a mutation of a populated value.
 *
 * @param what - The refused operation, e.g. `"push()"`.
 * @throws {QueryError} Always.
 */
const refuse = (what: string): never => {
  throw new QueryError(
    `${what} on a populated value: it is a read-only view of documents; $depopulate() the field (or $set it) to change the references`,
  );
};

/**
 * A populated reference array of a hydrated document: read-only (typed `readonly T[]`). Every mutating
 * method throws {@link QueryError}.
 *
 * @example
 * ```ts
 * const users = PopulatedArray.freeze([user1, user2]);
 * users.push(user3); // throws QueryError
 * ```
 */
export class PopulatedArray<T> extends Array<T> {
  /**
   * Derived arrays (`map`, `filter`, …) are plain arrays, not populated ones.
   *
   * @returns The `Array` constructor.
   */
  static override get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  /**
   * A frozen populated array of `items`.
   *
   * @param items - The populated documents.
   * @returns A frozen `PopulatedArray` holding `items`.
   */
  static freeze<E>(items: readonly E[]): PopulatedArray<E> {
    const array = new PopulatedArray<E>();
    for (const item of items) Array.prototype.push.call(array, item);
    return Object.freeze(array) as PopulatedArray<E>;
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override push(): number {
    return refuse("push()");
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override pop(): T | undefined {
    return refuse("pop()");
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override shift(): T | undefined {
    return refuse("shift()");
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override unshift(): number {
    return refuse("unshift()");
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override splice(): T[] {
    return refuse("splice()");
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override sort(): this {
    return refuse("sort()");
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override reverse(): this {
    return refuse("reverse()");
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override fill(): this {
    return refuse("fill()");
  }

  /**
   * Refused: a populated array is read-only.
   *
   * @throws {QueryError} Always.
   */
  override copyWithin(): this {
    return refuse("copyWithin()");
  }
}

/**
 * A populated Map of references of a hydrated document: read-only (typed `ReadonlyMap`). Every mutating
 * method throws {@link QueryError}.
 *
 * @example
 * ```ts
 * const map = PopulatedMap.from([["a", user]]);
 * map.delete(); // throws QueryError
 * ```
 */
export class PopulatedMap<V> extends Map<string, V> {
  #ready = false;

  /**
   * A populated Map of `entries`.
   *
   * @param entries - Key and populated document pairs.
   * @returns A read-only `PopulatedMap`.
   */
  static from<E>(entries: Iterable<readonly [string, E]>): PopulatedMap<E> {
    const map = new PopulatedMap<E>();
    for (const [key, value] of entries) Map.prototype.set.call(map, key, value);
    map.#ready = true;
    return map;
  }

  /**
   * Refused once the map is built; allowed only while the constructor fills it.
   *
   * @param key - The key.
   * @param value - The value.
   * @returns This map while it is being built.
   * @throws {QueryError} After construction.
   */
  override set(key: string, value: V): this {
    /* The Map constructor calls no `set` without entries; stay safe for a subclass that passes some. */
    if (!this.#ready) return super.set(key, value);
    return refuse("set()");
  }

  /**
   * Refused: a populated Map is read-only.
   *
   * @throws {QueryError} Always.
   */
  override delete(): boolean {
    return refuse("delete()");
  }

  /**
   * Refused: a populated Map is read-only.
   *
   * @throws {QueryError} Always.
   */
  override clear(): void {
    refuse("clear()");
  }
}

/**
 * Keys of populate matching: the SAME BSON value gives the same key (not `String()`, which conflates
 * a string and a number, or two different binaries).
 *
 * @example
 * ```ts
 * PopulateKeys.of(new ObjectId("665f1c2e9b1e8a0012345678")); // "o:665f1c2e9b1e8a0012345678"
 * ```
 */
export class PopulateKeys {
  /**
   * The key of one value (a local id, a foreign field value).
   *
   * @param value - Any BSON-compatible value.
   * @returns A string that is equal for equal values and different across types.
   */
  static of(value: unknown): string {
    switch (typeof value) {
      case "string":
        return `s:${value}`;
      case "number":
        return `n:${value}`;
      case "bigint":
        return `n:${value}`;
      case "boolean":
        return `b:${value}`;
      default:
        break;
    }
    if (value === null || value === undefined) return "null";
    if (BsonGuards.isObjectId(value)) return `o:${value.toHexString()}`;
    if (BsonGuards.isLong(value)) return `n:${value.toBigInt()}`;
    if (BsonGuards.isInt32(value) || BsonGuards.isDouble(value)) return `n:${value.valueOf()}`;
    if (BsonGuards.isDecimal128(value)) return `d:${value.toString()}`;
    if (BsonGuards.isBinary(value)) return `x:${value.sub_type}:${value.toString("base64")}`;
    if (BsonGuards.isDate(value)) return `t:${value.getTime()}`;
    if (BsonGuards.isUint8Array(value)) return `x:0:${Buffer.from(value).toString("base64")}`;
    return `j:${JSON.stringify(value)}`;
  }
}
