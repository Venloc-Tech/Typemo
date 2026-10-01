import { OptionQuery } from "./option-query.ts";
import type { OperationPlan, ValuePlan } from "./plan.ts";
import { QuerySpecs } from "./query-specs.ts";

/*
 * `countDocuments` with its own window (`skip`, `limit`). `distinct`, `estimatedDocumentCount` and `exists`
 * are plain `OptionQuery`s.
 */

/**
 * `countDocuments`.
 *
 * @example
 * const total = await User.countDocuments({ active: true }).skip(10).limit(50);
 */
export class CountQuery extends OptionQuery<number> {
  /**
   * Counts at most `n` documents (a positive integer).
   *
   * @param n - The maximum number of documents to count.
   * @returns A new query with the limit set.
   * @throws {QueryError} When `n` is not a positive integer.
   */
  limit(n: number): this {
    return this.rebuild({ ...(this.plan as ValuePlan), limit: QuerySpecs.limit(n) } as OperationPlan);
  }

  /**
   * Skips `n` documents before counting.
   *
   * @param n - The number of documents to skip.
   * @returns A new query with the skip set.
   * @throws {QueryError} When `n` is not a non-negative integer.
   */
  skip(n: number): this {
    return this.rebuild({ ...(this.plan as ValuePlan), skip: QuerySpecs.count("skip", n) } as OperationPlan);
  }
}
