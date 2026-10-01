import { BsonGuards } from "../bson/bson-guards.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import type { GuardPosition } from "./guard-scan.ts";
import { PolicyErrors } from "./policy-errors.ts";

/*
 * `undefined` is never a value. The driver sends it as `null` (`ignoreUndefined` is off): in a filter
 * `{ owner: undefined }` matches the documents WITHOUT an owner, in `$set` it writes `null` (Mongoose drops
 * it: the field silently keeps its value). The builders refuse it already (`PlanValues`); the policy is the
 * same rule for every plan that did not come through them (inserts, bulkWrite, the tenant and soft delete
 * policies adding clauses) and every position: filters, updates, replacements, documents, arrayFilters,
 * pipelines.
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
 * The undefined policy.
 *
 * @example
 * UndefinedPolicy.check({ owner: undefined }, "filter"); // throws StrictModeError (undefined)
 */
export class UndefinedPolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "undefined";

  /** The positions this guard checks; each one is followed by `GuardScan`. */
  static readonly POSITIONS = [
    "filter",
    "arrayFilters",
    "update",
    "updatePipeline",
    "replacement",
    "document",
    "pipeline",
    "projection",
  ] as const satisfies readonly GuardPosition[];

  /**
   * Checks every value of the operation for `undefined`.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `undefined` at the first `undefined`.
   */
  run(ctx: OperationContext): void {
    for (const unit of OperationView.units(ctx)) {
      const at =
        OperationView.unordered(ctx) || ctx.op === "bulkWrite" || ctx.op === "insertMany" ? `[${unit.index}]` : "";
      UndefinedPolicy.check(unit.filter, join(at, "filter"));
      UndefinedPolicy.check(unit.update, join(at, "update"));
      UndefinedPolicy.check(unit.replacement, join(at, "replacement"));
      UndefinedPolicy.check(unit.document, join(at, "document"));
      UndefinedPolicy.check(unit.arrayFilters, join(at, "arrayFilters"));
    }
    UndefinedPolicy.check(OperationView.pipeline(ctx), "pipeline");
    UndefinedPolicy.check(ctx.projection, "projection");
  }

  /**
   * Throws at the first `undefined` inside `value` (own keys of plain objects, array items, Map values).
   *
   * @param value - The value to walk.
   * @param at - Where the value sits, for the error path.
   * @throws {StrictModeError} With rule `undefined`.
   */
  static check(value: unknown, at: string): void {
    const path = UndefinedPolicy.find(value, at);
    if (path !== undefined) {
      throw PolicyErrors.strict(
        "undefined",
        `undefined at "${path}": the driver would send null (a filter would match missing fields, $set would write null). Leave the key out, use $exists: false or $unset`,
        path,
      );
    }
  }

  /**
   * The path of the first `undefined`, if any. The value itself being absent (`undefined` at the root) is fine.
   *
   * @param value - The value to walk.
   * @param at - Where the value sits, prepended to the found path.
   * @returns The path of the first `undefined`, or `undefined` when there is none.
   */
  static find(value: unknown, at: string): string | undefined {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const item: unknown = value[index];
        const path = join(at, String(index));
        if (item === undefined) return path;
        const found = UndefinedPolicy.find(item, path);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (BsonGuards.isMap(value)) {
      for (const [key, item] of value) {
        const path = join(at, String(key));
        if (item === undefined) return path;
        const found = UndefinedPolicy.find(item, path);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!BsonGuards.isPlainObject(value)) return undefined;
    for (const key of Object.keys(value)) {
      const item = value[key];
      const path = join(at, key);
      if (item === undefined) return path;
      const found = UndefinedPolicy.find(item, path);
      if (found !== undefined) return found;
    }
    return undefined;
  }
}
