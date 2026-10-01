/*
 * Generic helpers over change streams: `<E>(stream: ModelChangeStream<E>) => …` called with the stream of
 * `watch(options)` and its events read afterwards. The first comparison of two event types makes the compiler
 * measure the variance of the event and document-form aliases; that measurement used to run until the
 * instantiation limit (TS2589). The file is also compiled on its own (`watch-helpers-type-tests.test.ts`),
 * because in a large program another file may have measured the variances first and hidden the error.
 */

import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ChangeEvent, Connection, EventDoc, ModelChangeStream } from "../../../src/index.ts";
import { Imaged } from "../../fixtures/mechanisms/storage-entities.ts";

declare const connection: Connection;

/**
 * The next `count` events of a stream (the helper a user writes).
 *
 * @param stream - The change stream.
 * @param count - How many events to read.
 * @returns The events in order.
 */
const take = async <E>(stream: ModelChangeStream<E>, count: number): Promise<E[]> => {
  const out: E[] = [];
  while (out.length < count) out.push(await stream.next());
  return out;
};

/** The runtime test's scenario: a stream resumed from the token of a first stream, read through the helper. */
export const resumed = async (): Promise<string[]> => {
  const Imageds = connection.model(Imaged);
  const first = await Imageds.watch();
  const [one] = await take(first, 1);
  expectTypeOf(one).toEqualTypeOf<ChangeEvent<Imaged> | undefined>();
  const stream = await Imageds.watch({ resumeAfter: first.resumeToken });
  const names = (await take(stream, 2)).map((event) =>
    event.operationType === "insert" ? event.fullDocument.name : "",
  );
  expectTypeOf(names).toEqualTypeOf<string[]>();
  return names;
};

/** Every option that changes the event type, through the same helper. */
export const withOptions = async (): Promise<void> => {
  const Imageds = connection.model(Imaged);
  const stream = await Imageds.watch({ fullDocument: "updateLookup", hydrate: true, batchSize: 10 });
  const events = await take(stream, 1);
  for (const event of events) {
    if (event.operationType === "update") {
      expectTypeOf(event.fullDocument).toEqualTypeOf<EventDoc<
        Imaged,
        { readonly fullDocument: "updateLookup"; readonly hydrate: true; readonly batchSize: 10 }
      > | null>();
    }
  }
  const started = await Imageds.watch({ startAfter: stream.resumeToken });
  const [again] = await take(started, 1);
  expectTypeOf(again?.operationType).toEqualTypeOf<ChangeEvent<Imaged>["operationType"] | undefined>();
  // @ts-expect-error the helper keeps the event type: an insert event has no updateDescription
  if (again?.operationType === "insert") again.updateDescription;
};

/** A helper over plain arrays of events of a stream with options (the smallest form of the old failure). */
export const names = (events: ChangeEvent<Imaged, { readonly batchSize: 1 }>[]): string[] =>
  events.map((event) => (event.operationType === "insert" ? event.fullDocument.name : ""));
