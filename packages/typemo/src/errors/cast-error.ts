import { TypemoError } from "./typemo-error.ts";

/**
 * Why a value could not be cast. A closed list, so callers can branch on it without parsing
 * messages:
 * - `undefined` — the value is `undefined` (never allowed: the driver would write `null`);
 * - `null` — `null` on a path that is not nullable;
 * - `type` — wrong JavaScript/BSON type and no allowed conversion from it;
 * - `format` — right type, but the text does not have the required format (hex, ISO 8601, UUID, decimal);
 * - `integer` — a fractional number where an integer is required;
 * - `range` — outside the range of the target type (Int32, Int64, int8, float32, dates);
 * - `finite` — `NaN` or `±Infinity` where a finite number is required;
 * - `precision` — the conversion would lose information (unsafe integer, inexact Decimal128);
 * - `subtype` — a Binary of another subtype, or a vector of another dtype;
 * - `dimensions` — a vector of the wrong length;
 * - `flags` — RegExp flags that do not survive a BSON round trip;
 * - `key` — a Map key MongoDB cannot store or address;
 * - `unknown-key` — a field the subdocument does not declare (strict mode);
 * - `union-no-match` / `union-ambiguous` — no union member, or more than one, accepts the value (union values are never guessed);
 * - `json` — a value with no JSON form (`toJson` of `NaN`, of a raw `Long`);
 * - `discriminator` — the discriminator value of an embedded document names no known class.
 *
 * @example
 * ```ts
 * const reason: CastReason = "range";
 * ```
 */
export type CastReason =
  | "undefined"
  | "null"
  | "type"
  | "format"
  | "integer"
  | "range"
  | "finite"
  | "precision"
  | "subtype"
  | "dimensions"
  | "flags"
  | "key"
  | "unknown-key"
  | "union-no-match"
  | "union-ambiguous"
  | "json"
  | "discriminator";

/**
 * Everything a `CastError` carries.
 *
 * @example
 * ```ts
 * const details: CastErrorDetails = {
 *   path: "age", value: 2 ** 31, expected: "Int32", reason: "range", detail: "out of the Int32 range",
 * };
 * ```
 */
export interface CastErrorDetails {
  /** Dotted path of the value (`items.3.price`); `""` for a value cast on its own. */
  readonly path: string;
  /** The value that failed, as given (not a copy, not a string rendering). */
  readonly value: unknown;
  /** What was expected, in the vocabulary of the casters: `Int32`, `ObjectId`, `Array<string>`. */
  readonly expected: string;
  /** Machine-readable reason. */
  readonly reason: CastReason;
  /** One sentence for humans: what exactly is wrong. */
  readonly detail: string;
  /** The underlying error, when one caused the failure. */
  readonly cause?: unknown;
}

/**
 * A value could not be turned into the type of its path. Always carries the path, the
 * original value, the expected type and a machine-readable `reason`; the message repeats all of them.
 *
 * One rule everywhere: a value that cannot be cast is always this error, one for the field, at any depth; the
 * constraints of that field (`min`, `enum`, validators) are not checked, and it never becomes an issue of a
 * `ValidationError`. It is thrown when the value is cast:
 * - at once when the value enters through a Typemo method: `Model.new(row)`, `create`, `$set`, the methods of
 *   arrays and Maps, the filters and updates of queries;
 * - at the next `$validate()` or `$save()` for a plain assignment (`doc.age = …`, `doc.lines[0].qty = …`), which
 *   cannot be intercepted; nothing is sent then.
 *
 * Unlike Mongoose, the error has no reference to a model or schema (Mongoose gh-14529:
 * `console.log(err)` printed a whole model) and the reason is part of the message (Mongoose gh-16167).
 *
 * @example
 * ```ts
 * try {
 *   user.$set("age", 2 ** 31);
 * } catch (error) {
 *   if (error instanceof CastError) console.log(error.path, error.reason); // "age" "range"
 * }
 * ```
 */
export class CastError extends TypemoError {
  /** Dotted path of the value; `""` for a value cast on its own. */
  readonly path: string;
  /** The value that failed, as given. */
  readonly value: unknown;
  /** What was expected (`Int32`, `ObjectId`, …). */
  readonly expected: string;
  /** Machine-readable reason. */
  readonly reason: CastReason;
  /** One sentence for humans. */
  readonly detail: string;

  /**
   * @param details - Path, value, expected type, reason and explanation of the failure.
   */
  constructor(details: CastErrorDetails) {
    super(CastError.format(details), details.cause === undefined ? {} : { cause: details.cause });
    this.path = details.path;
    this.value = details.value;
    this.expected = details.expected;
    this.reason = details.reason;
    this.detail = details.detail;
  }

  static {
    Object.defineProperty(CastError.prototype, "name", { value: "CastError", writable: true, configurable: true });
  }

  /**
   * Builds the error message, e.g. `Cast to Int32 failed at path "age" for 2147483648 (number): out of the
   * Int32 range [range]`.
   *
   * @param details - The parts of the message.
   * @returns The message.
   */
  static format(details: Pick<CastErrorDetails, "path" | "value" | "expected" | "reason" | "detail">): string {
    const where = details.path === "" ? "" : ` at path "${details.path}"`;
    return `Cast to ${details.expected} failed${where} for ${CastError.describe(details.value)}: ${details.detail} [${details.reason}]`;
  }

  /**
   * Short, bounded rendering of any value for messages: `"abc" (string)`, `[array of 3]`, `ObjectId`.
   *
   * @param value - Any value.
   * @returns A short description that never contains a whole large value.
   */
  static describe(value: unknown): string {
    if (value === null) return "null";
    switch (typeof value) {
      case "undefined":
        return "undefined";
      case "string":
        return `${JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}...` : value)} (string)`;
      case "number":
        return `${Object.is(value, -0) ? "-0" : String(value)} (number)`;
      case "bigint":
        return `${value}n (bigint)`;
      case "boolean":
        return `${value} (boolean)`;
      case "symbol":
        return "a symbol";
      case "function":
        return "a function";
    }
    if (Array.isArray(value)) return `[array of ${value.length}]`;
    const tag = (value as { _bsontype?: unknown })._bsontype;
    if (typeof tag === "string") return tag;
    const name = Object.getPrototypeOf(value)?.constructor?.name;
    return typeof name === "string" && name !== "Object" ? `a ${name}` : "an object";
  }

  /**
   * Plain data for logs and JSON responses (the value is left out: it may be large or sensitive).
   *
   * @returns Name, message, path, expected type and reason.
   */
  toJSON(): { name: string; message: string; path: string; expected: string; reason: CastReason } {
    return { name: this.name, message: this.message, path: this.path, expected: this.expected, reason: this.reason };
  }
}
