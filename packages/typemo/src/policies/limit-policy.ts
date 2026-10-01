import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { CastError } from "../errors/cast-error.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import type { GuardPosition } from "./guard-scan.ts";
import { PolicyErrors } from "./policy-errors.ts";

/*
 * `limit` is a positive integer: the driver reads `limit(0)` as "no limit" and a negative limit as its absolute
 * value with a single batch. `skip` is a non-negative integer. The builders check it (`QuerySpecs.limit`); the
 * policy covers every plan and `$limit`/`$skip` stages (also inside `$facet`/`$lookup`/`$unionWith`).
 *
 * NOTE: `GuardScan` (guard-scan.ts) stands in for this guard on input it calls clean — then this guard does
 * NOT run. Any new rule or position here → update `GuardScan`, `POSITIONS` below and the generator and the
 * cases in `test/unit/policies/guard-scan.test.ts`.
 */

/**
 * Joins a path with a key.
 *
 * @param base - The path so far (empty at the root).
 * @param key - The next key.
 * @returns The dotted path.
 */
const join = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);

/**
 * The limit policy.
 *
 * @example
 * LimitPolicy.limit(0, "limit"); // throws StrictModeError (limit)
 */
export class LimitPolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "limit";

  /** The positions this guard checks; each one is followed by `GuardScan`. */
  static readonly POSITIONS = [
    "limit",
    "skip",
    "populate.limit",
    "populate.perDocumentLimit",
    "populate.skip",
    "pipeline.$limit",
    "pipeline.$skip",
    "pipeline.$lookup.pipeline",
    "pipeline.$unionWith.pipeline",
    "pipeline.$facet",
  ] as const satisfies readonly GuardPosition[];

  /**
   * Checks the limits and skips of the plan, of populate instructions and of pipeline stages.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `limit`.
   */
  run(ctx: OperationContext): void {
    LimitPolicy.limit(OperationView.planField(ctx, "limit"), "limit");
    LimitPolicy.skip(OperationView.planField(ctx, "skip"), "skip");
    for (const [index, entry] of OperationView.populate(ctx).entries()) {
      LimitPolicy.limit(entry.options?.limit, `populate.${index}.limit`);
      LimitPolicy.limit(entry.perDocumentLimit, `populate.${index}.perDocumentLimit`);
      LimitPolicy.skip(entry.options?.skip, `populate.${index}.skip`);
    }
    const pipeline = OperationView.pipeline(ctx);
    if (pipeline !== undefined) LimitPolicy.stages(pipeline, "pipeline");
  }

  /**
   * A limit: absent, or a positive integer.
   *
   * @param value - The limit.
   * @param at - Where the limit sits, for the error.
   * @throws {StrictModeError} With rule `limit`.
   */
  static limit(value: unknown, at: string): void {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw PolicyErrors.strict(
        "limit",
        `${at} must be a positive integer, got ${CastError.describe(value)} (0 means "no limit" to the driver and a negative limit its absolute value; leave it out for no limit)`,
        at,
      );
    }
  }

  /**
   * A skip: absent, or a non-negative integer.
   *
   * @param value - The skip.
   * @param at - Where the skip sits, for the error.
   * @throws {StrictModeError} With rule `limit`.
   */
  static skip(value: unknown, at: string): void {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw PolicyErrors.strict("limit", `${at} must be a non-negative integer, got ${CastError.describe(value)}`, at);
    }
  }

  /**
   * Checks `$limit`/`$skip` stages, also inside `$lookup`/`$unionWith` pipelines and `$facet` branches.
   *
   * @param stages - The stages.
   * @param at - Where the stages sit, for the error path.
   * @throws {StrictModeError} With rule `limit`.
   */
  private static stages(stages: readonly PipelineStage[], at: string): void {
    stages.forEach((stage, index) => {
      const path = join(at, String(index));
      if ("$limit" in stage) LimitPolicy.limit(stage.$limit, join(path, "$limit"));
      if ("$skip" in stage) LimitPolicy.skip(stage.$skip, join(path, "$skip"));
      for (const name of ["$lookup", "$unionWith"] as const) {
        const spec = stage[name];
        if (BsonGuards.isPlainObject(spec) && Array.isArray(spec.pipeline)) {
          LimitPolicy.stages(spec.pipeline as PipelineStage[], join(path, name));
        }
      }
      const facet = stage.$facet;
      if (BsonGuards.isPlainObject(facet)) {
        for (const [branch, branchStages] of Object.entries(facet)) {
          if (Array.isArray(branchStages)) LimitPolicy.stages(branchStages as PipelineStage[], join(path, branch));
        }
      }
    });
  }
}
