import { AuditError } from "../errors/audit-error.ts";
import { BulkWriteError, type BulkWriteSummary } from "../errors/bulk-write-error.ts";
import { DriverExecutor } from "../operation/executor/driver-executor.ts";
import { WRITE_OPERATIONS } from "../operation/pipeline/execution-plan.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import type { OperationStep } from "../operation/pipeline/operation-step.ts";
import { OperationView, type WorkUnit } from "../operation/steps/operation-view.ts";
import type { PlanDocument } from "../query/plan.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { SensitiveMask } from "./sensitive-mask.ts";

/*
 * The audit policy (off unless `@Schema({ audit })`): every WRITE of the model leaves one
 * entry in the audit collection (`<collection>_audit` unless `audit: { collection }`):
 * - in the SAME session as the write, after it — the `audit` slot of the pipeline, between `populate` and
 *   the post hooks;
 * - every write path: `insertOne`/`insertMany`/`create`/`save`/`bulkSave`, `bulkWrite`, updates, replaces,
 *   deletes (a soft delete is recorded as the delete it is, with `softDelete: true`), `findOneAnd*`,
 *   a document's `$save`/`$deleteOne`/`$updateOne`;
 * - the values are the operation's CAST values in code names (taken before the encode step), secrets masked
 *   by the field option `sensitive` (`SensitiveMask`) in the filter, the update and the documents;
 * - an unordered `insertMany`/`bulkWrite` that failed in part is recorded with `outcome: "partial"` and what
 *   the server says was written.
 * A failed audit write fails the operation with `AuditError`, and the transaction is aborted: the write is rolled
 * back with it. An audited write called outside a transaction runs in its OWN transaction
 * (`PipelineExecutor`), so the write and its entry always commit together — which needs a replica set or a sharded
 * cluster (a standalone mongod is a `ConfigurationError`). `AuditError.applied` is therefore `false` for writes of
 * the models. A bulk that fails in part inside a transaction commits nothing (the server aborts the transaction on
 * a write error): no "partial" entry then. Not audited: reads, aggregations
 * with `$out`/`$merge` (reported), a write skipped by a pre hook (nothing was written).
 *
 * What an entry names is what the OPERATION named: a write by a filter records the filter, not the `_id` of every
 * document it touched. `updateMany({ status: "open" }, …)` leaves ONE entry with `filter: { status: "open" }` and the
 * counts; the ids of the affected documents are not in it. A history of ONE document is therefore complete only for
 * writes that name it: the filter carries its `_id` (`updateOne({ _id }, …)`, `$save`, `$deleteOne`, `$updateOne`).
 * To keep a per-document trail of a write by a broader filter, read the ids first, inside the same transaction, and
 * write by them:
 *
 * ```ts
 * await client.transaction(async () => {
 *   const ids = (await Orders.find({ status: "open" }).select({ _id: 1 }).lean()).map((row) => row._id);
 *   await Orders.updateMany({ _id: { $in: ids } }, { $set: { status: "closed" } }); // the entry names the ids
 * });
 * ```
 */

/**
 * One entry of the audit trail.
 *
 * @example
 * const entry: AuditEntry = {
 *   at: new Date(), model: "User", collection: "users", operation: "updateOne", document: false,
 *   result: { matchedCount: 1, modifiedCount: 1 }, outcome: "ok",
 * };
 */
export interface AuditEntry {
  /** When the entry was made. */
  readonly at: Date;
  /** The model (the class name). */
  readonly model: string;
  /** The collection of the model. */
  readonly collection: string;
  /** The operation (`updateMany`, `insertMany`, …; a document's `$save` is `insertOne`/`updateOne`). */
  readonly operation: string;
  /** A document write (`$save`, `$deleteOne`, `$updateOne`, `bulkSave`, `create`, `insertOne`). */
  readonly document: boolean;
  /** `ctx.policy.actor`. */
  readonly actor?: unknown;
  /** `ctx.policy.tenant` (the operation's tenant). */
  readonly tenant?: unknown;
  /**
   * The filter of the write as the caller gave it (masked). For a write by a filter without `_id` (`updateMany`,
   * `deleteMany`, …) it is that filter, not the ids of the affected documents: see the header of this file for how
   * to get a per-document history.
   */
  readonly filter?: PlanDocument;
  /** The update of the write (masked). */
  readonly update?: PlanDocument | readonly PlanDocument[];
  /** The replacement of the write (masked). */
  readonly replacement?: PlanDocument;
  /** Inserted documents (only those written). */
  readonly documents?: readonly PlanDocument[];
  /** `bulkWrite`: the operations sent (masked). */
  readonly operations?: readonly PlanDocument[];
  /** Counts the server reported (and the `_id` of a find-and-modify document). */
  readonly result: Readonly<Record<string, unknown>>;
  /** `"partial"` when a bulk failed after writing something. */
  readonly outcome: "ok" | "partial";
  /** A soft delete (an update of the delete date recorded as the delete it is). */
  readonly softDelete?: true;
}

/** The `ctx.locals` key of the cast values captured before the encode step. */
const SNAPSHOT = Symbol("typemo.audit.snapshot");
/** The `ctx.locals` key set once an entry has been written. */
const WRITTEN = Symbol("typemo.audit.written");

/**
 * The work units of a write as captured before the encode step.
 *
 * @example
 * const snapshot: Snapshot = OperationView.units(ctx);
 */
type Snapshot = readonly WorkUnit[];

/**
 * The audit policy.
 *
 * @example
 * AuditPolicy.collectionOf(schema); // "users_audit", or `undefined` when the model is not audited
 */
export class AuditPolicy {
  /**
   * The audit collection of a schema, `undefined` when the model is not audited.
   *
   * @param schema - The compiled schema.
   * @returns The collection name, or `undefined`.
   */
  static collectionOf(schema: CompiledSchema): string | undefined {
    const option = schema.root.options.audit;
    if (option === undefined) return undefined;
    return option === true
      ? `${schema.root.collection}_audit`
      : (option.collection ?? `${schema.root.collection}_audit`);
  }

  /**
   * Takes the CAST values of a write before the encode step (called at the end of the `validate` slot):
   * code names, defaults and policies applied. Nothing for a model without audit or for a read.
   *
   * @param ctx - The operation context.
   */
  static capture(ctx: OperationContext): void {
    if (!WRITE_OPERATIONS.has(ctx.op) || AuditPolicy.collectionOf(ctx.target.schema) === undefined) return;
    ctx.locals.set(SNAPSHOT, OperationView.units(ctx));
  }

  /**
   * The entry of a write (`outcome` "partial": from the summary of a failed bulk).
   *
   * @param ctx - The operation context.
   * @param units - The captured work units.
   * @param result - The counts to record.
   * @param outcome - `"ok"`, or `"partial"` for a bulk that failed in part.
   * @param written - Tells whether a unit was written (only those are recorded in bulks).
   * @returns The entry, with secrets masked.
   */
  private static entry(
    ctx: OperationContext,
    units: Snapshot,
    result: Readonly<Record<string, unknown>>,
    outcome: "ok" | "partial",
    written: (unit: WorkUnit) => boolean,
  ): AuditEntry {
    const schema = ctx.target.schema;
    /* One walker for every output: marks win, an unmarked `Hidden` field is "mask", the rest is shown. */
    const filter = (value: PlanDocument): PlanDocument => SensitiveMask.audit(schema, value);
    const update = (value: PlanDocument | readonly PlanDocument[]) => SensitiveMask.audit(schema, value);
    const doc = (value: PlanDocument): PlanDocument => SensitiveMask.audit(schema, value);
    const base = {
      at: new Date(),
      model: schema.name,
      collection: ctx.target.collection,
      operation: ctx.op,
      document: ctx.document !== undefined && ctx.document.model !== true,
      ...(ctx.policy.actor === undefined ? {} : { actor: ctx.policy.actor }),
      ...(ctx.policy.tenant === undefined ? {} : { tenant: ctx.policy.tenant }),
      result,
      outcome,
      ...(ctx.softDelete ? { softDelete: true as const } : {}),
    };
    if (ctx.op === "insertOne" || ctx.op === "insertMany") {
      return {
        ...base,
        documents: units.filter(written).map((unit) => doc(unit.document as PlanDocument)),
      };
    }
    if (ctx.op === "bulkWrite") {
      return {
        ...base,
        operations: units.filter(written).map((unit) => {
          const spec: Record<string, unknown> = {};
          if (unit.filter !== undefined) spec.filter = filter(unit.filter);
          if (unit.update !== undefined) spec.update = update(unit.update);
          if (unit.replacement !== undefined) spec.replacement = doc(unit.replacement);
          if (unit.document !== undefined) spec.document = doc(unit.document);
          if (unit.upsert) spec.upsert = true;
          return Object.freeze({ [unit.kind]: Object.freeze(spec) });
        }),
      };
    }
    const [unit] = units;
    return {
      ...base,
      ...(unit?.filter === undefined ? {} : { filter: filter(unit.filter) }),
      ...(unit?.update === undefined ? {} : { update: update(unit.update) }),
      ...(unit?.replacement === undefined ? {} : { replacement: doc(unit.replacement) }),
    };
  }

  /**
   * The counts of a successful write's result (post-processed).
   *
   * @param ctx - The operation context.
   * @returns The counts (`insertedCount`, `found` and `_id` for find-and-modify, the driver's counts otherwise).
   */
  private static counts(ctx: OperationContext): Readonly<Record<string, unknown>> {
    const result = ctx.result;
    switch (ctx.op) {
      case "insertOne":
      case "insertMany":
        return { insertedCount: ctx.documentCount ?? 0 };
      case "findOneAndUpdate":
      case "findOneAndReplace":
      case "findOneAndDelete": {
        const value =
          result !== null && typeof result === "object" && "value" in result && "ok" in result
            ? (result as { readonly value: unknown }).value
            : result;
        const id = value !== null && typeof value === "object" ? (value as { readonly _id?: unknown })._id : undefined;
        return { found: value !== null && value !== undefined ? 1 : 0, ...(id === undefined ? {} : { _id: id }) };
      }
      default: {
        if (result === null || typeof result !== "object") return {};
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(result)) if (key !== "acknowledged") out[key] = value;
        return out;
      }
    }
  }

  /**
   * Writes the entry of a successful write (the `audit` slot).
   *
   * @param ctx - The operation context.
   * @throws {AuditError} When building or writing the entry fails.
   */
  static async afterWrite(ctx: OperationContext): Promise<void> {
    const units = ctx.locals.get(SNAPSHOT) as Snapshot | undefined;
    if (units === undefined || ctx.mode !== "run" || ctx.skipped !== undefined) return;
    const entry = AuditPolicy.masked(ctx, undefined, () =>
      AuditPolicy.entry(ctx, units, AuditPolicy.counts(ctx), "ok", (unit) => !ctx.isRejected(unit.index)),
    );
    await AuditPolicy.write(ctx, entry, undefined);
  }

  /**
   * A bulk (`insertMany`/`bulkWrite`) whose driver call failed after writing something: its written part is
   * recorded (called by the `execute` step, so the post-error hooks and the instrumentation — whose
   * `onError` run in reverse step order — see the final error). The failure of this audit write becomes the
   * error (`AuditError` with the bulk error as `operationError`).
   *
   * @param ctx - The operation context.
   * @param error - What the driver call threw.
   * @throws {AuditError} When building or writing the entry fails.
   */
  static async afterFailure(ctx: OperationContext, error: unknown): Promise<void> {
    const units = ctx.locals.get(SNAPSHOT) as Snapshot | undefined;
    if (units === undefined || !(error instanceof BulkWriteError) || ctx.locals.has(WRITTEN)) return;
    /*
     * A SERVER write error inside a transaction has ABORTED it: nothing of the bulk will commit, so there is nothing
     * to record — and a write in the aborted transaction fails with 251 (TransientTransactionError), which made
     * withTransaction retry the whole callback in a loop (the bulk error is the error). Documents
     * refused before the server (cast, validation: no code) leave the transaction alive: the written part is recorded.
     */
    if (ctx.inTransaction && error.writeErrors.some((failure) => failure.code !== undefined)) return;
    const summary: BulkWriteSummary = error.result;
    const changed = summary.insertedCount + summary.modifiedCount + summary.deletedCount + summary.upsertedCount;
    if (changed === 0) return;
    const failed = new Set(error.writeErrors.map((failure) => failure.index));
    const inserted = new Set(Object.keys(summary.insertedIds).map(Number));
    const written = (unit: WorkUnit): boolean =>
      ctx.op === "insertMany" ? inserted.has(unit.index) : !failed.has(unit.index) && !ctx.isRejected(unit.index);
    const { insertedIds: _ids, upsertedIds: _upserted, ...counts } = summary;
    const entry = AuditPolicy.masked(ctx, error, () => AuditPolicy.entry(ctx, units, counts, "partial", written));
    await AuditPolicy.write(ctx, entry, error);
  }

  /**
   * Builds an entry; a `sensitive` mask function that throws fails the operation like a failed audit write.
   *
   * @param ctx - The operation context.
   * @param operationError - The error of the operation, when the entry is built after a failure.
   * @param build - Builds the entry.
   * @returns The entry.
   * @throws {AuditError} When `build` throws.
   */
  private static masked(ctx: OperationContext, operationError: unknown, build: () => AuditEntry): AuditEntry {
    try {
      return build();
    } catch (error) {
      throw new AuditError(ctx.target.entity.name, OperationView.called(ctx), {
        cause: error,
        ...(operationError === undefined ? {} : { operationError }),
      });
    }
  }

  /**
   * Inserts the entry into the audit collection, in the operation's session.
   *
   * @param ctx - The operation context.
   * @param entry - The entry.
   * @param operationError - The error of the operation, when the entry is written after a failure.
   * @throws {AuditError} When the insert fails.
   */
  private static async write(ctx: OperationContext, entry: AuditEntry, operationError: unknown): Promise<void> {
    const collection = AuditPolicy.collectionOf(ctx.target.schema) as string;
    ctx.locals.set(WRITTEN, true);
    try {
      await DriverExecutor.insertAudit(ctx, collection, entry);
    } catch (error) {
      throw new AuditError(ctx.target.entity.name, OperationView.called(ctx), {
        cause: error,
        ...(operationError === undefined ? {} : { operationError }),
      });
    }
  }
}

/** The pipeline step that writes the audit entry of a write, in the operation's session. */
export class AuditStep implements OperationStep {
  /** The step name, as it appears in diagnostics. */
  readonly name = "audit";

  /**
   * Writes the audit entry when the operation captured a snapshot.
   *
   * @param ctx - The operation context.
   * @returns A promise when the entry is written asynchronously.
   * @throws {AuditError} When the audit write fails.
   */
  run(ctx: OperationContext): void | Promise<void> {
    if (!ctx.locals.has(SNAPSHOT)) return;
    return AuditPolicy.afterWrite(ctx);
  }

  /**
   * A model without audit never has a snapshot (`capture`), so there is nothing to run.
   *
   * @param schema - The schema of the model.
   * @returns Whether the model has an audit collection.
   */
  needed(schema: CompiledSchema): boolean {
    return AuditPolicy.collectionOf(schema) !== undefined;
  }
}
