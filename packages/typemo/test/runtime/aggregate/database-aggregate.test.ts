/*
 * Database-level aggregations on the real server: the plans of `Pipeline.database()`, `Pipeline.admin()` and
 * `Pipeline.sessions()` run with `connection.aggregate(plan)` / `client.aggregate(plan)` through the operation
 * pipeline — the right database (the connection's, `admin`, `config.system.sessions`), instrumentation events
 * without a model, Typemo errors, cursors, and the policies of a joined model.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { AggregatePlan } from "../../../src/index.ts";
import {
  ConfigurationError,
  type InstrumentationEvent,
  type Model,
  type OperationEndEvent,
  type OperationErrorEvent,
  type OperationStartEvent,
  Pipeline,
  QueryError,
  ServerError,
  type SessionRow,
  type Subscription,
  TypemoError,
} from "../../../src/index.ts";
import { Order } from "../../fixtures/aggregate-entities.ts";
import { Account9 } from "../../fixtures/mechanisms/mechanism-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("agg_database_level");
let Accounts: Model<Account9>;
let subscriptions: Subscription[] = [];

/**
 * Subscribes and collects every operation event.
 * @returns The array that receives the events.
 */
const collect = (): InstrumentationEvent[] => {
  const events: InstrumentationEvent[] = [];
  subscriptions.push(t.client.instrument({ handle: (event) => events.push(event) }));
  return events;
};

/**
 * The operation events of the collected list.
 * @param events The collected events.
 * @returns start, end and error events only.
 */
const operations = (events: readonly InstrumentationEvent[]) =>
  events.filter(
    (event): event is OperationStartEvent | OperationEndEvent | OperationErrorEvent =>
      event.type === "operation.start" || event.type === "operation.end" || event.type === "operation.error",
  );

beforeEach(async () => {
  Accounts = t.connection.model(Account9);
  await t.mongo.db.collection("m9_accounts").deleteMany({});
  t.commands.clear();
});

afterEach(() => {
  for (const subscription of subscriptions) subscription.unsubscribe();
  subscriptions = [];
});

describe("where the plan runs", () => {
  test("Pipeline.database() on the connection's database: $documents rows, typed by the plan", async () => {
    const rows = await t.connection.aggregate(
      Pipeline.database()
        .documents([
          { n: 1, s: "a" },
          { n: 2, s: "b" },
        ])
        .match({ n: { $gt: 1 } })
        .plan(),
    );
    expect(rows).toEqual([{ n: 2, s: "b" }]);
    const [command] = t.commands.byName("aggregate");
    expect(command?.databaseName).toBe(t.connection.name);
  });

  test("Pipeline.database() with client.aggregate: the client's default database", async () => {
    const rows = await t.client.aggregate(
      Pipeline.database()
        .documents([{ n: 1 }])
        .plan(),
    );
    expect(rows).toEqual([{ n: 1 }]);
    expect(t.commands.byName("aggregate")[0]?.databaseName).toBe(t.client.connection.name);
  });

  test("Pipeline.admin(): $currentOp on admin, from a connection of any database", async () => {
    const other = t.client.db(`${t.connection.name}_other`);
    const ops = await other.aggregate(Pipeline.admin().currentOp({ idleConnections: false }).plan());
    expect(ops.every((row) => typeof row.type === "string")).toBe(true);
    expect(t.commands.byName("aggregate")[0]?.databaseName).toBe("admin");
  });

  test("$listLocalSessions of a database aggregation", async () => {
    await t.connection.ready();
    const rows = await t.connection.aggregate(Pipeline.database().listLocalSessions().plan());
    expect(Array.isArray(rows)).toBe(true);
  });

  test("Pipeline.sessions(): $listSessions on config.system.sessions", async () => {
    const rows = await t.client.aggregate(Pipeline.sessions().listSessions({ allUsers: true }).plan());
    expect(Array.isArray(rows)).toBe(true);
    const [command] = t.commands.byName("aggregate");
    expect(command?.databaseName).toBe("config");
    expect(command?.command.aggregate).toBe("system.sessions");
  });

  test("the rows are typed by the plan", async () => {
    const rows = await t.client.aggregate(
      Pipeline.database()
        .documents([{ n: 1 }])
        .plan(),
    );
    expectTypeOf(rows).toEqualTypeOf<{ n: 1 }[]>();
    // @ts-expect-error — the rows have no field `m`
    rows[0]?.m;
    const sessions = await t.client.aggregate(Pipeline.sessions().listSessions().plan());
    expectTypeOf(sessions).toEqualTypeOf<SessionRow[]>();
  });

  test("cursor() and explain() work like a model's aggregation", async () => {
    const query = t.connection.aggregate(
      Pipeline.database()
        .documents([{ n: 1 }, { n: 2 }, { n: 3 }])
        .plan(),
    );
    const seen: number[] = [];
    for await (const row of query.cursor()) seen.push(row.n);
    expect(seen).toEqual([1, 2, 3]);
    const plan = await t.connection
      .aggregate(
        Pipeline.database()
          .documents([{ n: 1 }])
          .plan(),
      )
      .explain();
    expect(typeof plan).toBe("object");
  });
});

describe("refused plans", () => {
  test("a collection plan is refused by connection.aggregate; a database plan by Model.aggregate", () => {
    expect(() => t.connection.aggregate(Pipeline.from(Order).match({}).plan())).toThrow(ConfigurationError);
    expect(() =>
      t.connection.model(Order).aggregate(
        Pipeline.database()
          .documents([{ n: 1 }])
          .plan(),
      ),
    ).toThrow(/connection\.aggregate\(plan\)/);
    expect(() =>
      t.connection.model(Order).aggregate(Pipeline.sessions().listSessions({ allUsers: true }).plan()),
    ).toThrow(/config\.system\.sessions/);
  });

  test("something that is not a plan is a QueryError naming the method called", () => {
    /* cast: an untyped caller passes something that is not a plan */
    const notPlan = { op: "find" } as unknown as AggregatePlan<unknown>;
    expect(() => t.client.aggregate(notPlan)).toThrow(QueryError);
    expect(() => t.client.aggregate(notPlan)).toThrow(/client\.aggregate/);
  });
});

describe("the operation pipeline", () => {
  test("instrumentation: model null, collection null (or system.sessions), the database name", async () => {
    const events = collect();
    await t.connection.aggregate(
      Pipeline.database()
        .documents([{ n: 1 }])
        .plan(),
    );
    await t.client.aggregate(Pipeline.admin().currentOp().plan());
    await t.client.aggregate(Pipeline.sessions().listSessions({ allUsers: true }).plan());
    const seen = operations(events).map((event) => [
      event.type,
      event.operation,
      event.model,
      event.collection,
      event.database,
      event.schema,
    ]);
    expect(seen).toEqual([
      ["operation.start", "aggregate", null, null, t.connection.name, null],
      ["operation.end", "aggregate", null, null, t.connection.name, null],
      ["operation.start", "aggregate", null, null, "admin", null],
      ["operation.end", "aggregate", null, null, "admin", null],
      ["operation.start", "aggregate", null, "system.sessions", "config", null],
      ["operation.end", "aggregate", null, "system.sessions", "config", null],
    ]);
    const end = operations(events)[1] as OperationEndEvent;
    expect(end.documentCount).toBe(1);
  });

  test("a server error is a Typemo error with the driver error as cause; operation.error is emitted", async () => {
    const events = collect();
    const plan = Pipeline.database()
      .documents([{ n: 1 }])
      .plan();
    /* A stage the server refuses in a database of the user: `$currentOp` runs on admin only. */
    const wrong: AggregatePlan<unknown> = { ...plan, pipeline: [{ $currentOp: {} }] };
    let caught: unknown;
    try {
      await t.connection.aggregate(wrong);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypemoError);
    expect(caught).toBeInstanceOf(ServerError);
    expect((caught as Error).cause).toBeDefined();
    const error = operations(events).find((event) => event.type === "operation.error") as OperationErrorEvent;
    expect(error.model).toBeNull();
    expect(error.failedStep).toBe("execute");
  });

  test("a joined model keeps its policies: soft-deleted accounts are not joined", async () => {
    await Accounts.create([{ email: "ann@x" }, { email: "bob@x" }]);
    await Accounts.deleteOne({ email: "bob@x" });
    const rows = await t.connection.aggregate(
      Pipeline.database()
        .documents([{ email: "ann@x" }, { email: "bob@x" }])
        .lookup({ from: Account9, localField: "email", foreignField: "email", as: "found" })
        .plan(),
    );
    expect(rows.map((row) => [row.email, row.found.length])).toEqual([
      ["ann@x", 1],
      ["bob@x", 0],
    ]);
  });

  test("the ambient transaction is joined", async () => {
    await t.connection.transaction(async () => {
      await t.connection.aggregate(
        Pipeline.database()
          .documents([{ n: 1 }])
          .plan(),
      );
    });
    const [command] = t.commands.byName("aggregate");
    expect(command?.command.txnNumber).toBeDefined();
  });
});
