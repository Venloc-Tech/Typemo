import { StrictModeError } from "../errors/strict-mode-error.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView, type WorkUnit } from "../operation/steps/operation-view.ts";
import type { PlanDocument } from "../query/plan.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { ScopeFilters } from "./scope-filters.ts";

/*
 * The soft delete policy (off unless `@Schema({ softDelete })`, the field a `Date | null`):
 * - a delete (`deleteOne`, `deleteMany`, `findOneAndDelete`, `bulkWrite` deletes, a document's `$deleteOne`)
 *   becomes an UPDATE `$set: { deletedAt: <now> }` of the documents that are not deleted yet (the result
 *   is still a delete's: `deletedCount` = documents marked; `findOneAndDelete` returns the document as it
 *   was, like a real delete). `hardDelete: true` in the context (`SoftDelete.purge`) removes for good;
 * - every other operation sees only the documents that are not deleted: the condition `deletedAt: null`
 *   (null or absent) is ADDED to the user's filter — a user condition on `deletedAt` stays and both must
 *   hold (`$and`). `includeDeleted: true` shows every document,
 *   `onlyDeleted: true` only the deleted ones (`deletedAt: { $ne: null }`), for the model's own documents;
 *   joined documents (`$lookup`, `$unionWith`, `$graphLookup`, populate) never show deleted ones;
 * - inserts store `deletedAt: null` when absent, so a partial unique index can tell live documents from
 *   deleted ones (see `uniqueIndexHints`);
 * - `estimatedDocumentCount` counts deleted documents too (collection metadata): refused unless
 *   `includeDeleted: true`, pointing to `countDocuments()`.
 */

/**
 * What an operation sees of the model's own documents: the live ones, all, or only the deleted.
 *
 * @example
 * const mode: Mode = "only";
 */
type Mode = "exclude" | "include" | "only";

/**
 * The soft delete policy.
 *
 * @example
 * SoftDeletePolicy.fieldOf(schema)?.path; // "deletedAt"
 */
export class SoftDeletePolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "softDelete";

  /**
   * The delete-date field of a schema (its root's `softDelete` option), `undefined` without the policy.
   *
   * @param schema - The compiled schema, if any.
   * @returns The field's node, or `undefined`.
   */
  static fieldOf(schema: CompiledSchema | undefined): PathNode | undefined {
    if (schema === undefined) return undefined;
    const option = schema.root.options.softDelete;
    if (option === undefined) return undefined;
    const key = option === true ? "deletedAt" : (option.field ?? "deletedAt");
    return schema.field(key) ?? schema.root.field(key);
  }

  /**
   * Hints about the unique indexes of a soft-delete schema: a unique index without a partial filter on the
   * delete date keeps a deleted document's values taken (a new document with the same email fails with
   * E11000). The fix is a partial unique index over live documents only — `partialFilterExpression:
   * { deletedAt: { $type: "null" } }` (inserts store `deletedAt: null`; a partial filter cannot say "absent").
   *
   * @param schema - The compiled schema.
   * @returns One hint per unique index that also counts deleted documents; empty without soft delete.
   */
  static uniqueIndexHints(schema: CompiledSchema): readonly string[] {
    const node = SoftDeletePolicy.fieldOf(schema);
    if (node === undefined) return [];
    const field = node.dbPath;
    return schema.indexes
      .filter((index) => index.options.unique === true)
      .filter((index) => {
        const partial = index.options.partialFilterExpression as Readonly<Record<string, unknown>> | undefined;
        return partial === undefined || !JSON.stringify(partial).includes(`"${field}"`);
      })
      .map(
        (index) =>
          `${schema.name}: the unique index ${JSON.stringify(index.keys)} also counts soft-deleted documents; make it partial over live ones: partialFilterExpression: { ${field}: { $type: "null" } }`,
      );
  }

  /**
   * Scopes the operation to live documents (or as the context says), and turns deletes into updates.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `soft-delete` for `estimatedDocumentCount` without `includeDeleted`.
   */
  run(ctx: OperationContext): void {
    const schema = OperationView.schema(ctx);
    const node = SoftDeletePolicy.fieldOf(schema);
    const mode = SoftDeletePolicy.mode(ctx);
    if (ctx.op === "aggregate" && ctx.pipeline !== undefined) {
      ctx.pipeline = ScopeFilters.pipeline(
        ctx.pipeline,
        node === undefined ? undefined : SoftDeletePolicy.condition(node, mode),
        (collection) => {
          const joined = SoftDeletePolicy.fieldOf(OperationView.schemaOfCollection(ctx, collection));
          return joined === undefined ? undefined : SoftDeletePolicy.condition(joined, "exclude");
        },
        () => undefined,
      );
      return;
    }
    if (node === undefined || ctx.op === "watch") return;
    if (ctx.op === "estimatedDocumentCount" && mode !== "include") {
      throw new StrictModeError(
        "soft-delete",
        `${ctx.target.entity.name}.estimatedDocumentCount: the collection's metadata counts soft-deleted documents too; use countDocuments() (or includeDeleted: true to count them all)`,
      );
    }
    const condition = SoftDeletePolicy.condition(node, mode);
    const hard = ctx.policy.hardDelete === true;
    let soft = false;
    OperationView.map(ctx, (unit) => {
      let out: WorkUnit = unit;
      if (unit.filter !== undefined && condition !== undefined) {
        out = { ...out, filter: ScopeFilters.filter(unit.filter, condition) };
      }
      if (unit.document !== undefined && unit.document[node.path] === undefined) {
        out = { ...out, document: Object.freeze({ ...unit.document, [node.path]: null }) };
      }
      if (!hard && SoftDeletePolicy.isDelete(unit.kind)) {
        soft = true;
        const update = Object.freeze({ $set: Object.freeze({ [node.path]: OperationView.now(ctx) }) });
        /*
         * In a bulkWrite the operation itself becomes an update; a single delete keeps its name (hooks,
         * result form) and the executor sends the update (`ctx.softDelete`).
         */
        const kind = ctx.op === "bulkWrite" ? (unit.kind === "deleteOne" ? "updateOne" : "updateMany") : unit.kind;
        out = { ...out, kind, update };
      }
      return out;
    });
    if (soft && ctx.op !== "bulkWrite") ctx.softDelete = true;
  }

  /**
   * What the operation sees of its own documents.
   *
   * @param ctx - The operation context.
   * @returns The mode the policy context asks for.
   */
  private static mode(ctx: OperationContext): Mode {
    return ctx.policy.onlyDeleted === true ? "only" : ctx.policy.includeDeleted === true ? "include" : "exclude";
  }

  /**
   * The filter condition of a mode.
   *
   * @param node - The delete-date field.
   * @param mode - What the operation sees.
   * @returns The condition, or `undefined` when everything is shown.
   */
  private static condition(node: PathNode, mode: Mode): PlanDocument | undefined {
    switch (mode) {
      case "include":
        return undefined;
      case "only":
        return Object.freeze({ [node.path]: Object.freeze({ $ne: null }) });
      default:
        return Object.freeze({ [node.path]: null });
    }
  }

  /**
   * Whether a unit kind deletes documents.
   *
   * @param kind - The unit kind.
   * @returns `true` for the delete kinds.
   */
  private static isDelete(kind: WorkUnit["kind"]): boolean {
    return kind === "deleteOne" || kind === "deleteMany" || kind === "findOneAndDelete";
  }
}
