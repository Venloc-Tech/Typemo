import type { EntityClass } from "./type-spec.ts";

/**
 * Default query options of a populate virtual, applied when the virtual is populated.
 *
 * @example
 * ```ts
 * const query: VirtualQueryOptions = { sort: { createdAt: -1 }, limit: 10 };
 * ```
 */
export interface VirtualQueryOptions {
  /** Sort keys: `1` ascending, `-1` descending. */
  readonly sort?: Readonly<Record<string, 1 | -1>>;
  /** Maximum number of populated documents. */
  readonly limit?: number;
  /** Number of populated documents to skip. */
  readonly skip?: number;
}

/**
 * Everything `@Virtual({...})` accepts: populate virtuals only. Ordinary virtuals are class getters
 * and accessors and need no decorator. Paths and flags are checked against the field's
 * `VirtualRef<M, JustOne, Count>`.
 *
 * @example
 * ```ts
 * const options: VirtualOptions = { ref: () => Post, localField: "_id", foreignField: "author" };
 * ```
 */
export interface VirtualOptions {
  /** The model whose documents are populated (must be the model of the field's `VirtualRef<M>`). */
  readonly ref: () => EntityClass;
  /** A path of this class. */
  readonly localField: string;
  /** A path of the referenced class. */
  readonly foreignField: string;
  /** One document instead of an array (must equal `JustOne` of `VirtualRef`). */
  readonly justOne?: boolean;
  /** The number of documents instead of the documents (must equal `Count` of `VirtualRef`). */
  readonly count?: boolean;
  /** Extra filter on the referenced documents (keys are paths of the referenced class). */
  readonly match?: Readonly<Record<string, unknown>>;
  /** Default sort, limit and skip of the populate query. */
  readonly options?: VirtualQueryOptions;
  /** Limit per source document (populated with one `$lookup` that carries a `$limit`). */
  readonly perDocumentLimit?: number;
}
