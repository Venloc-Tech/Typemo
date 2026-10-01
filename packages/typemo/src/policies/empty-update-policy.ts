import { BsonGuards } from "../bson/bson-guards.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import { PolicyErrors } from "./policy-errors.ts";

/*
 * An update that changes nothing is an error. Mongoose silently skipped the command (`updateOne` →
 * `{ acknowledged: false }`, `findOneAndUpdate` → a plain `findOne`). Empty means: no operator, an operator
 * with no path, or an update pipeline with no stage. Checked on the raw update (`normalize`) and again after
 * the cast (`policies`): the cast never drops a path, so both see the same thing today; the second check
 * guards later steps.
 */

/**
 * The empty-update policy.
 *
 * @example
 * EmptyUpdatePolicy.check({ $set: {} }, "updateOne"); // throws StrictModeError (empty-update)
 */
export class EmptyUpdatePolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "emptyUpdate";

  /**
   * Checks the update of every unit of the operation.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `empty-update` when an update changes nothing.
   */
  run(ctx: OperationContext): void {
    for (const unit of OperationView.units(ctx)) {
      if (unit.update !== undefined) EmptyUpdatePolicy.check(unit.update, unit.kind);
    }
  }

  /**
   * Throws when `update` changes nothing.
   *
   * @param update - The update document or pipeline.
   * @param operation - The operation kind, for the message.
   * @throws {StrictModeError} With rule `empty-update`.
   */
  static check(update: unknown, operation: string): void {
    if (Array.isArray(update)) {
      if (update.length === 0) {
        throw PolicyErrors.strict("empty-update", `${operation}: an update pipeline without stages changes nothing`);
      }
      return;
    }
    if (!BsonGuards.isPlainObject(update) || Object.keys(update).length === 0) {
      throw PolicyErrors.strict("empty-update", `${operation}: an empty update changes nothing`);
    }
    for (const [operator, operand] of Object.entries(update)) {
      if (!BsonGuards.isPlainObject(operand) || Object.keys(operand).length === 0) {
        throw PolicyErrors.strict("empty-update", `${operation}: "${operator}" has no path`, operator);
      }
    }
  }
}
