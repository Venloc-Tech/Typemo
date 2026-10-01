import type { OperationContext } from "../operation-context.ts";
import type { OperationStep } from "../operation-step.ts";
import { InstrumentStartStep } from "./instrument-start-step.ts";
import { OperationEvents } from "./operation-events.ts";

/** The `instrumentEnd` step: `operation.end`, or `operation.error` with the classified error. */
export class InstrumentEndStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "instrumentEnd";

  /**
   * Emits `operation.end` when someone listens.
   *
   * @param ctx - The context of the operation.
   */
  run(ctx: OperationContext): void {
    const hub = ctx.environment.instrumentation;
    if (!hub.enabled) return;
    hub.emit(
      {
        type: "operation.end",
        ...OperationEvents.info(ctx),
        timestamp: Date.now(),
        durationMS: performance.now() - ctx.startedAt,
        documentCount: ctx.documentCount,
      },
      undefined,
      OperationEvents.tenant(ctx),
    );
  }

  /**
   * Emits `operation.error` when someone listens.
   *
   * @param ctx - The context of the operation; `ctx.error` holds the classified error.
   */
  onError(ctx: OperationContext): void {
    const hub = ctx.environment.instrumentation;
    if (!hub.enabled) return;
    /* A failure before `instrumentStart` (prepare, pre hooks, validation) still opens with `operation.start`. */
    InstrumentStartStep.emit(ctx);
    hub.emit(
      OperationEvents.error(ctx, "mask"),
      hub.wantsValues ? (sensitive) => OperationEvents.error(ctx, sensitive) : undefined,
      OperationEvents.tenant(ctx),
    );
  }
}
