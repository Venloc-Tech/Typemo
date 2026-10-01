import { QueryError } from "../errors/query-error.ts";
import type { OperationKind, OperationPlan, PlanExecutor } from "./plan.ts";

/*
 * A finished query that only runs: `countDocuments`, `distinct`, `exists`, the raw result of a
 * find-and-modify, and (as subclasses) the write builders. Thenable with the standard generic `then`.
 * A READ runs once per builder object — every `await` of the same object returns the same result
 * without going to the server again; a WRITE runs once — a second `await` of the same object is an
 * error. Every builder method returns a NEW object, which is a new operation.
 * `exec({ force: true })` runs the operation again on purpose — a read refreshes the cached result
 * (later `await`s return the new one), a write is sent a second time.
 */

const READ_OPERATIONS: ReadonlySet<OperationKind> = new Set<OperationKind>([
  "find",
  "findOne",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
]);

/**
 * Options of `exec()`.
 *
 * @example
 * await User.countDocuments().exec({ force: true });
 */
export interface ExecOptions {
  /**
   * Runs the operation again (`false` by default). A read goes to the server again and replaces the
   * cached result; a write is sent again — deliberately, since a second plain `await` of a write is an error.
   */
  readonly force?: boolean;
}

/**
 * The memoized execution of one builder object.
 *
 * @example
 * const once = new ExecutionOnce();
 * await once.run("find", () => fetchRows()); // runs
 * await once.run("find", () => fetchRows()); // returns the same result
 */
export class ExecutionOnce {
  #result: Promise<unknown> | undefined;

  /**
   * The `force` flag of `exec(options)`; anything but a boolean is refused (no silent coercion).
   *
   * @param op - The operation name, used in error messages.
   * @param options - The options given to `exec`.
   * @returns `true` when the operation must run again.
   * @throws {QueryError} When `options` is not an object or `force` is not a boolean.
   */
  static force(op: string, options: ExecOptions | undefined): boolean {
    if (options === undefined) return false;
    if (typeof options !== "object" || options === null) throw new QueryError(`${op}: exec(options) takes an object`);
    const force: unknown = options.force;
    if (force !== undefined && typeof force !== "boolean")
      throw new QueryError(`${op}: exec({ force }) takes a boolean`);
    return force === true;
  }

  /**
   * `true` for operations that only read (their result is memoized).
   *
   * @param op - The operation kind.
   * @returns Whether the operation only reads.
   */
  static isRead(op: OperationKind): boolean {
    return READ_OPERATIONS.has(op);
  }

  /**
   * Runs `start` the first time; afterwards a read returns the same promise, a write is refused —
   * unless `force` runs it again (and a read's cache takes the new result).
   *
   * @param op - The operation kind (reads are memoized, writes run once).
   * @param start - Starts the operation.
   * @param options - The options given to `exec`.
   * @param name - The method the user called, for the error texts (`aggregate` for an aggregation with `$out`,
   *   `findById`); the operation kind by default.
   * @returns The promise of the (possibly cached) result; a write that already ran gives a rejected promise
   * with a `QueryError`.
   * @throws {QueryError} When `options` are invalid.
   */
  run(op: OperationKind, start: () => Promise<unknown>, options?: ExecOptions, name: string = op): Promise<unknown> {
    const force = ExecutionOnce.force(name, options);
    if (this.#result === undefined || force) {
      this.#result = start();
      return this.#result;
    }
    if (ExecutionOnce.isRead(op)) return this.#result;
    return Promise.reject(
      new QueryError(
        `${name}: this operation was already executed; build a new one, or run it again deliberately with exec({ force: true }) (a write runs once per builder)`,
      ),
    );
  }
}

/**
 * A thenable around one plan.
 *
 * @typeParam R - What the query resolves to.
 * @example
 * const total = await User.countDocuments({ active: true });
 */
export class ExecutableQuery<R> implements Promise<R> {
  protected readonly executor: PlanExecutor;
  protected readonly plan: OperationPlan;
  /* The executor returns `unknown`; the builder gives the value its type (proven by the shape tests). */
  protected readonly map: (raw: unknown) => R;
  readonly #once = new ExecutionOnce();

  /**
   * @param executor - Runs the plan.
   * @param plan - The immutable plan.
   * @param map - Turns the executor's raw result into `R`; the identity by default.
   */
  constructor(executor: PlanExecutor, plan: OperationPlan, map: (raw: unknown) => R = (raw) => raw as R) {
    this.executor = executor;
    this.plan = plan;
    this.map = map;
  }

  /**
   * The immutable plan.
   *
   * @returns The plan this query would run.
   */
  build(): OperationPlan {
    return this.plan;
  }

  /**
   * Runs the plan. A read runs once: later calls return the same result; a write runs once:
   * a second call rejects with `QueryError`. `{ force: true }` runs it again.
   *
   * @param options - Execution options.
   * @returns The result of the operation.
   * @throws {QueryError} When `options` are invalid.
   */
  exec(options?: ExecOptions): Promise<R> {
    return this.#once.run(
      this.plan.op,
      () => this.executor.execute(this.plan).then(this.map),
      options,
      this.plan.options.method ?? this.plan.op,
    ) as Promise<R>;
  }

  /**
   * Makes the query awaitable: runs it and chains the handlers.
   *
   * @param onfulfilled - Called with the result.
   * @param onrejected - Called with the error.
   * @returns A promise of the handlers' result.
   */
  // biome-ignore lint/suspicious/noThenProperty: a query is deliberately awaitable.
  then<R1 = R, R2 = never>(
    onfulfilled?: ((value: R) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  /**
   * Attaches a rejection handler (runs the plan).
   *
   * @param onrejected - Called with the error.
   * @returns A promise of the result or of the handler's value.
   */
  catch<R2 = never>(onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): Promise<R | R2> {
    return this.exec().catch(onrejected);
  }

  /**
   * Attaches a completion handler (runs the plan).
   *
   * @param onfinally - Called when the promise settles.
   * @returns A promise of the result.
   */
  finally(onfinally?: (() => void) | null): Promise<R> {
    return this.exec().finally(onfinally);
  }

  /**
   * The tag `Object.prototype.toString` prints (`[object TypemoQuery]`). With `then`, `catch` and `finally` it
   * completes the `Promise` interface, so a query can be returned where a `Promise` of its result is expected.
   *
   * @returns `"TypemoQuery"`.
   */
  get [Symbol.toStringTag](): string {
    return "TypemoQuery";
  }
}
