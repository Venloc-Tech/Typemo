import type { Filter } from "../types/filter.ts";

/**
 * The value of `Filters.all()` without a type argument: `{ _id: { $exists: true } }`.
 *
 * A plain object type, not `Filter<T>` of some `T`: a filter is invariant in its document type, so a
 * `Filter<{ _id?: unknown }>` is not a filter of any model. This literal shape is a valid filter of every
 * model (every document has `_id`), so one value serves `find`, `deleteMany`, `updateMany`,
 * `countDocuments` and the other filter-taking operations of any model.
 *
 * @example
 * ```ts
 * const all: AllDocumentsFilter = Filters.all();
 * await Users.deleteMany(all);
 * await Orders.deleteMany(all);
 * ```
 */
export type AllDocumentsFilter = { readonly _id: { readonly $exists: true } };

/**
 * Filters with a meaning of their own. `Filters.all()` is the explicit "every document" for the
 * operations that refuse an empty filter (`updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`, `findOneAnd*`: `RequireFilterPolicy`).
 * It is a real filter the server evaluates — `{ _id: { $exists: true } }`, true for every stored
 * document — so nothing special travels through the plan and the command log shows the intent.
 */
export class Filters {
  /**
   * The filter matching every document, on purpose — accepted by every model.
   *
   * @returns A frozen filter that is true for every stored document.
   * @example
   * ```ts
   * await Users.deleteMany(Filters.all()); // deletes every user, explicitly
   * ```
   */
  static all(): AllDocumentsFilter;
  /**
   * The filter matching every document, on purpose, typed as a filter of `T`.
   *
   * @typeParam T - The document type the filter is typed for.
   * @returns A frozen filter that is true for every stored document.
   * @example
   * ```ts
   * const all: Filter<User> = Filters.all<User>();
   * ```
   */
  static all<T extends { readonly _id?: unknown }>(): Filter<T>;
  /**
   * The implementation behind both forms: one frozen `{ _id: { $exists: true } }`.
   *
   * @typeParam T - The document type of the typed form.
   * @returns A frozen filter that is true for every stored document.
   */
  static all<T extends { readonly _id?: unknown }>(): AllDocumentsFilter | Filter<T> {
    return Object.freeze({ _id: Object.freeze({ $exists: true } as const) });
  }
}
