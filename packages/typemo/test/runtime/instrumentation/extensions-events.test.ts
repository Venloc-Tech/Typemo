/*
 * Event → ext end to end on the real server. The extension is registered on ONE client (`client.use`),
 * so the flow runs in the shared test process.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import { testLabelExtension } from "../../../../test-kit/fixtures/extensions/test-label-extension.ts";
import {
  ConfigurationError,
  type InstrumentationEvent,
  type OperationStartEvent,
  Pipeline,
  TypemoClient,
} from "../../../src/index.ts";
import { Labeled, LabelHost } from "../../fixtures/extensions/labeled-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("x115");
let client: TypemoClient;

beforeAll(async () => {
  client = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName });
  client.use(testLabelExtension);
  await client.connect();
});

afterAll(async () => {
  await client.close();
});

describe("schema extensions through instrumentation events (client.use, real server)", () => {
  test("event.schema.ext / extOf(path) return what the model declared with a registered extension", async () => {
    const events: InstrumentationEvent[] = [];
    const subscription = client.instrument({ handle: (event) => events.push(event) });
    try {
      const Items = client.connection.model(Labeled);
      await Items.create({ email: "a@x.test" });
      const found = await Items.find({ email: "a@x.test" }).lean();
      const start = events.find(
        (event): event is OperationStartEvent => event.type === "operation.start" && event.operation === "find",
      );
      expect(found.length).toBe(1);
      expect(start?.schema?.ext).toEqual({ testLabel: { group: "people" } });
      expect(start?.schema?.extOf("email")).toEqual({ testLabel: { label: "Email" } });
      expect(start?.schema?.extOf("plain")).toEqual({});
      expect(start?.schema?.toDbPath("email")).toBe("em");
      expect(start?.schema).toBe(Items.schema);
      const lifecycle = events.filter((event) => event.type === "operation.start" || event.type === "operation.end");
      expect(lifecycle.every((event) => "schema" in event && event.schema?.ext?.testLabel !== undefined)).toBe(true);
    } finally {
      subscription.unsubscribe();
    }
  });

  test("another client without the extension refuses the same model; a late client.use is refused", () => {
    /* The shared test client never registered `testLabel`: the key is unknown to its models. */
    expect(() => t.connection.model(Labeled)).toThrow(
      'Labeled: ext "testLabel" is not a registered extension; register it before the first model with client.use() (for the models of one client) or Typemo.use() (for every client)',
    );
    expect(() => client.use({ name: "late", validateProp: () => undefined } as never)).toThrow(ConfigurationError);
  });

  test("an entity with a client-only extension is a $lookup / $unionWith source of that client's model", async () => {
    const Hosts = client.connection.model(LabelHost);
    const Items = client.connection.model(Labeled);
    await Items.create({ email: "join@x.test" });
    await Hosts.create({ email: "join@x.test" });
    /* The source must compile in the client's context, not the default one: else ConfigurationError "testLabel". */
    const joined = await Hosts.aggregate((p) =>
      p
        .match({ email: "join@x.test" })
        .lookup({ from: Labeled, localField: "email", foreignField: "email", as: "labels" }),
    );
    expect(joined.length).toBe(1);
    expect((joined[0] as { labels: readonly unknown[] }).labels.length).toBe(1);
    /*
     * $unionWith: the source compiles (no ext error); the run is then refused for its own reason — Labeled stores
     * `email` as "em", and rows of two stored shapes cannot be translated back.
     */
    await expect(Hosts.aggregate((p) => p.unionWith(Labeled)).exec()).rejects.toThrow(
      "$unionWith mixes rows of two stored shapes",
    );
    /* Outside a model the default context still applies: the extension is not global. */
    expect(() => Pipeline.from(LabelHost).unionWith(Labeled)).toThrow('ext "testLabel" is not a registered extension');
  });
});
