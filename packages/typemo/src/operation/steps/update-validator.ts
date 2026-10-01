import { BsonGuards } from "../../bson/bson-guards.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { UpdateValidationContext } from "../../schema/options/prop-options.ts";
import { PathResolver } from "./path-resolver.ts";
import { IssueCollector, ValueValidator } from "./value-validator.ts";

/**
 * Validation of operator updates. The validators are always on (Mongoose `runValidators` was off and skipped
 * `$inc/$min/$max`). The validators of the WRITTEN paths run on what the operator writes, when that value is known
 * without reading the document:
 *
 * | operator                | what is validated                                                   |
 * |-------------------------|---------------------------------------------------------------------|
 * | `$set`, `$setOnInsert`  | the value (embedded documents entirely, `required` inside them); `null` on a required path |
 * | `$min`, `$max`          | the operand: the result is either it or the stored value (valid already) |
 * | `$push`, `$addToSet`    | every new element (`$each` too)                                      |
 * | `$unset`, `$rename`     | `required` of the removed path                                       |
 * | `$inc`, `$mul`          | `min`/`max`: a guard in the filter, checked by the server (`IncrementGuard`) |
 * | `$pull`, `$pullAll`, `$pop`, `$bit`, `$currentDate` | nothing beyond the cast                  |
 *
 * Validators receive a typed `UpdateValidationContext` (operation, operator, path, upsert, filter), never
 * `this = Query`. Update pipelines are checked by `PipelineGuard`: constants here, computed values by the server.
 */
export class UpdateValidator {
  /**
   * Collects every issue of `update` (cast, code names) into `sink`.
   *
   * @param schema - The compiled schema.
   * @param update - The cast update document.
   * @param base - The context fields shared by every validator call.
   * @param sink - Receives the issues.
   */
  static collect(
    schema: CompiledSchema,
    update: PlanDocument,
    base: Omit<UpdateValidationContext, "kind" | "operator" | "path">,
    sink: IssueCollector,
  ): void {
    for (const [operator, operand] of Object.entries(update)) {
      if (!BsonGuards.isPlainObject(operand)) continue;
      for (const [path, value] of Object.entries(operand)) {
        const resolution = PathResolver.resolve(schema, path, "update");
        if (!resolution.ok) continue;
        const node = resolution.value.node;
        const segments = path.split(".");
        const context = (op: UpdateValidationContext["operator"]) => (): UpdateValidationContext => ({
          kind: "update",
          operator: op,
          path,
          ...base,
        });
        switch (operator) {
          case "$set":
          case "$setOnInsert":
            ValueValidator.value(node, value, segments, context(operator), sink);
            break;
          case "$min":
          case "$max":
            ValueValidator.own(node, value, segments, context(operator), sink);
            break;
          case "$push":
          case "$addToSet": {
            if (node.kind !== "array") break;
            const items = BsonGuards.isPlainObject(value) && Array.isArray(value.$each) ? value.$each : [value];
            items.forEach((item: unknown, index) => {
              ValueValidator.value(node.element, item, [...segments, `+${index}`], context(operator), sink);
            });
            break;
          }
          case "$unset":
          case "$rename":
            if (node.required) {
              sink.issues.push({
                path: segments,
                reason: "required",
                message: `the field is required; ${operator} would remove it`,
                value: undefined,
              });
            }
            break;
          default:
            break;
        }
      }
    }
  }

  /**
   * Validates `update`.
   *
   * @param schema - The compiled schema.
   * @param update - The cast update document.
   * @param base - The context fields shared by every validator call.
   * @returns A promise settled when every (async) validator finished.
   * @throws {ValidationError} With every issue found.
   */
  static async validate(
    schema: CompiledSchema,
    update: PlanDocument,
    base: Omit<UpdateValidationContext, "kind" | "operator" | "path">,
  ): Promise<void> {
    const sink = new IssueCollector();
    UpdateValidator.collect(schema, update, base, sink);
    await sink.finish();
  }
}
