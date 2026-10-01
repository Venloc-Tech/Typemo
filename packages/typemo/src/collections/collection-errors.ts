import { TypemoError, type TypemoErrorOptions } from "../errors/typemo-error.ts";

/**
 * One option of a collection that the server has differently from the schema (or view definition).
 *
 * @example
 * ```ts
 * const difference: CollectionDifference = {
 *   option: "capped",
 *   mutable: false,
 *   wanted: true,
 *   actual: undefined,
 * };
 * ```
 */
export interface CollectionDifference {
  /** The option (`validator`, `capped`, `timeseries.granularity`, `pipeline`, …). */
  readonly option: string;
  /** `true` when `collMod` can change it (`ensureCollection({ update: true })`). */
  readonly mutable: boolean;
  /** What the schema declares (`undefined`: not declared). */
  readonly wanted: unknown;
  /** What the server has (`undefined`: not set). */
  readonly actual: unknown;
}

/**
 * A collection (or view) exists with other options than the schema declares, or is of another kind (a
 * view where a collection is wanted, a regular collection where a time series is). Mongoose's
 * `createCollection` ignored an existing collection, so a changed option never reached the database;
 * Typemo reports the difference instead.
 */
export class CollectionOptionsError extends TypemoError {
  /** The collection (or view) name. */
  readonly collection: string;
  /** The options that differ; frozen. */
  readonly differences: readonly CollectionDifference[];

  /**
   * @param collection - The collection (or view) name.
   * @param message - What is wrong; prefixed with the collection name.
   * @param differences - The differing options.
   * @param options - Error options (`cause`, …).
   */
  constructor(
    collection: string,
    message: string,
    differences: readonly CollectionDifference[] = [],
    options: TypemoErrorOptions = {},
  ) {
    super(`collection "${collection}": ${message}`, options);
    this.collection = collection;
    this.differences = Object.freeze([...differences]);
  }

  static {
    Object.defineProperty(CollectionOptionsError.prototype, "name", {
      value: "CollectionOptionsError",
      writable: true,
      configurable: true,
    });
  }
}
