import type { W } from "mongodb";
import { OptionQuery } from "./option-query.ts";
import type { OperationPlan, WritePlan } from "./plan.ts";

/*
 * The builder of `updateOne`/`updateMany`/`replaceOne`/`deleteOne`/`deleteMany`: lazy —
 * nothing is sent until `await`/`exec()`; a write runs ONCE per builder object: a second `await` of the
 * same object is a `QueryError`. The result is the driver's (`UpdateResult` with `upsertedId` typed by the
 * entity's `_id`, `DeleteResult`). `orFail()` makes "nothing matched" an error; the result type does not
 * change: these results are never `null`.
 */

/**
 * A write operation with its options.
 *
 * @typeParam R - The driver result the write resolves to.
 * @example
 * const result = await User.updateOne({ name: "a" }, { $set: { age: 1 } }).orFail().writeConcern({ w: "majority" });
 */
export class WriteBuilder<R> extends OptionQuery<R> {
  /**
   * Write concern of this operation (inside a transaction the transaction's applies; a conflicting one is refused).
   *
   * @param concern - The write concern.
   * @returns A new builder with a copy of the concern.
   */
  writeConcern(concern: { readonly w?: W; readonly journal?: boolean }): this {
    return this.withOptions({ writeConcern: Object.freeze({ ...concern }) });
  }

  /**
   * Nothing matched is an error (`DocumentNotFoundError`).
   *
   * @returns A new builder that fails when no document matches.
   */
  orFail(): this {
    return this.rebuild({ ...(this.plan as WritePlan), orFail: true } as OperationPlan);
  }
}
