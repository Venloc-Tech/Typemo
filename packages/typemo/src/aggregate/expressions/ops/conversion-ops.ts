import type { Binary, ObjectId, Timestamp, UUID } from "mongodb";
import type { BsonScalarForms, BsonTypeAlias } from "../../../bson/bson-type-table.ts";
import type { PathError } from "../../types/path-types.ts";
import { ExprNodes } from "../expr-node.ts";
import type { Arg, Nullable, PropagateNull } from "../expr-types.ts";
import { type Expr, OperatorFactory as F } from "../operator-factory.ts";
import type { Numeric } from "./arithmetic-ops.ts";

/*
 * Type conversion, type inspection, hashing, BSON size. Result types are the LEAN forms of the BSON type
 * table (`BsonScalarForms[k]["lean"]`): a `$toLong` is a `bigint` (the enforced `useBigInt64`), a
 * `$toDecimal` a `Decimal128`, a `$toUUID` a `UUID`. No second table of BSON types lives here.
 */

/**
 * The lean TypeScript form of a BSON row.
 *
 * @typeParam K - The row key of the BSON type table.
 * @example
 * ```ts
 * type A = Lean<"long">; // bigint
 * type B = Lean<"objectId">; // ObjectId
 * ```
 */
type Lean<K extends keyof BsonScalarForms> = BsonScalarForms[K]["lean"];

/**
 * `true` for an integer number literal type (`0`, `-3`): the driver serializes it as an int32. A wide `number`
 * (a field, a computed value) may be a double and stays accepted.
 *
 * @typeParam N - Any type.
 * @example
 * ```ts
 * type A = IsIntLiteral<0>; // true
 * type B = IsIntLiteral<1.5 | number>; // false
 * ```
 */
type IsIntLiteral<N> = N extends number
  ? number extends N
    ? false
    : `${N}` extends `${bigint}`
      ? true
      : false
  : false;

/**
 * The argument check of `fn.toDate`: the server converts a double, a long, a decimal, a string, an `ObjectId` and
 * a `Timestamp` to a date, but refuses an int32.
 *
 * @typeParam A - The argument of `fn.toDate`.
 * @example
 * ```ts
 * type Ok = ToDateArgCheck<number>; // unknown
 * type Bad = ToDateArgCheck<0>; // PathError<…>
 * ```
 */
type ToDateArgCheck<A> =
  true extends IsIntLiteral<A>
    ? PathError<"fn.toDate: an int32 cannot be converted to a date (the server refuses it); use fn.toLong(n) or a double">
    : unknown;

/**
 * `$convert`'s `to`: a `$type` alias, its BSON type number, or `{ type: "binData", subtype }`.
 *
 * @example
 * ```ts
 * const a: ConvertTarget = "int";
 * const b: ConvertTarget = 18;
 * const c: ConvertTarget = { type: "binData", subtype: 4 };
 * ```
 */
export type ConvertTarget =
  | "double"
  | "string"
  | "objectId"
  | "bool"
  | "date"
  | "int"
  | "long"
  | "decimal"
  | "binData"
  | "array"
  | "object"
  | 1
  | 2
  | 5
  | 7
  | 8
  | 9
  | 16
  | 18
  | 19
  | { readonly type: "binData" | 5; readonly subtype: number };

/**
 * `$convert`'s `format` for string ↔ `binData` (MongoDB 8.1+).
 *
 * @example
 * ```ts
 * const format: ConvertFormat = "base64url";
 * ```
 */
export type ConvertFormat = "base64" | "base64url" | "utf8" | "hex" | "uuid";

/**
 * The result of `$convert` for a target (lean forms of the BSON type table). Subtype 4 is a `UUID`.
 *
 * @typeParam To - The `to` target.
 * @example
 * ```ts
 * type A = ConvertResult<"long">; // bigint
 * type B = ConvertResult<{ type: "binData"; subtype: 4 }>; // UUID
 * ```
 */
export type ConvertResult<To> = To extends "double" | 1
  ? Lean<"double">
  : To extends "int" | 16
    ? Lean<"int32">
    : To extends "long" | 18
      ? Lean<"long">
      : To extends "decimal" | 19
        ? Lean<"decimal128">
        : To extends "string" | 2
          ? Lean<"string">
          : To extends "objectId" | 7
            ? Lean<"objectId">
            : To extends "bool" | 8
              ? Lean<"bool">
              : To extends "date" | 9
                ? Lean<"date">
                : To extends { readonly subtype: 4 }
                  ? Lean<"uuid">
                  : To extends "binData" | 5 | { readonly type: "binData" | 5 }
                    ? Lean<"binary">
                    : To extends "array"
                      ? unknown[]
                      : To extends "object"
                        ? { [key: string]: unknown }
                        : never;

/**
 * Hash algorithms of `$hash` / `$hexHash` (MongoDB 8.3+).
 *
 * @example
 * ```ts
 * const algorithm: HashAlgorithm = "sha256";
 * ```
 */
export type HashAlgorithm = "md5" | "sha256" | "xxh64";

/**
 * What `$type` returns for a stored value: a row alias of the BSON type table, or `"missing"`.
 *
 * @example
 * ```ts
 * const name: TypeName = "missing";
 * ```
 */
export type TypeName = BsonTypeAlias | "missing";

/**
 * A value the numeric conversions accept.
 *
 * @example
 * ```ts
 * const values: Convertible[] = [1, 2n, "3", true, new Date()];
 * ```
 */
type Convertible = Numeric | string | boolean | Date;

/** Type conversion, type inspection, hashing and BSON size operators. */
export const conversionOps = {
  /**
   * Any value → string. Named `toString_`: `toString` is `Object.prototype`'s.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toString/
   */
  toString_: F.unaryNull<unknown, string>("$toString"),
  /**
   * Any value → boolean.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toBool/
   */
  toBool: F.unaryNull<unknown, boolean>("$toBool"),
  /**
   * → int32 (`number`).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toInt/
   */
  toInt: F.unaryNull<Convertible, Lean<"int32">>("$toInt"),
  /**
   * → int64 (`bigint`, the enforced `useBigInt64`).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toLong/
   */
  toLong: F.unaryNull<Convertible, Lean<"long">>("$toLong"),
  /**
   * → double.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toDouble/
   */
  toDouble: F.unaryNull<Convertible, Lean<"double">>("$toDouble"),
  /**
   * → `Decimal128`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toDecimal/
   */
  toDecimal: F.unaryNull<Convertible, Lean<"decimal128">>("$toDecimal"),
  /**
   * String, double, long, decimal, `ObjectId`, `Timestamp` → `Date`. An integer literal (`fn.toDate(0)`) does not
   * compile: the driver sends it as an int32, which the server cannot convert; write `fn.toLong(0)` or a double.
   *
   * @typeParam A - The argument.
   * @param x - The value to convert.
   * @returns The date; `null` for a `null` or missing argument.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toDate/
   */
  toDate: <const A extends Arg<Nullable<string | Numeric | Date | ObjectId | Timestamp>>>(
    x: A & ToDateArgCheck<A>,
  ): Expr<PropagateNull<Lean<"date">, A>> => F.node("$toDate", ExprNodes.serialize(x)),
  /**
   * Hex string → `ObjectId`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toObjectId/
   */
  toObjectId: F.unaryNull<string | ObjectId, Lean<"objectId">>("$toObjectId"),
  /**
   * UUID string → `UUID` (MongoDB 8.0+).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toUUID/
   */
  toUUID: F.unaryNull<string | UUID, Lean<"uuid">>("$toUUID"),
  /**
   * JSON array string or `binData` vector → array (MongoDB 8.3+).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toArray/
   */
  toArray: F.unaryNull<string | Binary, unknown[]>("$toArray"),
  /**
   * JSON object string → document (MongoDB 8.3+).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toObject/
   */
  toObject: F.unaryNull<string, { [key: string]: unknown }>("$toObject"),
  /**
   * General conversion. The result depends on `to`; `onError` and `onNull` join the union when given.
   *
   * @param spec - The input, the target and the optional format and fallbacks.
   * @returns The converted value, typed by `to`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/convert/
   */
  convert: <const To extends ConvertTarget, I extends Arg<unknown>, const OnError = never, const OnNull = never>(spec: {
    input: I;
    to: To;
    format?: ConvertFormat;
    onError?: Arg<OnError>;
    onNull?: Arg<OnNull>;
  }): Expr<ConvertResult<To> | OnError | ([OnNull] extends [never] ? PropagateNull<never, I> : OnNull)> =>
    F.node("$convert", { ...ExprNodes.spec(spec), to: spec.to }),

  /**
   * `true` for int, long, double or decimal.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/isNumber/
   */
  isNumber: F.unaryTo<unknown, boolean>("$isNumber"),
  /**
   * `true` for an array.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/isArray/
   */
  isArray: F.unaryArray<unknown, boolean>("$isArray"),
  /**
   * BSON type alias of a value (`"missing"` for a missing field).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/type/
   */
  typeOf: F.unaryArray<unknown, TypeName>("$type"),
  /**
   * Binary subtype of a `binData` value (MongoDB 8.3+).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/subtype/
   */
  subtype: F.unaryNull<Binary, number>("$subtype"),

  /**
   * Hash as `binData` (MongoDB 8.3+).
   *
   * @param spec - The input and the algorithm.
   * @returns The hash bytes, `null` when the input can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/hash/
   */
  hash: <I extends Arg<Nullable<string | Binary>>>(spec: {
    input: I;
    algorithm: HashAlgorithm;
  }): Expr<PropagateNull<Lean<"binary">, I>> => F.node("$hash", ExprNodes.spec(spec)),
  /**
   * Hash as an uppercase hex string (MongoDB 8.3+).
   *
   * @param spec - The input and the algorithm.
   * @returns The hex string, `null` when the input can be `null`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/hexHash/
   */
  hexHash: <I extends Arg<Nullable<string | Binary>>>(spec: {
    input: I;
    algorithm: HashAlgorithm;
  }): Expr<PropagateNull<string, I>> => F.node("$hexHash", ExprNodes.spec(spec)),
  /**
   * A new `ObjectId` per document (MongoDB 8.3+).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/createObjectId/
   */
  createObjectId: F.nullary<Lean<"objectId">>("$createObjectId"),
  /**
   * The hashed-index key of a value (int64, never `null`).
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/toHashedIndexKey/
   */
  toHashedIndexKey: F.unaryTo<unknown, Lean<"long">>("$toHashedIndexKey"),
  /**
   * Byte size of a string or `binData`.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/binarySize/
   */
  binarySize: F.unaryNull<string | Binary, number>("$binarySize"),
  /**
   * BSON size of a document.
   *
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/bsonSize/
   */
  bsonSize: F.unaryNull<{ readonly [key: string]: unknown }, number>("$bsonSize"),
  /**
   * A value → its Extended JSON form (MongoDB 8.3+). The form depends on the value, so it is `unknown`.
   *
   * @param spec - The input, whether the form is relaxed, and the optional fallback on error.
   * @returns The Extended JSON form.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/serializeEJSON/
   */
  serializeEJSON: <I extends Arg<unknown>, const OnError = never>(spec: {
    input: I;
    relaxed?: boolean;
    onError?: Arg<OnError>;
  }): Expr<unknown> => F.node("$serializeEJSON", ExprNodes.spec(spec)),
  /**
   * Extended JSON → BSON values (MongoDB 8.3+).
   *
   * @param spec - The input and the optional fallback on error.
   * @returns The deserialized value; its type depends on the input, so it is `unknown`.
   * @see https://www.mongodb.com/docs/manual/reference/operator/aggregation/deserializeEJSON/
   */
  deserializeEJSON: <I extends Arg<unknown>, const OnError = never>(spec: {
    input: I;
    onError?: Arg<OnError>;
  }): Expr<unknown> => F.node("$deserializeEJSON", ExprNodes.spec(spec)),
};
