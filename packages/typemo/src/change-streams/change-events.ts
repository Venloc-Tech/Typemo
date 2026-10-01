import type { ResumeToken, Timestamp } from "mongodb";
import type { VisibleDoc } from "../aggregate/types/doc-shape.ts";
import type { DocumentOf, ShownFields } from "../document/document-types.ts";
import type { IdOf } from "../types/document-forms.ts";
import type { DefaultView, KeptHiddenKeys } from "../types/projection.ts";

/**
 * `fullDocument` of the stream (server option).
 *
 * Change events are typed per operation type: the documents in them are in the form the options ask for (lean by
 * default, hydrated with `hydrate: true`), always in code names and without `Hidden` fields, like `find()`.
 * Whether `fullDocument` and `fullDocumentBeforeChange` are present (and may be `null`) follows the stream
 * options, so the compiler knows it.
 *
 * @example
 * ```ts
 * const option: FullDocumentOption = "updateLookup";
 * ```
 */
export type FullDocumentOption = "default" | "updateLookup" | "whenAvailable" | "required";
/**
 * `fullDocumentBeforeChange` of the stream (server option; needs `changeStreamPreAndPostImages`).
 *
 * @example
 * ```ts
 * const option: FullDocumentBeforeChangeOption = "whenAvailable";
 * ```
 */
export type FullDocumentBeforeChangeOption = "off" | "whenAvailable" | "required";

/**
 * Options of `Model.watch`.
 *
 * @typeParam Include - The model's `Hidden` paths, which `include` may name.
 *
 * @example
 * ```ts
 * const options: ModelWatchOptions = { fullDocument: "updateLookup", hydrate: true };
 * ```
 */
export interface ModelWatchOptions<Include extends string = string> {
  /**
   * `Hidden` paths kept in the event documents (`fullDocument`, `fullDocumentBeforeChange`, the update
   * description), like `+field` of `find()` and `include` of an aggregation; every other hidden path is removed on
   * the server. A path that is not a hidden path of the model is an error.
   */
  readonly include?: readonly Include[];
  /** The post-image of updates (`"updateLookup"`: the current document, read when the event is sent). */
  readonly fullDocument?: FullDocumentOption;
  /** The pre-image of updates, replaces and deletes (the collection needs `changeStreamPreAndPostImages`). */
  readonly fullDocumentBeforeChange?: FullDocumentBeforeChangeOption;
  /** Documents as hydrated documents (entity instances) instead of plain objects. */
  readonly hydrate?: boolean;
  /** Resume after this event (its `_id`, `stream.resumeToken`). Not after an `invalidate`: use `startAfter`. */
  readonly resumeAfter?: ResumeToken;
  /** Start after this event, also after an `invalidate`. */
  readonly startAfter?: ResumeToken;
  /** Start at this cluster time. */
  readonly startAtOperationTime?: Timestamp;
  /** How long the server waits for new events per round trip, in ms: a positive integer (`0` is a `QueryError`). */
  readonly maxAwaitTimeMS?: number;
  /** Events per batch: a positive integer (`0` is a `QueryError`: the driver would read it as the default). */
  readonly batchSize?: number;
  /** DDL events too (`create`, `createIndexes`, `modify` and so on: `CollectionEvent`). */
  readonly showExpandedEvents?: boolean;
}

/**
 * The document form of the events for options `O`: what `find()` (or `find().lean()`) returns. It equals the
 * result type of a query (a type test checks it) but is written with the non-identity steps only (the default
 * hidden projection; no populate, no narrowing), which keeps the number of nested instantiations low inside
 * `Awaited<Promise<ModelChangeStream<...>>>`.
 *
 * @example
 * ```ts
 * type Doc = EventDoc<User, { hydrate: true }>; // HydratedDoc<User>: without Hidden fields
 * ```
 */
export type EventDoc<T, O> = O extends { readonly hydrate: true }
  ? DocumentOf<T, ShownFields<DefaultView<T, IncludedOf<O>>, KeptHiddenKeys<O, DefaultView<T, IncludedOf<O>>>>>
  : VisibleDoc<T, IncludedOf<O>>;

/**
 * The hidden paths an options object includes, `never` without `include`.
 *
 * @example
 * ```ts
 * type Paths = IncludedOf<{ include: readonly ["password"] }>; // "password"
 * ```
 */
export type IncludedOf<O> = O extends { readonly include: readonly (infer P extends string)[] } ? P : never;

/**
 * The post-image of an update under options `O`: `D` for `"required"`; `D | null` for `"updateLookup"` and
 * `"whenAvailable"` (the document may be gone, or have no post-image); otherwise `undefined` (not asked for).
 *
 * @example
 * ```ts
 * type Image = PostImage<User, { fullDocument: "updateLookup" }>; // User | null
 * ```
 */
export type PostImage<D, O> = O extends { readonly fullDocument: "required" }
  ? D
  : O extends { readonly fullDocument: "updateLookup" | "whenAvailable" }
    ? D | null
    : undefined;

/**
 * The pre-image (`fullDocumentBeforeChange`) under options `O`, like {@link PostImage}.
 *
 * @example
 * ```ts
 * type Image = PreImage<User, { fullDocumentBeforeChange: "required" }>; // User
 * ```
 */
export type PreImage<D, O> = O extends { readonly fullDocumentBeforeChange: "required" }
  ? D
  : O extends { readonly fullDocumentBeforeChange: "whenAvailable" }
    ? D | null
    : undefined;

/**
 * Fields of every event.
 *
 * @example
 * ```ts
 * const describe = (event: ChangeEventBase): string => `${event.ns.db}.${event.ns.coll}`;
 * ```
 */
export interface ChangeEventBase {
  /** The resume token of this event. */
  readonly _id: ResumeToken;
  /** The cluster time of the change. */
  readonly clusterTime?: Timestamp;
  /** The wall clock time of the change on the server. */
  readonly wallTime?: Date;
  /** The database and collection the event belongs to. */
  readonly ns: { readonly db: string; readonly coll?: string };
  /** Set for an event of a transaction. */
  readonly txnNumber?: unknown;
  /** The logical session id of the transaction. */
  readonly lsid?: unknown;
}

/**
 * What an update changed: paths in code names (dotted, array positions included), hidden paths removed.
 *
 * @example
 * ```ts
 * const description: UpdateDescription = { updatedFields: { "profile.name": "Ann" }, removedFields: [] };
 * ```
 */
export interface UpdateDescription {
  /** The changed paths with their new values. */
  readonly updatedFields: Readonly<Record<string, unknown>>;
  /** The paths that were removed. */
  readonly removedFields: readonly string[];
  /** Arrays that were truncated, with their new size. */
  readonly truncatedArrays?: readonly { readonly field: string; readonly newSize: number }[];
  /** Path segments that were ambiguous (a field name that is also a number), spelled out. */
  readonly disambiguatedPaths?: Readonly<Record<string, readonly (string | number)[]>>;
}

/*
 * The events are interfaces, so their property types are resolved when read: intersections of conditional types
 * here would put `Awaited<Promise<ModelChangeStream<ChangeEvent<T>>>>` over the instantiation depth (TS2589).
 * The keys of the images are always present on a converted event (`undefined` when not asked for).
 */

/**
 * An inserted document.
 *
 * @example
 * ```ts
 * const onInsert = (event: InsertEvent<User>): string => String(event.documentKey._id);
 * ```
 */
export interface InsertEvent<in out T, in out O = Record<never, never>> extends ChangeEventBase {
  /** The operation type. */
  readonly operationType: "insert";
  /** The `_id` of the inserted document. */
  readonly documentKey: { readonly _id: IdOf<T> };
  /** The inserted document. */
  readonly fullDocument: EventDoc<T, O>;
}

/**
 * An update (`$set`, `$inc` and so on, or a pipeline update).
 *
 * @example
 * ```ts
 * const onUpdate = (event: UpdateEvent<User>): unknown => event.updateDescription.updatedFields;
 * ```
 */
export interface UpdateEvent<in out T, in out O = Record<never, never>> extends ChangeEventBase {
  /** The operation type. */
  readonly operationType: "update";
  /** The `_id` of the updated document. */
  readonly documentKey: { readonly _id: IdOf<T> };
  /** What the update changed. */
  readonly updateDescription: UpdateDescription;
  /** The post-image, as the `fullDocument` option asks. */
  readonly fullDocument: PostImage<EventDoc<T, O>, O>;
  /** The pre-image, as the `fullDocumentBeforeChange` option asks. */
  readonly fullDocumentBeforeChange: PreImage<EventDoc<T, O>, O>;
}

/**
 * A whole-document replacement.
 *
 * @example
 * ```ts
 * const onReplace = (event: ReplaceEvent<User>): unknown => event.fullDocument;
 * ```
 */
export interface ReplaceEvent<in out T, in out O = Record<never, never>> extends ChangeEventBase {
  /** The operation type. */
  readonly operationType: "replace";
  /** The `_id` of the replaced document. */
  readonly documentKey: { readonly _id: IdOf<T> };
  /** The new document. */
  readonly fullDocument: EventDoc<T, O>;
  /** The pre-image, as the `fullDocumentBeforeChange` option asks. */
  readonly fullDocumentBeforeChange: PreImage<EventDoc<T, O>, O>;
}

/**
 * A deleted document (only its `_id`, and the pre-image when asked for).
 *
 * @example
 * ```ts
 * const onDelete = (event: DeleteEvent<User>): unknown => event.documentKey._id;
 * ```
 */
export interface DeleteEvent<in out T, in out O = Record<never, never>> extends ChangeEventBase {
  /** The operation type. */
  readonly operationType: "delete";
  /** The `_id` of the deleted document. */
  readonly documentKey: { readonly _id: IdOf<T> };
  /** The pre-image, as the `fullDocumentBeforeChange` option asks. */
  readonly fullDocumentBeforeChange: PreImage<EventDoc<T, O>, O>;
}

/**
 * Events of the collection itself (no document): its drop, rename, the database drop, the end of the stream, DDL.
 *
 * @example
 * ```ts
 * const onCollection = (event: CollectionEvent): boolean => event.operationType === "invalidate";
 * ```
 */
export interface CollectionEvent extends ChangeEventBase {
  /** The operation type. */
  readonly operationType:
    | "drop"
    | "rename"
    | "dropDatabase"
    | "invalidate"
    | "create"
    | "createIndexes"
    | "dropIndexes"
    | "modify"
    | "shardCollection"
    | "reshardCollection"
    | "refineCollectionShardKey";
  /** The new namespace of a `rename`. */
  readonly to?: { readonly db: string; readonly coll: string };
}

/**
 * The operation types of document events.
 *
 * @example
 * ```ts
 * const type: DocumentOperationType = "insert";
 * ```
 */
export type DocumentOperationType = "insert" | "update" | "replace" | "delete";

/**
 * Every event of a model's stream for options `O`, discriminated by `operationType`.
 *
 * @example
 * ```ts
 * const handle = (event: ChangeEvent<User>): void => {
 *   if (event.operationType === "insert") console.log(event.fullDocument);
 * };
 * ```
 */
export type ChangeEvent<T, O = Record<never, never>> =
  | InsertEvent<T, O>
  | UpdateEvent<T, O>
  | ReplaceEvent<T, O>
  | DeleteEvent<T, O>
  | CollectionEvent;

/**
 * The event of one operation type.
 *
 * @example
 * ```ts
 * type Update = EventOf<User, "update", { fullDocument: "updateLookup" }>;
 * ```
 */
export type EventOf<T, K extends ChangeEvent<T, O>["operationType"], O = Record<never, never>> = Extract<
  ChangeEvent<T, O>,
  { readonly operationType: K }
>;
