/*
 * Runtime BSON classes come from "mongodb", not "bson": the driver (CommonJS) returns instances of
 * bson's CommonJS build, while `import "bson"` resolves to its ESM build — two different class sets
 * (dual-package hazard). Casting with the driver's classes keeps a cast value and
 * a read value of the same class, so `instanceof` in user code (with classes from "mongodb") agrees.
 */
import { Binary, type Decimal128, type MaxKey, type MinKey, type ObjectId, type Timestamp, UUID } from "mongodb";
import { CastError } from "../errors/cast-error.ts";
import { BsonGuards } from "./bson-guards.ts";
import type { AnyFunction, OpaqueValue } from "./opaque-value.ts";

/*
 * ONE table "BSON type ↔ TS type" for the hydrated, lean, JSON and plain forms. It
 * replaces the three diverging tables of the old wrapper (`LeanValue`, `Convert`, `Prettify` + the runtime
 * `deepPrettify`): the type level (`BsonScalarForms`, `LeanValue`, `JsonValue`, `PlainValue`)
 * and the runtime (`BsonTypeTable.scalars`, `toLean`, `toJson`, `toPlain`, `kindOf`) are bound to each other —
 * every runtime row is typed by its `BsonScalarForms` row, so a row cannot exist on one side only, and a row
 * without one of the four forms does not compile.
 *
 * Forms:
 * - hydrated — what a document field holds after casting (`*Caster.cast`);
 * - lean     — what the driver returns with the enforced options (`BsonOptions.REQUIRED`:
 *              `useBigInt64`, `promoteValues`, `bsonRegExp: false`); proven by shape tests;
 * - json     — what `toJson` produces (strings for values JSON cannot hold losslessly);
 * - plain    — what `toPlain` produces: the MongoDB types as their JSON strings (ids, int64,
 *              Decimal128, UUID), the native JavaScript types kept (`Date`, `RegExp`, bytes as `Uint8Array`, a
 *              vector as `number[]`, a `Map` as a `Map`) — nothing `JSON.stringify` cannot print.
 * The generated table of from-mongoose-to-typemo/guides/value-forms.md is written from `BsonTypeTable`
 * (`bun run forms:table`).
 */

/**
 * JSON form of a `Timestamp`: its two 32-bit halves.
 *
 * @example
 * ```ts
 * const json: TimestampJson = { t: 1700000000, i: 1 };
 * ```
 */
export interface TimestampJson {
  /** Seconds since the epoch (the high 32 bits). */
  t: number;
  /** The ordinal within the second (the low 32 bits). */
  i: number;
}

/**
 * JSON form of `MinKey` (the Extended JSON shape).
 *
 * @example
 * ```ts
 * const json: MinKeyJson = { $minKey: 1 };
 * ```
 */
export interface MinKeyJson {
  /** Always `1`, as in Extended JSON. */
  $minKey: 1;
}

/**
 * JSON form of `MaxKey` (the Extended JSON shape).
 *
 * @example
 * ```ts
 * const json: MaxKeyJson = { $maxKey: 1 };
 * ```
 */
export interface MaxKeyJson {
  /** Always `1`, as in Extended JSON. */
  $maxKey: 1;
}

/** Unique key of the phantom member of {@link VectorMarker}; exists only at the type level. */
declare const VECTOR: unique symbol;

/**
 * Phantom member of {@link Vector}: tells a vector from other binaries at the type level (their plain forms differ).
 *
 * @example
 * ```ts
 * type IsMarked = Vector extends VectorMarker ? true : false; // true
 * ```
 */
export interface VectorMarker {
  /** Optional and never set at run time; only its presence in the type matters. */
  readonly [VECTOR]?: true;
}

/**
 * A BSON vector (Binary subtype 9, `Spec.vector({ dtype, dimensions })`): at run time a `Binary` (what the driver
 * returns); the type carries a phantom marker because its plain and JSON forms are `number[]`, not
 * the bytes of a `Binary`. Declare vector fields with it: `@Prop(() => Spec.vector({ dtype: "float32" })) v!: Vector`.
 *
 * @example
 * ```ts
 * type Plain = PlainValue<Vector>; // number[]
 * type PlainBinary = PlainValue<Binary>; // Uint8Array<ArrayBuffer>
 * ```
 */
export interface Vector extends Binary, VectorMarker {}

/**
 * `true` when `T` is a {@link Vector}.
 *
 * @typeParam T - The type to test.
 * @example
 * ```ts
 * type A = IsVector<Vector>; // true
 * type B = IsVector<Binary>; // false
 * ```
 */
export type IsVector<T> = typeof VECTOR extends keyof T ? true : false;

/**
 * The decimal string of an int64: the JSON and plain form of a `bigint`, and accepted back as
 * input. TypeScript's `${bigint}` (it refuses `"1.5"`, `"01"`, `"+1"`, `" 1"`); the caster is stricter still.
 *
 * @example
 * ```ts
 * const id: Int64String = "9223372036854775807";
 * // @ts-expect-error a fractional string is not an int64
 * const bad: Int64String = "1.5";
 * ```
 */
export type Int64String = `${bigint}`;

/**
 * The four TypeScript forms of one BSON type. Phantom: only used at the type level.
 *
 * @typeParam Hydrated - What a document field holds after casting.
 * @typeParam Lean - What the driver returns with the enforced options.
 * @typeParam Json - What `toJson` produces.
 * @typeParam Plain - What `toPlain` produces.
 * @example
 * ```ts
 * type ObjectIdForms = BsonForms<ObjectId, ObjectId, string, string>;
 * type Json = ObjectIdForms["json"]; // string
 * ```
 */
export interface BsonForms<Hydrated, Lean, Json, Plain> {
  /** The hydrated form. */
  readonly hydrated: Hydrated;
  /** The lean form. */
  readonly lean: Lean;
  /** The JSON form. */
  readonly json: Json;
  /** The plain form. */
  readonly plain: Plain;
}

/**
 * The type-level table of scalar BSON types. Containers (array, embedded document, Map) are
 * recursive and handled by `LeanValue` / `JsonValue`; they have runtime rows in
 * `BsonTypeTable.containers`.
 *
 * - `double` and `int32` are both `number`: which one goes on the wire is decided by the caster
 *   (`DoubleCaster.encode` / `Int32Caster.encode`), not by the value;
 * - `long` is `bigint` in the hydrated and lean forms and a decimal `string` in the JSON and plain forms
 *   (the same type for every value, no precision loss);
 * - `uuid` is Binary subtype 4 and `vector` is Binary subtype 9; the deserializer returns `UUID`
 *   for a valid subtype 4 and a plain `Binary` for a vector (typed {@link Vector}); a vector's JSON and plain
 *   forms are its values (`number[]`: int8 and float32 elements, the bits of a packed-bit vector as 0/1);
 * - `regex` is a native `RegExp` (`bsonRegExp: false`); see `RegExpCaster` for the flags that survive.
 *
 * @example
 * ```ts
 * type LongJson = BsonScalarForms["long"]["json"]; // Int64String
 * type DateLean = BsonScalarForms["date"]["lean"]; // Date
 * ```
 */
export interface BsonScalarForms {
  /** The `ObjectId` row. */
  readonly objectId: BsonForms<ObjectId, ObjectId, string, string>;
  /** The `string` row. */
  readonly string: BsonForms<string, string, string, string>;
  /** The `double` row. */
  readonly double: BsonForms<number, number, number, number>;
  /** The `int32` row. */
  readonly int32: BsonForms<number, number, number, number>;
  /** The `long` (int64) row. */
  readonly long: BsonForms<bigint, bigint, Int64String, Int64String>;
  /** The `decimal128` row. */
  readonly decimal128: BsonForms<Decimal128, Decimal128, string, string>;
  /** The `bool` row. */
  readonly bool: BsonForms<boolean, boolean, boolean, boolean>;
  /** The `date` row. */
  readonly date: BsonForms<Date, Date, string, Date>;
  /** The generic `binary` row (subtype 0). */
  readonly binary: BsonForms<Binary, Binary, string, Uint8Array<ArrayBuffer>>;
  /** The `uuid` row (Binary subtype 4). */
  readonly uuid: BsonForms<UUID, UUID, string, string>;
  /** The `vector` row (Binary subtype 9). */
  readonly vector: BsonForms<Vector, Vector, number[], number[]>;
  /** The `regex` row. */
  readonly regex: BsonForms<RegExp, RegExp, string, RegExp>;
  /** The `timestamp` row. */
  readonly timestamp: BsonForms<Timestamp, Timestamp, TimestampJson, TimestampJson>;
  /** The `minKey` row. */
  readonly minKey: BsonForms<MinKey, MinKey, MinKeyJson, MinKeyJson>;
  /** The `maxKey` row. */
  readonly maxKey: BsonForms<MaxKey, MaxKey, MaxKeyJson, MaxKeyJson>;
  /** The `null` row. */
  readonly null: BsonForms<null, null, null, null>;
}

/**
 * A scalar row of the table.
 *
 * @example
 * ```ts
 * const key: BsonScalarKey = "objectId";
 * ```
 */
export type BsonScalarKey = keyof BsonScalarForms;

/**
 * A container row of the table.
 *
 * @example
 * ```ts
 * const key: BsonContainerKey = "map";
 * ```
 */
export type BsonContainerKey = "array" | "object" | "map";

/**
 * Every row of the table.
 *
 * @example
 * ```ts
 * const keys: BsonTypeKey[] = ["string", "array"];
 * ```
 */
export type BsonTypeKey = BsonScalarKey | BsonContainerKey;

/**
 * MongoDB `$type` aliases of the rows (`uuid` and `vector` are `binData` with a subtype).
 *
 * @example
 * ```ts
 * const alias: BsonTypeAlias = "binData"; // the alias of the `binary`, `uuid` and `vector` rows
 * ```
 */
export type BsonTypeAlias =
  | "objectId"
  | "string"
  | "double"
  | "int"
  | "long"
  | "decimal"
  | "bool"
  | "date"
  | "binData"
  | "regex"
  | "timestamp"
  | "minKey"
  | "maxKey"
  | "null"
  | "array"
  | "object";

/**
 * Metadata shared by every row. `forms` is the TypeScript text of each form (checked by hover tests).
 *
 * @typeParam K - The key of the row.
 * @example
 * ```ts
 * const row: BsonTypeRow<"int32"> = BsonTypeTable.scalars.int32;
 * row.bsonType; // 16
 * row.alias; // "int"
 * ```
 */
export interface BsonTypeRow<K extends BsonTypeKey> {
  /** The key of the row. */
  readonly key: K;
  /** BSON element type number (`-1` for MinKey, `127` for MaxKey). */
  readonly bsonType: number;
  /** The MongoDB `$type` alias of the row. */
  readonly alias: BsonTypeAlias;
  /** Binary subtype for `binary` (generic 0), `uuid` (4) and `vector` (9). */
  readonly subtype?: number;
  /** The TypeScript text of each form. */
  readonly forms: { readonly hydrated: string; readonly lean: string; readonly json: string; readonly plain: string };
}

/**
 * A scalar row: metadata plus the runtime half of its forms, typed by `BsonScalarForms[K]`.
 *
 * @typeParam K - The key of the scalar row.
 * @example
 * ```ts
 * const row: BsonScalarRow<"date"> = BsonTypeTable.scalars.date;
 * row.toJson(new Date(0), ""); // "1970-01-01T00:00:00.000Z"
 * ```
 */
export interface BsonScalarRow<K extends BsonScalarKey> extends BsonTypeRow<K> {
  /** Does the value have the hydrated (= lean) TypeScript type of this row? */
  readonly is: (value: unknown) => value is BsonScalarForms[K]["hydrated"];
  /** The JSON form. Throws `CastError` (`json`) for values JSON cannot represent (`NaN`, `Invalid Date`). */
  readonly toJson: (value: BsonScalarForms[K]["hydrated"], path: string) => BsonScalarForms[K]["json"];
  /**
   * The plain form: never aliases the value (mutable values are copied). Throws `CastError` only for a
   * vector whose bytes are not a vector.
   */
  readonly toPlain: (value: BsonScalarForms[K]["hydrated"], path: string) => BsonScalarForms[K]["plain"];
}

/**
 * The form `F` of the row whose hydrated type is exactly `T`. A vector and a binary are the same class: the
 * {@link Vector} marker tells them apart (mutual assignability alone would match both rows).
 *
 * @typeParam T - The hydrated type to find the row of.
 * @typeParam F - The form to read: `"hydrated"`, `"lean"`, `"json"` or `"plain"`.
 * @example
 * ```ts
 * type A = ExactForm<bigint, "json">; // Int64String
 * type B = ExactForm<Vector, "plain">; // number[]
 * type C = ExactForm<string | number, "json">; // never (no row has exactly this type)
 * ```
 */
type ExactForm<T, F extends keyof BsonForms<unknown, unknown, unknown, unknown>> = {
  [K in BsonScalarKey]: [T] extends [BsonScalarForms[K]["hydrated"]]
    ? [BsonScalarForms[K]["hydrated"]] extends [T]
      ? IsVector<T> extends IsVector<BsonScalarForms[K]["hydrated"]>
        ? BsonScalarForms[K][F]
        : never
      : never
    : never;
}[BsonScalarKey];

/**
 * Hydrated value → what the driver returns for it (lean / `toObject`). Scalars keep their type
 * (with the enforced driver options their lean form is the hydrated one); a `Map` becomes a plain
 * record (the driver never returns a `Map`); arrays and embedded documents are mapped recursively;
 * methods are dropped (a method lives on the prototype; a function stored as an own property is a `CastError` at
 * run time, at any depth). An opaque value outside the table (a raw `Long`, `Int32`, `Double` wrapper)
 * maps to `never`: the enforced options never produce it.
 *
 * @typeParam T - The hydrated type.
 * @example
 * ```ts
 * type A = LeanValue<Map<string, number>>; // { [key: string]: number }
 * type B = LeanValue<{ tags: string[]; save(): void }>; // { tags: string[] }
 * ```
 */
export type LeanValue<T> = T extends string | number | boolean | bigint | null
  ? T
  : T extends ReadonlyMap<string, infer V>
    ? { [key: string]: LeanValue<V> }
    : T extends OpaqueValue
      ? ExactForm<T, "lean">
      : T extends readonly (infer E)[]
        ? LeanValue<E>[]
        : T extends AnyFunction
          ? never
          : T extends object
            ? { -readonly [K in keyof T as T[K] extends AnyFunction ? never : K]: LeanValue<T[K]> }
            : never;

/**
 * Hydrated value → its JSON form (what `BsonTypeTable.toJson` returns, and what `JSON.stringify`
 * of it round-trips). Literal primitives are kept; `bigint` and the BSON scalars become their JSON
 * row (`bigint` → decimal `string`; `ObjectId` → `string`, `Decimal128` → `string`, `Date` → ISO
 * `string`, a vector → `number[]`, …).
 *
 * @typeParam T - The hydrated type.
 * @example
 * ```ts
 * type A = JsonValue<{ _id: ObjectId; at: Date; n: bigint }>; // { _id: string; at: string; n: Int64String }
 * ```
 */
export type JsonValue<T> = T extends string | number | boolean | null
  ? T
  : T extends bigint
    ? Int64String
    : T extends ReadonlyMap<string, infer V>
      ? { [key: string]: JsonValue<V> }
      : T extends OpaqueValue
        ? ExactForm<T, "json">
        : T extends readonly (infer E)[]
          ? JsonValue<E>[]
          : T extends AnyFunction
            ? never
            : T extends object
              ? { -readonly [K in keyof T as T[K] extends AnyFunction ? never : K]: JsonValue<T[K]> }
              : never;

/**
 * Hydrated value → its plain form (what `BsonTypeTable.toPlain` returns): the MongoDB types as their
 * JSON strings (`ObjectId`, `bigint`, `Decimal128`, `UUID`), the native JavaScript types kept (`Date`, `RegExp`),
 * bytes as `Uint8Array`, a vector as `number[]`, a `Map` as a `Map` of plain values; containers recursively.
 *
 * @typeParam T - The hydrated type.
 * @example
 * ```ts
 * type A = PlainValue<{ _id: ObjectId; at: Date; tags: Map<string, bigint> }>;
 * // { _id: string; at: Date; tags: Map<string, Int64String> }
 * ```
 */
export type PlainValue<T> = unknown extends T
  ? T
  : T extends string | number | boolean | null
    ? T
    : T extends bigint
      ? Int64String
      : T extends ReadonlyMap<string, infer V>
        ? Map<string, PlainValue<V>>
        : T extends Uint8Array
          ? T /* already plain bytes (the plain form of a Binary): the plain form is idempotent */
          : T extends OpaqueValue
            ? ExactForm<T, "plain">
            : T extends readonly (infer E)[]
              ? PlainValue<E>[]
              : T extends AnyFunction
                ? never
                : T extends object
                  ? { -readonly [K in keyof T as T[K] extends AnyFunction ? never : K]: PlainValue<T[K]> }
                  : never;

/** The smallest int32 value. */
const INT32_MIN = -2_147_483_648;
/** The largest int32 value. */
const INT32_MAX = 2_147_483_647;

/**
 * Throws the `CastError` of a value that has no JSON form.
 *
 * @param path - Dotted path of the value.
 * @param value - The value that cannot be represented.
 * @param expected - What the JSON form would have been.
 * @param detail - Human-readable explanation.
 * @returns Never returns.
 * @throws {CastError} Always, with reason `json`.
 */
const jsonFail = (path: string, value: unknown, expected: string, detail: string): never => {
  throw new CastError({ path, value, expected, reason: "json", detail });
};

/**
 * The JSON form of a number: itself when finite.
 *
 * @param value - The number.
 * @param path - Dotted path of the value.
 * @returns The same number.
 * @throws {CastError} With reason `json` for `NaN` and `±Infinity`.
 */
const finiteJson = (value: number, path: string): number =>
  Number.isFinite(value) ? value : jsonFail(path, value, "JSON number", "JSON has no NaN or Infinity");

/**
 * A view of the used bytes of a Binary (shares memory with it).
 *
 * @param value - The Binary.
 * @returns The bytes up to `value.position`.
 */
const binaryBytes = (value: Binary): Uint8Array => value.buffer.subarray(0, value.position);

/**
 * Detached copy of the bytes of a Binary (`Buffer#slice` would return a view on the same memory).
 *
 * @param value - The Binary.
 * @returns A new `Uint8Array` with the used bytes.
 */
const copyBytes = (value: Binary): Uint8Array => Uint8Array.prototype.slice.call(value.buffer, 0, value.position);

/**
 * A detached `Uint8Array` (never a `Buffer`: the plain form is the platform's own byte array).
 *
 * @param value - The Binary.
 * @returns A new `Uint8Array` with the used bytes.
 */
const plainBytes = (value: Binary): Uint8Array<ArrayBuffer> => new Uint8Array(binaryBytes(value));

/**
 * The values of a vector: int8 and float32 elements as numbers (a float32 element is the float32 value,
 * widened exactly to a double), a packed-bit vector as its bits 0/1 in order, without the padding bits of the last
 * byte (the bson decoder reads the padding from the header). Bytes that are not a vector: `CastError` (`format`).
 *
 * @param value - The vector Binary.
 * @param path - Dotted path of the value, used in error messages.
 * @returns The vector elements as numbers.
 * @throws {CastError} With reason `format` when the bytes are not a valid vector or the dtype byte is unknown.
 */
const vectorValues = (value: Binary, path: string): number[] => {
  try {
    switch (value.buffer[0]) {
      case Binary.VECTOR_TYPE.Int8:
        return Array.from(value.toInt8Array());
      case Binary.VECTOR_TYPE.Float32:
        return Array.from(value.toFloat32Array());
      case Binary.VECTOR_TYPE.PackedBit:
        return Array.from(value.toBits());
    }
  } catch (error) {
    throw new CastError({
      path,
      value,
      expected: "a BSON vector",
      reason: "format",
      detail: "invalid vector bytes",
      cause: error,
    });
  }
  throw new CastError({
    path,
    value,
    expected: "a BSON vector",
    reason: "format",
    detail: `unknown vector dtype byte ${String(value.buffer[0])}`,
  });
};

/** The runtime rows of the scalar BSON types, typed by their `BsonScalarForms` rows. */
const SCALAR_ROWS: { readonly [K in BsonScalarKey]: BsonScalarRow<K> } = {
  objectId: {
    key: "objectId",
    bsonType: 7,
    alias: "objectId",
    forms: { hydrated: "ObjectId", lean: "ObjectId", json: "string", plain: "string" },
    is: BsonGuards.isObjectId,
    toJson: (value) => value.toHexString(),
    toPlain: (value) => value.toHexString(),
  },
  string: {
    key: "string",
    bsonType: 2,
    alias: "string",
    forms: { hydrated: "string", lean: "string", json: "string", plain: "string" },
    is: (value): value is string => typeof value === "string",
    toJson: (value) => value,
    toPlain: (value) => value,
  },
  double: {
    key: "double",
    bsonType: 1,
    alias: "double",
    forms: { hydrated: "number", lean: "number", json: "number", plain: "number" },
    is: (value): value is number => typeof value === "number",
    toJson: finiteJson,
    toPlain: (value) => value,
  },
  int32: {
    key: "int32",
    bsonType: 16,
    alias: "int",
    forms: { hydrated: "number", lean: "number", json: "number", plain: "number" },
    is: (value): value is number => typeof value === "number",
    toJson: finiteJson,
    toPlain: (value) => value,
  },
  long: {
    key: "long",
    bsonType: 18,
    alias: "long",
    forms: { hydrated: "bigint", lean: "bigint", json: `\`\${bigint}\``, plain: `\`\${bigint}\`` },
    is: (value): value is bigint => typeof value === "bigint",
    /* A decimal string for every value — one type, no precision loss. */
    toJson: (value) => `${value}` as const,
    toPlain: (value) => `${value}` as const,
  },
  decimal128: {
    key: "decimal128",
    bsonType: 19,
    alias: "decimal",
    forms: { hydrated: "Decimal128", lean: "Decimal128", json: "string", plain: "string" },
    is: BsonGuards.isDecimal128,
    toJson: (value) => value.toString(),
    toPlain: (value) => value.toString(),
  },
  bool: {
    key: "bool",
    bsonType: 8,
    alias: "bool",
    forms: { hydrated: "boolean", lean: "boolean", json: "boolean", plain: "boolean" },
    is: (value): value is boolean => typeof value === "boolean",
    toJson: (value) => value,
    toPlain: (value) => value,
  },
  date: {
    key: "date",
    bsonType: 9,
    alias: "date",
    forms: { hydrated: "Date", lean: "Date", json: "string", plain: "Date" },
    is: BsonGuards.isDate,
    toJson: (value, path) =>
      BsonGuards.isValidDate(value) ? value.toISOString() : jsonFail(path, value, "ISO date string", "Invalid Date"),
    toPlain: (value) => new Date(value.getTime()),
  },
  binary: {
    key: "binary",
    bsonType: 5,
    alias: "binData",
    subtype: 0,
    forms: { hydrated: "Binary", lean: "Binary", json: "string", plain: "Uint8Array<ArrayBuffer>" },
    is: BsonGuards.isBinary,
    toJson: (value) => Buffer.from(binaryBytes(value)).toString("base64"),
    toPlain: plainBytes,
  },
  uuid: {
    key: "uuid",
    bsonType: 5,
    alias: "binData",
    subtype: 4,
    forms: { hydrated: "UUID", lean: "UUID", json: "string", plain: "string" },
    is: BsonGuards.isUuid,
    toJson: (value) => new UUID(binaryBytes(value)).toHexString(true),
    toPlain: (value) => new UUID(binaryBytes(value)).toHexString(true),
  },
  vector: {
    key: "vector",
    bsonType: 5,
    alias: "binData",
    subtype: 9,
    forms: { hydrated: "Vector", lean: "Vector", json: "number[]", plain: "number[]" },
    is: BsonGuards.isVector,
    /* The values, not base64: a vector is data, not opaque bytes. */
    toJson: vectorValues,
    toPlain: vectorValues,
  },
  regex: {
    key: "regex",
    bsonType: 11,
    alias: "regex",
    forms: { hydrated: "RegExp", lean: "RegExp", json: "string", plain: "RegExp" },
    is: BsonGuards.isRegExp,
    toJson: (value) => value.toString(),
    toPlain: (value) => new RegExp(value.source, value.flags),
  },
  timestamp: {
    key: "timestamp",
    bsonType: 17,
    alias: "timestamp",
    forms: { hydrated: "Timestamp", lean: "Timestamp", json: "TimestampJson", plain: "TimestampJson" },
    is: BsonGuards.isTimestamp,
    toJson: (value) => ({ t: value.t, i: value.i }),
    toPlain: (value) => ({ t: value.t, i: value.i }),
  },
  minKey: {
    key: "minKey",
    bsonType: -1,
    alias: "minKey",
    forms: { hydrated: "MinKey", lean: "MinKey", json: "MinKeyJson", plain: "MinKeyJson" },
    is: BsonGuards.isMinKey,
    toJson: () => ({ $minKey: 1 }),
    toPlain: () => ({ $minKey: 1 }),
  },
  maxKey: {
    key: "maxKey",
    bsonType: 127,
    alias: "maxKey",
    forms: { hydrated: "MaxKey", lean: "MaxKey", json: "MaxKeyJson", plain: "MaxKeyJson" },
    is: BsonGuards.isMaxKey,
    toJson: () => ({ $maxKey: 1 }),
    toPlain: () => ({ $maxKey: 1 }),
  },
  null: {
    key: "null",
    bsonType: 10,
    alias: "null",
    forms: { hydrated: "null", lean: "null", json: "null", plain: "null" },
    is: (value): value is null => value === null,
    toJson: () => null,
    toPlain: () => null,
  },
};

/** The metadata rows of the container types (they have no per-value runtime conversion of their own). */
const CONTAINER_ROWS: { readonly [K in BsonContainerKey]: BsonTypeRow<K> } = {
  array: {
    key: "array",
    bsonType: 4,
    alias: "array",
    forms: { hydrated: "T[]", lean: "LeanValue<T>[]", json: "JsonValue<T>[]", plain: "PlainValue<T>[]" },
  },
  object: {
    key: "object",
    bsonType: 3,
    alias: "object",
    forms: {
      hydrated: "{ … }",
      lean: "{ [K]: LeanValue<T[K]> }",
      json: "{ [K]: JsonValue<T[K]> }",
      plain: "{ [K]: PlainValue<T[K]> }",
    },
  },
  map: {
    key: "map",
    bsonType: 3,
    alias: "object",
    forms: {
      hydrated: "Map<string, V>",
      lean: "{ [key: string]: LeanValue<V> }",
      json: "{ [key: string]: JsonValue<V> }",
      plain: "Map<string, PlainValue<V>>",
    },
  },
};

/**
 * The runtime half of the BSON ↔ TS table plus conversions between the forms.
 * The type half is `BsonScalarForms` / `LeanValue` / `JsonValue` in this file.
 */
export class BsonTypeTable {
  /** Scalar rows, keyed like `BsonScalarForms`. */
  static readonly scalars: { readonly [K in BsonScalarKey]: BsonScalarRow<K> } = SCALAR_ROWS;

  /** Container rows (array, embedded document, Map). */
  static readonly containers: { readonly [K in BsonContainerKey]: BsonTypeRow<K> } = CONTAINER_ROWS;

  /** Every row key, scalars first, in table order. */
  static readonly keys: readonly BsonTypeKey[] = [
    ...(Object.keys(SCALAR_ROWS) as BsonScalarKey[]),
    ...(Object.keys(CONTAINER_ROWS) as BsonContainerKey[]),
  ];

  /**
   * The row a hydrated or lean value belongs to, the way the serializer decides it: a `number` is
   * `int32` when it is an integer in the Int32 range (and not `-0`), otherwise `double`; a `bigint`
   * is `long`; a Binary is `uuid` (subtype 4, 16 bytes), `vector` (subtype 9) or `binary`.
   * `undefined` for values that are not in any form of the table (functions, `undefined`, raw
   * `Long`/`Int32`/`Double` wrappers, legacy `Code`/`DBRef`/`BSONSymbol`, `Set`, typed arrays).
   *
   * @param value - The value to classify.
   * @returns The row key, or `undefined` when the value has no row.
   */
  static kindOf(value: unknown): BsonTypeKey | undefined {
    switch (typeof value) {
      case "string":
        return "string";
      case "boolean":
        return "bool";
      case "bigint":
        return "long";
      case "number":
        return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX && !Object.is(value, -0)
          ? "int32"
          : "double";
      case "object":
        break;
      default:
        return undefined;
    }
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (BsonGuards.isMap(value)) return "map";
    if (BsonGuards.isDate(value)) return "date";
    if (BsonGuards.isRegExp(value)) return "regex";
    if (BsonGuards.isUuid(value)) return "uuid";
    if (BsonGuards.isVector(value)) return "vector";
    switch (BsonGuards.tagOf(value)) {
      case "ObjectId":
        return "objectId";
      case "Decimal128":
        return "decimal128";
      case "Binary":
        return "binary";
      case "Timestamp":
        return "timestamp";
      case "MinKey":
        return "minKey";
      case "MaxKey":
        return "maxKey";
      case undefined:
        return BsonGuards.isPlainObject(value) ? "object" : undefined;
      default:
        return undefined;
    }
  }

  /**
   * Hydrated → lean (the runtime of `LeanValue<T>`): a `Map` becomes a plain object, containers
   * are rebuilt, mutable scalars (`Date`, `Binary`, `RegExp`) are copied so the result never aliases
   * the input.
   *
   * @typeParam T - The hydrated type.
   * @param value - The hydrated value.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The lean form.
   * @throws {CastError} With reason `type` for a value outside the table.
   */
  static toLean<T>(value: T, path = ""): LeanValue<T> {
    return BsonTypeTable.convertLean(value, path) as LeanValue<T>;
  }

  /**
   * Hydrated (or lean) → JSON (the runtime of `JsonValue<T>`).
   *
   * @typeParam T - The hydrated type.
   * @param value - The hydrated or lean value.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The JSON form.
   * @throws {CastError} With reason `json` for a value with no JSON form and `type` for a value outside the table.
   */
  static toJson<T>(value: T, path = ""): JsonValue<T> {
    return BsonTypeTable.convertJson(value, path) as JsonValue<T>;
  }

  /**
   * Hydrated (or lean) → plain (the runtime of `PlainValue<T>`): a `Map` stays a `Map` (plain values),
   * a plain object stays an object, every scalar goes through its row's `toPlain`.
   *
   * @typeParam T - The hydrated type.
   * @param value - The hydrated or lean value.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The plain form.
   * @throws {CastError} With reason `type` for a value outside the table.
   */
  static toPlain<T>(value: T, path = ""): PlainValue<T> {
    return BsonTypeTable.convertPlain(value, path) as PlainValue<T>;
  }

  /**
   * The plain form of one scalar of the table (a string, a number, a boolean, `null` or a BSON value), without the
   * container rows: the fast path of the schema-driven readers (a container is walked by its schema node there).
   *
   * @param value - The scalar value.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The plain form of the scalar.
   * @throws {CastError} With reason `type` for a value outside the table.
   */
  static scalarToPlain(value: unknown, path: string): unknown {
    const kind = BsonTypeTable.kindOf(value);
    if (kind === undefined || kind === "array" || kind === "map" || kind === "object") {
      return BsonTypeTable.convertPlain(value, path);
    }
    const row: BsonScalarRow<BsonScalarKey> = BsonTypeTable.scalars[kind] as BsonScalarRow<BsonScalarKey>;
    return row.toPlain(value as never, path);
  }

  /**
   * Dotted path of a child: `items` + `3` → `items.3`; the root path is `""`.
   *
   * @param path - The parent path.
   * @param key - The property name or array index of the child.
   * @returns The child's dotted path.
   */
  private static join(path: string, key: string | number): string {
    return path === "" ? String(key) : `${path}.${key}`;
  }

  /**
   * Throws the error of a value that has no row in the table.
   *
   * @param path - Dotted path of the value.
   * @param value - The value outside the table.
   * @returns Never returns.
   * @throws {CastError} Always, with reason `type`.
   */
  private static outside(path: string, value: unknown): never {
    throw new CastError({
      path,
      value,
      expected: "a value of the BSON type table",
      reason: "type",
      detail:
        "this value has no row in BsonTypeTable (undefined, a function, a raw Long/Int32/Double or a legacy type)",
    });
  }

  /**
   * The untyped runtime of `toLean`: containers are rebuilt, mutable scalars are copied.
   *
   * @param value - The hydrated value.
   * @param path - Dotted path of the value.
   * @returns The lean value.
   * @throws {CastError} With reason `type` for a value outside the table.
   */
  private static convertLean(value: unknown, path: string): unknown {
    const kind = BsonTypeTable.kindOf(value);
    switch (kind) {
      case undefined:
        return BsonTypeTable.outside(path, value);
      case "array":
        return (value as readonly unknown[]).map((item, index) =>
          BsonTypeTable.convertLean(item, BsonTypeTable.join(path, index)),
        );
      case "map":
        return Object.fromEntries(
          [...(value as ReadonlyMap<unknown, unknown>).entries()].map(([key, item]) => [
            String(key),
            BsonTypeTable.convertLean(item, BsonTypeTable.join(path, String(key))),
          ]),
        );
      case "object":
        return BsonTypeTable.mapObject(value as object, path, BsonTypeTable.convertLean);
      case "date":
        return new Date((value as Date).getTime());
      case "regex":
        return new RegExp((value as RegExp).source, (value as RegExp).flags);
      case "uuid":
        return new UUID(copyBytes(value as Binary));
      case "binary":
      case "vector":
        return new Binary(copyBytes(value as Binary), (value as Binary).sub_type);
      default:
        return value;
    }
  }

  /**
   * The untyped runtime of `toJson`.
   *
   * @param value - The hydrated or lean value.
   * @param path - Dotted path of the value.
   * @returns The JSON value.
   * @throws {CastError} With reason `json` or `type`.
   */
  private static convertJson(value: unknown, path: string): unknown {
    const kind = BsonTypeTable.kindOf(value);
    switch (kind) {
      case undefined:
        return BsonTypeTable.outside(path, value);
      case "array":
        return (value as readonly unknown[]).map((item, index) =>
          BsonTypeTable.convertJson(item, BsonTypeTable.join(path, index)),
        );
      case "map":
        return Object.fromEntries(
          [...(value as ReadonlyMap<unknown, unknown>).entries()].map(([key, item]) => [
            String(key),
            BsonTypeTable.convertJson(item, BsonTypeTable.join(path, String(key))),
          ]),
        );
      case "object":
        return BsonTypeTable.mapObject(value as object, path, BsonTypeTable.convertJson);
      default: {
        /*
         * `kindOf` picked the row from this very value, so the value has the row's hydrated type; the
         * compiler cannot correlate the union of rows with it (hence the `never` argument).
         */
        const row: BsonScalarRow<BsonScalarKey> = BsonTypeTable.scalars[kind] as BsonScalarRow<BsonScalarKey>;
        return row.toJson(value as never, path);
      }
    }
  }

  /**
   * The untyped runtime of `toPlain`.
   *
   * @param value - The hydrated or lean value.
   * @param path - Dotted path of the value.
   * @returns The plain value.
   * @throws {CastError} With reason `type` for a value outside the table.
   */
  private static convertPlain(value: unknown, path: string): unknown {
    const kind = BsonTypeTable.kindOf(value);
    switch (kind) {
      case undefined:
        /* Plain bytes are already plain (the form is idempotent, as `PlainValue` says): a detached copy. */
        return value instanceof Uint8Array ? new Uint8Array(value) : BsonTypeTable.outside(path, value);
      case "array":
        return (value as readonly unknown[]).map((item, index) =>
          BsonTypeTable.convertPlain(item, BsonTypeTable.join(path, index)),
        );
      case "map":
        return new Map(
          [...(value as ReadonlyMap<unknown, unknown>).entries()].map(([key, item]) => [
            String(key),
            BsonTypeTable.convertPlain(item, BsonTypeTable.join(path, String(key))),
          ]),
        );
      case "object":
        return BsonTypeTable.mapObject(value as object, path, BsonTypeTable.convertPlain);
      default: {
        /* As in `convertJson`: the row was picked from this very value. */
        const row: BsonScalarRow<BsonScalarKey> = BsonTypeTable.scalars[kind] as BsonScalarRow<BsonScalarKey>;
        return row.toPlain(value as never, path);
      }
    }
  }

  /**
   * Converts the own enumerable fields of an embedded document. A function-valued field is converted like any
   * other value, so it is the same `CastError` (`type`) as a function at the top level or in an array: a
   * function is never silently dropped at one depth and refused at another.
   *
   * @param value - The embedded document.
   * @param path - Dotted path of the document.
   * @param convert - The conversion applied to every field value.
   * @returns A new record with the converted fields.
   * @throws {CastError} With reason `type` for a field value outside the table (a function included).
   */
  private static mapObject(
    value: object,
    path: string,
    convert: (item: unknown, itemPath: string) => unknown,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, convert(item, BsonTypeTable.join(path, key))]),
    );
  }
}
