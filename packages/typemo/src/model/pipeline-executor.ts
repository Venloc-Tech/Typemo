import type { AbstractCursor } from "mongodb";
import { ClientInternals } from "../connection/client-internals.ts";
import type { Connection } from "../connection/connection.ts";
import { ConnectionInternals } from "../connection/connection-internals.ts";
import { SessionGuard } from "../connection/session-guard.ts";
import { TransactionContext } from "../connection/transaction-context.ts";
import type { TransactionOptions } from "../connection/transaction-scope.ts";
import type { CursorSource } from "../cursor/typed-cursor.ts";
import { Documents } from "../document/documents.ts";
import { BulkWriteError } from "../errors/bulk-write-error.ts";
import { ErrorTranslator } from "../errors/error-translator.ts";
import { type ExecutionMode, type ExecutionPlan, WRITE_OPERATIONS } from "../operation/pipeline/execution-plan.ts";
import {
  type DocumentPrepare,
  type DocumentWrite,
  OperationContext,
  type OperationTarget,
} from "../operation/pipeline/operation-context.ts";
import type { StepName } from "../operation/pipeline/operation-step.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import { AuditPolicy } from "../policies/audit-policy.ts";
import type { FindPlan, ModifyPlan, OperationPlan, PlanExecutor } from "../query/plan.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { PlainReader } from "./plain-reader.ts";

/*
 * The bridge between the query builders (`PlanExecutor`) and the operation pipeline: every plan
 * becomes an `OperationContext` and runs through the connection's pipeline — `await`, `cursor()` and
 * `explain()` alike (one path; Mongoose had three).
 */

/** Runs plans of one model through its connection's pipeline. */
export class PipelineExecutor implements PlanExecutor {
  readonly #connection: Connection;
  readonly #target: OperationTarget;

  /**
   * @param connection - The connection whose pipeline runs the plans.
   * @param target - The model the plans belong to.
   */
  constructor(connection: Connection, target: OperationTarget) {
    this.#connection = connection;
    this.#target = target;
  }

  /** The compiled schema of the model (compiled with the connection's context). */
  get schema(): CompiledSchema {
    return this.#target.schema;
  }

  /**
   * A new context for a plan.
   *
   * @param plan - The plan to run.
   * @param mode - Run, explain or cursor.
   * @param locals - Extra per-operation values to seed the context with.
   * @param parent - The enclosing operation of a populate sub-query.
   * @param document - Set when the plan is a document write (`save`, `remove`).
   * @returns The new context.
   */
  context(
    plan: ExecutionPlan,
    mode: ExecutionMode,
    locals?: ReadonlyMap<symbol, unknown>,
    parent?: OperationContext,
    document?: DocumentWrite,
  ): OperationContext {
    const ctx = new OperationContext({
      plan,
      mode,
      target: this.#target,
      environment: ConnectionInternals.environment(this.#connection),
      ...(parent === undefined ? {} : { parent }),
      ...(document === undefined ? {} : { document }),
    });
    /* The documents this operation hydrates are bound to this connection (their `save`). */
    ctx.locals.set(Documents.CONNECTION, this.#connection);
    for (const [key, value] of locals ?? []) ctx.locals.set(key, value);
    return ctx;
  }

  /**
   * @internal Reports a document write that failed before its steps could run
   * (`OperationPipeline.reportFailure`), so its events and hooks still fire.
   *
   * @param plan - The plan of the failed write.
   * @param document - The document write.
   * @param error - The failure.
   * @param step - The step that would have run when it failed.
   * @returns The error the operation ended with.
   */
  reportFailure(plan: ExecutionPlan, document: DocumentWrite, error: unknown, step: StepName): Promise<unknown> {
    const ctx = this.context(plan, "run", undefined, undefined, document);
    return ConnectionInternals.pipeline(this.#connection).reportFailure(ctx, error, step);
  }

  /**
   * Runs any plan to completion. An audited write outside a transaction runs in its own transaction
   * (the write and its audit entry commit together); each attempt of it gets a fresh context (the driver retries
   * the whole callback on a transient error).
   *
   * @param plan - The plan to run.
   * @param mode - Run or explain.
   * @param locals - Extra per-operation values to seed the context with.
   * @param parent - The enclosing operation of a populate sub-query.
   * @param document - Set when the plan is a document write.
   * @returns The operation's result.
   */
  run(
    plan: ExecutionPlan,
    mode: ExecutionMode = "run",
    locals?: ReadonlyMap<symbol, unknown>,
    parent?: OperationContext,
    document?: DocumentWrite,
  ): Promise<unknown> {
    if (mode === "run" && this.#needsAuditTransaction(plan)) {
      const prepare = document?.prepare;
      if (prepare !== undefined) return this.#preparedFirst(plan, prepare, locals, parent, document);
      return this.#inAuditTransaction(plan, mode, locals, parent, document);
    }
    return ConnectionInternals.pipeline(this.#connection).run(this.context(plan, mode, locals, parent, document));
  }

  /**
   * An audited DOCUMENT write validates BEFORE its transaction opens (a failed validation opens and
   * rolls back nothing). The preparation runs once (the document memoizes it) on a scratch context; a failure
   * runs the operation outside a transaction, where the same preparation fails it at its step (`operation.error`).
   *
   * @param plan - The plan of the write.
   * @param prepare - The document's preparation (validation, timestamps).
   * @param locals - Extra per-operation values.
   * @param parent - The enclosing operation.
   * @param document - The document write.
   * @returns The operation's result.
   */
  async #preparedFirst(
    plan: ExecutionPlan,
    prepare: DocumentPrepare,
    locals: ReadonlyMap<symbol, unknown> | undefined,
    parent: OperationContext | undefined,
    document: DocumentWrite | undefined,
  ): Promise<unknown> {
    let failed = false;
    try {
      await prepare(this.context(plan, "run", locals, parent, document));
    } catch {
      failed = true;
    }
    if (failed) {
      return ConnectionInternals.pipeline(this.#connection).run(this.context(plan, "run", locals, parent, document));
    }
    return this.#inAuditTransaction(plan, "run", locals, parent, document);
  }

  /**
   * Runs an audited write and its audit entry in one transaction.
   *
   * @param plan - The plan of the write.
   * @param mode - Run or explain.
   * @param locals - Extra per-operation values.
   * @param parent - The enclosing operation.
   * @param document - The document write, if any.
   * @returns The operation's result.
   * @throws {BulkWriteError} When an unordered bulk had failures refused before the server.
   */
  #inAuditTransaction(
    plan: ExecutionPlan,
    mode: ExecutionMode,
    locals: ReadonlyMap<symbol, unknown> | undefined,
    parent: OperationContext | undefined,
    document: DocumentWrite | undefined,
  ): Promise<unknown> {
    /* The write's own write concern and deadline become the transaction's (inside one, per-operation ones are
       refused). */
    const { session, writeConcern, timeoutMS, ...rest } = plan.options;
    const transaction: TransactionOptions = {
      ...(writeConcern === undefined
        ? {}
        : { writeConcern: writeConcern as TransactionOptions["writeConcern"] & object }),
      ...(timeoutMS === undefined ? {} : { timeoutMS }),
    };
    /* An unordered bulk whose only failures were refused BEFORE the server (cast, validation)
       commits its written part and its audit entry, then reports the refused ones; a server write error has
       aborted the transaction (nothing written). */
    let refused: BulkWriteError | undefined;
    return ClientInternals.auditTransaction(
      this.#connection.client,
      `${this.#target.entity.name}.${plan.options.method ?? plan.op}`,
      async (scope) => {
        refused = undefined;
        const joined = Object.freeze({ ...plan, options: Object.freeze({ ...rest, session: scope.session }) });
        try {
          return await ConnectionInternals.pipeline(this.#connection).run(
            this.context(joined as ExecutionPlan, mode, locals, parent, document),
          );
        } catch (error) {
          if (!(error instanceof BulkWriteError) || error.writeErrors.some((failure) => failure.code !== undefined)) {
            throw error;
          }
          refused = error;
          return undefined;
        }
      },
      session ?? undefined,
      transaction,
    ).then((result) => {
      if (refused !== undefined) throw refused;
      return result;
    });
  }

  /**
   * Tells whether the plan is an audited write that is not inside a transaction (its explicit session's, or the
   * ambient one of this client).
   *
   * @param plan - The plan to check.
   * @returns `true` when the write needs its own transaction for the audit entry.
   */
  #needsAuditTransaction(plan: ExecutionPlan): boolean {
    if (!WRITE_OPERATIONS.has(plan.op) || AuditPolicy.collectionOf(this.#target.schema) === undefined) return false;
    const session = plan.options.session;
    if (session !== undefined && session !== null) return !session.inTransaction();
    if (session === null) return true;
    /* An ambient transaction of another client: the context step refuses the operation (it cannot join it). */
    return TransactionContext.current() === undefined;
  }

  /**
   * Runs a plan and returns its result; with `.plain()` the result is converted to its plain form.
   *
   * @param plan - The plan to run.
   * @returns The operation's result.
   */
  execute(plan: OperationPlan): Promise<unknown> {
    const explain = "mode" in plan && plan.mode.kind === "explain";
    const result = this.run(plan, explain ? "explain" : "run");
    const plain = "plain" in plan ? plan.plain : undefined;
    if (plain === undefined || explain) return result;
    /* `.plain()`: the lean result of the whole pipeline (post hooks included) in its plain form. */
    const { populate } = plan as FindPlan | ModifyPlan;
    const schema = this.#target.schema;
    return result.then((value) => {
      if (Array.isArray(value)) return PlainReader.rows(schema, value, plain, populate);
      if ((plan as Partial<ModifyPlan>).includeResultMetadata === true && value !== null && typeof value === "object") {
        const metadata = value as { readonly value: unknown };
        return { ...metadata, value: PlainReader.row(schema, metadata.value, plain, populate) };
      }
      return PlainReader.row(schema, value, plain, populate);
    });
  }

  /**
   * A cursor over a find plan; with `.plain()` each row is converted to its plain form.
   *
   * @param plan - The find plan.
   * @returns The cursor source.
   */
  cursor(plan: FindPlan): CursorSource<unknown> {
    const source = this.stream(plan);
    const plain = plan.plain;
    if (plain === undefined) return source;
    /* Each row of each batch (after its post hooks) in its plain form. */
    const schema = this.#target.schema;
    return {
      async *[Symbol.asyncIterator]() {
        for await (const row of source) yield PlainReader.row(schema, row, plain, plan.populate);
      },
      ...(source.close === undefined ? {} : { close: source.close }),
    };
  }

  /**
   * A cursor over any cursor-capable plan (find, aggregate): the steps before `execute` run when
   * iteration starts; then each DRIVER batch goes through postProcess → populate → audit → hooksPost
   * (the same order as `await`), and `instrumentEnd` runs when the cursor ends or is closed.
   *
   * @param plan - The plan to stream.
   * @param locals - Extra per-operation values.
   * @returns The cursor source; `close` stops the iteration and closes the driver cursor.
   */
  stream(plan: ExecutionPlan, locals?: ReadonlyMap<symbol, unknown>): CursorSource<unknown> {
    const pipeline = ConnectionInternals.pipeline(this.#connection);
    let driverCursor: AbstractCursor | undefined;
    let closed = false;
    const context = (): OperationContext => this.context(plan, "cursor", locals);
    return {
      async *[Symbol.asyncIterator]() {
        const ctx = context();
        await pipeline.open(ctx);
        if (ctx.skipped !== undefined) {
          /* A pre hook skipped the operation: its rows are the one batch, through the same steps. */
          const processed = await pipeline.processBatch(ctx, ctx.result as readonly unknown[]);
          for (const doc of processed) yield doc;
          await pipeline.finish(ctx);
          return;
        }
        driverCursor = ctx.result as AbstractCursor;
        const label = `${OperationView.where(ctx)} (cursor)`;
        const hub = ctx.environment.instrumentation;
        let ended = false;
        let batchIndex = 0;
        try {
          while (!closed) {
            const cursor = driverCursor;
            let first: unknown;
            try {
              /* One fetch in flight per session; none is held between batches. */
              first = await SessionGuard.around(ctx.session, label, () => cursor.next(), "read");
            } catch (error) {
              ended = true;
              await pipeline.fail(ctx, ErrorTranslator.wrap(error));
            }
            if (first === null || first === undefined) break;
            const batch = [first, ...cursor.readBufferedDocuments()];
            if (hub.enabled) {
              hub.emit({
                type: "cursor.batch",
                operationId: ctx.id,
                timestamp: Date.now(),
                batch: batchIndex,
                size: batch.length,
              });
            }
            batchIndex++;
            let processed: unknown[];
            try {
              processed = await pipeline.processBatch(ctx, batch);
            } catch (error) {
              ended = true;
              throw error;
            }
            for (const doc of processed) yield doc;
          }
          /* A cursor that found nothing still ends in its post hooks, once, with no rows (like `await`). */
          if (batchIndex === 0 && !closed) {
            try {
              await pipeline.processBatch(ctx, []);
            } catch (error) {
              ended = true;
              throw error;
            }
          }
          ended = true;
          await pipeline.finish(ctx);
        } finally {
          if (!ended) await pipeline.finish(ctx).catch(() => undefined);
          await driverCursor?.close().catch(() => undefined);
        }
      },
      close: async () => {
        closed = true;
        await driverCursor?.close().catch(() => undefined);
      },
    };
  }
}
