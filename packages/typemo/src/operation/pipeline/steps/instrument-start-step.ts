import type { StepEvent } from "../../../instrumentation/instrumentation-events.ts";
import type { OperationContext } from "../operation-context.ts";
import type { OperationStep } from "../operation-step.ts";
import { OperationEvents } from "./operation-events.ts";

/** The `instrumentStart` step: `operation.start`, only when someone listens. */
export class InstrumentStartStep implements OperationStep {
  /** The slot of the step. */
  readonly name = "instrumentStart";

  /**
   * Emits `operation.start` when someone listens.
   *
   * @param ctx - The context of the operation.
   */
  run(ctx: OperationContext): void {
    InstrumentStartStep.emit(ctx);
  }

  /**
   * Emits an `operation.step` event, held until `operation.start` is out so that it never precedes it.
   *
   * @param ctx - The context of the operation.
   * @param event - The step event.
   */
  static step(ctx: OperationContext, event: StepEvent): void {
    if (ctx.instrumentStarted) {
      ctx.environment.instrumentation.emit(event);
      return;
    }
    if (ctx.heldSteps === undefined) ctx.heldSteps = [event];
    else ctx.heldSteps.push(event);
  }

  /**
   * Emits `operation.start` once per operation, then the step events held before it.
   *
   * @param ctx - The context of the operation.
   */
  static emit(ctx: OperationContext): void {
    const hub = ctx.environment.instrumentation;
    if (!hub.enabled || ctx.instrumentStarted) return;
    ctx.instrumentStarted = true;
    hub.emit(
      OperationEvents.start(ctx, "mask"),
      hub.wantsValues ? (sensitive) => OperationEvents.start(ctx, sensitive) : undefined,
      OperationEvents.tenant(ctx),
    );
    const held = ctx.heldSteps;
    if (held === undefined) return;
    ctx.heldSteps = undefined;
    for (const event of held) hub.emit(event);
  }
}
