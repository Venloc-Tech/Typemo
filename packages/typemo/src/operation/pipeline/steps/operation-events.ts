import type { PipelineStage } from "../../../aggregate/pipeline/aggregate-plan.ts";
import { TransactionContext } from "../../../connection/transaction-context.ts";
import { ErrorClassifier } from "../../../errors/error-classifier.ts";
import type {
  EmittedEvent,
  OperationInfo,
  OperationStartEvent,
  OperationSummary,
} from "../../../instrumentation/instrumentation-events.ts";
import type { SubscriberSensitive } from "../../../instrumentation/instrumentation-hub.ts";
import { OperationLink, OperationScope } from "../../../instrumentation/operation-scope.ts";
import { type MaskFailureSink, SensitiveMask } from "../../../policies/sensitive-mask.ts";
import type { PlanDocument } from "../../../query/plan.ts";
import { OperationView } from "../../steps/operation-view.ts";
import type { OperationContext } from "../operation-context.ts";
import { ResolveContextStep } from "./resolve-context-step.ts";

/* Builders of operation events. Called ONLY after `instrumentation.enabled` was checked: no event object exists
   without a subscriber. */

/** What the summary is built from (captured when `operation.start` is built). */
interface SummaryInput {
  readonly schema: OperationContext["target"]["schema"];
  readonly filter: OperationContext["filter"];
  readonly update: OperationContext["update"];
  readonly pipeline: OperationContext["pipeline"];
  readonly projection: OperationContext["projection"];
  readonly sort: OperationContext["sort"];
  readonly documents: OperationContext["documents"];
  readonly operations: OperationContext["operations"];
}

/* `ctx.locals` key: the operation's mask failure sink. */
const MASK_SINK = Symbol("maskSink");

/** Builders of the operation events (`operation.start`, `operation.error`, ...). */
export class OperationEvents {
  /**
   * The operation's sink of mask failures (the hub's, one report per path for the whole operation), for the work
   * outside `emit`: the value steps, the masked error, a summary read later.
   *
   * @param ctx - The context of the operation.
   * @returns The sink, created on first use.
   */
  static maskSink(ctx: OperationContext): MaskFailureSink {
    /* The slot holds only what this method put there. */
    const known = ctx.locals.get(MASK_SINK) as MaskFailureSink | undefined;
    if (known !== undefined) return known;
    const target = ctx.target;
    const sink = ctx.environment.instrumentation.maskSink(
      target.scope === undefined ? target.entity.name : undefined,
      true,
    );
    ctx.locals.set(MASK_SINK, sink);
    return sink;
  }

  /**
   * Runs `run` (synchronous) with mask failures going to {@link maskSink}; a plain call without subscribers.
   *
   * @param ctx - The context of the operation.
   * @param run - The synchronous work.
   * @returns What `run` returned.
   */
  static reporting<T>(ctx: OperationContext, run: () => T): T {
    return ctx.environment.instrumentation.enabled
      ? SensitiveMask.reporting(OperationEvents.maskSink(ctx), run)
      : run();
  }

  /**
   * The operation, WITHOUT the tenant (the hub adds it for `includeTenant` subscribers).
   *
   * @param ctx - The context of the operation.
   * @returns The common part of every operation event.
   */
  static info(ctx: OperationContext): OperationInfo {
    const link = ctx.locals.get(OperationScope.LINK);
    /* The address of the operation's last command beats the connection string's first host. */
    const server =
      (link instanceof OperationLink ? OperationEvents.address(link.address) : undefined) ?? ctx.environment.server;
    const path = ctx.locals.get(OperationView.POPULATE_PATH);
    const target = ctx.target;
    /* A database-level operation has no model: its synthetic entity and empty schema stay internal. */
    const model = target.scope === undefined;
    return {
      operationId: ctx.id,
      parentId: ctx.parent?.id,
      operation: ctx.op,
      mode: ctx.mode,
      model: model ? target.entity.name : null,
      collection: model || target.scope === "sessions" ? target.collection : null,
      database: target.database,
      connection: ctx.environment.connectionName,
      inTransaction: ctx.inTransaction,
      transactionId: OperationEvents.transactionOf(ctx),
      serverAddress: server?.address,
      serverPort: server?.port,
      populatePath: typeof path === "string" ? path : undefined,
      schema: model ? target.schema : null,
    };
  }

  /**
   * The `connection.transaction()` the operation runs in. `wrap` runs before `resolveContext` (no session yet):
   * then the ambient transaction is the one the operation will join; after it, the session must be the scope's.
   *
   * @param ctx - The context of the operation.
   * @returns The transaction id, or `undefined` outside a transaction.
   */
  private static transactionOf(ctx: OperationContext): number | undefined {
    if (ctx.session !== undefined) {
      /* The transaction session may be given explicitly (also outside the callback's async context). */
      const own = TransactionContext.ofSession(ctx.session);
      return own !== undefined && ctx.inTransaction ? own.id : undefined;
    }
    return TransactionContext.current()?.id;
  }

  /**
   * Splits `host:port` (or `[v6]:port`) of a driver event into address and port.
   *
   * @param address - The address as the driver reports it.
   * @returns The address and port, or `undefined` when there is no address.
   */
  static address(
    address: string | undefined,
  ): { readonly address: string; readonly port: number | undefined } | undefined {
    if (address === undefined) return undefined;
    const colon = address.lastIndexOf(":");
    if (colon <= 0 || address.endsWith("]")) return { address, port: undefined };
    const port = Number(address.slice(colon + 1));
    const host = address.slice(0, colon);
    return Number.isInteger(port)
      ? { address: host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host, port }
      : { address, port: undefined };
  }

  /**
   * The tenant to hand to `includeTenant` subscribers.
   *
   * @param ctx - The context of the operation.
   * @returns The tenant, or `undefined` when nobody wants it or there is none.
   */
  static tenant(ctx: OperationContext): unknown {
    if (!ctx.environment.instrumentation.wantsTenant) return undefined;
    /* `wrap` runs before `resolveContext`: the policy is resolved the same way it will be. */
    return ctx.policy.tenant ?? ResolveContextStep.policy(ctx).tenant;
  }

  /**
   * The summary of the input for a subscriber `sensitive`: a field's own mark (and an unmarked `Hidden`
   * field: "mask") wins, the subscriber default covers the rest. The values are in DB form (after encode): the
   * mask matches code AND db paths, walks every stage (`$lookup.pipeline`, `$facet`, `$set`/`$addFields`
   * literals) and masks expressions referencing a marked field.
   *
   * @param ctx - The values the summary is built from.
   * @param sensitive - The subscriber's `sensitive` setting.
   * @returns The masked summary.
   */
  static summary(ctx: SummaryInput, sensitive: SubscriberSensitive): OperationSummary {
    const schema = ctx.schema;
    const mask = (value: unknown): unknown => SensitiveMask.event(schema, value, sensitive);
    const filter = (value: PlanDocument): unknown => mask(value);
    const update = (value: PlanDocument | readonly PlanDocument[]): unknown => mask(value);
    const pipeline = (value: readonly PipelineStage[]): unknown => mask(value);
    const count = ctx.documents?.length ?? ctx.operations?.length;
    return {
      ...(ctx.filter === undefined ? {} : { filter: filter(ctx.filter) }),
      ...(ctx.update === undefined ? {} : { update: update(ctx.update) }),
      ...(ctx.pipeline === undefined ? {} : { pipeline: pipeline(ctx.pipeline) }),
      ...(ctx.projection === undefined
        ? {}
        : { projection: SensitiveMask.projection(schema, ctx.projection, sensitive) }),
      ...(ctx.sort === undefined ? {} : { sort: ctx.sort }),
      ...(count === undefined ? {} : { count }),
    };
  }

  /**
   * `operation.start` with a lazy summary: built on first access, then cached.
   *
   * @param ctx - The context of the operation.
   * @param sensitive - The subscriber's `sensitive` setting.
   * @returns The event.
   */
  static start(ctx: OperationContext, sensitive: SubscriberSensitive): OperationStartEvent {
    let summary: OperationSummary | undefined;
    /* A subscriber may read the summary after `handle` returned (outside `emit`): a mask failing then still
       reaches the subscribers of this model, not the console. */
    const sink = OperationEvents.maskSink(ctx);
    /* The input as it is now (steps replace these values, never mutate them): a later read sees the start state. */
    const input: SummaryInput = {
      schema: ctx.target.schema,
      filter: ctx.filter,
      update: ctx.update,
      pipeline: ctx.pipeline,
      projection: ctx.projection,
      sort: ctx.sort,
      documents: ctx.documents,
      operations: ctx.operations,
    };
    return {
      type: "operation.start",
      ...OperationEvents.info(ctx),
      timestamp: Date.now(),
      get summary(): OperationSummary {
        summary ??= SensitiveMask.reporting(sink, () => OperationEvents.summary(input, sensitive));
        return summary;
      },
    };
  }

  /**
   * `operation.error` for a subscriber `sensitive`: the error's unmarked values follow it like a filter's
   * ("show" gets the thrown error, already masked by the field marks); the classification is the thrown error's.
   *
   * @param ctx - The context of the operation.
   * @param sensitive - The subscriber's `sensitive` setting.
   * @returns The event.
   */
  static error(
    ctx: OperationContext,
    sensitive: SubscriberSensitive,
  ): Extract<EmittedEvent, { readonly type: "operation.error" }> {
    return {
      type: "operation.error",
      ...OperationEvents.info(ctx),
      timestamp: Date.now(),
      durationMS: performance.now() - ctx.startedAt,
      failedStep: ctx.failedStep,
      /* "show" too goes through the mask (a no-op for an error already masked by `fail`, but an error an
         `onError` put in its place is masked as well): the hub takes only a `MaskedError`. Built before `emit`, so a
         failing mask function still becomes an `instrumentation.error` event. */
      error: OperationEvents.reporting(ctx, () => SensitiveMask.error(ctx.target.schema, ctx.error, sensitive)),
      classification: ErrorClassifier.classify(ctx.error),
    };
  }
}
