import type { ClientSession } from "mongodb";
import type { IsPlainObject } from "../bson/opaque-value.ts";
import type { PolicyValues } from "../policies/policy-context.ts";
import type { ApplyMask, MaskSpecCheck } from "../query/response-mask.ts";
import type { IdOf, JsonOf, ObjectForm, ObjectFormOf, Plain, PlainJson, PlainOf } from "../types/document-forms.ts";
import type { IsHidden, IsVirtualValue, RefModel, Unbranded, VirtualRefModel } from "../types/markers.ts";
import type { WriteValue } from "../types/paths.ts";
import type {
  AnyPopulatedField,
  ApplyPopulate,
  Depopulated,
  PopulateArgument,
  PopulateArgumentEntries,
  PopulatedField,
  PopulatedKeys,
  PopulatedOriginalOf,
  PopulatedValueOf,
  PopulateObjectSpec,
  PopulatePathHint,
} from "../types/populate.ts";
import type { DefaultView } from "../types/projection.ts";
import type { DeleteResult, UpdateResult } from "../types/result.ts";
import type { DataKeys } from "../types/schema-paths.ts";
import type { Dec, Simplify } from "../types/type-utils.ts";
import type { Update, UpdateCheck } from "../types/update.ts";
import type { FieldInput, HydratedField, HydratedFields } from "./collections/hydrated-types.ts";

/*
 * The type of a hydrated document: the entity's own members with the typed collections for its data fields,
 * plus a small set of `import type { ClientSession } from "mongodb";
import type { IsPlainObject } from "../bson/opaque-value.ts";
import type { PolicyValues } from "../policies/policy-context.ts";
import type { ApplyMask, MaskSpecCheck } from "../query/response-mask.ts";
import type { IdOf, JsonOf, ObjectForm, ObjectFormOf, Plain, PlainJson, PlainOf } from "../types/document-forms.ts";
import type { IsHidden, IsVirtualValue, RefModel, Unbranded, VirtualRefModel } from "../types/markers.ts";
import type { WriteValue } from "../types/paths.ts";
import type {
  AnyPopulatedField,
  ApplyPopulate,
  Depopulated,
  PopulateArgument,
  PopulateArgumentEntries,
  PopulatedField,
  PopulatedKeys,
  PopulatedOriginalOf,
  PopulatedValueOf,
  PopulateObjectSpec,
  PopulatePathHint,
} from "../types/populate.ts";
import type { DefaultView } from "../types/projection.ts";
import type { DeleteResult, UpdateResult } from "../types/result.ts";
import type { DataKeys } from "../types/schema-paths.ts";
import type { Dec, Simplify } from "../types/type-utils.ts";
import type { Update, UpdateCheck } from "../types/update.ts";
import type { FieldInput, HydratedField, HydratedFields } from "./collections/hydrated-types.ts";

/*
 * The type of a hydrated document: the entity's own members with the typed collections for its data fields,
-methods in one interface, so the hover reads `HydratedDoc<User>` and the methods are
 * resolved only when used. A document whose fields differ from the default read (populated paths, `+hidden` fields,
 * narrowed fields) reads `HydratedDocWith<Post, { author: HydratedDoc<Person> | null }>`: the class by name and only
 * the differing fields, never the computed shape with its markers (the shape is rebuilt from these two parts). `lean()`, `$toObject()`, `$toPlain()` and `$toJSON()` are data (`Lean`, `ObjectForm`,
 * `Plain`, `PlainJson`).
 */

/**
 * Prefixes each sub-path `Sub` with the key `K`.
 *
 * @example
 * ```ts
 * type P = Join<"address", "city">; // "address.city"
 * ```
 */
type Join<K extends string, Sub> = Sub extends string ? `${K}.${Sub}` : never;

/**
 * The paths under one key `K` holding a value `V`, walked to depth `D`.
 *
 * @example
 * ```ts
 * type P = DocumentSub<"tags", string[], 4>; // "tags" | `tags.${number}`
 * ```
 */
type DocumentSub<K extends string, V, D extends number> =
  V extends ReadonlyMap<string, unknown>
    ? K | `${K}.${string}`
    : V extends readonly (infer E)[]
      ? K | DocumentSub<`${K}.${number}`, NonNullable<E>, D>
      : true extends IsPlainObject<V>
        ? K | Join<K, DocumentPaths<Extract<V, object>, Dec[D]>>
        : K;

/**
 * The paths of a document for `$set`/`$get`/`$isModified`/`$markModified`: data keys, dotted paths
 * into embedded documents, array elements by index (`tags.0`, `lines.1.qty`), Map entries
 * (`scores.math`). No positional tokens (`$`, `$[]`): a document knows its own elements.
 *
 * @example
 * ```ts
 * class User { name!: string; tags!: string[]; }
 * type P = DocumentPaths<User>; // "name" | "tags" | `tags.${number}`
 * ```
 */
export type DocumentPaths<T, D extends number = 4> = T extends unknown
  ? D extends 0
    ? never
    : { [K in DataKeys<T>]: DocumentSub<K, NonNullable<T[K]>, D> }[DataKeys<T>]
  : never;

/**
 * The declared type at a document path `P` (an index is an element, a Map key its value).
 *
 * @example
 * ```ts
 * class User { tags!: string[]; }
 * type V = DocumentValue<User, "tags.0">; // string
 * ```
 */
export type DocumentValue<T, P extends string> = WriteValue<T, P>;

/**
 * Options of `$save()` and `$deleteOne()`.
 *
 * @example
 * ```ts
 * await doc.$save({ session, timeoutMS: 5_000 });
 * ```
 */
export interface SaveOptions {
  /** An explicit session; `null` runs outside the ambient transaction; absent: the document's, else the ambient one. */
  readonly session?: ClientSession | null;
  /** Client-side operation timeout (driver CSOT). */
  readonly timeoutMS?: number;
  /**
   * Accepts that the save rewrites or replaces stored subdocuments WITHOUT their fields unknown to the
   * schema (data of another schema version): those fields are lost from the database (and removed from
   * the instances). Without it such a save is an `UnknownFieldsError` and nothing is sent.
   */
  readonly dropUnknownFields?: boolean;
  /** The policy context of this write (tenant, actor, soft delete), over the ambient scope of the save. */
  readonly policy?: PolicyValues;
}

/**
 * Options of serialization, given to each call (there are no schema-level defaults).
 *
 * @example
 * ```ts
 * const data = doc.$toObject({ getters: true, virtuals: true });
 * ```
 */
export interface SerializeOptions {
  /** Apply the fields' `get` functions (the type is unchanged: `get` maps a value to the same type). */
  readonly getters?: boolean;
  /** Include the class's getter virtuals (`Computed`, `VirtualValue`). Default `false`. */
  readonly virtuals?: boolean;
  /** Include `Hidden` fields that were loaded. Default: `true` for `$toObject()`, `false` for `$toJSON()`/`$toPlain()`. */
  readonly hidden?: boolean;
}

/**
 * Options of `$toObject()` / `$toJSON()` / `$toPlain()` that change the result (its type follows them).
 *
 * @example
 * ```ts
 * const data = doc.$toJSON({ mask: { email: "mask" } });
 * ```
 */
export interface ToObjectOptions extends SerializeOptions {
  /**
   * Masks the returned copy: keys are paths of the serialized form, values `"mask"` (→ `"?"`) or a
   * mask function (`Mask.*`). The document itself and its next `$save()` are untouched; applied before `transform`.
   */
  readonly mask?: object;
}

/**
 * The result of a serialization with its `mask` option applied.
 *
 * @example
 * ```ts
 * type R = WithMask<{ email: string }, { readonly mask: { email: "mask" } }>; // { email: "?" }
 * ```
 */
type WithMask<R, O> = O extends { readonly mask: infer M extends object } ? ApplyMask<R, M> : R;

/**
 * The check of the `mask` option against the serialized form `R` (the same check as `.mask()` of a query).
 *
 * @example
 * ```ts
 * type C = MaskOptionCheck<{ email: string }, { readonly mask: { email: "mask" } }>;
 * ```
 */
export type MaskOptionCheck<R, O> = O extends { readonly mask: infer M extends object }
  ? { readonly mask: M & MaskSpecCheck<R, M> }
  : unknown;

/**
 * The keys of `Hidden` fields.
 *
 * @example
 * ```ts
 * class User { name!: string; password!: Hidden<string>; }
 * type K = HiddenKeys<User>; // "password"
 * ```
 */
export type HiddenKeys<T> = { [K in DataKeys<T>]-?: IsHidden<T[K]> extends true ? K : never }[DataKeys<T>];

/**
 * The keys of getter virtuals (`Computed`, `VirtualValue`).
 *
 * @example
 * ```ts
 * class User { first!: string; get full(): Computed<string> { return this.first; } }
 * type K = GetterVirtualKeys<User>; // "full"
 * ```
 */
export type GetterVirtualKeys<T> = {
  [K in keyof T & string]-?: IsVirtualValue<T[K]> extends true ? K : never;
}[keyof T & string];

/**
 * The `hidden` option of a serialization call (`Default` when absent). It applies at EVERY depth
 * (subdocuments, arrays and Maps of them, populated documents), in the type as in the runtime.
 *
 * @example
 * ```ts
 * type H = HiddenOption<{ readonly hidden: false }, true>; // false
 * ```
 */
type HiddenOption<O, Default extends boolean> = O extends { readonly hidden: infer H extends boolean } ? H : Default;

/**
 * A getter virtual's value in a serialized form.
 *
 * @example
 * ```ts
 * type F = VirtualForm<Date, "json", false>; // string
 * ```
 */
type VirtualForm<V, Form, H extends boolean> = Form extends "json"
  ? JsonOf<V, H>
  : Form extends "plain"
    ? PlainOf<V, H>
    : ObjectFormOf<V, H>;

/**
 * Adds the getter virtuals to a serialized form `P` when the options ask for them (`virtuals: true`).
 *
 * @example
 * ```ts
 * type R = WithVirtuals<{ first: string }, User, { readonly virtuals: true }, "object">;
 * ```
 */
type WithVirtuals<P, T, O, Form> = O extends { readonly virtuals: true }
  ? P & {
      -readonly [K in GetterVirtualKeys<T>]: VirtualForm<
        Unbranded<T[K]>,
        Form,
        HiddenOption<O, Form extends "object" ? true : false>
      >;
    }
  : P;

/**
 * What `$toObject(options)` returns: the data (`Map` kept as `Map`, BSON values as they are), shaped by the options.
 *
 * @example
 * ```ts
 * const data: ToObjectResult<User> = doc.$toObject();
 * ```
 */
export type ToObjectResult<T, O = Record<never, never>> = WithMask<ToObjectBase<T, O>, O>;

/**
 * The `$toObject` result before the `mask` option is applied.
 *
 * @example
 * ```ts
 * type B = ToObjectBase<User, { readonly hidden: false }>;
 * ```
 */
type ToObjectBase<T, O> = WithVirtuals<ObjectForm<T, HiddenOption<O, true>>, T, O, "object">;

/**
 * What `$toJSON(options)` returns: the JSON forms, Maps as records, `Hidden` fields out by default.
 *
 * @example
 * ```ts
 * const json: ToJsonResult<User> = doc.$toJSON();
 * ```
 */
export type ToJsonResult<T, O = Record<never, never>> = WithMask<ToJsonBase<T, O>, O>;

/**
 * The `$toJSON` result before the `mask` option is applied.
 *
 * @example
 * ```ts
 * type B = ToJsonBase<User, { readonly hidden: true }>;
 * ```
 */
type ToJsonBase<T, O> = WithVirtuals<PlainJson<T, HiddenOption<O, false>>, T, O, "json">;

/**
 * What `$toPlain(options)` returns: the plain forms (ids, int64, `Decimal128`, `UUID` as strings;
 * `Date`, `RegExp`, `Map` kept; bytes as `Uint8Array`; a vector as `number[]`), `Hidden` fields out by default.
 *
 * @example
 * ```ts
 * const plain: ToPlainResult<User> = doc.$toPlain();
 * ```
 */
export type ToPlainResult<T, O = Record<never, never>> = WithMask<ToPlainBase<T, O>, O>;

/**
 * The `$toPlain` result before the `mask` option is applied.
 *
 * @example
 * ```ts
 * type B = ToPlainBase<User, { readonly hidden: true }>;
 * ```
 */
type ToPlainBase<T, O> = WithVirtuals<Plain<T, HiddenOption<O, false>>, T, O, "plain">;

/**
 * The update a save would send (code names): operators → paths → values. When the save would be refused, the
 * key `$problems` maps each problem path to the message of the error `$save()` throws.
 *
 * @example
 * ```ts
 * const changes: DocumentChanges = doc.$getChanges(); // { $set: { name: "Ann" } }
 * ```
 */
export type DocumentChanges = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/**
 * Phantom key (type only, never present at run time) carrying the entity type of a hydrated document: the forms of a
 * populated document are computed from it (its fields carry no markers, so `Hidden` is known only from the entity).
 */
export declare const HYDRATED_ENTITY: unique symbol;

/**
 * The `$`-methods of a hydrated document (the whole set; everything else on the object is the entity's).
 *
 * @example
 * ```ts
 * const user = await Users.findOne({ name: "Ann" });
 * user?.$set("name", "Bob");
 * await user?.$save();
 * ```
 */
export interface DocumentMethods<in out T, in out B = T, in out P = Record<never, never>> {
  /** Phantom (type only, never present at run time): the document shape (see {@link HYDRATED_ENTITY}). */
  readonly [HYDRATED_ENTITY]?: readonly [T];
  /** `true` until the document is inserted (a new document from `model.new()`). */
  $isNew(): boolean;
  /**
   * `true`: this is a root document, not a subdocument. In a document hook of a class that may also be embedded,
   * `this` is `HydratedDoc<T> | Subdocument<T>`, and `if (this.$isRoot())` narrows it to the root document with
   * all its methods (`$getChanges`, `$save`, …).
   *
   * @example
   * ```ts
   * @Pre("document.save")
   * audit(this: HookThis<"document.save", Line>): void {
   *   if (this.$isRoot()) console.log(this.$getChanges());
   * }
   * ```
   */
  $isRoot(): this is DocumentOf<B, P>;
  /** Free space for the application (the same object on every call), never saved. */
  $locals(): Record<string, unknown>;
  /**
   * Whether anything (or `path`, or something under it) changed since the last load or save.
   *
   * @param path - Limits the check to this path.
   */
  $isModified(path?: DocumentPaths<T>): boolean;
  /**
   * Forces `path` into the next save as a whole `$set` (a value changed where tracking cannot see it).
   *
   * @param path - The path to force.
   * @returns This document.
   */
  $markModified(path: DocumentPaths<T>): this;
  /**
   * The update the next save would send (code names), without side effects. Never throws: what `$save()` would
   * refuse (a container replaced by assignment, unknown stored fields that would be lost, …) is listed under
   * `$problems` (path → the message of the error the save throws); the rest of the update is still returned.
   */
  $getChanges(): DocumentChanges;
  /**
   * Sets the value at `path`, cast at once; containers and subdocuments become tracked.
   *
   * @param path - The path to set.
   * @param value - The new value.
   * @returns This document.
   * @throws {CastError} When the value cannot be cast to the field's type.
   */
  $set<const P extends DocumentPaths<T>>(path: P, value: FieldInput<DocumentValue<T, P>>): this;
  /**
   * The value at `path` (the field's `get` applied), `undefined` when absent.
   *
   * @param path - The path to read.
   */
  $get<const P extends DocumentPaths<T>>(path: P): HydratedField<DocumentValue<T, P>> | undefined;
  /**
   * Validates the whole document (every issue in one `ValidationError`). Values assigned directly
   * (`doc.age = …`, `doc.lines[0].qty = …`) are cast first.
   *
   * @throws {CastError} When a directly assigned value cannot be cast (the field's constraints are not checked).
   * @throws {ValidationError} When any field is invalid.
   */
  $validate(): Promise<void>;
  /**
   * Inserts (new) or updates (the changes only); nothing changed means nothing is sent.
   *
   * The `document.save` hooks (`@Pre`, `@Post`, `@PostError`) and the validation run all the same, also when
   * nothing changed: a save is an event of the document, and the hooks are free to act on more than the stored
   * fields. A hook that must act only on real changes starts with an early exit:
   *
   * @example
   * ```ts
   * @Pre("document.save")
   * touchAudit(this: HookThis<"document.save", User>): void {
   *   if (!this.$isModified()) return; // a save without changes: nothing to audit
   *   this.lastEditedAt = new Date();
   * }
   * ```
   *
   * @param options - Session, timeout and policy of the write.
   * @returns This document.
   * @throws {CastError} When a directly assigned value cannot be cast (nothing is sent).
   * @throws {ValidationError} When the document is invalid.
   * @throws {UnknownFieldsError} When the save would drop stored fields unknown to the schema.
   */
  $save(options?: SaveOptions): Promise<this>;
  /**
   * Deletes the document by `_id`.
   *
   * @param options - Session, timeout and policy of the write.
   */
  $deleteOne(options?: SaveOptions): Promise<DeleteResult>;
  /**
   * Updates THIS document by `_id` through the model's pipeline (cast, validators, policies, audit) with the
   * `document.updateOne` hooks (`this` = the document; no query hook fires). The document in memory is
   * not changed: read it again to see the result.
   *
   * @param update - The update document.
   * @param options - Session, timeout and policy of the write.
   */
  $updateOne<const U extends Update<T, true>>(
    update: U & NoInfer<UpdateCheck<T, U>>,
    options?: SaveOptions,
  ): Promise<UpdateResult<IdOf<T>>>;
  /**
   * Plain data with a final transform (its result is the result).
   *
   * @param options - Serialization options including `transform`.
   * @returns The value returned by `transform`.
   */
  $toObject<const O extends ToObjectOptions, R>(
    options: O & MaskOptionCheck<ToObjectBase<T, O>, O> & { readonly transform: (plain: ToObjectResult<T, O>) => R },
  ): R;
  /**
   * Plain data: arrays, `Map`s, plain objects; BSON values as they are.
   *
   * @param options - Serialization options.
   */
  $toObject<const O extends ToObjectOptions = Record<never, never>>(
    options?: O & MaskOptionCheck<ToObjectBase<T, O>, O>,
  ): ToObjectResult<T, O>;
  /**
   * The JSON form with a final transform (its result is the result).
   *
   * @param options - Serialization options including `transform`.
   * @returns The value returned by `transform`.
   */
  $toJSON<const O extends ToObjectOptions, R>(
    options: O & MaskOptionCheck<ToJsonBase<T, O>, O> & { readonly transform: (json: ToJsonResult<T, O>) => R },
  ): R;
  /**
   * The JSON form: ids, dates, int64 as strings, a vector as `number[]`, Maps as records.
   *
   * @param options - Serialization options.
   */
  $toJSON<const O extends ToObjectOptions = Record<never, never>>(
    options?: O & MaskOptionCheck<ToJsonBase<T, O>, O>,
  ): ToJsonResult<T, O>;
  /**
   * The plain form with a final transform (its result is the result).
   *
   * @param options - Serialization options including `transform`.
   * @returns The value returned by `transform`.
   */
  $toPlain<const O extends ToObjectOptions, R>(
    options: O & MaskOptionCheck<ToPlainBase<T, O>, O> & { readonly transform: (plain: ToPlainResult<T, O>) => R },
  ): R;
  /**
   * The plain form: the MongoDB types as strings (ids, int64, `Decimal128`, `UUID`), the native types
   * kept (`Date`, `RegExp`, `Map`), bytes as `Uint8Array`, a vector as `number[]`; `Hidden` fields out unless
   * `{ hidden: true }`. Nothing aliases the document; `JSON.stringify` of it never meets a `bigint`.
   *
   * @param options - Serialization options.
   */
  $toPlain<const O extends ToObjectOptions = Record<never, never>>(
    options?: O & MaskOptionCheck<ToPlainBase<T, O>, O>,
  ): ToPlainResult<T, O>;
  /**
   * The stored ids behind a populated path (a copy): one value for a field of the document, one per
   * subdocument for a path inside subdocuments; `undefined` when the path is not populated.
   *
   * @param path - The populated path.
   */
  $populated(path: string): unknown;
  /**
   * Puts the stored ids back in place of the populated values — of every populated field, or of those under
   * `key` — and returns the document typed accordingly (use the returned value).
   *
   * @param key - Limits the depopulation to this field.
   */
  $depopulate<const K extends DataKeys<T> = DataKeys<T>>(key?: K): DepopulatedDocument<B, P, T, K>;
  /**
   * Populates one path (checked like `query.populate(path)`), or populates with an object of options (`select`,
   * `match`, `options`, nested `populate`, `transform`, …), typed by the path's target. A path populated already
   * is populated anew: the stored ids are put back and the related documents are read again (a second populate
   * replaces the first, its `select` and nested paths included; the result is typed by the second call). A path
   * that goes on below a populated field is refused by the types: `$depopulate` that field first or populate the
   * path nested. A list of paths and populate objects (`$populate(["author", { path: "tags" }])`) populates them
   * all, typed like the list of `query.populate`.
   *
   * One signature serves the forms (not overloads): a wrong argument is ONE compiler error whose text is the
   * message (`Invalid populate path "x": …`), as for `query.populate`.
   *
   * @param arg - The path to populate, the path with its populate options, or a list of them.
   * @returns The document typed with the paths populated.
   */
  $populate<
    const Ps = never,
    const Pa extends PopulatePathHint<T> = never,
    const S = undefined,
    const O extends PopulateObjectSpec<T, Pa, S> = PopulateObjectSpec<T, Pa, S>,
    const L = never,
  >(
    arg: PopulateArgument<T, Ps, Pa, S, O, L>,
  ): Promise<
    ReshapedDocument<
      B,
      P,
      ApplyPopulate<T, PopulateArgumentEntries<Ps, Pa, O, L>, false>,
      PopulatedKeys<T, PopulateArgumentEntries<Ps, Pa, O, L>>
    >
  >;
  /**
   * Asserts that a path IS populated — by an earlier `populate()`, or as a side effect the type cannot see
   * (a hook that called `$populate`) — and returns this same document typed with the path in its populated
   * form. A `null` from a reference that found nothing counts as populated. Nothing is loaded; the runtime
   * checks only that the path holds populated values (`$populated`). The object form takes the options the
   * populate used (`select`, nested `populate`, …): they type the populated form. A list of paths and populate
   * objects (`$assertPopulated(["author", { path: "tags" }])`, the same list `$populate` takes) asserts every
   * one of them, nested paths included.
   * Use the returned value: `const book = doc.$assertPopulated("publisher")`.
   *
   * @param arg - The path expected to be populated, the path with the populate options used earlier, or a list of them.
   * @returns This document, typed with the paths populated.
   * @throws {QueryError} When a path is not populated.
   */
  $assertPopulated<
    const Ps = never,
    const Pa extends PopulatePathHint<T> = never,
    const S = undefined,
    const O extends PopulateObjectSpec<T, Pa, S> = PopulateObjectSpec<T, Pa, S>,
    const L = never,
  >(
    arg: PopulateArgument<T, Ps, Pa, S, O, L>,
  ): ReshapedDocument<
    B,
    P,
    ApplyPopulate<T, PopulateArgumentEntries<Ps, Pa, O, L>, false>,
    PopulatedKeys<T, PopulateArgumentEntries<Ps, Pa, O, L>>
  >;
  /**
   * A type guard to a discriminator class of the document's hierarchy (or the root itself) —
   * `if (event.$is(Signup)) await event.$populate("user")`. True when the document was read as that class or
   * one of its own discriminators (by its discriminator value). The narrowed document is typed as the class's
   * default read (its fields, `Hidden` ones out): a projection or populate of the base document is not carried over.
   *
   * @param cls - The discriminator class (or the root class).
   * @throws {QueryError} When the class is outside the document's hierarchy.
   */
  $is<const C extends abstract new () => object>(cls: C): this is HydratedDoc<InstanceType<C>>;
  /** The session the document was loaded in (or set), used by `$save` when none is passed. */
  $session(): ClientSession | undefined;
  /**
   * Sets (or with `null` clears) the document's session.
   *
   * @param session - The session, or `null` to clear it.
   * @returns This document.
   */
  $session(session: ClientSession | null): this;
}

/**
 * Any hydrated document, for the lists of `bulkSave`: documents of one model come in several result types
 * (a projection, the default view without `Hidden` fields, a new one), and relating each of them to
 * `HydratedDoc<T>` would instantiate the whole type (TS2589). The model checks at run time that every
 * document is its own.
 *
 * @example
 * ```ts
 * const docs: SavableDocument[] = [Users.new({ name: "Ann" }), Users.new({ name: "Bob" })];
 * await Users.bulkSave(docs);
 * ```
 */
export interface SavableDocument {
  /** `true` until the document is inserted. */
  $isNew(): boolean;
  /**
   * Inserts or updates the document.
   *
   * @param options - Session, timeout and policy of the write.
   */
  $save(options?: SaveOptions): Promise<unknown>;
}

/**
 * A field of a document shape as the hover of {@link HydratedDocWith} shows it: a populated field as the value it
 * holds (documents, read-only arrays and Maps of them, a count, transform results), any other field without its
 * markers.
 *
 * @example
 * ```ts
 * type A = ShownField<PopulatedField<HydratedDoc<User>, Ref<User>>>; // HydratedDoc<User>
 * type B = ShownField<Immutable<string>>; // string
 * ```
 */
export type ShownField<V> = V extends AnyPopulatedField ? PopulatedValueOf<V> : Unbranded<V>;

/**
 * The value a populated field holds, element by element (array elements, Map values, the value itself).
 *
 * @example
 * ```ts
 * type A = PopulatedElement<readonly HydratedDoc<User>[]>; // HydratedDoc<User>
 * ```
 */
type PopulatedElement<V> = V extends ReadonlyMap<string, infer M> ? M : V extends readonly (infer E)[] ? E : V;

/**
 * `true` when the populated values are not documents (`transform` results, a count): the serialized forms keep them
 * as they are instead of converting documents.
 *
 * @example
 * ```ts
 * type A = ShownTransformed<string[]>; // true
 * type B = ShownTransformed<HydratedDoc<User> | null>; // false
 * ```
 */
type ShownTransformed<V> = [Exclude<PopulatedElement<V>, null | undefined>] extends [never]
  ? false
  : [Exclude<PopulatedElement<V>, null | undefined>] extends [{ $populated(path: string): unknown }]
    ? false
    : true;

/**
 * `true` when `A` and `B` are mutually assignable (the same field type up to markers on `B`).
 *
 * @example
 * ```ts
 * type A = SameField<string, Immutable<string>>; // true
 * ```
 */
type SameField<A, B> = [A] extends [Unbranded<B>] ? ([Unbranded<B>] extends [A] ? true : false) : false;

/**
 * A stored field kept by a shown value `V` that is the field itself (a `+hidden` field, a field known to exist): the
 * declared type with its markers, so `Hidden`, `Immutable` and the inputs keep working; a narrowed field is `V`.
 *
 * @example
 * ```ts
 * type A = KeptField<Hidden<string> | undefined, string | undefined>; // Hidden<string> | undefined
 * type B = KeptField<"a" | "b", "a">; // "a"
 * ```
 */
type KeptField<F, V> =
  SameField<V, F> extends true ? F : SameField<V, Exclude<F, undefined>> extends true ? Exclude<F, undefined> : V;

/**
 * `true` for a stored field that populate fills: a reference (or an array of them), a Map of references, a populate
 * virtual.
 *
 * @example
 * ```ts
 * type A = IsPopulatableField<Ref<User>[]>; // true
 * type B = IsPopulatableField<string>; // false
 * ```
 */
type IsPopulatableField<F> = [RefModel<F>] extends [never]
  ? [VirtualRefModel<F>] extends [never]
    ? NonNullable<F> extends ReadonlyMap<string, infer E>
      ? [RefModel<E>] extends [never]
        ? false
        : true
      : false
    : true
  : true;

/**
 * The shape value of a populated field whose shown value is `V` and stored field `F`: the `PopulatedField` box of
 * the populated value with the stored field (the stored `null`/`undefined` stays outside the box, as populate puts it).
 *
 * @example
 * ```ts
 * type A = PopulatedBoxOf<Ref<User> | undefined, HydratedDoc<User> | null | undefined>;
 * // undefined | PopulatedField<HydratedDoc<User> | null, Ref<User>, false>
 * ```
 */
type PopulatedBoxOf<F, V> = [VirtualRefModel<F>] extends [never]
  ?
      | Extract<V, Extract<F, null | undefined>>
      | PopulatedField<
          Exclude<V, Extract<F, null | undefined>>,
          Exclude<F, null | undefined>,
          ShownTransformed<Exclude<V, Extract<F, null | undefined>>>
        >
  : PopulatedField<V, F, ShownTransformed<V>>;

/**
 * The shape value of a field listed in the second argument of {@link HydratedDocWith}: a populated reference or
 * virtual is boxed with its stored field again; the stored field itself (a `+hidden` field, a field known to exist)
 * gets its markers back; anything else (a narrowed field, an embedded document with populated paths inside, a field
 * the class does not declare) is the shown value.
 *
 * @example
 * ```ts
 * type A = ShapeField<Ref<User>, HydratedDoc<User> | null>; // PopulatedField<HydratedDoc<User> | null, Ref<User>, false>
 * type B = ShapeField<Hidden<string> | undefined, string | undefined>; // Hidden<string> | undefined
 * ```
 */
type ShapeField<F, V> = [F] extends [never]
  ? V
  : IsPopulatableField<PopulatedOriginalOf<F>> extends true
    ? [Exclude<V, null | undefined>] extends [Unbranded<Exclude<PopulatedOriginalOf<F>, null | undefined>>]
      ? KeptField<PopulatedOriginalOf<F>, V>
      : PopulatedBoxOf<PopulatedOriginalOf<F>, V>
    : KeptField<F, V>;

/**
 * The fields of `P` in the shape (see {@link ShapeField}); homomorphic, so `?` and `readonly` are those of `P`.
 *
 * @example
 * ```ts
 * type A = ShapeFields<Post, { author: HydratedDoc<User> | null }>;
 * ```
 */
type ShapeFields<T, P> = { [K in keyof P]: ShapeField<K extends keyof T ? T[K] : never, P[K]> };

/**
 * The shape of a (sub)document of `T` whose fields `P` differ from the default read of `T` (populated paths,
 * `+hidden` fields, narrowed fields): the default view of `T` without those keys, plus them. Its hover is
 * `FieldsWith<Line, { product: HydratedDoc<Product> | null }>`: an embedded document with populated paths inside.
 *
 * @typeParam T - The entity (or embedded) class.
 * @typeParam P - The differing fields, as they read.
 * @example
 * ```ts
 * type P = FieldsWith<Post, { author?: HydratedDoc<User> | null }>; // a Post shape whose author is populated
 * ```
 */
export type FieldsWith<T, P> = Omit<DefaultView<T>, keyof P> & ShapeFields<T, P>;

/**
 * The document shape behind `HydratedDocWith<T, P>`: the default view of `T` (no `Hidden` fields) when `P` is
 * empty, {@link FieldsWith} otherwise.
 *
 * @example
 * ```ts
 * type S = DocumentShape<Account, Record<never, never>>; // Account without its Hidden fields
 * ```
 */
export type DocumentShape<T, P> = [keyof P] extends [never] ? DefaultView<T> : FieldsWith<T, P>;

/**
 * The document type for the parts `T` (the class, or a projection of it) and `P` (the differing fields):
 * `HydratedDoc<T>` when nothing differs, `HydratedDocWith<T, P>` otherwise.
 *
 * @example
 * ```ts
 * type A = DocumentOf<User, Record<never, never>>; // HydratedDoc<User>
 * ```
 */
export type DocumentOf<T, P> = [keyof P] extends [never] ? HydratedDoc<T> : HydratedDocWith<T, P>;

/**
 * The differing fields `K` of a document shape `S`, as they read (see {@link ShownField}); an object type the
 * hover prints field by field (not by this name).
 *
 * @example
 * ```ts
 * type P = ShownFields<{ author: PopulatedField<HydratedDoc<User> | null, Ref<User>>; title: string }, "author">;
 * // { author: HydratedDoc<User> | null }
 * ```
 */
export type ShownFields<S, K> = Simplify<{ [Q in keyof S as Q extends K ? Q : never]: ShownField<S[Q]> }>;

/**
 * The document with parts `T`, `P` after a change of shape (populate, depopulate): the fields `K` of the new shape
 * `S` replace those of `P`.
 *
 * @example
 * ```ts
 * type D = ReshapedDocument<Post, Record<never, never>, Shape, "author">; // HydratedDocWith<Post, { author: … }>
 * ```
 */
type ReshapedDocument<T, P, S, K> = DocumentOf<T, Simplify<Omit<P, K & keyof P> & ShownFields<S, K>>>;

/**
 * The fields `K` that `$depopulate` gives back to the default read: their stored ids are what the class declares
 * (a `Hidden` field selected with `+path`, a field narrowed by a filter stay listed).
 *
 * @example
 * ```ts
 * type K = RestoredKeys<Post, { author: Ref<User> }, "author">; // "author"
 * ```
 */
type RestoredKeys<T, S, K> = {
  [Q in keyof S & K]-?: Q extends keyof T
    ? IsHidden<T[Q]> extends true
      ? never
      : SameField<ShownField<S[Q]>, T[Q]> extends true
        ? Q
        : never
    : never;
}[keyof S & K];

/**
 * The document after `$depopulate(key)`: the depopulated fields that read as the class declares them leave the
 * second argument (back to `HydratedDoc<T>` when nothing else differs).
 *
 * @example
 * ```ts
 * type D = DepopulatedDocument<Post, { author: HydratedDoc<User> | null }, Shape, "author">; // HydratedDoc<Post>
 * ```
 */
type DepopulatedDocument<T, P, S, K> = DocumentOf<
  T,
  Simplify<
    Omit<P, RestoredKeys<T, Depopulated<S, K & PropertyKey>, K>> &
      ShownFields<
        Depopulated<S, K & PropertyKey>,
        Exclude<K & keyof P, RestoredKeys<T, Depopulated<S, K & PropertyKey>, K>>
      >
  >
>;

/**
 * A hydrated document of `T` whose fields `P` differ from the default read: populated paths, `Hidden` fields added
 * with `+path`, fields narrowed by `where`. The hover names the class and lists only those fields:
 * `HydratedDocWith<Post, { author: HydratedDoc<Person> | null }>`.
 *
 * @typeParam T - The entity class (or a projection of it: `Projected<User, "_id" | "name">`, `Partial<User>`).
 * @typeParam P - The differing fields, as they read.
 * @example
 * ```ts
 * const post: HydratedDocWith<Post, { author?: HydratedDoc<User> | null }> =
 *   await Posts.findOne().populate("author").orFail();
 * ```
 */
export type HydratedDocWith<T, P> = HydratedFields<DocumentShape<T, P>> & DocumentMethods<DocumentShape<T, P>, T, P>;

/**
 * A hydrated document of `T` as a read gives it by default: the entity instance without its `Hidden` fields, with
 * typed collections, plus {@link DocumentMethods}. Reads, `new()` and `create()` give this type; a document whose
 * fields differ (populated, `+hidden`, narrowed) is a {@link HydratedDocWith}.
 *
 * @example
 * ```ts
 * const user: HydratedDoc<User> = await Users.findOne({ name: "Ann" }).orFail();
 * ```
 */
export type HydratedDoc<T> = HydratedDocWith<T, Record<never, never>>;
