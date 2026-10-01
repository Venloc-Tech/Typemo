import { BsonGuards } from "../../bson/bson-guards.ts";
import { QueryError } from "../../errors/query-error.ts";
import type { ValidationError } from "../../errors/validation-error.ts";
import { PolicyErrors } from "../../policies/policy-errors.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import { IncrementGuard } from "./increment-guard.ts";
import { PipelineGuard } from "./pipeline-guard.ts";

/**
 * The guard of a conditional update, as the executor uses it: the same for `$inc`/`$mul` on a field with
 * `min`/`max` (`IncrementGuard`) and for the computed values of an update pipeline (`PipelineGuard`).
 *
 * @example
 * const guard = UpdateGuards.of(ctx);
 * if (guard !== undefined && result.matchedCount === 0) {
 *   const stored = await collection.findOne(guard.filter, { projection: guard.projection });
 *   if (stored !== null) throw guard.failure(stored);
 * }
 */
export interface UpdateGuard {
  /** The user's filter in database form (without the guard). */
  readonly filter: PlanDocument;
  /** The filter of the documents the guard would skip (the pre-check of `updateMany`). */
  readonly outOfRange: PlanDocument;
  /** The projection of the follow-up read. */
  readonly projection: PlanDocument;
  /** Whether the user's filter selects at most one document (`_id` equality). */
  readonly single: boolean;
  /**
   * The error of a failed guard.
   *
   * @param stored - The row of the follow-up read.
   * @returns The `ValidationError` to throw.
   */
  readonly failure: (stored: Readonly<Record<string, unknown>>) => ValidationError;
}

/*
 * Two updates the server accepts to parse but refuses once a document matches: a replacement that carries an
 * `_id` (the server keeps the stored `_id`, code 66 ImmutableField when it differs) and a positional `$` whose
 * array the filter does not name (code 2, "did not find the match needed from the query"). Both are refused here,
 * before anything is sent, as Typemo errors that say what to change.
 */

/**
 * The guards of updates: the conditional guard the executor uses (`of`), and the checks of an update's shape
 * before it is sent (`replacementId`, `positional`).
 *
 * @example
 * const guard = UpdateGuards.of(ctx); // undefined for an update without a guard
 * UpdateGuards.positional({ "items.sku": "a" }, { $set: { "items.$.qty": 1 } }); // passes
 */
export class UpdateGuards {
  /**
   * A replacement never carries `_id`: the server keeps the stored one (and refuses one that differs only once a
   * document matches). The type of a replacement leaves `_id` out; this is the same rule for untyped input.
   *
   * @param schemaName - The schema name, for the error.
   * @param replacement - The replacement document (code names).
   * @throws {StrictModeError} With rule `immutable` when the replacement has an `_id` key.
   */
  static replacementId(schemaName: string, replacement: PlanDocument): void {
    if (!Object.hasOwn(replacement, "_id")) return;
    throw PolicyErrors.strict(
      "immutable",
      `a replacement of ${schemaName} carries "_id": a replacement keeps the stored _id and cannot change it; leave "_id" out and select the document by _id in the filter`,
      "_id",
    );
  }

  /**
   * Every positional `$` of an update needs a condition on its array in the filter: the server finds the element
   * through that condition, and without it refuses the update once a document matches. `$[]` and `$[id]` need
   * none. A condition counts at the top of the filter and inside `$and`/`$or`/`$nor`: the key is the array's
   * path or a path below it (`items`, `items.sku`).
   *
   * @param filter - The filter (code names), if any.
   * @param update - The update document (code names); a pipeline is not checked.
   * @throws {QueryError} When a positional `$` has no condition on its array in the filter.
   */
  static positional(filter: PlanDocument | undefined, update: PlanDocument | readonly PlanDocument[]): void {
    if (Array.isArray(update)) return;
    const keys = filter === undefined ? [] : UpdateGuards.filterKeys(filter);
    for (const [operator, operand] of Object.entries(update as PlanDocument)) {
      if (!BsonGuards.isPlainObject(operand)) continue;
      for (const path of Object.keys(operand)) {
        const segments = path.split(".");
        const at = segments.indexOf("$");
        if (at === -1) continue;
        const array = segments.slice(0, at).join(".");
        if (array !== "" && keys.some((key) => key === array || key.startsWith(`${array}.`))) continue;
        throw new QueryError(
          `${operator}: "${path}" uses the positional $ of the array "${array}", but the filter has no condition on "${array}"; the server would refuse the update once a document matches. Add a condition on "${array}" to the filter, or use $[] (every element) or $[id] with arrayFilters`,
          { path: `${operator}.${path}` },
        );
      }
    }
  }

  /**
   * The field keys of a filter: its top level and the clauses of `$and`/`$or`/`$nor`, at any depth.
   *
   * @param filter - The filter.
   * @returns The keys that are not operators.
   */
  private static filterKeys(filter: PlanDocument): string[] {
    const keys: string[] = [];
    const visit = (value: unknown): void => {
      if (!BsonGuards.isPlainObject(value)) return;
      for (const [key, item] of Object.entries(value)) {
        if (key === "$and" || key === "$or" || key === "$nor") {
          if (Array.isArray(item)) for (const clause of item) visit(clause);
          continue;
        }
        if (!key.startsWith("$")) keys.push(key);
      }
    };
    visit(filter);
    return keys;
  }

  /**
   * The guard of the operation's update, if it has one.
   *
   * @param ctx - The operation context.
   * @returns The guard, or `undefined`.
   */
  static of(ctx: OperationContext): UpdateGuard | undefined {
    const increment = IncrementGuard.stateOf(ctx);
    if (increment !== undefined) {
      return {
        filter: increment.filter,
        outOfRange: IncrementGuard.outOfRange(increment),
        projection: IncrementGuard.projection(increment),
        single: IncrementGuard.singleDocument(increment),
        failure: (stored) => IncrementGuard.failure(increment, stored),
      };
    }
    const pipeline = PipelineGuard.stateOf(ctx);
    if (pipeline === undefined) return undefined;
    return {
      filter: pipeline.filter,
      outOfRange: { $and: [pipeline.filter, { $expr: { $not: [pipeline.guard] } }] },
      projection: PipelineGuard.projection(pipeline),
      single: IncrementGuard.singleDocument(pipeline),
      failure: (computed) => PipelineGuard.failure(pipeline, computed),
    };
  }
}
