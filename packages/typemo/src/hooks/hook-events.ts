import type { ClientSession } from "mongodb";
import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import type { Subdocument } from "../document/collections/hydrated-types.ts";
import type { NewDocument } from "../document/document-types.ts";
import type { BulkWriteResult } from "../model/bulk-write.ts";
import type { PolicyValues } from "../policies/policy-context.ts";
import type { IdOf, Lean } from "../types/document-forms.ts";
import type { Filter } from "../types/filter.ts";
import type { Projection, Sort } from "../types/projection.ts";
import type { DeleteResult, UpdateResult } from "../types/result.ts";
import type { Update } from "../types/update.ts";

/**
 * Events of a document: `this` of the hook is the entity instance.
 *
 * Every event names its scope, so there is no ambiguity like Mongoose's `updateOne` and `deleteOne`, which are
 * document and query middleware at once, selected by `{ document, query }` flags. Each event is a step of the
 * operation pipeline; document events run around the document's own steps.
 *
 * @example
 * ```ts
 * const event: DocumentHookEvent = "document.save";
 * ```
 */
export type DocumentHookEvent =
  | "document.save"
  | "document.validate"
  | "document.init"
  | "document.updateOne"
  | "document.deleteOne";

/**
 * Events of a query: `this` of the hook is the operation context ({@link OperationHookContext}).
 *
 * @example
 * ```ts
 * const event: QueryHookEvent = "query.findOne";
 * ```
 */
export type QueryHookEvent =
  | "query.find"
  | "query.findOne"
  | "query.countDocuments"
  | "query.estimatedDocumentCount"
  | "query.distinct"
  | "query.updateOne"
  | "query.updateMany"
  | "query.replaceOne"
  | "query.deleteOne"
  | "query.deleteMany"
  | "query.findOneAndUpdate"
  | "query.findOneAndReplace"
  | "query.findOneAndDelete";

/**
 * Events of model-level writes: `this` of the hook is the operation context.
 *
 * @example
 * ```ts
 * const event: ModelHookEvent = "model.insertMany";
 * ```
 */
export type ModelHookEvent = "model.insertMany" | "model.bulkWrite";

/**
 * Every event a hook can be registered for.
 *
 * @example
 * ```ts
 * const events: HookEvent[] = ["document.save", "query.find", "aggregate"];
 * ```
 */
export type HookEvent = DocumentHookEvent | QueryHookEvent | ModelHookEvent | "aggregate";

/**
 * The events whose `this` is the operation context.
 *
 * @example
 * ```ts
 * const event: OperationHookEvent = "aggregate";
 * ```
 */
export type OperationHookEvent = Exclude<HookEvent, DocumentHookEvent>;

/**
 * When a hook runs relative to its event. `postError` runs instead of `post` when the operation failed.
 *
 * @example
 * ```ts
 * const phase: HookPhase = "pre";
 * ```
 */
export type HookPhase = "pre" | "post" | "postError";

/**
 * What a pre hook may give `skip(result)` for an event: the value the server would have given, in code names.
 * Documents are in their lean form; they go through the same post-processing as the server's (hydrated or lean as
 * the query says, `orFail`, populate). Counts and write results are plain values.
 *
 * @example
 * ```ts
 * type FindSkip = SkipResult<"query.find", User>; // readonly Lean<User>[]
 * type CountSkip = SkipResult<"query.countDocuments", User>; // number
 * ```
 */
export type SkipResult<E, T> = E extends "query.find" | "model.insertMany"
  ? readonly Lean<T>[]
  : E extends "query.findOne" | "query.findOneAndUpdate" | "query.findOneAndReplace" | "query.findOneAndDelete"
    ? Lean<T> | null
    : E extends "query.countDocuments" | "query.estimatedDocumentCount"
      ? number
      : E extends "query.distinct" | "aggregate"
        ? readonly unknown[]
        : E extends "query.updateOne" | "query.updateMany" | "query.replaceOne"
          ? UpdateResult<IdOf<T>>
          : E extends "query.deleteOne" | "query.deleteMany"
            ? DeleteResult
            : E extends "model.bulkWrite"
              ? BulkWriteResult<IdOf<T>>
              : never;

/**
 * What the post hook of one operation inside a `bulkWrite` receives: the server reports per operation only the
 * upserted `_id`, so the counts are `null` (the bulk's totals are the `model.bulkWrite` post hook's result).
 *
 * @example
 * ```ts
 * const result: BulkOperationResult = {
 *   acknowledged: true,
 *   matchedCount: null,
 *   modifiedCount: null,
 *   upsertedCount: 1,
 *   upsertedId: "a1",
 * };
 * ```
 */
export type BulkOperationResult<Id = unknown> =
  | {
      /** Whether the server acknowledged the bulk. */
      readonly acknowledged: boolean;
      /** Unknown for one operation of a bulk. */
      readonly matchedCount: null;
      /** Unknown for one operation of a bulk. */
      readonly modifiedCount: null;
      /** `1` when this operation inserted a document by its upsert, else `0`. */
      readonly upsertedCount: number;
      /** The `_id` this operation upserted, `null` when it did not insert. */
      readonly upsertedId: Id | null;
    }
  | {
      /** Whether the server acknowledged the bulk. */
      readonly acknowledged: boolean;
      /** Unknown for one operation of a bulk. */
      readonly deletedCount: null;
    };

/**
 * What a post hook receives for an event: the operation's result (a cursor batch for a cursor). A query hook of one
 * operation inside a `bulkWrite` receives a {@link BulkOperationResult} (per operation only the upserted `_id` is
 * known). The form of documents depends on the query (hydrated or lean, projected, populated), so they are
 * `unknown` here.
 *
 * @example
 * ```ts
 * type SavePost = PostResult<"document.save", User>; // User
 * type CountPost = PostResult<"query.countDocuments", User>; // number
 * ```
 */
export type PostResult<E, T> = E extends "document.save" | "document.validate" | "document.init"
  ? T
  : E extends "document.deleteOne"
    ? DeleteResult
    : E extends "query.deleteOne" | "query.deleteMany"
      ? DeleteResult | Extract<BulkOperationResult<IdOf<T>>, { readonly deletedCount: null }>
      : E extends "document.updateOne"
        ? UpdateResult<IdOf<T>>
        : E extends "query.updateOne" | "query.updateMany" | "query.replaceOne"
          ? UpdateResult<IdOf<T>> | Extract<BulkOperationResult<IdOf<T>>, { readonly matchedCount: null }>
          : E extends "query.countDocuments" | "query.estimatedDocumentCount"
            ? number
            : E extends "query.find" | "query.distinct" | "model.insertMany" | "aggregate"
              ? readonly unknown[]
              : E extends "model.bulkWrite"
                ? BulkWriteResult<IdOf<T>>
                : unknown;

/**
 * Every change a pre hook can make to an operation, in code names like the model's methods.
 * {@link OperationChange} keeps the ones that apply to an event.
 *
 * @example
 * ```ts
 * const change: OperationChanges<User> = { where: { active: true }, sort: { name: 1 } };
 * ```
 */
export interface OperationChanges<T> {
  /** A condition combined with the operation's filter by AND (the user's conditions stay; typed like `find`'s). */
  readonly where?: Filter<T>;
  /**
   * Operators merged into the operation's update: an operator it already has gets these paths too. A path the
   * update already writes with the same operator is a `QueryError` (the hook would silently replace a value).
   */
  readonly update?: Update<T>;
  /** Replaces the projection (`+field` includes a hidden field, as in `select`). */
  readonly select?: Projection<T>;
  /** Replaces the sort. */
  readonly sort?: Sort<T>;
  /**
   * Stages appended to the aggregation (in the plan form `Pipeline.from(Entity)….build()` gives). They go
   * through every step like the builder's: literals cast, `Hidden` fields removed, tenant and soft delete
   * scoping of joined models, `dbName`.
   */
  readonly stages?: readonly PipelineStage[];
}

/**
 * The keys of {@link OperationChanges} that apply to an event.
 *
 * @example
 * ```ts
 * type Keys = ChangeKeys<"query.updateOne">; // "where" | "update"
 * ```
 */
export type ChangeKeys<E> = E extends
  | "query.find"
  | "query.findOne"
  | "query.findOneAndReplace"
  | "query.findOneAndDelete"
  ? "where" | "select" | "sort"
  : E extends "query.findOneAndUpdate"
    ? "where" | "update" | "select" | "sort"
    : E extends "query.updateOne" | "query.updateMany"
      ? "where" | "update"
      : E extends
            | "query.countDocuments"
            | "query.distinct"
            | "query.replaceOne"
            | "query.deleteOne"
            | "query.deleteMany"
        ? "where"
        : E extends "aggregate"
          ? "stages"
          : never;

/**
 * What `modify` accepts for event `E`. Events without changes (`estimatedDocumentCount`, `insertMany`,
 * `bulkWrite`) accept nothing.
 *
 * @example
 * ```ts
 * const change: OperationChange<User, "query.find"> = { where: { active: true } };
 * ```
 */
export type OperationChange<T, E> = Pick<OperationChanges<T>, ChangeKeys<E>>;

/**
 * `this` of a query, model or aggregate hook (the runtime is `OperationHooks`): a view of the operation. The
 * values are in database form (pre hooks run after the encode step) and read-only; a pre hook changes the
 * operation with {@link OperationHookContext.modify}, or skips it with the result it should have.
 *
 * @example
 * ```ts
 * @Schema()
 * class User extends Entity {
 *   @Pre("query.find")
 *   audit(this: OperationHookContext<User, "query.find">): void {
 *     this.locals.set("startedAt", Date.now());
 *   }
 * }
 * ```
 */
export interface OperationHookContext<T, E extends OperationHookEvent = OperationHookEvent> {
  /** The event being run, e.g. `query.updateMany`. */
  readonly event: E;
  /** The operation (`find`, `updateMany`, `insertMany`, …). */
  readonly operation: string;
  /** The model (entity class name). */
  readonly model: string;
  /** A process-unique id of the operation (the instrumentation's `operationId`). */
  readonly operationId: number;
  /** The filter the operation sends. */
  readonly filter: Readonly<Record<string, unknown>> | undefined;
  /** The update document or update pipeline the operation sends. */
  readonly update: Readonly<Record<string, unknown>> | readonly Readonly<Record<string, unknown>>[] | undefined;
  /** The replacement document of `replaceOne` and `findOneAndReplace`. */
  readonly replacement: Readonly<Record<string, unknown>> | undefined;
  /** `insertMany`: the documents to insert. */
  readonly documents: readonly Readonly<Record<string, unknown>>[] | undefined;
  /** `bulkWrite`: the operations. */
  readonly operations: readonly Readonly<Record<string, unknown>>[] | undefined;
  /** `aggregate`: the stages. */
  readonly pipeline: readonly Readonly<Record<string, unknown>>[] | undefined;
  /** The session of the operation (explicit or the ambient transaction's). */
  readonly session: ClientSession | undefined;
  /** Whether the operation runs inside a transaction. */
  readonly inTransaction: boolean;
  /** The policy context (tenant, actor, soft delete view). */
  readonly policy: Readonly<PolicyValues>;
  /** Values shared by the pre, post and postError hooks of THIS operation (a fresh map per operation). */
  readonly locals: Map<string, unknown>;
  /**
   * The position of this operation in a `bulkWrite` when the hook runs for one operation of the bulk (a query hook
   * of an `updateOne`, … inside `Model.bulkWrite`); `undefined` for a standalone call.
   */
  readonly bulkIndex?: number | undefined;
  /**
   * Pre hooks only: the operation is not sent; `result` is what it returns (typed by the event, see
   * {@link SkipResult}). The remaining pre hooks do not run, the post hooks do (with the result).
   *
   * @param result - The result the operation should have had.
   * @throws {QueryError} When called outside a pre hook.
   */
  skip(result: SkipResult<E, T>): void;
  /**
   * Pre hooks only, at the hook's own risk: changes the operation (a condition combined with the filter,
   * operators merged into the update, a new projection or sort, stages appended to an aggregation).
   * Every policy still holds: after the hook, the changed operation goes again through normalize, path
   * resolution, cast, policies (strict, sanitize, tenant, soft delete, Hidden), defaults and validation, and the
   * audit records the final operation. The next pre hook sees the result.
   *
   * @param change - The change; only the keys that apply to the event are accepted.
   * @throws {QueryError} When called outside a pre hook, the change does not apply to the operation, or it breaks a
   * rule (it fails like the same input given to the model).
   */
  modify(change: OperationChange<T, E>): void;
  /** Phantom: the entity the operation works on. */
  readonly entity?: (value: T) => void;
}

/**
 * The root document in a document hook: the class's own fields, `Hidden` ones included (a hook runs on new
 * documents too, and hashes or checks such fields), so `HydratedDocWith<User, { password?: string }>` for a class
 * with `Hidden` fields and `HydratedDoc<User>` otherwise.
 *
 * @example
 * ```ts
 * type Root = HookDocument<User>; // HydratedDocWith<User, { password?: string }>
 * ```
 */
export type HookDocument<T> = NewDocument<T>;

/**
 * `this` of a hook for event `E` on entity `T`: for document events the hydrated document or, when the class is
 * embedded, the hydrated subdocument — a hook of a class does not know where the class is used, so only what both
 * have (`$isNew()`, `$isModified()`) is there without narrowing; the operation context for the others. The root
 * document keeps the class's `Hidden` fields ({@link HookDocument}), like the subdocument. A document hook may
 * also declare `this: User` (both are a `User`) or leave `this` implicit.
 *
 * @example
 * ```ts
 * type SaveThis = HookThis<"document.save", User>; // HydratedDoc<User> | Subdocument<User>
 * type FindThis = HookThis<"query.find", User>; // OperationHookContext<User, "query.find">
 * ```
 */
export type HookThis<E, T> = E extends DocumentHookEvent
  ? HookDocument<T> | Subdocument<T>
  : E extends OperationHookEvent
    ? OperationHookContext<T, E>
    : never;

/**
 * `this` of a hook registered for one event or a list of events (a union for a list).
 *
 * @example
 * ```ts
 * type Both = HookThisOf<readonly ["query.find", "query.findOne"], User>;
 * ```
 */
export type HookThisOf<E, T> = E extends readonly (infer U)[] ? HookThis<U, T> : HookThis<E, T>;

/**
 * The events of a hook registration (one or a list).
 *
 * @example
 * ```ts
 * type Events = EventsOf<readonly ["query.find", "aggregate"]>; // "query.find" | "aggregate"
 * ```
 */
type EventsOf<E> = E extends readonly (infer U)[] ? U : E;

/**
 * Arguments of a hook by phase: `pre` gets none, `post` receives the result ({@link PostResult}), `postError`
 * the error.
 *
 * @example
 * ```ts
 * type PostArgs = HookArgs<"post", "query.countDocuments", User>; // [result: number]
 * type ErrorArgs = HookArgs<"postError">; // [error: unknown]
 * ```
 */
export type HookArgs<P extends HookPhase, E = HookEvent, T = unknown> = P extends "pre"
  ? []
  : P extends "post"
    ? [result: PostResult<EventsOf<E>, T>]
    : [error: unknown];

/** All hook events, for runtime validation. */
export const HOOK_EVENTS: readonly HookEvent[] = Object.freeze([
  "document.save",
  "document.validate",
  "document.init",
  "document.updateOne",
  "document.deleteOne",
  "query.find",
  "query.findOne",
  "query.countDocuments",
  "query.estimatedDocumentCount",
  "query.distinct",
  "query.updateOne",
  "query.updateMany",
  "query.replaceOne",
  "query.deleteOne",
  "query.deleteMany",
  "query.findOneAndUpdate",
  "query.findOneAndReplace",
  "query.findOneAndDelete",
  "model.insertMany",
  "model.bulkWrite",
  "aggregate",
] satisfies HookEvent[]);
