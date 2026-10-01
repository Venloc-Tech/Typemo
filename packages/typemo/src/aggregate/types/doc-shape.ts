import type { Lean, LeanOf } from "../../types/document-forms.ts";
import type { DefaultView } from "../../types/projection.ts";

/*
 * The document a pipeline reads: what the collection STORES for an entity, in the lean form the
 * driver returns with the enforced BSON options. It is `Lean<T>`: data fields only (no methods, no
 * `Computed`/`VirtualValue`/`VirtualRef` virtuals — an aggregation reads raw documents), markers removed,
 * `Map` fields as plain records, `Ref<M>` kept, `Hidden<T>` fields present (the server does not hide them in an
 * aggregation), arrays and subdocuments mapped recursively. One form for `Filter.$expr`, the query layer and
 * the pipeline.
 */

/**
 * The stored form of an entity or subdocument (`Lean<T>`).
 *
 * @typeParam T - The entity or subdocument class type.
 * @example
 * ```ts
 * type Doc = PipelineDoc<User>; // { _id: ObjectId; name: string; … } without methods and virtuals
 * ```
 */
export type PipelineDoc<T> = Lean<T>;

/**
 * The document an aggregation READS from an entity: its stored form without the `Hidden` fields,
 * which the operation pipeline removes with a leading `$unset`; `Plus` are the
 * hidden paths included explicitly (`Pipeline.from(E, { include: [...] })`), like `+field` of `find`.
 *
 * @typeParam T - The entity class type.
 * @typeParam Plus - Hidden paths included explicitly.
 * @example
 * ```ts
 * type Doc = VisibleDoc<User>; // no `passwordHash` (a Hidden field)
 * type WithHash = VisibleDoc<User, "passwordHash">; // has `passwordHash`
 * ```
 */
export type VisibleDoc<T, Plus extends string = never> = Lean<DefaultView<T, Plus>>;

/**
 * One stored value (`LeanOf<V>`).
 *
 * @typeParam V - The hydrated value type.
 * @example
 * ```ts
 * type A = StoredValue<Map<string, number>>; // { [key: string]: number }
 * ```
 */
export type StoredValue<V> = LeanOf<V>;
