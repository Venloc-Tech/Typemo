import { CastError } from "../errors/cast-error.ts";
import { EachAsyncError } from "../errors/each-async-error.ts";
import { QueryError } from "../errors/query-error.ts";

/*
 * The cursor of Typemo: `for await`, `next`, `toArray`, `close`, `eachAsync`, typed `map`. It reads a
 * CursorSource — the documents after the operation pipeline's post-execution steps (hydrate/lean, populate,
 * post hooks, per batch: one order everywhere). Unlike the driver's `map` (which mutates the cursor and
 * returns it), `map` returns a NEW cursor; the original is not changed (both read the same stream).
 */

/**
 * What a cursor reads: an async iterable of processed documents, closable.
 *
 * @example
 * ```ts
 * const source: CursorSource<number> = {
 *   async *[Symbol.asyncIterator]() { yield 1; yield 2; },
 *   close: async () => {},
 * };
 * ```
 */
export interface CursorSource<T> extends AsyncIterable<T, void, undefined> {
  /** Releases the server cursor (never throws). */
  readonly close?: () => Promise<void>;
}

/**
 * Options of `eachAsync`.
 *
 * @example
 * ```ts
 * const send = async (user: HydratedDoc<User>): Promise<void> => console.log(user.email);
 * await Users.find({}).cursor().eachAsync(send, { parallel: 4, continueOnError: true } satisfies EachAsyncOptions);
 * ```
 */
export interface EachAsyncOptions {
  /** How many calls of `fn` may run at once (default 1). Documents are still read one after another. */
  readonly parallel?: number;
  /** Continue after a failing call; the errors are thrown together at the end (`EachAsyncError`). */
  readonly continueOnError?: boolean;
}

/**
 * Options of `eachAsync` with batches: `fn` receives arrays of up to `batchSize` documents.
 *
 * @example
 * ```ts
 * await Users.find({})
 *   .cursor()
 *   .eachAsync(async (users) => console.log(users.length), { batchSize: 100 } satisfies EachAsyncBatchOptions);
 * ```
 */
export interface EachAsyncBatchOptions extends EachAsyncOptions {
  /** The maximum number of documents per call (a positive integer). */
  readonly batchSize: number;
}

/**
 * A cursor over typed documents.
 *
 * @example
 * ```ts
 * const cursor: QueryCursor<HydratedDoc<User>> = Users.find({ active: true }).cursor();
 * for await (const user of cursor) console.log(user.name);
 * ```
 */
export interface QueryCursor<T> extends AsyncIterable<T, void, undefined> {
  /**
   * @returns The next document, `null` when the cursor is exhausted.
   * @throws {QueryError} When the cursor was closed by the caller.
   */
  next(): Promise<T | null>;
  /**
   * @returns All remaining documents.
   * @throws {QueryError} When the cursor was closed by the caller.
   */
  toArray(): Promise<T[]>;
  /** Closes the cursor (idempotent, never throws); reading it afterwards is a `QueryError`. */
  close(): Promise<void>;
  /**
   * Calls `fn` for every batch of up to `batchSize` documents (the overload with `batchSize` comes first).
   *
   * @param fn - Called with the batch and its index.
   * @param options - `batchSize` and the `eachAsync` options.
   * @throws {EachAsyncError} With `continueOnError`, after the end, when calls failed.
   */
  eachAsync(fn: (docs: T[], batchIndex: number) => unknown, options: EachAsyncBatchOptions): Promise<void>;
  /**
   * Calls `fn` for every document (`parallel`, `continueOnError`); closes the cursor at the end.
   *
   * @param fn - Called with the document and its index.
   * @param options - The `eachAsync` options.
   * @throws {EachAsyncError} With `continueOnError`, after the end, when calls failed.
   */
  eachAsync(fn: (doc: T, index: number) => unknown, options?: EachAsyncOptions): Promise<void>;
  /**
   * A new cursor whose documents are `fn(doc)`; this cursor is not changed.
   *
   * @param fn - The mapping function.
   * @returns The mapped cursor over the same stream.
   */
  map<U>(fn: (doc: T) => U): QueryCursor<U>;
}

/**
 * Validates an `eachAsync` numeric option.
 *
 * @param value - The option value.
 * @param name - The option name, used in the error message.
 * @param fallback - The value used when the option is absent.
 * @returns The value, or the fallback.
 * @throws {QueryError} When the value is not a positive integer.
 */
const positiveInteger = (value: number | undefined, name: string, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1)
    throw new QueryError(`eachAsync: ${name} must be a positive integer, got ${CastError.describe(value)}`);
  return value;
};

/** @internal The shared state of one stream (a cursor and the cursors mapped from it). */
export class CursorStream<T> {
  readonly #source: CursorSource<T>;
  #iterator: AsyncIterator<T, void, undefined> | undefined;
  #closed = false;
  /** Closed by the user (`close()`, leaving a `for await`), not by exhaustion. */
  #closedByUser = false;
  #reading: Promise<unknown> = Promise.resolve();

  /**
   * @param source - What the stream reads.
   */
  constructor(source: CursorSource<T>) {
    this.#source = source;
  }

  /** `true` once the stream was closed (by the user or by exhaustion). */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Reads the next document; reads are serialized (one `next` of the source at a time).
   *
   * @returns The iterator result; `done` when the stream is exhausted or closed by exhaustion.
   * @throws {QueryError} When the user closed the stream.
   */
  next(): Promise<IteratorResult<T, void>> {
    const read = this.#reading.then(async (): Promise<IteratorResult<T, void>> => {
      /* Reading a cursor the user closed is a bug, not the end of the data (Mongoose gh-4258). */
      if (this.#closedByUser)
        throw new QueryError("the cursor is closed (close() or a left for-await); open a new one");
      if (this.#closed) return { done: true, value: undefined };
      this.#iterator ??= this.#source[Symbol.asyncIterator]();
      const result = await this.#iterator.next();
      if (result.done === true) await this.close();
      return result;
    });
    this.#reading = read.catch(() => undefined);
    return read;
  }

  /** Closes the stream on the user's behalf: reading afterwards is an error. */
  async closeByUser(): Promise<void> {
    this.#closedByUser = true;
    await this.close();
  }

  /** Closes the iterator and the source (idempotent, never throws). */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    /*
     * A finished generator keeps its frame (the last batch, the operation context) while the iterator object
     * lives, so the stream lets go of it before closing.
     */
    const iterator = this.#iterator;
    this.#iterator = undefined;
    try {
      await iterator?.return?.();
      await this.#source.close?.();
    } catch {
      /* Closing never throws: killCursors failures are the driver's to swallow. */
    }
  }
}

/**
 * The runtime of {@link QueryCursor}.
 *
 * @example
 * ```ts
 * const cursor = new TypedCursor<number>({ async *[Symbol.asyncIterator]() { yield 1; yield 2; } });
 * const doubled = await cursor.map((n) => n * 2).toArray(); // [2, 4]
 * ```
 */
export class TypedCursor<T> implements QueryCursor<T> {
  readonly #stream: CursorStream<unknown>;
  readonly #transform: (doc: unknown) => T;

  /**
   * @param source - What the cursor reads.
   */
  constructor(source: CursorSource<T>);
  /**
   * @internal Creates a mapped cursor over an existing stream.
   * @param source - Unused placeholder source (the stream is shared).
   * @param stream - The shared stream.
   * @param transform - Converts a raw item into this cursor's document type.
   */
  constructor(source: CursorSource<T>, stream: CursorStream<unknown>, transform: (doc: unknown) => T);
  constructor(source: CursorSource<T>, stream?: CursorStream<unknown>, transform?: (doc: unknown) => T) {
    this.#stream = stream ?? new CursorStream<unknown>(source);
    this.#transform = transform ?? ((doc) => doc as T);
  }

  /**
   * @returns The next document, `null` when the cursor is exhausted.
   * @throws {QueryError} When the cursor was closed by the caller.
   */
  async next(): Promise<T | null> {
    const result = await this.#stream.next();
    return result.done === true ? null : this.#transform(result.value);
  }

  /**
   * @returns All remaining documents.
   * @throws {QueryError} When the cursor was closed by the caller.
   */
  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const doc of this) out.push(doc);
    return out;
  }

  /** Closes the cursor (idempotent, never throws); reading it afterwards is a `QueryError`. */
  close(): Promise<void> {
    return this.#stream.closeByUser();
  }

  /**
   * A new cursor whose documents are `fn(doc)`; both cursors read the same stream.
   *
   * @param fn - The mapping function.
   * @returns The mapped cursor.
   */
  map<U>(fn: (doc: T) => U): QueryCursor<U> {
    const transform = this.#transform;
    return new TypedCursor<U>(
      { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) },
      this.#stream,
      (doc) => fn(transform(doc)),
    );
  }

  eachAsync(fn: (docs: T[], batchIndex: number) => unknown, options: EachAsyncBatchOptions): Promise<void>;
  eachAsync(fn: (doc: T, index: number) => unknown, options?: EachAsyncOptions): Promise<void>;
  /**
   * Calls `fn` for every document, or for every batch when `batchSize` is set; closes the cursor at the end.
   *
   * @param fn - Called with a document (or a batch) and its index.
   * @param options - `parallel`, `continueOnError` and optionally `batchSize`.
   * @throws {QueryError} When `parallel` or `batchSize` is not a positive integer.
   * @throws {EachAsyncError} With `continueOnError`, after the end, when calls failed.
   * @throws {unknown} Without `continueOnError`, the first error `fn` threw.
   */
  async eachAsync(
    fn: ((doc: T, index: number) => unknown) | ((docs: T[], batchIndex: number) => unknown),
    options: EachAsyncOptions & { readonly batchSize?: number } = {},
  ): Promise<void> {
    const parallel = positiveInteger(options.parallel, "parallel", 1);
    const batchSize = options.batchSize === undefined ? undefined : positiveInteger(options.batchSize, "batchSize", 1);
    const errors: { readonly index: number; readonly error: unknown }[] = [];
    const running = new Set<Promise<void>>();
    let index = 0;
    let stop: unknown;
    const call = (item: T | T[], at: number): void => {
      const task = (async () => {
        try {
          await (fn as (value: T | T[], position: number) => unknown)(item, at);
        } catch (error) {
          if (options.continueOnError === true) errors.push({ index: at, error });
          else stop ??= error;
        }
      })();
      running.add(task);
      void task.finally(() => running.delete(task));
    };
    try {
      let batch: T[] = [];
      while (stop === undefined) {
        const doc = await this.next();
        if (doc === null) break;
        if (batchSize !== undefined) {
          batch.push(doc);
          if (batch.length < batchSize) continue;
          call(batch, index++);
          batch = [];
        } else {
          call(doc, index++);
        }
        while (running.size >= parallel) await Promise.race(running);
      }
      if (stop === undefined && batch.length > 0) call(batch, index++);
      await Promise.all(running);
    } finally {
      await this.close();
    }
    if (stop !== undefined) throw stop;
    if (errors.length > 0)
      throw new EachAsyncError(errors.sort((a, b) => a.index - b.index).map((entry) => entry.error));
  }

  /**
   * Iterates the documents. Leaving a `for await` early (break, throw) closes the cursor, as the driver's
   * cursor does; an exhausted stream closed itself.
   *
   * @returns The async generator of documents.
   * @throws {QueryError} When the cursor was closed by the caller.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    let exhausted = false;
    try {
      while (true) {
        const doc = await this.next();
        if (doc === null) {
          exhausted = true;
          return;
        }
        yield doc;
      }
    } finally {
      if (!exhausted) await this.close();
    }
  }
}
