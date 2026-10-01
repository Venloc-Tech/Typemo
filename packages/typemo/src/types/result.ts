import type { Binary, Timestamp } from "mongodb";
import type { ToPlainResult } from "../document/document-types.ts";
import type { DiscriminatorsKey, DiscriminatorsOf } from "./markers.ts";
import type { ApplyNarrow } from "./narrow.ts";
import type { ApplyPopulate, HydratedResult, LeanBase, PopulationEntry } from "./populate.ts";
import type { ApplyProjection } from "./projection.ts";
import type { Simplify } from "./type-utils.ts";

/*
 * The result automaton: the type of a result follows the whole chain — projection, populate, lean,
 * orFail, narrowing.
 *
 *   entity T ── ApplyProjection<T, S> ──┬─ lean: LeanBase (lean FIRST) ── ApplyPopulate(…, true) ─┐
 *                                       └─ hydrated: ─────────────────── ApplyPopulate(…, false) ─┴─ ApplyNarrow
 *
 * A hydrated result is `HydratedDoc<Entity>`, or `HydratedDocWith<Entity, { …the fields that differ }>` (typed
 * collections and `$`-methods; see `HydratedResult`). A plain
 * result (`.plain()`) is the plain form of that same shape — exactly what `$toPlain()` of the hydrated
 * document returns (`ToPlainResult`), with its `Hidden` fields only for `.plain({ hidden: true })`.
 *
 * Then `Many ? Doc[] : Found ? Doc : Doc | null`.
 */

/**
 * The form of a query's documents: hydrated (`false`), lean (`true`, `.lean()`), plain (`.plain()`;
 * `"plain+hidden"` for `.plain({ hidden: true })`).
 *
 * @example
 * const hydrated: ReadForm = false;
 * const plain: ReadForm = "plain";
 */
export type ReadForm = boolean | "plain" | "plain+hidden";

/**
 * The documents a read of the model of `T` returns: `T` itself, or — for a base that lists its discriminators
 * (`declare readonly __t?: Discriminators<A | B>`) — the union of the base without a key and every listed class.
 * The base member's key is absent (`?: undefined`), each class's is its literal, so a check of the key narrows the
 * union.
 *
 * @typeParam T - The entity type.
 * @example
 * type A = ReadShape<Payment>; // (Omit<Payment, "__t"> & { readonly __t?: undefined }) | Card | Transfer
 * type B = ReadShape<User>; // User
 */
export type ReadShape<T> = BaseOf<T> | DiscriminatorsOf<T[DiscriminatorsKey<T> & keyof T]>;

/**
 * The base member of a discriminated read: `T` without its key, the key absent (`?: undefined`, kept in every form);
 * `T` itself for any other entity. Used as a type ARGUMENT (never a condition at the top of {@link ResultDoc}), so a
 * query of a generic `T` stays cheap: `await` does not unfold the condition (TS2589).
 *
 * @typeParam T - The entity type.
 * @example
 * type A = BaseOf<Payment>; // Omit<Payment, "__t"> & { readonly __t?: undefined }
 * type B = BaseOf<User>; // User
 */
type BaseOf<T> = [DiscriminatorsKey<T>] extends [never]
  ? T
  : Omit<T, DiscriminatorsKey<T>> & { readonly [P in DiscriminatorsKey<T>]?: undefined };

/**
 * One result document: projection `S`, populate `E`, its form, narrowing `N`/`X`; for a base that lists its
 * discriminators, the union of its {@link ReadShape} members, each shaped on its own.
 *
 * @typeParam T - The entity type.
 * @typeParam S - The projection.
 * @typeParam E - The populate entries.
 * @typeParam Form - The read form.
 * @typeParam N - The narrowing state.
 * @typeParam X - The fields known to exist.
 * @example
 * type Doc = ResultDoc<User, undefined, never, true, {}, never>; // the lean `User`
 */
export type ResultDoc<T, S, E extends PopulationEntry, Form extends ReadForm, N, X extends string> =
  | ShapedDoc<BaseOf<T>, S, E, Form, N, X>
  | ChildDocs<DiscriminatorsOf<T[DiscriminatorsKey<T> & keyof T]>, S, E, Form, N, X>;

/**
 * The result documents of the listed discriminator classes, each shaped on its own (`never` for none).
 *
 * @typeParam C - The discriminator classes.
 * @typeParam S - The projection.
 * @typeParam E - The populate entries.
 * @typeParam Form - The read form.
 * @typeParam N - The narrowing state.
 * @typeParam X - The fields known to exist.
 * @example
 * type Docs = ChildDocs<Card | Transfer, undefined, never, true, {}, never>; // lean Card | lean Transfer
 */
type ChildDocs<C, S, E extends PopulationEntry, Form extends ReadForm, N, X extends string> = C extends unknown
  ? ShapedDoc<C, S, E, Form, N, X>
  : never;

/**
 * One result document of one entity type (see {@link ResultDoc}).
 *
 * @typeParam T - The entity type.
 * @typeParam S - The projection.
 * @typeParam E - The populate entries.
 * @typeParam Form - The read form.
 * @typeParam N - The narrowing state.
 * @typeParam X - The fields known to exist.
 * @example
 * type Doc = ShapedDoc<User, undefined, never, true, {}, never>; // the lean `User`
 */
type ShapedDoc<T, S, E extends PopulationEntry, Form extends ReadForm, N, X extends string> = Form extends true
  ? ApplyNarrow<ApplyPopulate<LeanBase<ApplyProjection<T, S>, E>, E, true>, N, X>
  : Form extends false
    ? HydratedResult<T, S, E, N, X>
    : Simplify<
        ToPlainResult<
          ApplyNarrow<ApplyPopulate<ApplyProjection<T, S>, E, false>, N, X>,
          { readonly hidden: Form extends "plain+hidden" ? true : false }
        >
      >;

/**
 * What a query resolves to: a list, one document, or one document or `null` (no `orFail`).
 *
 * @typeParam Many - Whether the query returns a list.
 * @typeParam Found - Whether a missing document is an error (`orFail`).
 * @typeParam Doc - The result document type.
 * @example
 * type A = QueryResult<true, false, User>; // User[]
 * type B = QueryResult<false, true, User>; // User
 * type C = QueryResult<false, false, User>; // User | null
 */
export type QueryResult<Many extends boolean, Found extends boolean, Doc> = Many extends true
  ? Doc[]
  : Found extends true
    ? Doc
    : Doc | null;

/**
 * The server's answer to `explain` (its shape depends on the server version and verbosity).
 *
 * @example
 * const plan: ExplainResult = await User.find().explain();
 */
export type ExplainResult = Readonly<Record<string, unknown>>;

/**
 * Verbosity of `explain()`.
 *
 * @example
 * const v: ExplainVerbosity = "executionStats";
 */
export type ExplainVerbosity = "queryPlanner" | "executionStats" | "allPlansExecution";

/**
 * The result of `updateOne`/`updateMany`/`replaceOne` (driver `UpdateResult`, `upsertedId` typed by `_id`).
 *
 * @typeParam Id - The type of the entity's `_id`.
 * @example
 * const r: UpdateResult<ObjectId> = await User.updateOne({ name: "a" }, { $set: { age: 1 } });
 * r.modifiedCount; // number
 */
export interface UpdateResult<Id> {
  /** Whether the server acknowledged the write. */
  readonly acknowledged: boolean;
  /** How many documents matched the filter. */
  readonly matchedCount: number;
  /** How many documents were changed. */
  readonly modifiedCount: number;
  /** How many documents were inserted by an upsert. */
  readonly upsertedCount: number;
  /** The `_id` of the upserted document, or `null` when nothing was upserted. */
  readonly upsertedId: Id | null;
}

/**
 * The result of `deleteOne`/`deleteMany`.
 *
 * @example
 * const r: DeleteResult = await User.deleteMany({ banned: true });
 * r.deletedCount; // number
 */
export interface DeleteResult {
  /** Whether the server acknowledged the write. */
  readonly acknowledged: boolean;
  /** How many documents were deleted. */
  readonly deletedCount: number;
}

/**
 * The raw result of a find-and-modify with `includeResultMetadata()` (driver `ModifyResult`):
 * `lastErrorObject.upserted` is typed by the entity's `_id`, not hardcoded to `ObjectId`.
 *
 * @typeParam Doc - The document type.
 * @typeParam Id - The type of the entity's `_id`.
 * @example
 * type R = ModifyResult<User, ObjectId>; // { value: User | null; lastErrorObject?: {...}; ok: 0 | 1; ... }
 */
export interface ModifyResult<Doc, Id> {
  /** The document (before or after the change, by the `new` option), or `null` when none matched. */
  readonly value: Doc | null;
  /** Details of the write. */
  readonly lastErrorObject?: {
    /** How many documents were affected. */
    readonly n: number;
    /** Whether an existing document was updated. */
    readonly updatedExisting?: boolean;
    /** The `_id` of the upserted document. */
    readonly upserted?: Id;
  };
  /** The command status. */
  readonly ok: 0 | 1;
  /** Replica sets and sharded clusters: the operation time of the command (found by the shape test). */
  readonly operationTime?: Timestamp;
  /** Replica sets and sharded clusters: the gossiped cluster time. */
  readonly $clusterTime?: {
    readonly clusterTime: Timestamp;
    readonly signature: { readonly hash: Binary; readonly keyId: bigint };
  };
}
