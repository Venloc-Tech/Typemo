import type { ClientSession } from "mongodb";
import { QueryError } from "../errors/query-error.ts";
import { TypemoError } from "../errors/typemo-error.ts";
import type { OperationContext, ValuesSnapshot } from "../operation/pipeline/operation-context.ts";
import type { PolicyValues } from "../policies/policy-context.ts";
import { type CodeValues, HookChanges } from "./hook-changes.ts";
import type { HookPhase, OperationHookContext, OperationHookEvent } from "./hook-events.ts";
import { HookRegistry } from "./hook-registry.ts";

type Doc = Readonly<Record<string, unknown>>;

/**
 * The runtime of `OperationHookContext`: one object per operation, `this` of all its query, model and aggregate
 * hooks (pre, post for every cursor batch, and postError), so `locals` carries values from a pre hook to the post
 * hooks. Values are read from the operation context when a hook reads them; after `skip`, or in a post hook, they
 * are what the operation sent.
 *
 * `modify(change)` in a pre hook changes the operation's code-form values (see `HookChanges`) and marks the
 * operation. After that hook the value steps run again over the whole changed operation, so the next hook, the
 * driver and the audit see the final operation. A hook that changes nothing costs nothing: no copy is made and no
 * step runs again, `modify({})` included. Before the steps run again the context is restored from a snapshot taken
 * at the first real change.
 */
export class OperationHooks implements OperationHookContext<unknown> {
  readonly #ctx: OperationContext;
  /** The hook event of the operation. */
  readonly event: OperationHookEvent;
  /** Values shared by all hooks of the operation, from pre to post. */
  readonly locals = new Map<string, unknown>();
  #phase: HookPhase | undefined;
  /** The operation's code-form values with the changes made so far (`undefined`: none). */
  #changed: CodeValues | undefined;
  /** A change that has not been prepared yet. */
  #pending = false;
  /** The context before the value steps (taken at the first real change). */
  #snapshot: ValuesSnapshot | undefined;
  /** The read-only views of the unfrozen stage lists, by the list they show, so repeated reads give one object. */
  #updateSource: unknown;
  #updateView: readonly Doc[] | undefined;
  #pipelineSource: unknown;
  #pipelineView: readonly Doc[] | undefined;

  private constructor(ctx: OperationContext, event: OperationHookEvent) {
    this.#ctx = ctx;
    this.event = event;
  }

  /**
   * The hooks object of an operation. It is created on first use and kept in `ctx.hooks`, not in `ctx.locals`, so
   * the user's `locals` stay free of internals.
   *
   * @param ctx - The operation context.
   * @param event - The hook event of the operation.
   * @returns The hooks object of the operation.
   */
  static of(ctx: OperationContext, event: OperationHookEvent): OperationHooks {
    const existing = ctx.hooks;
    if (existing instanceof OperationHooks) return existing;
    const created = new OperationHooks(ctx, event);
    ctx.hooks = created;
    return created;
  }

  /**
   * Runs the hooks of a phase for the operation's event (`this` is the hooks object). After each pre hook that
   * changed the operation, the value steps run again. A pre hook that skipped the operation ends the run.
   *
   * @param ctx - The operation context.
   * @param phase - The phase to run.
   * @param args - The arguments passed to every hook.
   * @returns A promise that settles when the hooks have run.
   * @throws Whatever a hook throws.
   */
  static async run(ctx: OperationContext, phase: HookPhase, args: readonly unknown[]): Promise<void> {
    const event = ctx.hookEvent;
    if (event === undefined) return;
    const hooks = HookRegistry.list(ctx.target.schema, event, phase);
    if (hooks.length === 0) return;
    const self = OperationHooks.of(ctx, event);
    self.#phase = phase;
    try {
      await HookRegistry.run(
        hooks,
        self,
        args,
        () => phase === "pre" && ctx.skipped !== undefined,
        phase === "pre" ? () => self.#prepare() : undefined,
      );
    } finally {
      self.#phase = undefined;
    }
  }

  /** The operation name, for example `find` or `updateOne`. */
  get operation(): string {
    return this.#ctx.op;
  }

  /** The name of the model the operation runs on. */
  get model(): string {
    return this.#ctx.target.entity.name;
  }

  /** The id of the operation, the same as in instrumentation events. */
  get operationId(): number {
    return this.#ctx.id;
  }

  /** The filter the operation sends, or `undefined` when it has none. */
  get filter(): Doc | undefined {
    return this.#ctx.filter;
  }

  /** The update document or update pipeline the operation sends, or `undefined` when it has none. */
  get update(): Doc | readonly Doc[] | undefined {
    const update = this.#ctx.update;
    /* The context's list of stages is not frozen, so a hook gets a read-only view, the same one on every read
       until the list is replaced (`this.update === this.update`). */
    if (!Array.isArray(update) || Object.isFrozen(update)) return update;
    if (this.#updateSource !== update) {
      this.#updateSource = update;
      this.#updateView = Object.freeze([...(update as readonly Doc[])]);
    }
    return this.#updateView;
  }

  /** The replacement document of `replaceOne` and `findOneAndReplace`, or `undefined`. */
  get replacement(): Doc | undefined {
    return this.#ctx.replacement;
  }

  /** The documents `insertMany` sends, or `undefined`. */
  get documents(): readonly Doc[] | undefined {
    return this.#ctx.documents;
  }

  /** The operations `bulkWrite` sends, or `undefined`. */
  get operations(): readonly Doc[] | undefined {
    return this.#ctx.operations as readonly Doc[] | undefined;
  }

  /** The aggregation pipeline stages, or `undefined`. A change goes through `modify`. */
  get pipeline(): readonly Doc[] | undefined {
    /* The context's list of stages is not frozen, so a hook gets a read-only view, the same one on every read
       until the list is replaced. */
    const stages = this.#ctx.pipeline as readonly Doc[] | undefined;
    if (stages === undefined || Object.isFrozen(stages)) return stages;
    if (this.#pipelineSource !== stages) {
      this.#pipelineSource = stages;
      this.#pipelineView = Object.freeze([...stages]);
    }
    return this.#pipelineView;
  }

  /** The driver session the operation runs in, if any. */
  get session(): ClientSession | undefined {
    return this.#ctx.session;
  }

  /** Whether the operation runs inside a transaction. */
  get inTransaction(): boolean {
    return this.#ctx.inTransaction;
  }

  /** The policy values (tenant, soft delete and so on) applied to the operation. */
  get policy(): Readonly<PolicyValues> {
    return this.#ctx.policy;
  }

  /**
   * Skips the operation: the driver is not called and `result` is used as if the server had returned it.
   *
   * @param result - The result, in the form the driver would have returned.
   * @throws {QueryError} When called outside a pre hook, or without a result.
   */
  skip(result: unknown): void {
    if (this.#phase !== "pre") {
      throw new QueryError(`${this.model}.${this.operation}: skip() is only for pre hooks (the operation already ran)`);
    }
    if (result === undefined) throw new QueryError(`${this.model}.${this.operation}: skip(result) needs a result`);
    this.#ctx.skipped = { result };
  }

  /**
   * Changes the operation's code-form values. The value steps run again after the hook, so later hooks and the
   * driver see the final operation.
   *
   * @param change - The change to apply. An empty change, or one holding only `undefined` values, changes nothing.
   * @throws {QueryError} When called outside a pre hook, or after `skip`.
   */
  modify(change: unknown): void {
    const ctx = this.#ctx;
    if (this.#phase !== "pre") {
      throw new QueryError(
        `${this.model}.${this.operation}: modify() is only for pre hooks (the operation already ran)`,
      );
    }
    if (ctx.skipped !== undefined) {
      throw new QueryError(`${this.model}.${this.operation}: modify() after skip() — the operation is not sent`);
    }
    const current = this.#changed ?? HookChanges.initial(ctx);
    const next = HookChanges.apply(ctx, current, change);
    /* `modify({})` (or only `undefined` values) is no change: nothing is prepared again. */
    if (next === current) return;
    this.#snapshot ??= ctx.snapshotValues();
    this.#changed = next;
    this.#pending = true;
  }

  /**
   * Runs after a pre hook: when it changed the operation, the value steps run again over the changed values.
   *
   * @returns A promise when the steps run again, `undefined` when nothing changed.
   * @throws {TypemoError} When the context has no pipeline runner.
   */
  #prepare(): Promise<void> | undefined {
    if (!this.#pending || this.#changed === undefined || this.#snapshot === undefined) return undefined;
    this.#pending = false;
    const ctx = this.#ctx;
    const runner = ctx.runner;
    if (runner === undefined) {
      throw new TypemoError(
        `${this.model}.${this.operation}: Internal error: no pipeline to prepare the changed operation`,
      );
    }
    HookChanges.restore(ctx, this.#snapshot, this.#changed);
    return runner.prepare(ctx);
  }
}
