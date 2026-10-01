import type { ChangeStream, ResumeToken } from "mongodb";
import { ErrorTranslator } from "../errors/error-translator.ts";

/** The outcome of the read that opened a stream: the raw event it brought (`null` for none), or its failure. */
interface FirstRead {
  readonly raw: unknown;
  readonly error?: unknown;
}

/**
 * A change stream over a model's collection: a thin, typed view of the driver's stream with `for await`, `next`,
 * `tryNext`, `resumeToken`, `closed` and `close`. Mongoose's wrapper had no `for await`, `tryNext` or
 * `resumeToken` and called no callbacks with driver 7.
 *
 * The server cursor is open when `Model.watch` resolves: a change made right after it is seen. The stream is
 * opened with a first non-blocking read; what that read brings (an event that happened while the stream was
 * opening) is kept and handed out by the first `next()`, `tryNext()` or iteration, so nothing is lost and no
 * read is needed as a barrier.
 *
 * Every event goes through a conversion (code names, hidden fields removed, documents lean or hydrated; see
 * `ChangeStreams`). Resuming after a resumable error is the driver's job; a new stream started from
 * `resumeToken` continues after a `close()`.
 *
 * @typeParam E - The event type (`ChangeEvent<T, O>`, or the pipeline's rows).
 *
 * @example
 * ```ts
 * const stream = await Users.watch({ fullDocument: "updateLookup" });
 * for await (const event of stream) console.log(event.operationType);
 * ```
 */
export class ModelChangeStream<out E> implements AsyncIterable<E, void, undefined> {
  readonly #stream: ChangeStream;
  readonly #convert: (raw: unknown) => E;
  /** The read that opened the server cursor, until a reader takes its outcome. */
  #first: Promise<FirstRead> | undefined;

  /**
   * Created by `Model.watch`. Not for direct use.
   *
   * @param stream - The driver's change stream.
   * @param convert - Converts each raw event (identity by default).
   */
  constructor(stream: ChangeStream, convert: (raw: unknown) => E = (raw) => raw as E) {
    this.#stream = stream;
    this.#convert = convert;
  }

  /**
   * Opens the server cursor of a driver stream and wraps it (see the class description).
   *
   * The driver opens the cursor inside its first read, and that read then waits for an event. The stream is
   * known to be open as soon as the server's reply to the opening command is processed, which the driver
   * announces with the resume token of that reply; the rest of the first read goes on in the background.
   *
   * @param stream - The driver's change stream, not read yet.
   * @param convert - Converts each raw event (identity by default).
   * @returns The stream, open on the server.
   * @throws {TypemoError} When the server refuses the stream; the error is wrapped in the Typemo hierarchy.
   * @internal
   */
  static async open<E>(stream: ChangeStream, convert?: (raw: unknown) => E): Promise<ModelChangeStream<E>> {
    const wrapped = new ModelChangeStream<E>(stream, convert);
    let announce: () => void = () => undefined;
    const announced = new Promise<void>((resolve) => {
      announce = resolve;
    });
    stream.once("resumeTokenChanged", announce);
    const first: Promise<FirstRead> = stream.tryNext().then(
      (raw: unknown): FirstRead => ({ raw }),
      (error: unknown): FirstRead => ({ raw: null, error }),
    );
    wrapped.#first = first;
    try {
      const early = await Promise.race([first, announced]);
      /* The opening command failed: the failure belongs to `watch()`, there is no stream to read. */
      if (early !== undefined && early.error !== undefined) {
        wrapped.#first = undefined;
        throw ErrorTranslator.wrap(early.error);
      }
    } finally {
      stream.off("resumeTokenChanged", announce);
    }
    return wrapped;
  }

  /**
   * Takes the outcome of the read that opened the stream, once.
   *
   * @returns The raw event that read brought, `null` when it brought none, `undefined` when it was taken before.
   * @throws {TypemoError} When that read failed and the stream was not closed by the caller.
   */
  async #takeFirst(): Promise<unknown> {
    const first = this.#first;
    if (first === undefined) return undefined;
    const outcome = await first;
    /* Two readers may wait for it together: only one takes the event. */
    if (this.#first !== first) return undefined;
    this.#first = undefined;
    if (outcome.error !== undefined) {
      if (this.#stream.closed) return null;
      throw ErrorTranslator.wrap(outcome.error);
    }
    return outcome.raw;
  }

  /**
   * The token to resume after the last event read (`resumeAfter` or `startAfter` of a new stream). Before the
   * first event it is the server's post-batch token; resuming from it skips nothing that follows.
   */
  get resumeToken(): ResumeToken {
    return this.#stream.resumeToken;
  }

  /** `true` once closed (by `close()`, by leaving a `for await`, or by an `invalidate`). */
  get closed(): boolean {
    return this.#stream.closed;
  }

  /**
   * The next event; waits for one.
   *
   * @returns The converted event.
   * @throws {TypemoError} When the driver fails; the error is wrapped in the Typemo hierarchy.
   */
  async next(): Promise<E> {
    const first = await this.#takeFirst();
    if (first !== undefined && first !== null) return this.#convert(first);
    let raw: unknown;
    try {
      raw = await this.#stream.next();
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
    return this.#convert(raw);
  }

  /**
   * The next event, or `null` when none is available now (one round trip at most).
   *
   * @returns The converted event, or `null`.
   * @throws {TypemoError} When the driver fails; the error is wrapped in the Typemo hierarchy.
   */
  async tryNext(): Promise<E | null> {
    /* The opening read is this call's round trip when it is still to be taken. */
    const first = await this.#takeFirst();
    if (first !== undefined) return first === null ? null : this.#convert(first);
    let raw: unknown;
    try {
      raw = await this.#stream.tryNext();
    } catch (error) {
      throw ErrorTranslator.wrap(error);
    }
    return raw === null ? null : this.#convert(raw);
  }

  /**
   * Closes the stream. Calling it again is harmless.
   *
   * @returns A promise that settles when the stream is closed.
   */
  async close(): Promise<void> {
    await this.#stream.close();
  }

  /**
   * Iterates the events with `for await`; leaving the loop closes the stream.
   *
   * @returns An async generator of converted events.
   * @throws {TypemoError} When the driver fails while the stream is open.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<E, void, undefined> {
    try {
      const first = await this.#takeFirst();
      if (first !== undefined && first !== null) yield this.#convert(first);
      while (!this.#stream.closed) {
        let raw: unknown;
        try {
          raw = await this.#stream.next();
        } catch (error) {
          /* Closing the stream while `next()` waits ends the loop, it is not a failure. */
          if (this.#stream.closed) return;
          throw ErrorTranslator.wrap(error);
        }
        yield this.#convert(raw);
      }
    } finally {
      await this.close();
    }
  }
}
