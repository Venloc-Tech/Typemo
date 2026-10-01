/*
 * `@venloc/typemo-opentelemetry` on the real server: span names and tree (operation → populate / commands /
 * steps), semantic-convention attributes, `sensitive` ("mask" default, "show" with the schema marks),
 * errors, a transaction with a retry, a cursor, unsubscribe, the async context on Bun, metrics.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import * as semconv from "@opentelemetry/semantic-conventions";
import * as incubating from "@opentelemetry/semantic-conventions/incubating";
import {
  BsonOptions,
  type Connection,
  Entity,
  type Model,
  Pipeline,
  Prop,
  type Ref,
  Schema,
  SENSITIVE_MASK,
  type Subscription,
  TypemoClient,
  Types,
} from "@venloc/typemo";
import { type FailPointHandle, FailPointHelpers, MongoHarness, MongoLifecycle } from "@venloc/typemo-test-kit";
import { type OpenTelemetryOptions, SemConv, TypemoOpenTelemetry } from "../src/index.ts";

@Schema({ collection: "otel_teams" })
class Team extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

@Schema({ collection: "otel_users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { sensitive: "mask", dbName: "pw" }) password?: string;
  @Prop(() => Types.ObjectId, { ref: () => Team }) team?: Ref<Team>;
  @Prop(() => String, { sensitive: "hide" }) internal?: string;
  @Prop(() => String, { sensitive: { mask: (value: string) => `${value.slice(0, 2)}***` } }) email?: string;
  @Prop(() => String, { sensitive: "show" }) city?: string;
}

@Schema({ collection: "otel_accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true, sensitive: "hide" }) login!: string;
  @Prop(() => Number) age?: number;
}

const SECRET = "otel-s3cr3t";
const mongo = MongoLifecycle.useMongo("otel", BsonOptions.apply({}));
const spans = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] });
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 });
const meterProvider = new MeterProvider({ readers: [reader] });
const contextManager = new AsyncLocalStorageContextManager();
let client: TypemoClient;
let connection: Connection;
let Users: Model<User>;
let Teams: Model<Team>;
let subscription: Subscription | undefined;
let failpoint: FailPointHandle | undefined;

const use = (options: OpenTelemetryOptions = {}): void => {
  subscription = TypemoOpenTelemetry.instrument(client, { tracerProvider, meterProvider, ...options });
};
const finished = (): ReadableSpan[] => spans.getFinishedSpans();
const named = (name: string): ReadableSpan => {
  const span = finished().find((one) => one.name === name);
  if (span === undefined)
    throw new Error(
      `no span "${name}" in ${finished()
        .map((one) => one.name)
        .join(", ")}`,
    );
  return span;
};
const parentOf = (span: ReadableSpan): string | undefined => span.parentSpanContext?.spanId;

beforeAll(async () => {
  context.setGlobalContextManager(contextManager.enable());
  client = new TypemoClient(MongoHarness.getUri(), { dbName: mongo.dbName, monitorCommands: true });
  await client.connect();
  connection = client.connection;
  Users = connection.model(User);
  Teams = connection.model(Team);
});

afterAll(async () => {
  await client.close();
  context.disable();
  await meterProvider.shutdown();
});

beforeEach(() => spans.reset());

afterEach(async () => {
  subscription?.unsubscribe();
  subscription = undefined;
  await failpoint?.disable();
  failpoint = undefined;
});

describe("semantic convention names", () => {
  test("the copied names equal the package's constants", () => {
    expect(SemConv.DB_SYSTEM_NAME).toBe(semconv.ATTR_DB_SYSTEM_NAME);
    expect(SemConv.DB_SYSTEM_NAME_VALUE_MONGODB).toBe(incubating.DB_SYSTEM_NAME_VALUE_MONGODB);
    expect(SemConv.DB_NAMESPACE).toBe(semconv.ATTR_DB_NAMESPACE);
    expect(SemConv.DB_COLLECTION_NAME).toBe(semconv.ATTR_DB_COLLECTION_NAME);
    expect(SemConv.DB_OPERATION_NAME).toBe(semconv.ATTR_DB_OPERATION_NAME);
    expect(SemConv.DB_QUERY_SUMMARY).toBe(semconv.ATTR_DB_QUERY_SUMMARY);
    expect(SemConv.DB_QUERY_TEXT).toBe(semconv.ATTR_DB_QUERY_TEXT);
    expect(SemConv.DB_RESPONSE_STATUS_CODE).toBe(semconv.ATTR_DB_RESPONSE_STATUS_CODE);
    expect(SemConv.DB_RESPONSE_RETURNED_ROWS).toBe(incubating.ATTR_DB_RESPONSE_RETURNED_ROWS);
    expect(SemConv.SERVER_ADDRESS).toBe(semconv.ATTR_SERVER_ADDRESS);
    expect(SemConv.SERVER_PORT).toBe(semconv.ATTR_SERVER_PORT);
    expect(SemConv.ERROR_TYPE).toBe(semconv.ATTR_ERROR_TYPE);
    expect(SemConv.METRIC_DB_CLIENT_OPERATION_DURATION).toBe(semconv.METRIC_DB_CLIENT_OPERATION_DURATION);
    expect(SemConv.METRIC_DB_CLIENT_CONNECTION_COUNT).toBe(incubating.METRIC_DB_CLIENT_CONNECTION_COUNT);
    expect(SemConv.DB_CLIENT_CONNECTION_POOL_NAME).toBe(incubating.ATTR_DB_CLIENT_CONNECTION_POOL_NAME);
    expect(SemConv.DB_CLIENT_CONNECTION_STATE).toBe(incubating.ATTR_DB_CLIENT_CONNECTION_STATE);
    expect(SemConv.DB_CLIENT_CONNECTION_STATE_VALUE_IDLE).toBe(incubating.DB_CLIENT_CONNECTION_STATE_VALUE_IDLE);
    expect(SemConv.DB_CLIENT_CONNECTION_STATE_VALUE_USED).toBe(incubating.DB_CLIENT_CONNECTION_STATE_VALUE_USED);
    expect(SemConv.METRIC_DB_CLIENT_CONNECTION_TIMEOUTS).toBe(incubating.METRIC_DB_CLIENT_CONNECTION_TIMEOUTS);
    expect(SemConv.METRIC_DB_CLIENT_CONNECTION_PENDING_REQUESTS).toBe(
      incubating.METRIC_DB_CLIENT_CONNECTION_PENDING_REQUESTS,
    );
    expect(SemConv.METRIC_DB_CLIENT_CONNECTION_MAX).toBe(incubating.METRIC_DB_CLIENT_CONNECTION_MAX);
    expect(SemConv.METRIC_DB_CLIENT_CONNECTION_IDLE_MIN).toBe(incubating.METRIC_DB_CLIENT_CONNECTION_IDLE_MIN);
    expect(SemConv.METRIC_DB_CLIENT_CONNECTION_CREATE_TIME).toBe(incubating.METRIC_DB_CLIENT_CONNECTION_CREATE_TIME);
    expect(SemConv.METRIC_DB_CLIENT_CONNECTION_WAIT_TIME).toBe(incubating.METRIC_DB_CLIENT_CONNECTION_WAIT_TIME);
    expect(SemConv.METRIC_DB_CLIENT_CONNECTION_USE_TIME).toBe(incubating.METRIC_DB_CLIENT_CONNECTION_USE_TIME);
  });
});

describe("operation spans", () => {
  test("one CLIENT span `Typemo.<op> (<Model>)` with the convention attributes, db.query.text always written, masked", async () => {
    use();
    await Users.create({ name: "ann", password: SECRET });
    const rows = await Users.find({ name: "ann" });
    expect(rows).toHaveLength(1);
    const span = named("Typemo.find (User)");
    expect(span.kind).toBe(2); // SpanKind.CLIENT
    expect(span.attributes).toMatchObject({
      "db.system.name": "mongodb",
      "db.namespace": mongo.dbName,
      "db.collection.name": "otel_users",
      "db.operation.name": "find",
      "db.query.summary": "find otel_users",
      "db.response.returned_rows": 1,
      "typemo.model": "User",
      "typemo.operation.mode": "run",
    });
    expect(typeof span.attributes["server.address"]).toBe("string");
    expect(typeof span.attributes["server.port"]).toBe("number");
    expect(JSON.parse(String(span.attributes["db.query.text"]))).toEqual({ filter: { name: "?" } });
    expect(JSON.stringify(finished().map((one) => one.attributes))).not.toContain(SECRET);
    expect(JSON.stringify(finished().map((one) => one.attributes))).not.toContain("ann");
  });

  test("the span's parent is the active context at the call; populate sub-queries are children", async () => {
    use();
    const team = await Teams.create({ name: "red" });
    await Users.create({ name: "bob", team: team._id });
    spans.reset();
    const root = tracerProvider.getTracer("test").startSpan("request");
    /* A query is lazy: it runs (and takes the active context) when awaited, so it is awaited INSIDE. */
    await context.with(
      trace.setSpan(context.active(), root),
      async () => await Users.find({ name: "bob" }).populate("team"),
    );
    root.end();
    const find = named("Typemo.find (User)");
    const child = named("Typemo.find (Team)");
    expect(parentOf(find)).toBe(root.spanContext().spanId);
    expect(parentOf(child)).toBe(find.spanContext().spanId);
    expect(child.attributes["typemo.populate.path"]).toBe("team");
  });

  test("commandSpans and stepSpans are children of the operation span", async () => {
    use({ commandSpans: true, stepSpans: true });
    await Users.findOne({ name: "none" });
    const operation = named("Typemo.findOne (User)");
    const command = named("find");
    expect(parentOf(command)).toBe(operation.spanContext().spanId);
    const steps = finished().filter((one) => one.name.startsWith("Typemo.step "));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(parentOf(step)).toBe(operation.spanContext().spanId);
  });

  test("command spans: the collection is never masked (every command), server.address is the host, server.port the port", async () => {
    use({ commandSpans: true });
    await Users.create({ name: "cmd-ann" });
    await Users.find({ name: "cmd-ann" });
    await Users.updateOne({ name: "cmd-ann" }, { $set: { name: "cmd-bob" } });
    await Users.findOneAndUpdate({ name: "cmd-bob" }, { $set: { name: "cmd-cid" } });
    await Users.countDocuments({ name: "cmd-cid" });
    await Users.distinct("name", { name: "cmd-cid" });
    await Users.aggregate((p) => p.match({ name: "cmd-cid" }));
    await Users.deleteOne({ name: "cmd-cid" });
    const names = ["insert", "find", "update", "findAndModify", "aggregate", "distinct", "delete"];
    for (const name of names) {
      const span = named(name);
      const text = JSON.parse(String(span.attributes["db.query.text"])) as Record<string, unknown>;
      expect(text[name]).toBe("otel_users");
      expect(span.attributes["db.collection.name"]).toBe("otel_users");
      expect(span.attributes["server.address"]).toBe("127.0.0.1");
      expect(typeof span.attributes["server.port"]).toBe("number");
      expect(String(span.attributes["server.address"])).not.toContain(":");
    }
    /* The operation span and the command span report the same server. */
    const operation = named("Typemo.find (User)");
    expect(named("find").attributes["server.address"]).toBe(operation.attributes["server.address"]);
    expect(named("find").attributes["server.port"]).toBe(operation.attributes["server.port"]);
    /* The values stay masked. */
    expect(JSON.stringify(finished().map((one) => one.attributes))).not.toContain("cmd-");
  });

  test("a database-level aggregation (connection.aggregate): no collection or model attribute, the span names the database", async () => {
    use({ commandSpans: true });
    await connection.aggregate(
      Pipeline.database()
        .documents([{ n: 1 }])
        .plan(),
    );
    const span = named(`Typemo.aggregate (database ${mongo.dbName})`);
    expect(span.attributes["db.namespace"]).toBe(mongo.dbName);
    expect(span.attributes["db.query.summary"]).toBe("aggregate");
    expect(span.attributes).not.toHaveProperty("db.collection.name");
    expect(span.attributes).not.toHaveProperty("typemo.model");
    /* The command of a database-level aggregation is `aggregate: 1`: no collection either. */
    const command = named("aggregate");
    expect(parentOf(command)).toBe(span.spanContext().spanId);
    expect(command.attributes).not.toHaveProperty("db.collection.name");
  });

  test("an error: status ERROR, error.type, the exception recorded", async () => {
    use();
    const created = await Users.create({ name: "dup" });
    await expect(Users.create({ _id: created._id, name: "dup" } as never)).rejects.toThrow();
    const failed = finished().filter((one) => one.name === "Typemo.insertOne (User)" && one.status.code === 2);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.attributes["error.type"]).toBe("DuplicateKeyError");
    expect(failed[0]?.events.some((event) => event.name === "exception")).toBe(true);
  });

  test("Model.create with an invalid value is an ERROR span with error.type ValidationError", async () => {
    use();
    await expect(Users.create({} as never)).rejects.toThrow();
    const failed = finished().filter((one) => one.name === "Typemo.insertOne (User)");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(failed[0]?.attributes["error.type"]).toBe("ValidationError");
    expect(failed[0]?.events.some((event) => event.name === "exception")).toBe(true);
    expect(await Users.countDocuments({ name: { $exists: false } })).toBe(0);
  });

  test("a cursor: `Typemo.find.cursor (User)` with cursor.batch events", async () => {
    use();
    await Users.insertMany([{ name: "c1" }, { name: "c2" }, { name: "c3" }]);
    spans.reset();
    const seen: string[] = [];
    for await (const user of Users.find({ name: /^c/ }).batchSize(2).cursor()) seen.push(user.name);
    expect(seen).toHaveLength(3);
    const span = named("Typemo.find.cursor (User)");
    expect(span.events.filter((event) => event.name === "cursor.batch").length).toBeGreaterThan(0);
  });

  test("unsubscribe: no spans afterwards", async () => {
    use();
    subscription?.unsubscribe();
    subscription = undefined;
    await Users.countDocuments();
    expect(finished()).toHaveLength(0);
  });
});

describe("errors never carry marked values into spans", () => {
  test('DuplicateKeyError on a "hide" field: recordException, status and command spans carry no value', async () => {
    const Accounts = connection.model(Account);
    await Accounts.createIndexes();
    await Accounts.create({ login: "otel-dup-login" });
    use({ commandSpans: true });
    await Accounts.create({ login: "otel-dup-login" }).catch(() => undefined);
    await Accounts.findOneAndUpdate({ age: 1 }, { $set: { login: "otel-dup-login" } }, { upsert: true }).catch(
      () => undefined,
    );
    const text = JSON.stringify(finished().map((one) => ({ a: one.attributes, e: one.events, s: one.status })));
    expect(text).toContain("DuplicateKeyError");
    expect(text).not.toContain("otel-dup-login");
  });

  test('an unmarked value in a CastError is "?" in the span exception (default "mask")', async () => {
    use();
    /* cast: a wrong type on purpose (the cast must fail at run time) */
    await connection
      .model(Account)
      .find({ age: "otel-unmarked-value" as never })
      .catch(() => undefined);
    const text = JSON.stringify(finished().map((one) => ({ a: one.attributes, e: one.events, s: one.status })));
    expect(text).toContain("CastError");
    expect(text).not.toContain("otel-unmarked-value");
  });
});

describe("sensitive: none", () => {
  test("db.query.text carries values with the audit mask (dbName alias too), commands too", async () => {
    use({ sensitive: "show", commandSpans: true });
    await Users.find({ name: "eve", password: SECRET });
    const text = String(named("Typemo.find (User)").attributes["db.query.text"]);
    expect(text).toContain("eve");
    expect(text).toContain(SENSITIVE_MASK);
    expect(JSON.stringify(finished().map((one) => one.attributes))).not.toContain(SECRET);
  });
});

describe("sensitive per field mode × subscriber mode", () => {
  const FILTER = { name: "eve", password: SECRET, internal: "int-x", email: "eve@x.test", city: "Oslo" };
  const query = async (): Promise<Record<string, unknown>> => {
    await Users.find(FILTER);
    return JSON.parse(String(named("Typemo.find (User)").attributes["db.query.text"])) as Record<string, unknown>;
  };

  test('"mask" (default): unmarked "?", field mask "?", hide "[hidden]", fn its result, show real', async () => {
    use();
    const text = await query();
    expect(JSON.stringify(text)).not.toContain(SECRET);
    expect(JSON.stringify(text)).not.toContain("int-x");
    /* A "hide" field keeps its key, the value is the marker. */
    expect(JSON.stringify(text)).toContain('"internal":"[hidden]"');
    expect(JSON.stringify(text)).toContain('"ev***"');
    expect(JSON.stringify(text)).toContain('"Oslo"');
    expect(JSON.stringify(text)).not.toContain('"eve"');
  });

  test('"hide": unmarked values "[hidden]", field modes kept', async () => {
    use({ sensitive: "hide" });
    const text = JSON.stringify(await query());
    expect(text).not.toContain('"eve');
    expect(text).toContain('"name":"[hidden]"');
    expect(text).not.toContain("int-x");
    expect(text).not.toContain(SECRET);
    expect(text).toContain('"ev***"');
    expect(text).toContain('"Oslo"');
  });

  test("a subscriber function (value, { path }) for unmarked values; field modes kept", async () => {
    use({ sensitive: { mask: (value, { path }) => `${path}#${String(value).length}` } });
    const text = JSON.stringify(await query());
    expect(text).toContain('"name#3"');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("int-x");
    expect(text).toContain('"ev***"');
    expect(text).toContain('"Oslo"');
  });

  test("a throwing subscriber mask is a span event on the operation span, without the value", async () => {
    const original = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      use({
        sensitive: {
          mask: (value) => {
            throw new Error(`bad ${String(value)}`);
          },
        },
      });
      await Users.find({ name: SECRET });
    } finally {
      console.error = original;
    }
    const span = named("Typemo.find (User)");
    const event = span.events.find((one) => one.name === "typemo.instrumentation.error");
    expect(event?.attributes).toMatchObject({
      "typemo.instrumentation.source": "sensitive-mask",
      "typemo.path": "name",
      "typemo.model": "User",
    });
    expect(JSON.stringify([span.attributes, span.events])).not.toContain(SECRET);
    expect(logged).toEqual([]);
  });
});

describe("async context on Bun (AsyncLocalStorageContextManager)", () => {
  test("the operation span is active across await inside a hook-free call and a transaction retry", async () => {
    use();
    const root = tracerProvider.getTracer("test").startSpan("request");
    failpoint = await FailPointHelpers.configureFailCommand(mongo.client, {
      failCommands: ["insert"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    let attempts = 0;
    const activeInside: (string | undefined)[] = [];
    await context.with(trace.setSpan(context.active(), root), () =>
      connection.transaction(async () => {
        attempts++;
        await Promise.resolve();
        activeInside.push(trace.getActiveSpan()?.spanContext().spanId);
        await Users.create({ name: `tx${attempts}` });
      }),
    );
    root.end();
    expect(attempts).toBe(2);
    expect(activeInside).toEqual([root.spanContext().spanId, root.spanContext().spanId]);
    const creates = finished().filter((one) => one.name === "Typemo.insertOne (User)");
    expect(creates).toHaveLength(2);
    const transaction = named("Typemo.transaction");
    expect(parentOf(transaction)).toBe(root.spanContext().spanId);
    for (const one of creates) {
      expect(parentOf(one)).toBe(transaction.spanContext().spanId);
      expect(one.attributes["typemo.transaction"]).toBe(true);
    }
    expect(transaction.events.some((event) => event.name === "transaction.retry")).toBe(true);
  });
});

describe("metrics", () => {
  test("db.client.operation.duration (seconds, convention buckets); pool connection counts", async () => {
    use({ poolMetrics: true });
    await Users.countDocuments();
    await reader.forceFlush();
    const metrics = metricExporter.getMetrics().flatMap((resource) => resource.scopeMetrics.flatMap((s) => s.metrics));
    const duration = metrics.find((one) => one.descriptor.name === "db.client.operation.duration");
    expect(duration?.descriptor.unit).toBe("s");
    const point = duration?.dataPoints.find((one) => one.attributes["db.operation.name"] === "countDocuments");
    expect(point?.attributes["db.collection.name"]).toBe("otel_users");
    const value = point?.value as { readonly buckets: { readonly boundaries: readonly number[] } } | undefined;
    expect(value?.buckets.boundaries).toEqual([...SemConv.DURATION_BUCKETS]);
  });
});

describe("pool metrics", () => {
  test("the CMAP-derived set: count by state, pending requests, max, idle.min, create / wait / use time", async () => {
    const fresh = new TypemoClient(MongoHarness.getUri(), { dbName: mongo.dbName, maxPoolSize: 7, minPoolSize: 0 });
    const own = TypemoOpenTelemetry.instrument(fresh, { tracerProvider, meterProvider, poolMetrics: true });
    try {
      await fresh.connect();
      const FreshUsers = fresh.connection.model(User);
      await Promise.all([FreshUsers.countDocuments(), FreshUsers.countDocuments(), FreshUsers.countDocuments()]);
      await reader.forceFlush();
      const metrics = metricExporter
        .getMetrics()
        .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
      const named = (name: string) => metrics.filter((one) => one.descriptor.name === name).at(-1);
      const points = (name: string) => named(name)?.dataPoints ?? [];
      const sum = (name: string, state?: string): number =>
        points(name)
          .filter((one) => state === undefined || one.attributes["db.client.connection.state"] === state)
          .reduce((total, one) => total + (one.value as number), 0);
      const histogramCount = (name: string): number =>
        points(name).reduce((total, one) => total + (one.value as { readonly count: number }).count, 0);

      expect(named("db.client.connection.count")?.descriptor.unit).toBe("{connection}");
      expect(sum("db.client.connection.count", "idle")).toBeGreaterThan(0);
      expect(sum("db.client.connection.count", "used")).toBe(0);
      expect(sum("db.client.connection.pending_requests")).toBe(0);
      expect(sum("db.client.connection.max")).toBeGreaterThanOrEqual(7);
      expect(points("db.client.connection.max").some((one) => one.value === 7)).toBe(true);
      for (const name of [
        "db.client.connection.create_time",
        "db.client.connection.wait_time",
        "db.client.connection.use_time",
      ]) {
        expect(named(name)?.descriptor.unit).toBe("s");
        expect(histogramCount(name)).toBeGreaterThan(0);
      }
      expect(typeof points("db.client.connection.wait_time")[0]?.attributes["db.client.connection.pool.name"]).toBe(
        "string",
      );
    } finally {
      own.unsubscribe();
      await fresh.close();
    }
  });
});
