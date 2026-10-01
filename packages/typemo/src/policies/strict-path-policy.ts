import { BsonGuards } from "../bson/bson-guards.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import { type PathMode, PathResolver, type ResolvedPath, type ResolveRoot } from "../operation/steps/path-resolver.ts";
import type { PlanDocument } from "../query/plan.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { PolicyErrors } from "./policy-errors.ts";

/*
 * An unknown path is an error, never dropped: Mongoose `strictQuery` silently REMOVED unknown filter
 * keys (H300: `find({ notInSchema: 1 })` returned every document, `deleteMany` deleted them)
 * and `strict` silently removed unknown update paths. Checked at the `resolvePaths` step for
 * every path an operation names at the top of its values: filter keys (also inside `$and/$or/$nor`),
 * update paths and `$rename` targets, projection and sort keys, the `distinct` field, arrayFilters
 * identifiers. Paths deeper inside operands (`$elemMatch` filters, `$pull` conditions, `$push.$sort`)
 * are resolved by the cast with the same error.
 */

/** The strict-path policy. */
export class StrictPathPolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "strictPath";

  /**
   * Checks every path the operation names at the top of its values.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `unknown-path` when a path is not in the schema.
   */
  run(ctx: OperationContext): void {
    const schema = OperationView.schema(ctx);
    for (const unit of OperationView.units(ctx)) {
      if (unit.filter !== undefined) StrictPathPolicy.filter(schema, unit.filter, "filter");
      if (unit.update !== undefined && !Array.isArray(unit.update))
        StrictPathPolicy.update(schema, unit.update as PlanDocument);
    }
    if (ctx.projection !== undefined) StrictPathPolicy.projection(schema, ctx.projection);
    for (const [path, direction] of ctx.sort ?? []) {
      /* The text score field (`textScore()`): a field the projection adds, sorted by its `$meta`. */
      if (typeof direction === "object" && StrictPathPolicy.isMeta(ctx.projection?.[path])) continue;
      StrictPathPolicy.check(schema, path, "read", `sort.${path}`);
    }
    const field = OperationView.planField(ctx, "field");
    if (typeof field === "string") StrictPathPolicy.check(schema, field, "read", "distinct");
  }

  /**
   * Tells whether a projection value adds a metadata field (`{ $meta: "textScore" }`).
   *
   * @param value - The projection value of a key.
   * @returns `true` for a `$meta` projection.
   */
  private static isMeta(value: unknown): boolean {
    return BsonGuards.isPlainObject(value) && "$meta" in value;
  }

  /**
   * The resolution of `path`, or a `StrictModeError` "unknown-path".
   *
   * @param root - A document schema, or a node to start from.
   * @param path - The path in code names.
   * @param mode - How the server reads the path.
   * @param at - Where the path sits, for the error.
   * @returns The resolved path.
   * @throws {StrictModeError} With rule `unknown-path` when the path does not exist.
   */
  static check(root: ResolveRoot, path: string, mode: PathMode, at: string): ResolvedPath {
    const resolution = PathResolver.resolve(root, path, mode);
    if (!resolution.ok)
      throw PolicyErrors.strict("unknown-path", `${StrictPathPolicy.area(at, path)}: ${resolution.reason}`, at);
    return resolution.value;
  }

  /**
   * The part of a location before the path it ends with: the reason already names the path, so the
   * message does not print it twice (`filter: "nope" is not a field of User`).
   *
   * @param at - Where the path sits (`filter.nope`, `$set.a.b`, `projection.+secret`, `distinct`).
   * @param path - The path the reason names.
   * @returns The location without the trailing path, or the whole location when it does not end with it.
   */
  private static area(at: string, path: string): string {
    for (const tail of [`.${path}`, `.+${path}`]) {
      if (at.endsWith(tail)) return at.slice(0, at.length - tail.length);
    }
    return at;
  }

  /**
   * Every field key of a filter (top level and logical clauses).
   *
   * @param schema - The compiled schema.
   * @param filter - The filter.
   * @param at - Where the filter sits, for the error path.
   * @throws {StrictModeError} With rule `unknown-path`.
   */
  static filter(schema: CompiledSchema, filter: PlanDocument, at: string): void {
    const visit = (value: unknown, prefix: string): void => {
      if (!BsonGuards.isPlainObject(value)) return;
      for (const [key, item] of Object.entries(value)) {
        const path = `${prefix}.${key}`;
        if (key === "$and" || key === "$or" || key === "$nor") {
          if (Array.isArray(item))
            item.forEach((clause: unknown, index) => {
              visit(clause, `${path}.${index}`);
            });
          continue;
        }
        if (key.startsWith("$")) continue;
        StrictPathPolicy.check(schema, key, "filter", path);
      }
    };
    visit(filter, at);
  }

  /**
   * Every path written by an update (and `$rename` targets).
   *
   * @param schema - The compiled schema.
   * @param update - The update document.
   * @throws {StrictModeError} With rule `unknown-path`.
   */
  static update(schema: CompiledSchema, update: PlanDocument): void {
    for (const [operator, operand] of Object.entries(update)) {
      if (!BsonGuards.isPlainObject(operand)) continue;
      for (const [path, value] of Object.entries(operand)) {
        StrictPathPolicy.check(schema, path, "update", `${operator}.${path}`);
        if (operator === "$rename" && typeof value === "string") {
          StrictPathPolicy.check(schema, value, "update", `${operator}.${path}`);
        }
      }
    }
  }

  /**
   * Projection keys (`+path` adds a hidden path; `arr.$` is the matched element).
   *
   * @param schema - The compiled schema.
   * @param projection - The projection.
   * @throws {StrictModeError} With rule `unknown-path`.
   */
  static projection(schema: CompiledSchema, projection: PlanDocument): void {
    for (const key of Object.keys(projection)) {
      const path = key.startsWith("+") ? key.slice(1) : key;
      const value = projection[key];
      /* `{ score: { $meta: "textScore" } }` names a NEW field of the result. */
      if (StrictPathPolicy.isMeta(value)) continue;
      StrictPathPolicy.check(schema, path, "read", `projection.${key}`);
    }
  }
}
