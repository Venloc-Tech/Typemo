/*
 * The Typemo cursor over any source — next/toArray/close, `for await` closes on break, typed `map` that does not
 * change the original, `eachAsync` with parallel/batchSize/continueOnError.
 */
import { describe, expect, test } from "bun:test";
import { type CursorSource, EachAsyncError, QueryError, TypedCursor } from "../../../src/internal.ts";

/** A source of `count` numbers that records what was read and calls `onClose` when closed. */
const source = (count: number, onClose?: () => void): CursorSource<number> & { readonly read: number[] } => {
  const read: number[] = [];
  return {
    read,
    async *[Symbol.asyncIterator]() {
      for (let n = 0; n < count; n++) {
        read.push(n);
        yield n;
      }
    },
    close: async () => onClose?.(),
  };
};

describe("TypedCursor", () => {
  test("next() gives documents then null; toArray() the rest", async () => {
    const cursor = new TypedCursor(source(4));
    expect(await cursor.next()).toBe(0);
    expect(await cursor.toArray()).toEqual([1, 2, 3]);
    expect(await cursor.next()).toBeNull();
  });

  test("breaking out of for-await closes the source (and close is idempotent); reading a closed cursor is an error", async () => {
    let closed = 0;
    const cursor = new TypedCursor(source(10, () => closed++));
    for await (const doc of cursor) if (doc === 2) break;
    await cursor.close();
    expect(closed).toBe(1);
    await expect(cursor.next()).rejects.toThrow(/the cursor is closed/);
  });

  test("an exhausted cursor keeps answering null", async () => {
    const cursor = new TypedCursor(source(1));
    expect(await cursor.toArray()).toEqual([0]);
    expect(await cursor.next()).toBeNull();
  });

  test("map returns a NEW cursor; the original's documents are not transformed", async () => {
    const cursor = new TypedCursor(source(3));
    const doubled = cursor.map((n) => ({ twice: n * 2 }));
    expect(await doubled.next()).toEqual({ twice: 0 });
    expect(await cursor.next()).toBe(1); /* same stream, untransformed view */
    const labelled = doubled.map((value) => `#${value.twice}`);
    expect(await labelled.next()).toBe("#4");
  });

  test("eachAsync: every document, in order, one at a time by default; closes at the end", async () => {
    let closed = false;
    const seen: [number, number][] = [];
    await new TypedCursor(source(5, () => (closed = true))).eachAsync((doc, index) => {
      seen.push([doc, index]);
    });
    expect(seen).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(closed).toBe(true);
  });

  test("eachAsync parallel: at most `parallel` callbacks run at once", async () => {
    let running = 0;
    let peak = 0;
    await new TypedCursor(source(12)).eachAsync(
      async () => {
        running++;
        peak = Math.max(peak, running);
        await Bun.sleep(5);
        running--;
      },
      { parallel: 3 },
    );
    expect(peak).toBe(3);
  });

  test("eachAsync batchSize: arrays of up to batchSize, the last one shorter", async () => {
    const batches: number[][] = [];
    await new TypedCursor(source(7)).eachAsync(
      (docs: number[], batch) => {
        batches.push([batch, ...docs]);
      },
      { batchSize: 3 },
    );
    expect(batches).toEqual([
      [0, 0, 1, 2],
      [1, 3, 4, 5],
      [2, 6],
    ]);
  });

  test("eachAsync stops at the first error (no more reads), waits for running calls, closes, rethrows", async () => {
    let closed = false;
    const src = source(100, () => (closed = true));
    const error = await new TypedCursor(src)
      .eachAsync((doc) => {
        if (doc === 3) throw new Error("boom at 3");
      })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("boom at 3");
    expect(src.read.length).toBe(4);
    expect(closed).toBe(true);
  });

  test("eachAsync continueOnError: every document is processed, all errors in order in EachAsyncError", async () => {
    const error = await new TypedCursor(source(6))
      .eachAsync(
        async (doc) => {
          await Bun.sleep(doc % 2 === 0 ? 5 : 0);
          if (doc % 2 === 0) throw new Error(`even ${doc}`);
        },
        { continueOnError: true, parallel: 3 },
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EachAsyncError);
    expect((error as EachAsyncError).errors.map((e) => (e as Error).message)).toEqual(["even 0", "even 2", "even 4"]);
  });

  test("eachAsync refuses parallel/batchSize that are not positive integers", async () => {
    await expect(new TypedCursor(source(1)).eachAsync(() => {}, { parallel: 0 })).rejects.toThrow(QueryError);
    await expect(new TypedCursor(source(1)).eachAsync(() => {}, { batchSize: 1.5 })).rejects.toThrow(/batchSize/);
  });

  test("concurrent next() calls are serialized (one read of the source at a time)", async () => {
    const cursor = new TypedCursor(source(3));
    const values = await Promise.all([cursor.next(), cursor.next(), cursor.next(), cursor.next()]);
    expect(values).toEqual([0, 1, 2, null]);
  });
});
