import type { ClientSession } from "mongodb";
import type { BulkWriteSummary } from "../errors/bulk-write-error.ts";
import { QueryError } from "../errors/query-error.ts";
import { TypemoError } from "../errors/typemo-error.ts";
import type { BulkWriteModel, BulkWritePlan } from "../operation/pipeline/execution-plan.ts";
import type { BulkOperationHooks, OperationContext, ValuesSnapshot } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import { PolicyContext, type PolicyValues } from "../policies/policy-context.ts";
import type { PlanDocument } from "../query/plan.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import { type CodeValues, HookChanges } from "./hook-changes.ts";
import type { BulkOperationResult, HookPhase, OperationHookContext, QueryHookEvent } from "./hook-events.ts";
import { HookRegistry } from "./hook-registry.ts";

/**
 * The kinds of `bulkWrite` operations that run query hooks (an `insertOne` runs the document's hooks instead).
 *
 * @example
 * ```ts
 * const kind: BulkQueryKind = "updateOne";
 * ```
 */
export type BulkQueryKind = "updateOne" | "updateMany" | "replaceOne" | "deleteOne" | "deleteMany";

/**
 * The body of one `bulkWrite` operation, whatever its kind.
 *
 * @example
 * ```ts
 * const spec: BulkSpec = { filter: { name: "Ann" }, update: { $set: { age: 3 } }, upsert: true };
 * ```
 */
interface BulkSpec {
  /** The filter (every kind but `insertOne`). */
  readonly filter?: PlanDocument;
  /** The update of `updateOne` / `updateMany`. */
  readonly update?: PlanDocument | readonly PlanDocument[];
  /** The replacement of `replaceOne`. */
  readonly replacement?: PlanDocument;
  /** The array filters of an update. */
  readonly arrayFilters?: readonly PlanDocument[];
  /** Whether the operation upserts. */
  readonly upsert?: boolean;
  /** The index hint. */
  readonly hint?: string | PlanDocument;
}

/**
 * The kind of a `bulkWrite` operation (its only key).
 *
 * @param operation - The operation.
 * @returns Its kind.
 */
const kindOf = (operation: BulkWriteModel): BulkQueryKind | "insertOne" =>
  Object.keys(operation)[0] as BulkQueryKind | "insertOne";

/**
 * The body of a `bulkWrite` operation.
 *
 * @param operation - The operation.
 * @returns Its body.
 */
const specOf = (operation: BulkWriteModel): BulkSpec =>
  (operation as unknown as Readonly<Record<string, BulkSpec>>)[kindOf(operation)] as BulkSpec;

/**
 * The hook event of an operation kind.
 *
 * @param kind - The operation kind.
 * @returns `query.<kind>`.
 */
const eventOf = (kind: BulkQueryKind): QueryHookEvent => `query.${kind}` as QueryHookEvent;

/** The phase each operation's hooks are in (absent between runs): not a property the hooks could change. */
const PHASES = new WeakMap<object, HookPhase>();

/**
 * `this` of a query hook that runs for ONE operation inside a `bulkWrite` (`query.updateOne` for an `updateOne`
 * of the bulk, and so on): the same view of the operation a standalone call gives — its filter, update or
 * replacement in database form, read-only — plus {@link bulkIndex}. `modify({ where, update })` changes that
 * operation (the bulk's values are prepared again, as for a standalone call); `skip()` is refused: one operation
 * of a bulk cannot be replaced by a result (a `model.bulkWrite` pre hook may skip the whole bulk).
 */
export class BulkUnitHooks implements OperationHookContext<unknown> {
  /** The hook event (`query.<kind>`). */
  readonly event: QueryHookEvent;
  /** Values shared by the pre and post hooks of this operation. */
  readonly locals = new Map<string, unknown>();
  /** The position of the operation in the `bulkWrite` list. */
  readonly bulkIndex: number;
  /** The hooks of the whole bulk. */
  readonly #units: BulkUnits;
  /** The operation kind. */
  readonly #kind: BulkQueryKind;

  /**
   * @param units - The hooks of the whole bulk.
   * @param index - The position of the operation in the bulk.
   * @param kind - The operation kind.
   */
  constructor(units: BulkUnits, index: number, kind: BulkQueryKind) {
    this.#units = units;
    this.bulkIndex = index;
    this.#kind = kind;
    this.event = eventOf(kind);
  }

  /** The operation kind (`updateOne`, …), as for a standalone call. */
  get operation(): string {
    return this.#kind;
  }

  /** The entity class name. */
  get model(): string {
    return this.#units.model;
  }

  /** The id of the `bulkWrite` operation this one belongs to. */
  get operationId(): number {
    return this.#units.context?.id ?? 0;
  }

  /** The filter in database form. */
  get filter(): Readonly<Record<string, unknown>> | undefined {
    return this.#units.current(this.bulkIndex)?.filter;
  }

  /** The update in database form (an update pipeline is a read-only list). */
  get update(): Readonly<Record<string, unknown>> | readonly Readonly<Record<string, unknown>>[] | undefined {
    return this.#units.current(this.bulkIndex)?.update;
  }

  /** The replacement in database form. */
  get replacement(): Readonly<Record<string, unknown>> | undefined {
    return this.#units.current(this.bulkIndex)?.replacement;
  }

  /** Always `undefined`: an operation of a bulk has no documents of its own. */
  get documents(): undefined {
    return undefined;
  }

  /** Always `undefined`: the bulk's list is on `model.bulkWrite` hooks. */
  get operations(): undefined {
    return undefined;
  }

  /** Always `undefined`. */
  get pipeline(): undefined {
    return undefined;
  }

  /** The session of the bulk. */
  get session(): ClientSession | undefined {
    return this.#units.context?.session;
  }

  /** Whether the bulk runs inside a transaction. */
  get inTransaction(): boolean {
    return this.#units.context?.inTransaction === true;
  }

  /** The resolved policy values of the bulk. */
  get policy(): Readonly<PolicyValues> {
    return this.#units.context?.policy ?? PolicyContext.EMPTY;
  }

  /**
   * Refused: one operation of a bulk cannot be replaced by a result.
   *
   * @param _result - The result a standalone call would get instead.
   * @throws {QueryError} Always.
   */
  skip(_result: unknown): void {
    throw new QueryError(
      `${this.#where()}: skip() cannot replace one operation of a bulkWrite with a result; skip the whole bulkWrite from a model.bulkWrite pre hook`,
    );
  }

  /**
   * Changes this operation (`where`, and `update` for updates), as a standalone pre hook does.
   *
   * @param change - The change.
   * @throws {QueryError} Outside a pre hook, or when the change does not apply.
   */
  modify(change: unknown): void {
    if (PHASES.get(this) !== "pre") {
      throw new QueryError(`${this.#where()}: modify() is only for pre hooks (the operation already ran)`);
    }
    this.#units.modify(this.bulkIndex, this.#kind, change, this.#where());
  }

  /** How the operation is named in messages. */
  #where(): string {
    return `${this.model}.${this.#kind} (bulkWrite[${this.bulkIndex}])`;
  }
}

/**
 * The query hooks of the operations inside one `Model.bulkWrite` call: every `updateOne`, `updateMany`,
 * `replaceOne`, `deleteOne` and `deleteMany` of the bulk runs the `query.<kind>` hooks its standalone counterpart
 * runs. The pre hooks run in the `hooksPre` step (after the bulk's values were cast and validated, before the
 * `model.bulkWrite` pre hooks), one operation after another; the post and postError hooks run after the whole
 * bulk ended (the caller decides, per operation, whether it was applied).
 */
export class BulkUnits implements BulkOperationHooks {
  /** The entity class name. */
  readonly model: string;
  /** The compiled schema of the model (its hook table). */
  readonly #schema: CompiledSchema;
  /** The `this` of each operation that has hooks, by index (the same object for its pre and post hooks). */
  readonly #hooks = new Map<number, BulkUnitHooks>();
  /** The context of the current attempt (an audit transaction may run the bulk again). */
  #ctx: OperationContext | undefined;
  /** The code-form operations the value steps start from (the documents' prepared inserts included). */
  #base: readonly BulkWriteModel[] | undefined;
  /** The code-form operations with the changes of the pre hooks. */
  #code: BulkWriteModel[] | undefined;
  /** The state before the value steps, taken on the first change. */
  #snapshot: ValuesSnapshot | undefined;
  /** Whether a change waits to be prepared. */
  #pending = false;
  /** The operations an unordered bulk left out because their pre hook threw (a prepare puts the context back). */
  readonly #failed = new Map<number, TypemoError>();

  /**
   * @param model - The entity class name.
   * @param schema - The compiled schema of the model.
   */
  constructor(model: string, schema: CompiledSchema) {
    this.model = model;
    this.#schema = schema;
  }

  /**
   * What the post hook of one applied operation receives: the server reports per operation only the upserted
   * `_id`; the counts of one operation are unknown (`null`) — the bulk's totals are the `model.bulkWrite` result.
   *
   * @param index - The operation's position.
   * @param operation - The operation.
   * @param summary - The bulk's result.
   * @returns The operation's result.
   */
  static resultOf(index: number, operation: BulkWriteModel, summary: BulkWriteSummary): BulkOperationResult {
    const kind = kindOf(operation);
    if (kind === "deleteOne" || kind === "deleteMany") return Object.freeze({ acknowledged: true, deletedCount: null });
    const upserted = Object.hasOwn(summary.upsertedIds, index);
    return Object.freeze({
      acknowledged: true,
      matchedCount: null,
      modifiedCount: null,
      upsertedCount: upserted ? 1 : 0,
      upsertedId: upserted ? summary.upsertedIds[index] : null,
    });
  }

  /**
   * Whether any operation of the list has a query hook (in any phase).
   *
   * @param schema - The compiled schema of the model.
   * @param operations - The bulk's operations.
   * @returns `true` when some operation would run a hook.
   */
  static needed(schema: CompiledSchema, operations: readonly BulkWriteModel[]): boolean {
    return operations.some((operation) => {
      const kind = kindOf(operation);
      return kind !== "insertOne" && HookRegistry.has(schema, eventOf(kind));
    });
  }

  /**
   * The code-form operations the value steps start from, when the document layer prepared some of them.
   *
   * @param operations - The operations with the prepared inserts.
   */
  base(operations: readonly BulkWriteModel[]): void {
    this.#base = operations;
  }

  /** The context of the current attempt, `undefined` before the pre hooks. */
  get context(): OperationContext | undefined {
    return this.#ctx;
  }

  /**
   * The body of an operation as the bulk will send it (database form).
   *
   * @param index - The operation's position.
   * @returns Its body, `undefined` before the pre hooks.
   */
  current(index: number): BulkSpec | undefined {
    const operation = this.#ctx?.operations?.[index];
    return operation === undefined ? undefined : specOf(operation);
  }

  /**
   * Runs the pre hooks of every operation that has some, in order; a change of one prepares the bulk again before
   * the next hook.
   *
   * @param ctx - The context of the bulkWrite.
   * @returns A promise when a hook runs, `undefined` otherwise.
   * @throws {TypemoError} When a hook fails, or a changed operation does not pass the value steps.
   */
  pre(ctx: OperationContext): Promise<void> | undefined {
    /* A new attempt starts from the operations as given (its hooks change them again). */
    this.#ctx = ctx;
    this.#code = undefined;
    this.#snapshot = undefined;
    this.#pending = false;
    this.#failed.clear();
    const due: [number, BulkQueryKind][] = [];
    for (const [index, operation] of (ctx.operations ?? []).entries()) {
      const kind = kindOf(operation);
      if (kind === "insertOne" || ctx.isRejected(index)) continue;
      if (HookRegistry.list(this.#schema, eventOf(kind), "pre").length > 0) due.push([index, kind]);
    }
    if (due.length === 0) return undefined;
    return this.#runPre(ctx, due);
  }

  /**
   * Runs the pre hooks of the operations due.
   *
   * @param ctx - The context of the bulkWrite.
   * @param due - The operations with pre hooks.
   */
  async #runPre(ctx: OperationContext, due: readonly (readonly [number, BulkQueryKind])[]): Promise<void> {
    /* An unordered bulk goes on without the operation whose hook threw (as it does for one that fails its checks);
       an ordered one stops at the first failure. */
    const unordered = OperationView.unordered(ctx);
    for (const [index, kind] of due) {
      const self = this.#self(index, kind);
      PHASES.set(self, "pre");
      try {
        await HookRegistry.run(
          HookRegistry.list(this.#schema, eventOf(kind), "pre"),
          self,
          [],
          () => false,
          () => this.#prepare(ctx),
        );
      } catch (error) {
        if (!unordered) throw error;
        const failure =
          error instanceof TypemoError
            ? error
            : new TypemoError(
                `${this.model}.${kind} (bulkWrite[${index}]): a pre hook threw: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
              );
        this.#failed.set(index, failure);
        ctx.reject(index, failure);
      } finally {
        PHASES.delete(self);
      }
    }
  }

  /**
   * Records a pre hook's change of one operation (applied by the next {@link #prepare}).
   *
   * @param index - The operation's position.
   * @param kind - The operation kind.
   * @param change - The hook's change.
   * @param where - How the operation is named in messages.
   * @throws {QueryError} When the change does not apply to the operation or is invalid.
   */
  modify(index: number, kind: BulkQueryKind, change: unknown, where: string): void {
    const ctx = this.#ctx;
    if (ctx === undefined) throw new TypemoError(`${where}: Internal error: modify() before the bulk's pre hooks`);
    this.#code ??= [...(this.#base ?? (ctx.plan as BulkWritePlan).operations)];
    const code = this.#code;
    const operation = code[index] as BulkWriteModel;
    const spec = specOf(operation);
    const current: CodeValues = {
      filter: spec.filter,
      update: spec.update,
      arrayFilters: spec.arrayFilters,
      projection: undefined,
      sort: undefined,
      pipeline: undefined,
    };
    const next = HookChanges.apply(ctx, current, change, kind, where);
    if (next === current) return;
    this.#snapshot ??= ctx.snapshotValues();
    const body = Object.freeze({
      ...spec,
      ...(next.filter === undefined ? {} : { filter: next.filter }),
      ...(next.update === undefined ? {} : { update: next.update }),
      ...(next.arrayFilters === undefined ? {} : { arrayFilters: next.arrayFilters }),
    });
    code[index] = Object.freeze({ [kind]: body }) as unknown as BulkWriteModel;
    this.#pending = true;
  }

  /**
   * Prepares the bulk again after a change: its values go back to the state before the value steps, with the
   * changed operations, and the value steps run again (every rule and policy applies to the change).
   *
   * @param ctx - The context of the bulkWrite.
   * @returns A promise when there was a change, `undefined` otherwise.
   * @throws {TypemoError} When no pipeline runs the operation (an internal error).
   */
  #prepare(ctx: OperationContext): Promise<void> | undefined {
    if (!this.#pending || this.#snapshot === undefined || this.#code === undefined) return undefined;
    this.#pending = false;
    const runner = ctx.runner;
    if (runner === undefined) {
      throw new TypemoError(`${this.model}.bulkWrite: Internal error: no pipeline to prepare the changed operation`);
    }
    ctx.restoreValues(this.#snapshot);
    for (const [index, error] of this.#failed) ctx.reject(index, error);
    ctx.operations = Object.freeze([...this.#code]);
    return runner.prepare(ctx);
  }

  /**
   * The indexes of the operations whose post or postError hooks may run, in order.
   *
   * @param operations - The bulk's operations.
   * @returns The positions of the operations with query hooks.
   */
  hooked(operations: readonly BulkWriteModel[]): readonly number[] {
    const out: number[] = [];
    for (const [index, operation] of operations.entries()) {
      const kind = kindOf(operation);
      if (kind !== "insertOne" && HookRegistry.has(this.#schema, eventOf(kind))) out.push(index);
    }
    return out;
  }

  /**
   * Runs the post hooks of one applied operation.
   *
   * @param index - The operation's position.
   * @param operation - The operation.
   * @param result - What the hook receives.
   * @returns A promise settled when the hooks are done.
   * @throws Whatever a hook throws.
   */
  post(index: number, operation: BulkWriteModel, result: unknown): Promise<void> {
    return this.#after(index, operation, "post", result);
  }

  /**
   * Runs the postError hooks of one operation that was not applied.
   *
   * @param index - The operation's position.
   * @param operation - The operation.
   * @param error - Its own failure, else the bulk's.
   * @returns A promise settled when the hooks are done.
   * @throws Whatever a hook throws.
   */
  failed(index: number, operation: BulkWriteModel, error: unknown): Promise<void> {
    return this.#after(index, operation, "postError", error);
  }

  /**
   * Runs the post or postError hooks of one operation.
   *
   * @param index - The operation's position.
   * @param operation - The operation.
   * @param phase - `post` or `postError`.
   * @param argument - The hooks' argument.
   */
  async #after(index: number, operation: BulkWriteModel, phase: "post" | "postError", argument: unknown) {
    const kind = kindOf(operation);
    if (kind === "insertOne") return;
    const hooks = HookRegistry.list(this.#schema, eventOf(kind), phase);
    if (hooks.length === 0) return;
    const self = this.#self(index, kind);
    PHASES.set(self, phase);
    try {
      await HookRegistry.run(hooks, self, [argument]);
    } finally {
      PHASES.delete(self);
    }
  }

  /**
   * The `this` of one operation (created on first use, kept for its later hooks).
   *
   * @param index - The operation's position.
   * @param kind - The operation kind.
   * @returns The hook context.
   */
  #self(index: number, kind: BulkQueryKind): BulkUnitHooks {
    let self = this.#hooks.get(index);
    if (self === undefined) {
      self = new BulkUnitHooks(this, index, kind);
      this.#hooks.set(index, self);
    }
    return self;
  }
}
