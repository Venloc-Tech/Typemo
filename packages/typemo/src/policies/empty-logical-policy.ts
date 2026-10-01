import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import type { PopulatePlan } from "../query/plan.ts";
import { FilterScan } from "./filter-scan.ts";
import type { GuardPosition } from "./guard-scan.ts";
import { PolicyErrors } from "./policy-errors.ts";

/*
 * An empty `$and`/`$or`/`$nor` is an error. The server refuses it, but Mongoose DROPPED it before
 * sending (H300): `deleteMany({ $or: ids.map(…) })` with no ids deleted every document.
 * Checked in every filter position (the filter, arrayFilters, `$pull` conditions, `$match`, populate
 * `match`); aggregation EXPRESSIONS are not filters (`{ $and: [] }` there is the constant `true`).
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
 * The empty-logical policy.
 *
 * @example
 * EmptyLogicalPolicy.filter({ $or: [] }, "filter"); // throws StrictModeError (empty-logical)
 */
export class EmptyLogicalPolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "emptyLogical";

  /** The positions this guard checks; each one is followed by `GuardScan`. */
  static readonly POSITIONS = [
    "filter",
    "arrayFilters",
    "update.$pull",
    "pipeline.$match",
    "pipeline.$geoNear.query",
    "pipeline.$graphLookup.restrictSearchWithMatch",
    "pipeline.$lookup.pipeline",
    "pipeline.$unionWith.pipeline",
    "pipeline.$facet",
    "populate.match",
    "populate.populate",
  ] as const satisfies readonly GuardPosition[];

  /**
   * Checks every filter position of the operation.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `empty-logical` at the first empty logical clause.
   */
  run(ctx: OperationContext): void {
    for (const unit of OperationView.units(ctx)) {
      if (unit.filter !== undefined) EmptyLogicalPolicy.filter(unit.filter, "filter");
      for (const [index, filter] of (unit.arrayFilters ?? []).entries()) {
        EmptyLogicalPolicy.filter(filter, `arrayFilters.${index}`);
      }
      const pull = BsonGuards.isPlainObject(unit.update) ? unit.update.$pull : undefined;
      if (BsonGuards.isPlainObject(pull)) {
        for (const [path, condition] of Object.entries(pull)) EmptyLogicalPolicy.filter(condition, join("$pull", path));
      }
    }
    const pipeline = OperationView.pipeline(ctx);
    if (pipeline !== undefined) EmptyLogicalPolicy.stages(pipeline, "pipeline");
    EmptyLogicalPolicy.populate(OperationView.populate(ctx), "populate");
  }

  /**
   * Throws at the first empty (or non-array) logical clause of a filter.
   *
   * @param filter - The filter.
   * @param at - Where the filter sits, for the error path.
   * @throws {StrictModeError} With rule `empty-logical`.
   */
  static filter(filter: unknown, at: string): void {
    FilterScan.visit(
      filter,
      (site) => {
        if (site.kind !== "logical") return;
        if (!Array.isArray(site.value) || site.value.length === 0) {
          throw PolicyErrors.strict(
            "empty-logical",
            `${site.key} at "${site.path}" is empty: the server refuses it, and dropping it would match every document. Check the list before building the filter`,
            site.path,
          );
        }
      },
      at,
    );
  }

  /**
   * Checks the filters inside aggregation stages (`$match`, `$geoNear.query`, nested pipelines, `$facet`).
   *
   * @param stages - The stages.
   * @param at - Where the stages sit, for the error path.
   * @throws {StrictModeError} With rule `empty-logical`.
   */
  private static stages(stages: readonly PipelineStage[], at: string): void {
    stages.forEach((stage, index) => {
      const path = join(at, String(index));
      for (const [name, spec] of Object.entries(stage)) {
        if (name === "$match") EmptyLogicalPolicy.filter(spec, join(path, name));
        if (!BsonGuards.isPlainObject(spec)) continue;
        if (name === "$geoNear" && spec.query !== undefined) EmptyLogicalPolicy.filter(spec.query, join(path, name));
        if (name === "$graphLookup" && spec.restrictSearchWithMatch !== undefined) {
          EmptyLogicalPolicy.filter(spec.restrictSearchWithMatch, join(path, name));
        }
        if ((name === "$lookup" || name === "$unionWith") && Array.isArray(spec.pipeline)) {
          EmptyLogicalPolicy.stages(spec.pipeline as PipelineStage[], join(path, name));
        }
        if (name === "$facet") {
          for (const [branch, branchStages] of Object.entries(spec)) {
            if (Array.isArray(branchStages))
              EmptyLogicalPolicy.stages(branchStages as PipelineStage[], join(path, branch));
          }
        }
      }
    });
  }

  /**
   * Checks the `match` filters of populate instructions, nested ones included.
   *
   * @param populate - The populate instructions.
   * @param at - Where they sit, for the error path.
   * @throws {StrictModeError} With rule `empty-logical`.
   */
  private static populate(populate: readonly PopulatePlan[], at: string): void {
    for (const entry of populate) {
      if (entry.match !== undefined) EmptyLogicalPolicy.filter(entry.match, join(at, `${entry.path}.match`));
      EmptyLogicalPolicy.populate(entry.populate, join(at, entry.path));
    }
  }
}
