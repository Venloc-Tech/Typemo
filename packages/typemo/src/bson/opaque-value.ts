/*
 * Every value the driver (de)serializes as ONE BSON value is opaque — a path never goes inside it.
 * A shorter list (Date/RegExp/Buffer/ObjectId only) would make `Binary`/`UUID`/`Long`/`Double`/
 * `Int32`/`Timestamp` produce junk dotted paths (`uuid.sub_type`, `big.low`, `d.value`).
 *
 * The list is the hydrated/lean forms of `BsonTypeTable` plus the BSON classes that never appear in
 * those forms but may still be typed by a user (driver wrappers, legacy types): all of them are
 * single values, none is a subdocument. `BsonGuards.isOpaqueValue` is the runtime twin.
 */
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
 * Any function type; used to exclude methods and callables from data.
 *
 * @example
 * ```ts
 * type Yes = (() => void) extends AnyFunction ? true : false; // true
 * ```
 */
export type AnyFunction = (...args: never[]) => unknown;

/**
 * Values that are stored as a single BSON value and must never be walked into by a path.
 * `UUID` is a subclass of `Binary` and `Buffer` of `Uint8Array`; both are listed for readability.
 * `Map` and `Set` are containers with their own rules (a Map is addressed as `field.<key>`), never
 * "an embedded object".
 *
 * @example
 * ```ts
 * type Yes = Date extends OpaqueValue ? true : false; // true
 * ```
 */
export type OpaqueValue =
  | Date
  | RegExp
  | ObjectId
  | Binary
  | UUID
  | Uint8Array
  | Buffer
  | ArrayBuffer
  | Long
  | Decimal128
  | Double
  | Int32
  | Timestamp
  | BSONRegExp
  | BSONSymbol
  | Code
  | DBRef
  | MinKey
  | MaxKey
  | ReadonlyMap<unknown, unknown>
  | ReadonlySet<unknown>;

/**
 * `true` for an embedded subdocument: an `object` that is not an opaque BSON value, an array or a function.
 *
 * @example
 * ```ts
 * type A = IsPlainObject<{ a: 1 }>; // true
 * type B = IsPlainObject<Date>;     // false
 * ```
 */
export type IsPlainObject<T> = T extends
  | OpaqueValue
  | readonly unknown[]
  | string
  | number
  | boolean
  | bigint
  | symbol
  | AnyFunction
  ? false
  : T extends object
    ? true
    : false;
