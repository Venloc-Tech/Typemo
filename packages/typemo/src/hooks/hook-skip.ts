import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";
import type { InsertOutcome } from "../operation/executor/driver-executor.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import { SchemaWalker } from "../schema/compiler/schema-walker.ts";

type Doc = Readonly<Record<string, unknown>>;

/**
 * Checks a count from a skip result.
 *
 * @param value - The value the hook gave.
 * @param what - Name of the value, for the error message.
 * @param where - `Model.operation`, for the error message.
 * @returns The count.
 * @throws {QueryError} When the value is not a non-negative integer.
 */
const count = (value: unknown, what: string, where: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new QueryError(`${where}: skip(result): ${what} must be a non-negative integer`);
  }
  return value;
};

/**
 * Turns the result given to `this.skip(result)` of a pre hook into a raw result.
 *
 * The `execute` step does not call the driver and leaves the skip result in `ctx.result` in the form the driver
 * would have given, so everything after `execute` runs as for a real result: post-processing (hydrated or lean,
 * `orFail`, `dbName`), populate and the post hooks. Documents are given in their lean code form; the schema casts
 * them here (a wrong document is a `CastError`, so a hook cannot smuggle in data the server would never return)
 * and encodes them to the stored form. Nothing is audited for a skipped write, because nothing was written.
 */
export class HookSkip {
  /**
   * The raw result of a skipped operation.
   *
   * @param ctx - The context of the skipped operation.
   * @param value - The result the hook passed to `skip`.
   * @returns The result in the shape the driver would have returned for the operation.
   * @throws {QueryError} When the value does not fit the operation's result, or the operation cannot be skipped.
   */
  static raw(ctx: OperationContext, value: unknown): unknown {
    const where = `${ctx.target.entity.name}.${ctx.op}`;
    const stored = (doc: unknown): Doc => {
      if (!BsonGuards.isPlainObject(doc)) throw new QueryError(`${where}: skip(result): a document is a plain object`);
      return SchemaWalker.encodeDocument(ctx.target.schema, SchemaWalker.castDocument(ctx.target.schema, doc));
    };
    const list = (what: string): readonly unknown[] => {
      if (!Array.isArray(value)) throw new QueryError(`${where}: skip(result): ${what} (an array)`);
      return value;
    };
    const record = (): Doc => {
      if (!BsonGuards.isPlainObject(value))
        throw new QueryError(`${where}: skip(result): the operation's result object`);
      return value;
    };
    switch (ctx.plan.op) {
      case "find":
        return ctx.mode === "explain" ? value : list("the documents").map(stored);
      case "findOne":
        if (ctx.mode === "explain") return value;
        return value === null ? null : stored(value);
      case "countDocuments":
      case "estimatedDocumentCount":
        return count(value, "the count", where);
      case "distinct":
        return list("the values");
      case "updateOne":
      case "updateMany":
      case "replaceOne": {
        const result = record();
        return {
          acknowledged: result.acknowledged !== false,
          matchedCount: count(result.matchedCount, "matchedCount", where),
          modifiedCount: count(result.modifiedCount, "modifiedCount", where),
          upsertedCount: count(result.upsertedCount, "upsertedCount", where),
          upsertedId: result.upsertedId ?? null,
        };
      }
      case "deleteOne":
      case "deleteMany": {
        const result = record();
        return {
          acknowledged: result.acknowledged !== false,
          deletedCount: count(result.deletedCount, "deletedCount", where),
        };
      }
      case "findOneAndUpdate":
      case "findOneAndReplace":
      case "findOneAndDelete":
        return { ok: 1, value: value === null ? null : stored(value), lastErrorObject: { n: value === null ? 0 : 1 } };
      case "insertMany": {
        const inserted = new Map(list("the inserted documents").map((doc, index) => [index, stored(doc)] as const));
        const outcome: InsertOutcome = { inserted };
        return outcome;
      }
      case "bulkWrite":
        return Object.freeze({ ...record() });
      case "aggregate":
        /* The rows are the hook's (code names, any shape): returned as they are. */
        ctx.locals.set(OperationView.RAW_ROWS, true);
        return ctx.mode === "explain" ? value : list("the rows");
      default:
        throw new QueryError(`${where}: this operation cannot be skipped`);
    }
  }
}
