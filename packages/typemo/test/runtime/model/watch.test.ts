/* Basic watch: a typed change stream of the model's collection. */
import { describe, expect, test } from "bun:test";
import { Counter } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("watch");

describe("Model.watch", () => {
  test("events of the collection, filtered by a change-stream pipeline; for-await and close", async () => {
    const Counters = t.connection.model(Counter);
    await Counters.createCollection();
    const stream = await Counters.watch((p) => p.match({ operationType: "insert" }));
    const received = (async () => {
      for await (const event of stream) return event;
      return undefined;
    })();
    await Bun.sleep(100);
    await Counters.updateMany({ key: "none" }, { $set: { value: 1 } });
    const created = await Counters.create({ key: "k", value: 1 });
    const event = await received;
    /* Events are a union by operation type — narrow to read the insert's fields. */
    if (event?.operationType !== "insert") throw new Error("expected an insert event");
    expect(event.documentKey._id).toEqual(created._id);
    expect(event.fullDocument.key).toBe("k");
    expect(stream.closed).toBe(true);
    expect(stream.resumeToken).toBeDefined();
  });
});
