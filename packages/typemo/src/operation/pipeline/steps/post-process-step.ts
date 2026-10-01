import type { Document } from "mongodb";
import type { Connection } from "../../../connection/connection.ts";
import { Documents } from "../../../document/documents.ts";
import { DocumentNotFoundError } from "../../../errors/document-not-found-error.ts";
import { DocumentHooks } from "../../../hooks/document-hooks.ts";
import { DocumentReader } from "../../../model/document-reader.ts";
import { ReadValidator } from "../../../model/read-validator.ts";
import type { FindPlan, ModifyPlan, WritePlan } from "../../../query/plan.ts";
import type { InsertOutcome } from "../../executor/driver-executor.ts";
import { DbNames } from "../../steps/db-names.ts";
import { OperationView } from "../../steps/operation-view.ts";
import type { ResultShape } from "../../steps/result-shape.ts";
import type { OperationContext } from "../operation-context.ts";
import type { OperationStep } from "../operation-step.ts";

/* A stored row as the driver returns it. */
type Raw = Readonly<Record<string, unknown>>;

/**
 * The `postProcess` step: the driver's raw result becomes the result the builder's type promises (proven by the
 * shape tests): documents hydrated or lean, `orFail`, write results normalized to the result types
 * (`UpdateResult` with `upsertedId: Id | null`, ...).
 */
export class PostProcessStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "postProcess";

  /**
   * Turns `ctx.result` into the typed result and runs `document.init` for the hydrated documents.
   *
   * @param ctx - The context of the operation.
   * @returns Nothing when no `init` hook has to run, else a promise settled when the hooks are done.
   * @throws {DocumentNotFoundError} When `orFail` is set and nothing matched.
   */
  run(ctx: OperationContext): void | Promise<void> {
    ctx.result = PostProcessStep.process(ctx);
    /* `document.init` of the documents a read hydrated (and their subdocuments'), in order. */
    if (!PostProcessStep.reads(ctx) || !DocumentHooks.hasInit(ctx.target.schema)) return;
    return DocumentHooks.init(PostProcessStep.documents(ctx.result));
  }

  /**
   * Tells whether the operation is a read that hydrates documents.
   *
   * @param ctx - The context of the operation.
   * @returns `true` for a read that is neither lean nor an explain.
   */
  private static reads(ctx: OperationContext): boolean {
    switch (ctx.plan.op) {
      case "find":
      case "findOne":
        return !(ctx.plan as FindPlan).lean && ctx.mode !== "explain";
      case "findOneAndUpdate":
      case "findOneAndReplace":
      case "findOneAndDelete":
        return !(ctx.plan as ModifyPlan).lean;
      default:
        return false;
    }
  }

  /**
   * The documents of a post-processed result (a list, one, or `{ value }` with metadata).
   *
   * @param result - The post-processed result.
   * @returns The documents it holds.
   */
  private static documents(result: unknown): readonly unknown[] {
    if (Array.isArray(result)) return result;
    if (result === null || typeof result !== "object") return [];
    if (!Documents.is(result) && "value" in result) return [(result as { readonly value: unknown }).value];
    return [result];
  }

  /**
   * One stored row in the result form. Hydrated: a tracked document bound to the connection
   * (`Documents.hydrate`), knowing what the projection loaded; lean: `DocumentReader.lean`.
   *
   * @param ctx - The context of the operation.
   * @param row - The stored row.
   * @param lean - `true` for a plain object.
   * @returns The document or the lean object.
   */
  private static read(ctx: OperationContext, row: Raw, lean: boolean): unknown {
    if (lean) return DocumentReader.lean(ctx.target.schema, row);
    const connection = ctx.locals.get(Documents.CONNECTION) as Connection | undefined;
    if (connection === undefined) return DocumentReader.hydrate(ctx.target.schema, row);
    const info = Documents.readInfo(ctx.target.schema, ctx.projection, ctx.session);
    return Documents.hydrate(connection, ctx.target.schema, row, info);
  }

  /**
   * Whether the read checks the stored documents against the schema: the query's `.validateReads()`, else the
   * client's option. Asked once per operation, so a read without the check pays one test.
   *
   * @param ctx - The context of the operation.
   * @returns `true` when every row is checked by `ReadValidator`.
   */
  static validates(ctx: OperationContext): boolean {
    return (ctx.plan as FindPlan | ModifyPlan).options.validateReads ?? ctx.environment.validateReads;
  }

  /**
   * Throws the `orFail` error.
   *
   * @param ctx - The context of the operation.
   * @throws {DocumentNotFoundError} Always.
   */
  private static notFound(ctx: OperationContext): never {
    throw new DocumentNotFoundError(OperationView.called(ctx), ctx.target.entity.name);
  }

  /**
   * Converts the raw driver result by operation kind and counts the documents for instrumentation.
   *
   * @param ctx - The context of the operation.
   * @returns The typed result.
   * @throws {DocumentNotFoundError} When `orFail` is set and nothing matched.
   */
  private static process(ctx: OperationContext): unknown {
    const raw = ctx.result;
    switch (ctx.plan.op) {
      case "find":
      case "findOne": {
        const plan = ctx.plan as FindPlan;
        if (plan.mode.kind === "explain") return raw;
        if (ctx.mode === "cursor" || plan.op === "find") {
          const rows = raw as readonly Raw[];
          ctx.documentCount = (ctx.documentCount ?? 0) + rows.length;
          /* A cursor sees one batch at a time: an empty batch is not an empty result, so `orFail` applies to `await` only. */
          if (plan.orFail && ctx.mode !== "cursor" && rows.length === 0) return PostProcessStep.notFound(ctx);
          if (PostProcessStep.validates(ctx)) for (const row of rows) ReadValidator.check(ctx.target.schema, row);
          return rows.map((row) => PostProcessStep.read(ctx, row, plan.lean));
        }
        if (raw === null || raw === undefined) {
          ctx.documentCount = 0;
          return plan.orFail ? PostProcessStep.notFound(ctx) : null;
        }
        ctx.documentCount = 1;
        if (PostProcessStep.validates(ctx)) ReadValidator.check(ctx.target.schema, raw as Raw);
        return PostProcessStep.read(ctx, raw as Raw, plan.lean);
      }
      case "countDocuments":
      case "estimatedDocumentCount":
        ctx.documentCount = raw as number;
        return raw;
      case "distinct":
        ctx.documentCount = (raw as readonly unknown[]).length;
        return raw;
      case "updateOne":
      case "updateMany":
      case "replaceOne": {
        const result = raw as {
          readonly acknowledged: boolean;
          readonly matchedCount: number;
          readonly modifiedCount: number;
          readonly upsertedCount: number;
          readonly upsertedId: unknown;
        };
        ctx.documentCount = result.modifiedCount + result.upsertedCount;
        if ((ctx.plan as WritePlan).orFail && result.matchedCount === 0 && result.upsertedCount === 0) {
          return PostProcessStep.notFound(ctx);
        }
        return Object.freeze({
          acknowledged: result.acknowledged,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
          upsertedCount: result.upsertedCount,
          upsertedId: result.upsertedId ?? null,
        });
      }
      case "deleteOne":
      case "deleteMany": {
        const result = raw as { readonly acknowledged: boolean; readonly deletedCount: number };
        ctx.documentCount = result.deletedCount;
        if ((ctx.plan as WritePlan).orFail && result.deletedCount === 0) return PostProcessStep.notFound(ctx);
        return Object.freeze({ acknowledged: result.acknowledged, deletedCount: result.deletedCount });
      }
      case "findOneAndUpdate":
      case "findOneAndReplace":
      case "findOneAndDelete": {
        const plan = ctx.plan as ModifyPlan;
        const result = raw as { readonly value: Raw | null } & Raw;
        if (result.value !== null && PostProcessStep.validates(ctx))
          ReadValidator.check(ctx.target.schema, result.value);
        const value = result.value === null ? null : PostProcessStep.read(ctx, result.value, plan.lean);
        ctx.documentCount = value === null ? 0 : 1;
        if (plan.includeResultMetadata) return { ...result, value };
        if (value === null && plan.orFail) return PostProcessStep.notFound(ctx);
        return value;
      }
      case "insertOne":
      case "insertMany": {
        const { inserted } = raw as InsertOutcome;
        ctx.documentCount = inserted.size;
        const sorted = [...inserted.entries()].sort(([a], [b]) => a - b).map(([, doc]) => doc as Document);
        /* A document's own insert (`save`): the sent document is the answer (its `_id`), no second hydration.
           `insertMany` gets back the documents its records were built from. A skipped operation inserted nothing:
           its rows are the hook's and are hydrated like the server's. */
        const commit = ctx.document?.inserted;
        const docs =
          !ctx.isDocument || ctx.skipped !== undefined
            ? sorted.map((doc) => PostProcessStep.read(ctx, doc, false))
            : commit === undefined
              ? sorted
              : [...inserted.entries()].sort(([a], [b]) => a - b).map(([index, doc]) => commit(index, doc));
        return ctx.op === "insertOne" ? docs[0] : docs;
      }
      case "bulkWrite": {
        /* Documents written (bulkSave, bulkWrite) are counted like the single writes. */
        const result = (raw ?? {}) as Partial<
          Record<"insertedCount" | "modifiedCount" | "upsertedCount" | "deletedCount", number>
        >;
        ctx.documentCount =
          (result.insertedCount ?? 0) +
          (result.modifiedCount ?? 0) +
          (result.upsertedCount ?? 0) +
          (result.deletedCount ?? 0);
        return raw;
      }
      case "aggregate": {
        if (ctx.mode === "explain") return raw;
        const rows = raw as readonly unknown[];
        ctx.documentCount = (ctx.documentCount ?? 0) + rows.length;
        /* Populate's own aggregation hydrates the joined documents itself: rows as stored. */
        if (ctx.locals.has(OperationView.RAW_ROWS)) return rows;
        /* Mongoose H14: rows in stored names go back to code names by the result shape the encode step computed.
           The translator is compiled once per shape; a shape with nothing to translate keeps the driver's rows. */
        const shape = ctx.locals.get(OperationView.RESULT_SHAPE) as ResultShape | undefined;
        const translate = shape === undefined ? undefined : DbNames.translator(shape);
        return translate === undefined ? rows : rows.map(translate);
      }
      case "watch":
        return raw;
    }
  }
}
