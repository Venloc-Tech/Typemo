import { ConfigurationError } from "../../errors/configuration-error.ts";
import { HookErrors } from "../../hooks/hook-errors.ts";
import { SensitiveMask } from "../../policies/sensitive-mask.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { DocumentPrepare, OperationContext } from "./operation-context.ts";
import { type OperationStep, STEP_ORDER, type StepName } from "./operation-step.ts";
import { InstrumentStartStep } from "./steps/instrument-start-step.ts";
import { OperationEvents } from "./steps/operation-events.ts";

/**
 * A slot that does nothing; it fills every slot no step was given for.
 *
 * @example
 * ```ts
 * const step = new PassThroughStep("audit");
 * ```
 */
export class PassThroughStep implements OperationStep {
  /**
   * @param name - The slot this step stands in for.
   */
  constructor(readonly name: StepName) {}

  /** Does nothing. */
  run(): void {}
}

/**
 * Steps by slot.
 *
 * @example
 * ```ts
 * const steps: StepSet = { execute: new ExecuteStep() };
 * ```
 */
export type StepSet = { readonly [K in StepName]?: OperationStep };

const AFTER_EXECUTE: readonly StepName[] = ["postProcess", "populate", "audit", "hooksPost"];

/* The steps that turn the operation's code-form values into what the driver gets; a pre hook's change reruns them. */
const VALUE_STEPS: readonly StepName[] = ["normalize", "resolvePaths", "cast", "policies", "defaults", "validate"];

/* Steps reported as nested `operation.step` events. */
const NESTED: ReadonlySet<StepName> = new Set<StepName>(["cast", "validate", "hooksPre", "hooksPost", "populate"]);

/**
 * Tells whether a step returned a promise, so the pipeline awaits only when it has to.
 *
 * @param value - What the step returned.
 * @returns `true` for a thenable.
 */
const isPromise = (value: unknown): value is Promise<void> =>
  typeof value === "object" && value !== null && typeof (value as Promise<void>).then === "function";

/**
 * The steps a model runs: the pipeline without the steps that can do nothing for its schema.
 *
 * @example
 * ```ts
 * const { all, open, batch } = pipeline.active(ctx);
 * ```
 */
export interface ActiveSteps {
  /** Every needed step (`await`, explain). */
  readonly all: readonly OperationStep[];
  /** The needed steps up to and including `execute` (a cursor opening). */
  readonly open: readonly OperationStep[];
  /** The needed steps of {@link AFTER_EXECUTE} (one cursor batch). */
  readonly batch: readonly OperationStep[];
}

/**
 * The operation pipeline: ONE ordered list of steps for every operation and every way of consuming it (`await`,
 * cursor, explain). The order is fixed; a configuration can only put a step into its slot. Unfilled slots are
 * pass-through steps. It runs the steps over an operation context.
 *
 * @example
 * ```ts
 * const pipeline = new OperationPipeline({ execute: new ExecuteStep() });
 * const result = await pipeline.run(ctx);
 * ```
 */
export class OperationPipeline {
  /** The steps in run order (every slot filled). */
  readonly steps: readonly OperationStep[];
  readonly #bySlot: ReadonlyMap<StepName, OperationStep>;
  /* The run lists per schema, computed on the first operation of a model (a pipeline is immutable). */
  readonly #active = new WeakMap<CompiledSchema, ActiveSteps>();
  readonly #values: readonly OperationStep[];
  /* The standard `instrumentStart` emits `operation.start`; step events before it wait for it. */
  readonly #holdSteps: boolean;

  /**
   * @param steps - The steps by slot; slots left out become pass-through steps.
   * @throws {ConfigurationError} When a step is put into a slot of another name.
   */
  constructor(steps: StepSet) {
    const list = STEP_ORDER.map((name) => {
      const step = steps[name] ?? new PassThroughStep(name);
      if (step.name !== name) throw new ConfigurationError(`step "${step.name}" was put into the slot "${name}"`);
      return step;
    });
    this.steps = Object.freeze(list);
    this.#bySlot = new Map(list.map((step) => [step.name, step]));
    this.#values = VALUE_STEPS.map((name) => this.step(name));
    this.#holdSteps = this.step("instrumentStart") instanceof InstrumentStartStep;
  }

  /**
   * A pipeline with some slots replaced (the others kept).
   *
   * @param steps - The steps to put into their slots.
   * @returns A new pipeline.
   */
  with(steps: StepSet): OperationPipeline {
    const current = Object.fromEntries(this.steps.map((step) => [step.name, step])) as StepSet;
    return new OperationPipeline({ ...current, ...steps });
  }

  /**
   * The step in a slot.
   *
   * @param name - The slot.
   * @returns The step filling the slot.
   */
  step(name: StepName): OperationStep {
    return this.#bySlot.get(name) as OperationStep;
  }

  /**
   * The steps an operation runs: without the steps whose `needed(schema)` is `false`. The same holds with an
   * instrumentation subscriber: a step left out did nothing, so it has no `operation.step` event either.
   *
   * @param ctx - The context of the operation.
   * @returns The run lists of the operation's schema, cached per schema.
   */
  active(ctx: OperationContext): ActiveSteps {
    const schema = ctx.target.schema;
    const cached = this.#active.get(schema);
    if (cached !== undefined) return cached;
    const active = this.#lists((step) => step.needed?.(schema) ?? true);
    this.#active.set(schema, active);
    return active;
  }

  /* Builds the three run lists from the steps `keep` accepts. */
  #lists(keep: (step: OperationStep) => boolean): ActiveSteps {
    const all = this.steps.filter(keep);
    const index = this.steps.findIndex((step) => step.name === "execute");
    return Object.freeze({
      all: Object.freeze(all),
      open: Object.freeze(this.steps.slice(0, index + 1).filter((step) => all.includes(step))),
      batch: Object.freeze(AFTER_EXECUTE.map((name) => this.step(name)).filter((step) => all.includes(step))),
    });
  }

  /**
   * Runs the value steps (normalize, resolvePaths, cast, policies, defaults, validate) again over the code-form
   * values a pre hook changed, so every rule and policy applies to the changed operation. The caller first puts
   * back the state before the value steps (`OperationContext.restoreValues`).
   *
   * @param ctx - The context of the operation.
   * @returns A promise settled when the value steps are done.
   * @throws {TypemoError} The error of a value step; it goes to the `hooksPre` step, which fails the operation.
   */
  async prepare(ctx: OperationContext): Promise<void> {
    for (const step of this.#values) {
      const out = OperationPipeline.runStep(ctx, step);
      if (isPromise(out)) await out;
    }
  }

  /**
   * Runs every step; the result is `ctx.result`.
   *
   * @param ctx - The context of the operation.
   * @returns The result of the operation.
   * @throws {TypemoError} The classified error of the step that failed.
   */
  async run(ctx: OperationContext): Promise<unknown> {
    ctx.runner = this;
    await this.#wrapped(ctx, this.active(ctx).all);
    return ctx.result;
  }

  /**
   * Opens a cursor: runs the steps up to and including `execute` (which leaves the driver cursor in
   * `ctx.result`). The caller then feeds batches through {@link processBatch} and ends with
   * {@link finish} (or {@link fail}).
   *
   * @param ctx - The context of the operation.
   * @returns A promise settled when the cursor is open.
   * @throws {TypemoError} The classified error of the step that failed.
   */
  async open(ctx: OperationContext): Promise<void> {
    ctx.runner = this;
    await this.#wrapped(ctx, this.active(ctx).open);
  }

  /**
   * Runs postProcess, populate, audit and hooksPost over one batch (`ctx.result = batch`).
   *
   * @param ctx - The context of the operation.
   * @param batch - The raw documents of the batch.
   * @returns The processed batch.
   * @throws {TypemoError} The classified error of the step that failed.
   */
  async processBatch(ctx: OperationContext, batch: readonly unknown[]): Promise<unknown[]> {
    ctx.result = batch;
    await this.#runSteps(ctx, this.active(ctx).batch);
    ctx.postDone = true;
    return ctx.result as unknown[];
  }

  /**
   * Ends a cursor operation (`instrumentEnd`).
   *
   * @param ctx - The context of the operation.
   * @returns A promise settled when the end event is out.
   */
  async finish(ctx: OperationContext): Promise<void> {
    await this.#runSteps(ctx, [this.step("instrumentEnd")]);
  }

  /**
   * Ends a cursor operation with an error that happened outside the steps (the driver's `getMore`).
   *
   * @param ctx - The context of the operation.
   * @param error - The original error.
   * @param at - The step the failure is attributed to.
   * @returns Never: it always throws.
   * @throws {TypemoError} The classified error, masked when it repeats a sensitive value.
   */
  async fail(ctx: OperationContext, error: unknown, at: StepName = "execute"): Promise<never> {
    ctx.failedStep = at;
    /* A server error repeating a marked (or Hidden) value leaves the operation masked. */
    ctx.error = OperationEvents.reporting(ctx, () => SensitiveMask.error(ctx.target.schema, error, "show"));
    await this.#onError(ctx);
    /* A `transaction.*` event carrying this error later masks it by this schema. */
    SensitiveMask.originOf(ctx.error, ctx.target.schema);
    throw ctx.error;
  }

  /**
   * Reports an operation that failed BEFORE any of its steps could run: a failed `pre('save')` hook, the preparation
   * of a `bulkSave`, `new Model(doc)` of `create()`. It is still an operation: inside the subscribers' `wrap`,
   * `operation.start` and `operation.error` at `step` and the `onError` of every step (`postError` hooks; none for
   * a document write, its hooks are the document's). No step runs, nothing is sent.
   *
   * @param ctx - The context of the operation.
   * @param error - The original error.
   * @param step - The step the failure is attributed to.
   * @returns The error the operation ended with (masked; an `onError` may replace it).
   */
  async reportFailure(ctx: OperationContext, error: unknown, step: StepName): Promise<unknown> {
    ctx.runner = this;
    const hub = ctx.environment.instrumentation;
    const body = (): Promise<never> => this.fail(ctx, error, step);
    try {
      await (hub.wraps ? hub.around(OperationEvents.info(ctx), OperationEvents.tenant(ctx), body) : body());
    } catch (failure) {
      return failure;
    }
    /* `fail` always throws; kept for the type checker. */
    return ctx.error;
  }

  /* Runs the steps inside the subscribers' `wrap`, only when one gives it (one boolean check otherwise). */
  #wrapped(ctx: OperationContext, steps: readonly OperationStep[]): Promise<void> {
    const hub = ctx.environment.instrumentation;
    const prepare = ctx.document?.prepare;
    const body = prepare === undefined ? () => this.#runSteps(ctx, steps) : () => this.#prepared(ctx, prepare, steps);
    if (!hub.wraps) return body();
    return hub.around(OperationEvents.info(ctx), OperationEvents.tenant(ctx), body);
  }

  /* A document write prepares its values inside the operation; a failure fails it at `validate`, or at the step
     the write says its preparation has reached. */
  async #prepared(ctx: OperationContext, prepare: DocumentPrepare, steps: readonly OperationStep[]): Promise<void> {
    try {
      await prepare(ctx);
    } catch (error) {
      await this.fail(ctx, error, ctx.document?.stage?.step ?? "validate");
    }
    await this.#runSteps(ctx, steps);
  }

  /* Runs the steps in order; a failing step goes through `fail`. */
  async #runSteps(ctx: OperationContext, steps: readonly OperationStep[]): Promise<void> {
    const firstValue = this.#values[0];
    for (const step of steps) {
      /* Two counts, no copy: what the value steps add can be taken back if a pre hook changes the operation. */
      if (step === firstValue) ctx.beginValues();
      const hub = ctx.environment.instrumentation;
      /* Nested step events only for the steps worth a span, and only when someone listens. */
      const started = hub.wantsSteps && NESTED.has(step.name) ? performance.now() : undefined;
      try {
        const out = OperationPipeline.runStep(ctx, step);
        if (isPromise(out)) await out;
      } catch (error) {
        await this.fail(ctx, error, step.name);
      }
      if (started !== undefined) {
        const event = {
          type: "operation.step" as const,
          operationId: ctx.id,
          step: step.name,
          timestamp: Date.now(),
          durationMS: performance.now() - started,
        };
        if (this.#holdSteps) InstrumentStartStep.step(ctx, event);
        else hub.emit(event);
      }
    }
  }

  /**
   * Runs a step with mask failures (`SensitiveMask.forError` of a `CastError` or a validation issue) going to the
   * subscribers of the operation's hub; one boolean check without subscribers. Synchronous scope: the async part
   * of a step (async validators) keeps the sink captured when its report was set up (`ValueValidator`).
   *
   * @param ctx - The context of the operation.
   * @param step - The step to run.
   * @returns What the step returned.
   */
  private static runStep(ctx: OperationContext, step: OperationStep): void | Promise<void> {
    return OperationEvents.reporting(ctx, () => step.run(ctx));
  }

  /* Runs `onError` of the steps from the last to the first; an error thrown there replaces `ctx.error`, which it
     keeps as its `cause` (a failing `postError` hook does not lose the operation's error). */
  async #onError(ctx: OperationContext): Promise<void> {
    for (let index = this.steps.length - 1; index >= 0; index--) {
      const step = this.steps[index] as OperationStep;
      if (step.onError === undefined) continue;
      try {
        const out = step.onError(ctx);
        if (isPromise(out)) await out;
      } catch (error) {
        ctx.error = HookErrors.chain(error, ctx.error);
      }
    }
  }
}
