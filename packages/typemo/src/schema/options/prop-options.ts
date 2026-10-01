import type { UUID } from "mongodb";
import type { PropExtensions } from "../extensions/extension-registry.ts";
import type { BsonClass, EntityClass, MapSpec, ScalarSpec, SpecValue, TypeSpec, UnionSpec } from "./type-spec.ts";

/*
 * The catalog of field options, cut down from the Mongoose option map:
 * - no legacy names (`minlength`, `msg`), no `cast`, `select` (use `hidden`), `raw`, `castNonArrays`,
 *   `encrypt`, `populate`, `auto`, `transform` (a per-field transform made the type of `toJSON` lie;
 *   transforms are typed and live in `$toObject`/`$toJSON({ transform })` only);
 * - every callback is typed by the field value (`(v: V) => V`), not `unknown`/`any`;
 * - options exist only for the spec they make sense for (`minLength` is a String option): a wrong
 *   option is a compile error at the key (`NoExtraOptions`), and a `ConfigurationError` at build time
 *   for untyped callers;
 * - `required` is an explicit option, never inferred from `?`/`!`;
 * - `nullable: true` is how the runtime learns that `null` is a value of the field (`null` is
 *   accepted only on nullable paths); the decorator checks it against `| null` in the field type,
 *   both ways.
 */

/**
 * A JSON value (the result of a `sensitive` mask function).
 *
 * @example
 * ```ts
 * const masked: SensitiveJson = { last4: "1234" };
 * ```
 */
export type SensitiveJson =
  | string
  | number
  | boolean
  | null
  | readonly SensitiveJson[]
  | { readonly [key: string]: SensitiveJson };

/**
 * The visibility of a value outside the database (field option and subscriber option `sensitive`).
 *
 * @example
 * ```ts
 * const option: SensitiveOption<string> = { mask: (value) => value.slice(-4) };
 * ```
 */
export type SensitiveOption<V> = "show" | "mask" | "hide" | { readonly mask: (value: V) => SensitiveJson };

/**
 * The context of a validator that runs on a whole document (insert, replacement, `validate()`, `save`).
 *
 * @example
 * ```ts
 * const context: DocumentValidationContext = { kind: "document", operation: "insertOne", path: "links.0.url" };
 * ```
 */
export interface DocumentValidationContext {
  /** Discriminates the context from {@link UpdateValidationContext}. */
  readonly kind: "document";
  /** The operation (`insertOne`, `insertMany`, `replaceOne`, `validate`, …). */
  readonly operation: string;
  /** The path of the value (code names, positions as numbers: `links.0.url`). */
  readonly path: string;
}

/**
 * The context of a validator that runs on a value written by an update operator: typed data about
 * the update, never `this = Query` (unlike Mongoose `updateValidators` with `context: "query"`).
 *
 * @example
 * ```ts
 * const context: UpdateValidationContext = {
 *   kind: "update", operation: "updateOne", operator: "$set", path: "name", upsert: false, filter: undefined,
 * };
 * ```
 */
export interface UpdateValidationContext {
  /** Discriminates the context from {@link DocumentValidationContext}. */
  readonly kind: "update";
  /** `updateOne`, `updateMany`, `findOneAndUpdate`, `bulkWrite`. */
  readonly operation: string;
  /** The operator that writes the value; `$min`/`$max`: the operand (the result is it or the stored value). */
  readonly operator: "$set" | "$setOnInsert" | "$min" | "$max" | "$push" | "$addToSet";
  /** The path as written in the update (code names, positional tokens kept). */
  readonly path: string;
  /** Whether the update is an upsert. */
  readonly upsert: boolean;
  /** The cast filter of the update (code names). */
  readonly filter: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Where a validator runs: the second argument of every validator.
 *
 * @example
 * ```ts
 * const isUpdate = (context: ValidationContext): boolean => context.kind === "update";
 * ```
 */
export type ValidationContext = DocumentValidationContext | UpdateValidationContext;

/**
 * A validator: `true` passes, a string is the failure message. May be async. Runs on non-null
 * values only (`null` on a nullable field and absence are the business of `required`). The second
 * argument says where it runs (a document or an update).
 *
 * @example
 * ```ts
 * const shortName: FieldValidator<string> = (value) => value.length < 50 || "name is too long";
 * ```
 */
export type FieldValidator<V> = (value: V, context: ValidationContext) => true | string | Promise<true | string>;

/**
 * Kinds of a single-field index (`true` = ascending). Geo and text have their own options.
 *
 * @example
 * ```ts
 * const kind: FieldIndexKind = -1;
 * ```
 */
export type FieldIndexKind = true | 1 | -1 | "hashed";

/**
 * Deeply readonly arrays: a `const` options object infers `readonly [...]` for array literals.
 *
 * @example
 * ```ts
 * type Tags = ReadonlyArrays<string[][]>; // readonly (readonly string[])[]
 * ```
 */
export type ReadonlyArrays<V> = V extends readonly (infer E)[] ? readonly ReadonlyArrays<E>[] : V;

/**
 * A default: a value (arrays may be readonly literals; cast into a fresh copy per document) or a factory.
 *
 * @example
 * ```ts
 * const now: DefaultOption<Date> = () => new Date();
 * ```
 */
export type DefaultOption<V> = ReadonlyArrays<V> | null | (() => V | null);

/**
 * Options every field accepts.
 *
 * @example
 * ```ts
 * const options: CommonPropOptions<string> = { required: true, index: 1, default: "n/a" };
 * ```
 */
export interface CommonPropOptions<V> {
  /**
   * The field must be present when the document is validated, and not `null` unless it is `nullable` (with
   * `nullable: true`, `null` is a value: only an absent key fails). It is never inferred from `?`. An array
   * field without `required` and without `default` starts as `[]`; with `required` it must be given.
   */
  readonly required?: boolean;
  /** `null` is a value of this field (declare the field `T | null`). */
  readonly nullable?: true;
  /**
   * Value used when the field is absent (declare the field `Defaulted<T>`; an array field may stay `T[]`, as
   * it starts as `[]` without the option anyway).
   */
  readonly default?: DefaultOption<V>;
  /** The value cannot change after the document is created (declare the field `Immutable<T>`). */
  readonly immutable?: true;
  /** Left out of query results unless selected (declare the field `Hidden<T>`; Mongoose `select: false`). */
  readonly hidden?: true;
  /**
   * How the value looks OUTSIDE the database: in the audit trail, in instrumentation events (and so in
   * traces and Sentry), in error texts. `"show"` the real value, `"mask"` `"?"`, `"hide"` the key stays and the whole value (an operator condition such as `$gt` too) becomes `[hidden]`,
   * `{ mask }` an own mask typed by the field value: it is called only with a value of that type (a value that
   * failed to cast, one element of an array field, an operand of another type are `"?"` without calling it). A
   * mark on the field wins over the subscriber's default.
   */
  readonly sensitive?: SensitiveOption<V>;
  /**
   * Options of registered extensions, by extension name: metadata for integrations, checked at compile by
   * the extension and frozen; never a way to change an operation or a policy.
   */
  readonly ext?: PropExtensions<V>;
  /** The name of the field in the database when it differs from the property name (Mongoose `alias` is the reverse). */
  readonly dbName?: string;
  /** Single-field index on this field. */
  readonly index?: FieldIndexKind;
  /** Unique index on this field (needs `required`, `sparse` or a partial index: see build checks). */
  readonly unique?: true;
  /** Makes the field-level index sparse. */
  readonly sparse?: true;
  /** Validators run after casting, in order; all failures are reported. */
  readonly validate?: FieldValidator<V> | readonly FieldValidator<V>[];
  /**
   * A getter of the value, applied where the document is READ THROUGH ITS API: `doc.$get(path)`, and the
   * serialization with `getters: true` (`$toObject({ getters: true })`, `$toJSON({ getters: true })`). A plain
   * property read (`doc.tag`) does not go through it: it returns the stored value as it is. `lean()` results and
   * the values sent to the database are not passed through it either.
   *
   * @example
   * ```ts
   * @Prop(() => String, { get: (value) => value.toUpperCase() })
   * tag!: string;
   * // doc.tag === "abc"; doc.$get("tag") === "ABC"; doc.$toObject({ getters: true }).tag === "ABC"
   * ```
   */
  readonly get?: (value: V) => V;
  /** Applied to the value when it is assigned, after casting and the built-in transforms. */
  readonly set?: (value: V) => V;
}

/**
 * Options of a `Ref<M>` field: the referenced model. Exactly one of them is given.
 *
 * @example
 * ```ts
 * const options: RefOptions = { ref: () => User };
 * ```
 */
export interface RefOptions {
  /** The model the id points to (the field must be `Ref<M>`). */
  readonly ref?: () => EntityClass;
  /**
   * A polymorphic reference (`Ref<A | B>`): a path of the SAME (sub)document holding the model's class
   * name (`"A"`/`"B"`); the model must be registered on the connection.
   */
  readonly refPath?: string;
  /**
   * A polymorphic reference chosen by a function (the dynamic form is its own option, `ref` stays
   * `() => M`): called with the (sub)document that holds the reference and the id; returns the model class.
   */
  readonly refModel?: (owner: object, id: unknown) => EntityClass;
}

/**
 * String options (also for the elements of a `[String]` array).
 *
 * @example
 * ```ts
 * const options: StringPropOptions = { trim: true, lowercase: true, maxLength: 100 };
 * ```
 */
export interface StringPropOptions {
  /** Allowed values: a list or an object whose values are allowed. */
  readonly enum?: readonly string[] | Readonly<Record<string, string>>;
  /** Converts the value to lower case on assignment. */
  readonly lowercase?: true;
  /** Converts the value to upper case on assignment. */
  readonly uppercase?: true;
  /** Trims whitespace on assignment. */
  readonly trim?: true;
  /** The value must match the pattern. */
  readonly match?: RegExp;
  /** Minimum length. */
  readonly minLength?: number;
  /** Maximum length. */
  readonly maxLength?: number;
  /** Part of the collection's text index (several `text` fields are merged into one index). */
  readonly text?: true;
}

/**
 * Number options (Number, Double, Int32).
 *
 * @example
 * ```ts
 * const options: NumberPropOptions = { min: 0, max: 150 };
 * ```
 */
export interface NumberPropOptions {
  /** Allowed values: a list or an object whose values are allowed. */
  readonly enum?: readonly number[] | Readonly<Record<string, number | string>>;
  /** Minimum value. */
  readonly min?: number;
  /** Maximum value. */
  readonly max?: number;
}

/**
 * Long options.
 *
 * @example
 * ```ts
 * const options: BigIntPropOptions = { min: 0n };
 * ```
 */
export interface BigIntPropOptions {
  /** Minimum value. */
  readonly min?: bigint;
  /** Maximum value. */
  readonly max?: bigint;
}

/**
 * Date options.
 *
 * @example
 * ```ts
 * const options: DatePropOptions = { expires: 3600 };
 * ```
 */
export interface DatePropOptions {
  /** Earliest allowed date. */
  readonly min?: Date;
  /** Latest allowed date. */
  readonly max?: Date;
  /** TTL: the document is removed this many seconds after the date (a TTL index on this field). */
  readonly expires?: number;
}

/**
 * Subdocument options.
 *
 * @example
 * ```ts
 * const options: SubdocumentPropOptions = { excludeIndexes: true };
 * ```
 */
export interface SubdocumentPropOptions {
  /** Do not build the indexes declared inside the subdocument class for this field. */
  readonly excludeIndexes?: true;
}

/** No options beyond the common ones. */
type EmptyOptions = Record<never, never>;

/**
 * Options specific to one element spec (the array field forwards them to its elements).
 *
 * @example
 * ```ts
 * type S = SpecificOptions<StringConstructor>; // StringPropOptions & RefOptions
 * ```
 */
export type SpecificOptions<S> = S extends StringConstructor
  ? StringPropOptions & RefOptions
  : S extends NumberConstructor | BsonClass<"Double"> | BsonClass<"Int32">
    ? NumberPropOptions & RefOptions
    : S extends BigIntConstructor
      ? BigIntPropOptions
      : S extends DateConstructor
        ? DatePropOptions
        : S extends BsonClass<"ObjectId"> | typeof UUID
          ? RefOptions
          : S extends readonly [infer E]
            ? SpecificOptions<E>
            : S extends MapSpec<infer V, boolean>
              ? MapValueOptions<V>
              : S extends UnionSpec
                ? EmptyOptions
                : S extends ScalarSpec
                  ? EmptyOptions
                  : S extends EntityClass
                    ? SubdocumentPropOptions
                    : EmptyOptions;

/**
 * A Map of references (`Map<string, Ref<M>>`, populate `map.$*`) takes the reference options for its values.
 *
 * @example
 * ```ts
 * type M = MapValueOptions<StringConstructor>; // RefOptions
 * ```
 */
type MapValueOptions<V> = V extends StringConstructor | NumberConstructor | BsonClass<"ObjectId"> | typeof UUID
  ? RefOptions
  : EmptyOptions;

/**
 * Every option a field of spec `S` accepts.
 *
 * @example
 * ```ts
 * const options: PropOptions<StringConstructor> = { required: true, trim: true };
 * ```
 */
export type PropOptions<S extends TypeSpec> = CommonPropOptions<SpecValue<S>> & SpecificOptions<S>;

/**
 * The names of every option of the catalog (runtime checks and the JSON of snapshots use it).
 *
 * @example
 * ```ts
 * const name: PropOptionName = "minLength";
 * ```
 */
export type PropOptionName =
  | keyof CommonPropOptions<unknown>
  | keyof RefOptions
  | keyof StringPropOptions
  | keyof NumberPropOptions
  | keyof DatePropOptions
  | keyof SubdocumentPropOptions;

/**
 * Makes an option that the spec does not accept a compile error at its key, with a readable message
 * (a generic constraint alone does no excess-property check).
 *
 * @example
 * ```ts
 * type Checked = NoExtraOptions<{ trim: true; min: 1 }, StringPropOptions>; // `min` becomes an error string
 * ```
 */
export type NoExtraOptions<O, Allowed> = {
  readonly [K in keyof O]: K extends keyof Allowed
    ? K extends "ext"
      ? NoExtraExtensions<O[K], NonNullable<Allowed[K]>>
      : O[K]
    : `"${K & string}" is not an option of this field type`;
};

/**
 * An `ext` key no extension declared is a compile error at the key (the const options object is not excess-checked).
 *
 * @example
 * ```ts
 * type Checked = NoExtraExtensions<{ unknown: 1 }, PropExtensions<string>>; // an error string at `unknown`
 * ```
 */
export type NoExtraExtensions<E, Allowed> = {
  readonly [K in keyof E]: K extends keyof Allowed
    ? E[K]
    : `"${K & string}" is not a registered extension (PropExtensions)`;
};

/**
 * The options object as the runtime sees it (untyped callers, plugins): every option, values unknown.
 *
 * @example
 * ```ts
 * const options: AnyPropOptions = { required: true, minLength: 3 };
 * ```
 */
export type AnyPropOptions = { readonly [K in PropOptionName]?: unknown };
