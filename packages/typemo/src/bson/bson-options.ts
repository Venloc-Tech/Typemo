import type { BSONSerializeOptions } from "mongodb";
import { ConfigurationError } from "../errors/configuration-error.ts";

/**
 * The BSON options Typemo fixes. Values are literal types: nothing else is accepted.
 *
 * @example
 * ```ts
 * const required: RequiredBsonOptions = BsonOptions.REQUIRED;
 * ```
 */
export interface RequiredBsonOptions {
  /** int64 is always `bigint`. Without it the driver returns `number` or `Long` depending on the value. */
  readonly useBigInt64: true;
  /** Needed by `useBigInt64` (bson throws otherwise); int32/double come back as `number`. */
  readonly promoteValues: true;
  /** Needed by `useBigInt64` (bson throws otherwise). */
  readonly promoteLongs: true;
  /** Binary stays `Binary` (subtype is kept), never a bare `Buffer`. */
  readonly promoteBuffers: false;
  /**
   * Regular expressions are read as native `RegExp`. The price: BSON flags `x`, `l`, `u`
   * are lost and BSON `s` comes back as JS `g`; `RegExpCaster` therefore only writes `i` and `m`.
   */
  readonly bsonRegExp: false;
  /**
   * The driver's own default. `undefined` never reaches the driver: every caster refuses it,
   * so the option is fixed only so that nobody turns on silent dropping.
   */
  readonly ignoreUndefined: false;
  /** Functions are not data (with `true` they would be stored as BSON Code). */
  readonly serializeFunctions: false;
  /** Documents are always deserialized (raw buffers bypass the whole table). */
  readonly raw: false;
  /** Invalid UTF-8 is an error, not replacement characters. */
  readonly enableUtf8Validation: true;
}

type FixedKey = keyof RequiredBsonOptions;

/**
 * Options that conflict with Typemo: every fixed key may only be absent or equal to its required value.
 *
 * @example
 * ```ts
 * type Ok = CompatibleBsonOptions<{ raw: false }>; // { readonly raw: false | undefined }
 * ```
 */
export type CompatibleBsonOptions<T> = {
  readonly [K in keyof T]: K extends FixedKey ? RequiredBsonOptions[K] | undefined : T[K];
};

const REQUIRED: RequiredBsonOptions = Object.freeze({
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

/**
 * Driver BSON options that make the runtime match `BsonTypeTable`. They are forced, not
 * defaulted: an option set to a conflicting value is a `ConfigurationError` (no relaxations).
 *
 * `apply` is used where Typemo creates a client and by tests; `verify` checks the resolved
 * options of an existing `MongoClient`/`Db`/`Collection` (`.bsonOptions`), e.g. a client passed in
 * by the user.
 *
 * @example
 * ```ts
 * const options = BsonOptions.apply({ appName: "app" });
 * declare const collection: import("mongodb").Collection;
 * BsonOptions.verify(collection.bsonOptions, "users");
 * ```
 */
export class BsonOptions {
  /** The fixed option values. */
  static readonly REQUIRED: RequiredBsonOptions = REQUIRED;

  /**
   * A new options object with the required BSON options set (the input is not mutated). Accepts any
   * options object (typically `MongoClientOptions`, `DbOptions`, `CollectionOptions`).
   *
   * @param options - The options to extend; a fixed key may only be absent or equal to its required value.
   * @returns A copy of `options` with every fixed key set.
   * @throws {ConfigurationError} If the input sets a fixed key to another value or sets `fieldsAsRaw`.
   */
  static apply<T extends object>(
    /* The conditional form reports a conflict on the key itself ("true" is not assignable to "false"). */
    options: T extends CompatibleBsonOptions<T> ? T : CompatibleBsonOptions<T>,
  ): Omit<T, FixedKey> & RequiredBsonOptions {
    BsonOptions.check(options as BSONSerializeOptions, "options", false);
    /* The conditional parameter type is T once the conflict check passed; the compiler cannot see that. */
    return { ...(options as T), ...REQUIRED };
  }

  /**
   * Checks already resolved options (every fixed key present), e.g. `collection.bsonOptions`.
   *
   * @param resolved - The resolved BSON options of a client, database or collection.
   * @param where - Names the owner in the error message.
   * @throws {ConfigurationError} If a fixed key differs from its required value or `fieldsAsRaw` is set.
   */
  static verify(resolved: BSONSerializeOptions, where: string): void {
    BsonOptions.check(resolved, where, true);
  }

  /**
   * Collects conflicting fixed keys and throws when there are any.
   *
   * @param options - The options to check.
   * @param where - Names the owner in the error message.
   * @param resolved - `true` when every fixed key must be present (resolved options), `false` when absent is allowed.
   * @throws {ConfigurationError} On any conflict or a non-empty `fieldsAsRaw`.
   */
  private static check(options: BSONSerializeOptions, where: string, resolved: boolean): void {
    const wrong = (Object.keys(REQUIRED) as FixedKey[]).filter((key) => {
      const actual = options[key];
      return resolved ? actual !== REQUIRED[key] : actual !== undefined && actual !== REQUIRED[key];
    });
    if (wrong.length > 0) {
      const list = wrong.map((key) => `${key}: ${String(options[key])} (required: ${REQUIRED[key]})`).join(", ");
      throw new ConfigurationError(`${where}: BSON options conflict with Typemo — ${list}`);
    }
    const raw = options.fieldsAsRaw;
    if (raw !== undefined && Object.keys(raw).length > 0) {
      throw new ConfigurationError(`${where}: fieldsAsRaw is not supported (raw fields bypass the BSON type table)`);
    }
  }
}
