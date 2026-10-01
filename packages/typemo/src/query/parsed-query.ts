import { type QueryCursor, TypedCursor } from "../cursor/typed-cursor.ts";
import { InternalError } from "../errors/internal-error.ts";
import { type AnyStandardSchema, StandardSchema } from "../schema/standard-schema/standard-schema.ts";
import type { ExpectRows } from "../types/contract.ts";
import type { PathError } from "../types/paths.ts";
import { type ExecOptions, ExecutionOnce } from "./executable-query.ts";
import type { OperationKind } from "./plan.ts";

/*
 * `.parse(schema)` of a lean query or an aggregation — every row validated by a Standard Schema
 * (zod, valibot, arktype, a model's `~standard` …): the result is the schema's OUTPUT (per row; `null` for "not
 * found" stays `null` and is not validated), the issues of every row are ONE `ValidationError` (the path starts
 * with the row's index for a list or a cursor). A parsed query is terminal (a thenable with `exec`, `cursor` for
 * lists, `expect`): the query is fixed before it is parsed. It runs through the same pipeline as the query (a
 * read runs once per object, a write — `findOneAndUpdate(…).lean().parse(S)` — once).
 */

/**
 * What a parsed query reads: a whole result, and (for lists) a stream of rows.
 *
 * @example
 * const source: ParseSource = { op: "find", run: () => query.exec(), cursor: () => query.cursor() };
 */
export interface ParseSource {
  /** The operation kind (reads are memoized, writes run once). */
  readonly op: OperationKind;
  /** The method the user called, for error texts (`aggregate`, `findById`); the operation kind by default. */
  readonly method?: string;
  /** Runs the query once more (a new run: the parsed query is a new operation). */
  readonly run: () => Promise<unknown>;
  /** The rows as a cursor (lists only). */
  readonly cursor?: () => QueryCursor<unknown>;
}

/**
 * A query whose rows are validated by a Standard Schema.`Result` is what it resolves to (`Row[]`,
 * `Row | null`, `Row` with `orFail`), `Row` one validated row, `Many` whether it is a list (a cursor is available).
 *
 * @typeParam Result - What the query resolves to.
 * @typeParam Row - One validated row.
 * @typeParam Many - Whether the query is a list.
 * @example
 * const rows = await User.find().lean().parse(UserSchema); // the schema's output, per row
 */
export class ParsedQuery<Result, Row, Many extends boolean> implements Promise<Result> {
  readonly #source: ParseSource;
  readonly #schema: AnyStandardSchema;
  readonly #many: boolean;
  readonly #once = new ExecutionOnce();

  /**
   * Not for direct use: call `query.lean().parse(schema)` or `Model.aggregate(…).parse(schema)`.
   * @param source - What to run and stream.
   * @param schema - A Standard Schema (zod, valibot, arktype, a model's `~standard`).
   * @param many - Whether the query is a list.
   * @throws {QueryError} When `schema` is not a Standard Schema.
   */
  constructor(source: ParseSource, schema: unknown, many: Many) {
    this.#source = source;
    this.#schema = StandardSchema.require(schema, "parse");
    this.#many = many;
  }

  /**
   * Runs the query and validates its rows: a read once per object (later calls return the same result), a
   * write once; `{ force: true }` runs it again. Any invalid row: a `ValidationError` (every issue of every row).
   *
   * @param options - Execution options.
   * @returns The validated result.
   * @throws {ValidationError} When any row is invalid.
   */
  exec(options?: ExecOptions): Promise<Result> {
    return this.#once.run(
      this.#source.op,
      () => this.#validate(),
      options,
      this.#source.method ?? this.#source.op,
    ) as Promise<Result>;
  }

  /**
   * Runs the source and validates what it returns; a single row that is `null`/`undefined` is passed through.
   *
   * @returns The validated rows or the validated single row.
   * @throws {ValidationError} When any row is invalid.
   */
  async #validate(): Promise<unknown> {
    const raw = await this.#source.run();
    if (this.#many) return StandardSchema.validateRows(this.#schema, raw as readonly unknown[], true);
    if (raw === null || raw === undefined) return raw;
    const [value] = await StandardSchema.validateRows(this.#schema, [raw], false);
    return value;
  }

  /**
   * Makes the query awaitable: runs it and chains the handlers.
   *
   * @param onfulfilled - Called with the result.
   * @param onrejected - Called with the error.
   * @returns A promise of the handlers' result.
   */
  // biome-ignore lint/suspicious/noThenProperty: a query is deliberately awaitable.
  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  /**
   * Attaches a rejection handler (runs the query).
   *
   * @param onrejected - Called with the error.
   * @returns A promise of the result or of the handler's value.
   */
  catch<R2 = never>(onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): Promise<Result | R2> {
    return this.exec().catch(onrejected);
  }

  /**
   * Attaches a completion handler (runs the query).
   *
   * @param onfinally - Called when the promise settles.
   * @returns A promise of the result.
   */
  finally(onfinally?: (() => void) | null): Promise<Result> {
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

  /**
   * Streams the rows, each validated as it is read (lists only): an invalid row is a `ValidationError` whose path
   * starts with the row's position in the stream; the cursor is closed then.
   *
   * @returns A cursor of validated rows.
   * @throws {InternalError} When the query is a single-row one (the types forbid the call).
   */
  cursor(
    this: ParsedQuery<Result, Row, Many> &
      (Many extends true ? unknown : PathError<"cursor() applies to a list (find, aggregate)">),
  ): QueryCursor<Row> {
    const open = this.#source.cursor;
    if (!this.#many || open === undefined) throw new InternalError("cursor() of a parsed single-row query");
    const inner = open();
    const schema = this.#schema;
    const rows = async function* (): AsyncGenerator<unknown, void, undefined> {
      let index = 0;
      for await (const row of inner) {
        const [value] = await StandardSchema.validateRows(schema, [row], true, index);
        index += 1;
        yield value;
      }
    };
    const iterable = rows();
    return new TypedCursor<Row>({
      [Symbol.asyncIterator]: () => iterable as AsyncIterator<Row, void, undefined>,
      close: () => inner.close(),
    });
  }

  /**
   * The exact contract check of the validated rows, types only: this same query, or a compile error
   * naming what is missing, extra or mismatched against `Shape` (one row).
   *
   * @typeParam Shape - The exact row shape expected.
   * @returns This query, unchanged.
   */
  expect<Shape>(this: ParsedQuery<Result, Row, Many> & ExpectRows<Row, Shape>): ParsedQuery<Result, Row, Many> {
    return this;
  }
}
