import type { GetterVirtualKeys } from "../document/document-types.ts";
import type { IdOf, JsonOf, Lean, Plain, PlainJson, PlainOf } from "./document-forms.ts";
import type { IsVirtualRef, Unbranded } from "./markers.ts";
import type { DataKeys } from "./schema-paths.ts";
import type { Simplify } from "./type-utils.ts";

/*
 * Hand-written contracts of query results. One contract per form of the data:
 * - `Selected<Entity, Fields, Overrides>` — the PLAIN form (what `.plain()` and `$toPlain()` return: ids and
 *   int64 as strings, `Date` kept, a Map as a `Map`);
 * - `SelectedLean<…>` — the LEAN form (what `.lean()` returns: ids as `ObjectId`, int64 as `bigint`, a Map as a record);
 * - `SelectedJson<…>` — the JSON form (what `$toJSON()` returns: ids, dates, int64 as strings, a Map as a record).
 * All go through the ONE BSON↔TS table of the document forms (`Plain`, `Lean`, `PlainJson`, …).
 * - `_id` is `IdOf<Entity>` in its form, included by default, left out by `"-_id"` among the fields
 *   (the projection `{ _id: 0 }`);
 * - `Fields` are data keys only; a populate virtual (`VirtualRef`) is part of the form only when populated,
 *   so it is accepted only with its override; getter virtuals (`Computed`, `VirtualValue`) are part of the
 *   serialized forms with `{ virtuals: true }` only (`Selected`, `SelectedJson`);
 * - an override key must be one of the fields (a typo is an error, not a silent extra field);
 * - an EXTRA field in a result is caught by the exact contract check (`.expect<Shape>()`, `Contract.check`),
 *   not by an assignment (TypeScript lets an assignment drop extra fields).
 */

/**
 * The keys of the populate virtuals (`VirtualRef`) of `E`.
 *
 * @typeParam E - The entity type.
 * @example
 * type A = VirtualRefKeys<{ name: string; author: VirtualRef<User> }>; // "author"
 */
type VirtualRefKeys<E> = { [K in keyof E & string]-?: IsVirtualRef<E[K]> extends true ? K : never }[keyof E & string];

/**
 * The fields a {@link SelectedLean} contract may name: the data fields of `E` (not `_id`, which is included by
 * default), the populate virtuals (with an override: they exist only when populated) and `"-_id"` (leave `_id` out).
 *
 * @typeParam E - The entity type.
 * @example
 * type F = SelectedLeanFields<{ _id: ObjectId; name: string; age: number }>; // "name" | "age" | "-_id"
 */
export type SelectedLeanFields<E> = Exclude<DataKeys<E>, "_id"> | VirtualRefKeys<E> | "-_id";

/**
 * The fields a {@link Selected} contract may name: {@link SelectedLeanFields} plus the getter virtuals
 * (`$toPlain({ virtuals: true })`).
 *
 * @typeParam E - The entity type.
 * @example
 * type F = SelectedFields<User>; // data keys | populate virtuals | "-_id" | getter virtuals
 */
export type SelectedFields<E> = SelectedLeanFields<E> | GetterVirtualKeys<E>;

/**
 * The fields a {@link SelectedJson} contract may name: as {@link SelectedFields} (`$toJSON({ virtuals: true })`).
 *
 * @typeParam E - The entity type.
 * @example
 * type F = SelectedJsonFields<User>; // the same union as SelectedFields<User>
 */
export type SelectedJsonFields<E> = SelectedFields<E>;

/**
 * A readable error of a contract type argument (a required member whose name is the message).
 *
 * @typeParam Message - The message text.
 * @example
 * type E = ContractArgumentError<"bad override">; // { readonly "contract error": "bad override" }
 */
export interface ContractArgumentError<Message extends string> {
  /** The error message. */
  readonly "contract error": Message;
}

/**
 * The constraint of the overrides of a contract: every key is one of `Fields` (and not `"-_id"`). (A populate
 * virtual among `Fields` without an override is typed as a {@link ContractArgumentError} in the contract itself:
 * unpopulated, a virtual is not in the result, and a default type argument cannot require it.)
 *
 * @typeParam F - The selected fields.
 * @typeParam O - The overrides record.
 * @example
 * type A = SelectedOverrides<"name", { name: string }>; // { readonly name: unknown }
 * type B = SelectedOverrides<"name", { nmae: string }>; // { readonly nmae: ContractArgumentError<...> }
 */
export type SelectedOverrides<F, O> = {
  readonly [K in keyof O]: K extends Exclude<F, "-_id">
    ? unknown
    : ContractArgumentError<`the override "${K & string}" is not one of the selected fields`>;
};

/**
 * A populate virtual among the fields without an override: a readable error in place of the field.
 *
 * @typeParam E - The entity type.
 * @typeParam F - The selected fields.
 * @typeParam O - The overrides record.
 * @example
 * type A = VirtualWithoutOverride<Post, "author", {}>; // { author: ContractArgumentError<...> }
 */
type VirtualWithoutOverride<E, F, O> = {
  -readonly [K in Exclude<
    Extract<F, VirtualRefKeys<E>>,
    keyof O
  >]: ContractArgumentError<`"${K}" is a populate virtual: give its populated form in Overrides`>;
};

/**
 * The form of a contract.
 *
 * @example
 * const f: ContractForm = "lean";
 */
type ContractForm = "plain" | "lean" | "json";

/**
 * The `_id` member of a contract in the given form: absent when `"-_id"` is selected or the entity has no id.
 *
 * @typeParam E - The entity type.
 * @typeParam F - The selected fields.
 * @typeParam Form - The contract form.
 * @example
 * type A = IdPart<{ _id: ObjectId }, "name", "plain">; // { _id: string }
 * type B = IdPart<{ _id: ObjectId }, "-_id", "plain">; // unknown
 */
type IdPart<E, F, Form extends ContractForm> = "-_id" extends F
  ? unknown
  : [IdOf<E>] extends [never]
    ? unknown
    : { _id: Form extends "json" ? JsonOf<IdOf<E>> : Form extends "plain" ? PlainOf<IdOf<E>> : IdOf<E> };

/**
 * The overridden fields: the entity's optionality kept for data fields; a populated virtual is always there.
 *
 * @typeParam E - The entity type.
 * @typeParam O - The overrides record.
 * @example
 * type A = OverridePart<{ author?: string }, { author: { name: string } }>; // { author?: { name: string } }
 */
type OverridePart<E, O> = {
  -readonly [K in keyof Pick<E, Extract<keyof O, DataKeys<E>>>]: O[K & keyof O];
} & { -readonly [K in Exclude<keyof O, DataKeys<E>>]: O[K] };

/**
 * The selected data fields that are taken from the entity as they are (not overridden).
 *
 * @typeParam E - The entity type.
 * @typeParam F - The selected fields.
 * @typeParam O - The overrides record.
 * @example
 * type A = Chosen<{ a: 1; b: 2 }, "a" | "b", { b: 3 }>; // "a"
 */
type Chosen<E, F, O> = Exclude<Extract<F, DataKeys<E>>, keyof O>;

/**
 * The chosen getter virtuals (not overridden), in a serialized form.
 *
 * @typeParam E - The entity type.
 * @typeParam F - The selected fields.
 * @typeParam O - The overrides record.
 * @typeParam Form - The contract form.
 * @example
 * type A = VirtualPart<{ full: Computed<string> }, "full", {}, "json">; // { full: string }
 */
type VirtualPart<E, F, O, Form extends ContractForm> = {
  -readonly [K in Exclude<Extract<F, GetterVirtualKeys<E>>, keyof O>]: Form extends "json"
    ? JsonOf<Unbranded<E[K & keyof E]>>
    : PlainOf<Unbranded<E[K & keyof E]>>;
};

/**
 * A contract of the PLAIN form of `Entity` with the fields `Fields`: `_id` (`IdOf<Entity>` in its
 * plain form — a string for an `ObjectId` — left out by `"-_id"` among the fields), each field as `.plain()` and
 * `$toPlain()` return it (ids, int64, `Decimal128`, `UUID` as strings; `Date`, `RegExp` kept; bytes as `Uint8Array`;
 * a vector as `number[]`; a Map as a `Map`; optional fields stay optional), getter virtuals among the fields
 * (`$toPlain({ virtuals: true })`), and `Overrides` in place of fields that are further populated — nested by recursion
 * (`{ author: Selected<User, "name"> }`, arrays `Selected<…>[]`, `| null`).
 *
 * Compare a query with it exactly (missing, extra and mismatched fields are errors): `.plain().expect<Shape>()`, or a
 * value: `Contract.check<Shape>()(doc.$toPlain())`.
 *
 * @example
 * type PostCard = Selected<Post, "title" | "author", { author: Selected<User, "name" | "-_id"> }>;
 * const cards = await Posts.find().select({ title: 1, author: 1 })
 *   .populate({ path: "author", select: { name: 1, _id: 0 } }).plain().expect<PostCard>();
 *
 * @typeParam Entity - The entity type.
 * @typeParam Fields - The selected fields.
 * @typeParam Overrides - The populated forms of virtual or nested fields.
 */
export type Selected<
  Entity,
  Fields extends SelectedFields<Entity>,
  Overrides extends SelectedOverrides<Fields, Overrides> = Record<never, never>,
> = Simplify<
  IdPart<Entity, Fields, "plain"> &
    Plain<Pick<Entity, Chosen<Entity, Fields, Overrides>>> &
    VirtualPart<Entity, Fields, Overrides, "plain"> &
    OverridePart<Entity, Overrides> &
    VirtualWithoutOverride<Entity, Fields, Overrides>
>;

/**
 * A contract of the LEAN form of `Entity`: as {@link Selected}, but every
 * value as `lean()` returns it (`ObjectId`, `bigint`, `Date`, a Map as a record, …); no getter virtuals (a lean row has
 * none). Nested contracts in `Overrides` are `SelectedLean` too. Compare with `.lean().expect<Shape>()`.
 *
 * @typeParam Entity - The entity type.
 * @typeParam Fields - The selected fields.
 * @typeParam Overrides - The populated forms of virtual or nested fields.
 * @example
 * type UserRow = SelectedLean<User, "name" | "-_id">; // { name: string }
 */
export type SelectedLean<
  Entity,
  Fields extends SelectedLeanFields<Entity>,
  Overrides extends SelectedOverrides<Fields, Overrides> = Record<never, never>,
> = Simplify<
  IdPart<Entity, Fields, "lean"> &
    Lean<Pick<Entity, Chosen<Entity, Fields, Overrides>>> &
    OverridePart<Entity, Overrides> &
    VirtualWithoutOverride<Entity, Fields, Overrides>
>;

/**
 * A contract of the `toJSON` form of `Entity`: as {@link Selected}, but every value in its JSON form
 * (`JsonOf`: ids, dates, int64, `Decimal128` as strings, a vector as `number[]`, a Map as a record, …). Nested
 * contracts in `Overrides` are `SelectedJson` too.
 *
 * Check a value exactly: `Contract.check<UserJson>()(doc.$toJSON())`.
 *
 * @typeParam Entity - The entity type.
 * @typeParam Fields - The selected fields.
 * @typeParam Overrides - The populated forms of virtual or nested fields.
 * @example
 * type UserJson = SelectedJson<User, "name">; // { _id: string; name: string }
 */
export type SelectedJson<
  Entity,
  Fields extends SelectedJsonFields<Entity>,
  Overrides extends SelectedOverrides<Fields, Overrides> = Record<never, never>,
> = Simplify<
  IdPart<Entity, Fields, "json"> &
    PlainJson<Pick<Entity, Chosen<Entity, Fields, Overrides>>> &
    VirtualPart<Entity, Fields, Overrides, "json"> &
    OverridePart<Entity, Overrides> &
    VirtualWithoutOverride<Entity, Fields, Overrides>
>;
