/*
 * Regressions of research/mongoose/M11-history/history.yaml (areas transaction, connection, query
 * execution): each test names its entry and follows its `how_to_test`.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import {
  ConnectionError,
  type StrictModeError,
  TimeoutError,
  type TransactionScope,
  TypemoClient,
} from "../../../src/index.ts";
import { Counter, Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("reg_conn");
const person = (name: string) => ({ name, email: `${name}@x.test`, tags: [], pets: [], lastSeen: null });

describe("history: connection", () => {
  test("H080/H137: the readiness wait leaves no timer behind (cleared when connect() wins, and on timeout)", async () => {
    const set = spyOn(globalThis, "setTimeout");
    const clear = spyOn(globalThis, "clearTimeout");
    try {
      const c = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName, readyTimeoutMS: 5_000 });
      const pending = c.connection.model(Counter).countDocuments();
      await c.connect();
      await pending;
      const late = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName, readyTimeoutMS: 20 });
      await late.connection
        .model(Counter)
        .countDocuments()
        .exec()
        .catch(() => undefined);
      const timers = set.mock.results.filter((result) => result.type === "return").map((result) => result.value);
      const cleared = new Set(clear.mock.calls.map((call) => call[0]));
      const ours = timers.filter((timer) => cleared.has(timer));
      expect(ours.length).toBeGreaterThanOrEqual(2);
      await c.close();
      await late.close();
    } finally {
      set.mockRestore();
      clear.mockRestore();
    }
  });

  test("H414: after close() operations do not wait (no buffering after disconnect) — they fail at once", async () => {
    const c = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName, readyTimeoutMS: 10_000 });
    await c.connect();
    await c.close();
    const started = performance.now();
    const error = await c.connection
      .model(Counter)
      .find()
      .exec()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConnectionError);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("H108: a useDb connection reflects the client's state (one state per client)", async () => {
    const c = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName });
    const child = c.connection.useDb("other");
    expect(child.client.state).toBe("idle");
    await c.connect();
    expect(child.client.state).toBe("connected");
    await c.close();
    expect(child.client.state).toBe("closed");
  });

  test("H203: a failing connect() handled by the caller gives no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const c = new TypemoClient("mongodb://127.0.0.1:1/", { serverSelectionTimeoutMS: 100 });
      await c.connect().catch(() => undefined);
      await Bun.sleep(20);
      await c.close();
    } finally {
      process.off("unhandledRejection", listener);
    }
    expect(unhandled).toEqual([]);
  });

  test("H053: watch() before connect() waits for the connection instead of failing", async () => {
    const c = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName });
    const Counters = c.connection.model(Counter);
    const opening = Counters.watch();
    await c.connect();
    const stream = await opening;
    expect(stream.closed).toBe(false);
    await stream.close();
    await c.close();
  });
});

describe("history: transactions", () => {
  test("H349: every operation inside transaction() uses the ambient session", async () => {
    const People = t.connection.model(Person);
    await People.createCollection();
    t.commands.clear();
    await t.connection.transaction(async () => {
      await People.insertMany([person("a")]);
      await People.aggregate((p) => p.match({ name: "a" }));
      await People.bulkWrite([{ deleteMany: { filter: { name: "zzz" } } }]);
      await People.find().cursor().toArray();
    });
    const withoutTxn = t.commands
      .all()
      .filter(
        (c) => ["insert", "aggregate", "delete", "find"].includes(c.commandName) && c.command.txnNumber === undefined,
      );
    expect(withoutTxn).toEqual([]);
  });

  test("H182: { session: null } leaves the ambient transaction", async () => {
    const People = t.connection.model(Person);
    await t.connection
      .transaction(async () => {
        await People.create(person("outside"), { session: null });
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(await People.exists({ name: "outside" })).not.toBeNull();
  });

  test("H427: session(null) sends no explicit session to the driver (an implicit one is used)", async () => {
    t.commands.clear();
    await t.connection.model(Person).find().session(null);
    const [find] = t.commands.byName("find");
    expect(find?.command.txnNumber).toBeUndefined();
    expect(find?.command.lsid).toBeDefined();
  });

  test("H201: a write concern on an operation inside a transaction is an explicit error (not a server failure)", async () => {
    const error = await t.connection
      .transaction(async () =>
        t.connection
          .model(Person)
          .updateOne({ name: "x" }, { $set: { age: 1 } })
          .writeConcern({ w: "majority" }),
      )
      .catch((caught: unknown) => caught);
    expect((error as StrictModeError).reason).toBe("transaction-option");
  });

  test("H140/H321/H134: parallel operations in a transaction are refused; create([...]) is one ordered insert", async () => {
    const People = t.connection.model(Person);
    await t.connection.transaction(async () => {
      expect((await People.create([person("o1"), person("o2")])).length).toBe(2);
    });
    const error = await t.connection
      .transaction(async () => {
        await Promise.all([People.findOne({ name: "o1" }), People.findOne({ name: "o2" })]);
      })
      .catch((caught: unknown) => caught);
    expect((error as StrictModeError).reason).toBe("concurrent-session");
  });

  test("H471: transaction() does not leak sessions", async () => {
    const scopes: TransactionScope[] = [];
    for (let n = 0; n < 30; n++) {
      await t.connection.transaction(async (scope) => {
        scopes.push(scope);
        await t.connection.model(Counter).countDocuments();
      });
    }
    expect(scopes.every((scope) => scope.session.hasEnded)).toBe(true);
  });

  test("H307/H018: the participants of a failed attempt are rolled back before the retry (the mechanism; documents are covered by the document tests)", async () => {
    // Covered with a failpoint-forced TransientTransactionError in test/runtime/connection/transactions.test.ts;
    // here: a participant enlisted during an attempt that ABORTS gets onAbort exactly once.
    const events: string[] = [];
    await t.connection
      .transaction(async (scope) => {
        scope.enlist({
          onAbort: () => {
            events.push("abort");
          },
          onCommit: () => {
            events.push("commit");
          },
        });
        throw new Error("x");
      })
      .catch(() => undefined);
    expect(events).toEqual(["abort"]);
  });

  test("readiness in a transaction: transaction() before connect() waits, bounded (TimeoutError)", async () => {
    const c = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName, readyTimeoutMS: 30 });
    const error = await c.transaction(async () => undefined).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
    await c.close();
  });
});
