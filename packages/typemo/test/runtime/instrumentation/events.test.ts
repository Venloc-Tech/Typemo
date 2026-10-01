/*
 * Instrumentation on the real server: typed events of operations (start/end/error, nested steps, cursor
 * batches), transactions, driver commands linked to the operation, pool events; redaction by default;
 * zero cost without subscribers.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import {
  ConfigurationError,
  type DriverCommandEvent,
  type InstrumentationEvent,
  type Model,
  type OperationErrorEvent,
  type OperationStartEvent,
  type Subscription,
  Typemo,
  TypemoClient,
} from "../../../src/index.ts";
import { OperationEvents } from "../../../src/operation/pipeline/steps/operation-events.ts";
import { Hooked } from "../../fixtures/model/hooked-entities.ts";
import { Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("instr");
let People: Model<Person>;
let events: InstrumentationEvent[] = [];
let subscriptions: Subscription[] = [];

/**
 * Registers a collecting subscriber on the test client.
 * @param options Subscriber options: sensitivity and which optional event groups it receives.
 */
const listen = (options: { sensitive?: "show"; driverCommands?: boolean; poolEvents?: boolean } = {}) => {
  subscriptions.push(t.client.instrument({ handle: (event) => events.push(event), ...options }));
};

/**
 * A valid person document input.
 * @param name The person's name; also used for the email.
 * @returns The plain input for `create`.
 */
const person = (name: string) => ({ name, email: `${name}@x.test`, tags: [], pets: [], lastSeen: null });

beforeEach(async () => {
  People = t.connection.model(Person);
  await People.createIndexes();
  events = [];
});

afterEach(() => {
  for (const subscription of subscriptions) subscription.unsubscribe();
  subscriptions = [];
});

describe("operation events", () => {
  test("the operation info carries the model's compiled schema (describe(), ext, toDbPath)", async () => {
    listen();
    await People.find({ name: "Ann" });
    const start = events.find((event) => event.type === "operation.start") as OperationStartEvent;
    expect(start.schema).toBe(People.schema);
    expect(start.schema?.describe().name).toBe("Person");
    expect(start.schema?.extOf("name")).toEqual({});
    expect(start.schema?.extOf("nope")).toBeUndefined();
    expect(start.schema?.ext).toEqual({});
  });

  test("start and end, with the operation info and a REDACTED summary (values are ?)", async () => {
    listen();
    await People.find({ name: "Ann", age: { $gte: 18 } }).sort({ name: 1 });
    const start = events.find((event) => event.type === "operation.start") as OperationStartEvent;
    expect(start).toMatchObject({
      operation: "find",
      mode: "run",
      model: "Person",
      collection: "m_people",
      database: t.mongo.dbName,
      connection: "default",
      inTransaction: false,
      parentId: undefined,
    });
    expect(start.summary.filter).toEqual({ name: "?", age: { $gte: "?" } });
    const end = events.find((event) => event.type === "operation.end");
    expect(end).toMatchObject({ operationId: start.operationId, documentCount: 0 });
    expect((end as { durationMS: number }).durationMS).toBeGreaterThanOrEqual(0);
  });

  test("sensitive: none gives the real values (explicit choice only)", async () => {
    listen({ sensitive: "show" });
    await People.find({ name: "Ann" });
    const start = events.find((event) => event.type === "operation.start") as OperationStartEvent;
    expect(start.summary.filter).toEqual({ name: "Ann" });
  });

  test("nested step events carry the operation id", async () => {
    listen();
    await People.countDocuments();
    const start = events.find((event) => event.type === "operation.start") as OperationStartEvent;
    const steps = events.filter((event) => event.type === "operation.step");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((event) => event.operationId === start.operationId)).toBe(true);
  });

  test("a step the model does not need is skipped with a subscriber too — no event for it", async () => {
    listen();
    await People.find({ name: "Ann" });
    const plain = events.flatMap((event) => (event.type === "operation.step" ? [event.step] : []));
    expect(plain).toContain("cast");
    expect(plain).not.toContain("hooksPre");
    expect(plain).not.toContain("hooksPost");
    events = [];
    await t.connection.model(Hooked).find({ name: "Ann" });
    const hooked = events.flatMap((event) => (event.type === "operation.step" ? [event.step] : []));
    expect(hooked).toContain("hooksPre");
    expect(hooked).toContain("hooksPost");
  });

  test("error: classified (kind, code, retryable), with the failing step", async () => {
    listen();
    await People.create(person("Dup"));
    events = [];
    await People.create(person("Dup")).catch(() => undefined);
    const error = events.find((event) => event.type === "operation.error") as OperationErrorEvent;
    expect(error.failedStep).toBe("execute");
    expect(error.classification).toMatchObject({ kind: "duplicate-key", code: 11000, retryable: false });
    expect((error.error as Error).name).toBe("DuplicateKeyError");
  });

  test("cursor: one batch event per driver batch, end when the cursor is done", async () => {
    await People.insertMany([person("a"), person("b"), person("c")]);
    listen();
    await People.find().batchSize(2).cursor().toArray();
    expect(
      events.filter((event) => event.type === "cursor.batch").map((event) => (event as { size: number }).size),
    ).toEqual([2, 1]);
    expect(events.at(-1)?.type).toBe("operation.end");
  });

  test("transaction events: start, commit (and retry/abort)", async () => {
    await People.createCollection();
    listen();
    await t.connection.transaction(async () => {
      await People.countDocuments();
    });
    await t.connection
      .transaction(async () => {
        throw new Error("x");
      })
      .catch(() => undefined);
    const types = events.filter((event) => event.type.startsWith("transaction.")).map((event) => event.type);
    expect(types).toEqual(["transaction.start", "transaction.commit", "transaction.start", "transaction.abort"]);
  });
});

describe("driver events", () => {
  test("driver commands are linked to the Typemo operation that issued them; commands are redacted", async () => {
    listen({ driverCommands: true });
    await People.find({ name: "Ann" });
    const start = events.find((event) => event.type === "operation.start") as OperationStartEvent;
    const command = events.find(
      (event) => event.type === "driver.command.started" && event.commandName === "find",
    ) as DriverCommandEvent;
    expect(command.operationId).toBe(start.operationId);
    expect((command.command as { filter: unknown }).filter).toEqual({ name: "?" });
    const done = events.find(
      (event) => event.type === "driver.command.succeeded" && event.requestId === command.requestId,
    );
    expect((done as DriverCommandEvent).operationId).toBe(start.operationId);
  });

  test("pool events on request", async () => {
    listen({ poolEvents: true });
    await People.countDocuments();
    expect(events.some((event) => event.type === "driver.pool" && event.name === "connectionCheckedOut")).toBe(true);
  });

  test("driver commands need monitorCommands: true on the client (explicit error, not silence)", async () => {
    const plain = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName });
    try {
      expect(() => plain.instrument({ handle: () => {}, driverCommands: true })).toThrow(ConfigurationError);
    } finally {
      await plain.close();
    }
  });
});

describe("registration and cost", () => {
  test("global subscribers (Typemo.instrument) see every client's operations", async () => {
    const seen: string[] = [];
    const subscription = Typemo.instrument({ handle: (event) => seen.push(event.type) });
    try {
      await People.countDocuments();
    } finally {
      subscription.unsubscribe();
    }
    expect(seen).toContain("operation.start");
    const before = seen.length;
    await People.countDocuments();
    expect(seen.length).toBe(before);
  });

  test("without subscribers no event object is built", async () => {
    const start = spyOn(OperationEvents, "start");
    const info = spyOn(OperationEvents, "info");
    try {
      await People.find();
      await People.countDocuments();
      expect(start).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    } finally {
      start.mockRestore();
      info.mockRestore();
    }
  });
});
