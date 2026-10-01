/*
 * TypemoClient on the real server: connect/close, state from topology events, `await using`,
 * `useDb` and the model registry, readiness before `connect()`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { MongoHarness, MongoLifecycle } from "@venloc/typemo-test-kit";
import {
  BsonOptions,
  ConfigurationError,
  ConnectionError,
  type ConnectionState,
  TimeoutError,
  TypemoClient,
} from "../../../src/index.ts";
import { Order, Person } from "../../fixtures/model/model-entities.ts";

const mongo = MongoLifecycle.useMongo("conn", BsonOptions.apply({}));
const open: TypemoClient[] = [];
/**
 * Creates a client for the test database and registers it for closing after the test.
 * @param options Extra client options.
 * @returns A new, not yet connected client.
 */
const client = (options: ConstructorParameters<typeof TypemoClient>[1] = {}): TypemoClient => {
  const created = new TypemoClient(MongoHarness.getUri(), { dbName: mongo.dbName, ...options });
  open.push(created);
  return created;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

/**
 * A valid person document input.
 * @param name The person's name; also used for the email.
 * @returns The plain input for `create`.
 */
const person = (name: string) => ({ name, email: `${name}@x.test`, tags: [], pets: [], lastSeen: null });

describe("TypemoClient lifecycle", () => {
  test("idle → connecting → connected → closed, from topology events", async () => {
    const c = client();
    const states: ConnectionState[] = [];
    c.onStateChange((state) => states.push(state));
    expect(c.state).toBe("idle");
    await c.connect();
    expect(c.state).toBe("connected");
    await c.connect(); /* idempotent */
    await c.close();
    await c.close(); /* idempotent */
    expect(states).toEqual(["connecting", "connected", "closed"]);
  });

  test("TypemoClient.connect() and `await using` close the client at the end of the scope", async () => {
    let captured: TypemoClient | undefined;
    {
      await using c = await TypemoClient.connect(MongoHarness.getUri(), { dbName: mongo.dbName });
      captured = c;
      expect(c.state).toBe("connected");
    }
    expect(captured?.state).toBe("closed");
  });

  test("after close() operations fail at once with ConnectionError(closed); connect() too", async () => {
    const c = client();
    await c.connect();
    const People = c.connection.model(Person);
    await c.close();
    const error = await People.find().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).failure).toBe("closed");
    await expect(c.connect()).rejects.toThrow(/closed; create a new client/);
  });
});

describe("readiness", () => {
  test("an operation issued BEFORE connect() waits for it and then runs (no queue, the call itself continues)", async () => {
    const c = client();
    const People = c.connection.model(Person);
    const pending = People.countDocuments();
    await Bun.sleep(30);
    await c.connect();
    expect(await pending).toBe(0);
  });

  test("without connect() the wait ends with a clear TimeoutError after readyTimeoutMS (no timer left behind)", async () => {
    const c = client({ readyTimeoutMS: 60 });
    const People = c.connection.model(Person);
    const started = performance.now();
    const error = await People.find().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).kind).toBe("connection");
    expect((error as Error).message).toMatch(/not connected after 60 ms: call connect\(\)/);
    expect(performance.now() - started).toBeGreaterThanOrEqual(55);
  });

  test("the operation's timeoutMS bounds the wait (before readyTimeoutMS)", async () => {
    const c = client({ readyTimeoutMS: 5_000 });
    const error = await c.connection
      .model(Person)
      .find()
      .timeoutMS(40)
      .catch((caught: unknown) => caught);
    expect((error as TimeoutError).timeoutMS).toBe(40);
  });

  test("close() while operations wait: they fail with ConnectionError(closed)", async () => {
    const c = client();
    const pending = c.connection
      .model(Person)
      .find()
      .catch((caught: unknown) => caught);
    await c.close();
    expect(await pending).toBeInstanceOf(ConnectionError);
  });

  test("a failed connect() fails the waiting operations with the connect error", async () => {
    const c = new TypemoClient("mongodb://127.0.0.1:1/", { serverSelectionTimeoutMS: 200, readyTimeoutMS: 5_000 });
    open.push(c);
    const pending = c.connection
      .model(Person)
      .find()
      .catch((caught: unknown) => caught);
    const connectError = await c.connect().catch((caught: unknown) => caught);
    expect(connectError).toBeInstanceOf(ConnectionError);
    expect((connectError as ConnectionError).failure).toBe("server-selection");
    expect(await pending).toBe(connectError);
    expect(c.state).toBe("idle");
  });
});

describe("connections and the model registry", () => {
  test("one model per entity per connection; useDb gives another database of the same client", async () => {
    const c = client();
    await c.connect();
    const conn = c.connection;
    expect(conn.name).toBe(mongo.dbName);
    expect(conn.model(Person)).toBe(conn.model(Person));
    expect(conn.models.length).toBe(1);
    const other = conn.useDb(`${mongo.dbName}_other`);
    expect(other).toBe(c.db(`${mongo.dbName}_other`));
    expect(other.model(Person)).not.toBe(conn.model(Person));
    await other.model(Person).create(person("Iso"));
    expect(await conn.model(Person).countDocuments()).toBe(0);
    expect(await other.model(Person).countDocuments()).toBe(1);
    await c.unsafeDriver().db(`${mongo.dbName}_other`).dropDatabase();
  });

  test("connection plugins are fixed once a model is compiled on the connection", async () => {
    const c = client();
    const conn = c.db(`${mongo.dbName}_plugins`);
    conn.plugins.use({ name: "noop", apply: () => {} });
    conn.model(Order);
    expect(() => conn.plugins.use({ name: "late", apply: () => {} })).toThrow(ConfigurationError);
  });

  test("model() of a class that is not a model is a ConfigurationError at registration", () => {
    class Plain {}
    expect(() => client().connection.model(Plain)).toThrow(ConfigurationError);
  });
});
