/*
 * Instrumentation core events on the real server: `wrap` around the execution (nesting, errors, zero cost),
 * the lazy summary, `steps: false`, the tenant only by `includeTenant`, the server address, populate
 * sub-queries as child operations with their path, save/bulkSave as operations, and the audit mask of
 * `sensitive: "show"`.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { MongoHarness } from "@venloc/typemo-test-kit";
import {
  type InstrumentationEvent,
  type InstrumentationSubscriber,
  type Model,
  type OperationInfo,
  type OperationStartEvent,
  SENSITIVE_MASK,
  type Subscription,
} from "../../../src/internal.ts";
import { SensitiveMask } from "../../../src/policies/sensitive-mask.ts";
import { Folder, Note } from "../../fixtures/mechanisms/mechanism-entities.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("instr11a");
let People: Model<Person>;
let Notes: Model<Note>;
let subscriptions: Subscription[] = [];

/**
 * Registers a subscriber on the test client and remembers it for cleanup.
 * @param subscriber The instrumentation subscriber.
 */
const listen = (subscriber: InstrumentationSubscriber): void => {
  subscriptions.push(t.client.instrument(subscriber));
};

/**
 * Subscribes and collects every event into an array.
 * @param options Extra subscriber options (everything except `handle`).
 * @returns The array that receives the events.
 */
const collect = (options: Omit<InstrumentationSubscriber, "handle"> = {}): InstrumentationEvent[] => {
  const events: InstrumentationEvent[] = [];
  listen({ handle: (event) => events.push(event), ...options });
  return events;
};

/**
 * Keeps only the `operation.start` events.
 * @param events The collected events.
 * @returns The start events.
 */
const starts = (events: readonly InstrumentationEvent[]): OperationStartEvent[] =>
  events.filter((event): event is OperationStartEvent => event.type === "operation.start");

/**
 * A valid person document input.
 * @param name The person's name; also used for the email.
 * @returns The plain input for `create`.
 */
const person = (name: string) => ({ name, email: `${name}@x.test`, tags: [], pets: [], lastSeen: null });

beforeEach(async () => {
  People = t.connection.model(Person);
  Notes = t.connection.model(Note);
  t.connection.model(Folder); /* registered: the populate target */
  await People.createIndexes();
});

afterEach(() => {
  for (const subscription of subscriptions) subscription.unsubscribe();
  subscriptions = [];
});

describe("wrap", () => {
  test("runs around the execution: its async context is active inside the operation; wraps nest in order", async () => {
    const store = new AsyncLocalStorage<string>();
    const order: string[] = [];
    const seenInside: (string | undefined)[] = [];
    listen({
      handle: (event) => {
        if (event.type === "operation.start") seenInside.push(store.getStore());
      },
      wrap: async (operation, run) => {
        order.push(`outer:${operation.operation}`);
        await store.run("outer", run);
        order.push("outer:end");
      },
    });
    listen({
      handle: () => {},
      wrap: async (_operation, run) => {
        order.push(`inner:${store.getStore()}`);
        await run();
        order.push("inner:end");
      },
    });
    const found = await People.find({ name: "Ann" });
    expect(found).toEqual([]);
    expect(order).toEqual(["outer:find", "inner:outer", "inner:end", "outer:end"]);
    expect(seenInside).toEqual(["outer"]);
  });

  test("gets the operation info (the same id as the events)", async () => {
    const infos: OperationInfo[] = [];
    const events = collect({
      wrap: (operation, run) => {
        infos.push(operation);
        return run();
      },
    });
    await People.countDocuments();
    expect(infos).toHaveLength(1);
    expect(infos[0]?.operationId).toBe(starts(events)[0]?.operationId as number);
    expect(infos[0]).not.toHaveProperty("tenant");
  });

  test("not called (no around) when no subscriber gives wrap", async () => {
    collect();
    const around = spyOn(t.client.instrumentation, "around");
    try {
      await People.find();
      expect(around).not.toHaveBeenCalled();
    } finally {
      around.mockRestore();
    }
  });

  test("a wrap that throws before run is reported; the operation runs anyway", async () => {
    const report = spyOn(console, "error").mockImplementation(() => {});
    try {
      listen({
        handle: () => {},
        wrap: () => {
          throw new Error("broken wrap");
        },
      });
      await People.insertOne(person("Ann"));
      expect(await People.countDocuments()).toBe(1);
      expect(report).toHaveBeenCalled();
    } finally {
      report.mockRestore();
    }
  });

  test("a wrap that never calls run is reported; the operation runs anyway", async () => {
    const report = spyOn(console, "error").mockImplementation(() => {});
    try {
      listen({ handle: () => {}, wrap: async () => undefined });
      await People.insertOne(person("Bob"));
      expect(await t.mongo.db.collection("m_people").countDocuments()).toBe(1);
      expect(report).toHaveBeenCalled();
    } finally {
      report.mockRestore();
    }
  });

  test("the operation's outcome is run's: a wrap that swallows the failure does not hide it", async () => {
    listen({
      handle: () => {},
      wrap: async (_operation, run) => {
        await run().catch(() => undefined);
      },
    });
    await People.insertOne(person("Ann"));
    /* A duplicate email (unique index of the fixture) fails on the server. */
    await expect(People.insertOne(person("Ann"))).rejects.toThrow();
  });

  test("a wrap that rejects after run: reported, the result stays", async () => {
    const report = spyOn(console, "error").mockImplementation(() => {});
    try {
      listen({
        handle: () => {},
        wrap: async (_operation, run) => {
          await run();
          throw new Error("late");
        },
      });
      await People.insertOne(person("Cid"));
      expect(await People.countDocuments()).toBe(1);
      expect(report).toHaveBeenCalled();
    } finally {
      report.mockRestore();
    }
  });
});

describe("lazy summary", () => {
  test("not computed when no subscriber reads it; computed once on first read", async () => {
    const events = collect();
    const redact = spyOn(SensitiveMask, "event");
    try {
      await People.find({ name: "Ann" });
      expect(redact).not.toHaveBeenCalled();
      const start = starts(events)[0] as OperationStartEvent;
      expect(start.summary.filter).toEqual({ name: "?" });
      const calls = redact.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      expect(start.summary).toBe(start.summary);
      expect(redact.mock.calls.length).toBe(calls);
    } finally {
      redact.mockRestore();
    }
  });
});

describe("steps: false", () => {
  test("no operation.step events for that subscriber; none built when nobody wants them", async () => {
    const events = collect({ steps: false });
    expect(t.client.instrumentation.wantsSteps).toBe(false);
    await People.countDocuments();
    expect(events.some((event) => event.type === "operation.step")).toBe(false);
    expect(events.some((event) => event.type === "operation.end")).toBe(true);
  });

  test("default subscribers still get steps; a steps:false one next to them does not", async () => {
    const quiet = collect({ steps: false });
    const loud = collect();
    await People.countDocuments();
    expect(quiet.some((event) => event.type === "operation.step")).toBe(false);
    expect(loud.some((event) => event.type === "operation.step")).toBe(true);
  });
});

describe("tenant", () => {
  test("only subscribers with includeTenant see it (start, end, wrap)", async () => {
    const withTenant = collect({ includeTenant: true });
    const without = collect();
    const wrapped: OperationInfo[] = [];
    listen({
      handle: () => {},
      includeTenant: true,
      wrap: (operation, run) => {
        wrapped.push(operation);
        return run();
      },
    });
    await Notes.find({ title: "x" }).policy({ tenant: "t1" });
    const start = starts(withTenant)[0] as OperationStartEvent;
    expect(start.tenant).toBe("t1");
    expect(start.summary.filter).toBeDefined();
    expect(withTenant.find((event) => event.type === "operation.end")).toMatchObject({ tenant: "t1" });
    expect(starts(without)[0]).not.toHaveProperty("tenant");
    expect(wrapped[0]?.tenant).toBe("t1");
  });
});

describe("server address", () => {
  test("operation info carries the host and port of the connection", async () => {
    const events = collect();
    await People.countDocuments();
    const start = starts(events)[0] as OperationStartEvent;
    const [, host, port] = /mongodb:\/\/([^:/,]+):(\d+)/.exec(MongoHarness.getUri()) ?? [];
    expect(start.serverAddress).toBe(host as string);
    expect(start.serverPort).toBe(Number(port));
  });
});

describe("populate and save", () => {
  test("populate sub-queries are child operations with the populated path", async () => {
    const folder = await t.mongo.db.collection("m9_folders").insertOne({ tenantId: "t", name: "f", deletedAt: null });
    await t.mongo.db
      .collection("m9_notes")
      .insertOne({ tenantId: "t", title: "n", folder: folder.insertedId, deletedAt: null });
    const events = collect();
    await Notes.find().populate("folder").policy({ tenant: "t" });
    const all = starts(events);
    const parent = all.find((event) => event.model === "Note") as OperationStartEvent;
    const child = all.find((event) => event.model === "Folder") as OperationStartEvent;
    expect(parent.parentId).toBeUndefined();
    expect(parent.populatePath).toBeUndefined();
    expect(child.parentId).toBe(parent.operationId);
    expect(child.populatePath).toBe("folder");
  });

  test("save and bulkSave are operations with a documentCount", async () => {
    const created = await People.create(person("Ann"));
    const events = collect();
    created.$set("name", "Anna");
    await created.$save();
    const saved = events.filter((event) => event.type === "operation.end");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ model: "Person", documentCount: 1 });
    events.length = 0;
    created.$set("name", "Annie");
    await People.bulkSave([created]);
    const bulk = events.filter((event) => event.type === "operation.end");
    expect(bulk).toHaveLength(1);
    expect(bulk[0]).toMatchObject({ operation: "bulkWrite", documentCount: 1 });
  });
});

describe("audit mask with sensitive: none", () => {
  test("fields marked audit mask/omit are masked in the real-values summary; others keep their values", async () => {
    const values = collect({ sensitive: "show" });
    await Notes.find({ title: "x", secret: "s3cr3t" }).policy({ tenant: "t" });
    await Notes.updateOne({ title: "x" }, { $set: { secret: "new", rank: 2 } }).policy({ tenant: "t" });
    const [find, update] = starts(values).filter((event) => event.model === "Note");
    const filter = find?.summary.filter as Record<string, unknown>;
    expect(filter.title).toBe("x");
    expect(filter.secret).toBe(SENSITIVE_MASK);
    const set = ((update as OperationStartEvent).summary.update as { $set: Record<string, unknown> }).$set;
    expect(set.secret).toBe(SENSITIVE_MASK);
    expect(set.rank).toBe(2);
    expect(
      JSON.stringify(values.filter((event) => event.type === "operation.start").map((e) => e.summary)),
    ).not.toContain("s3cr3t");
  });
});
