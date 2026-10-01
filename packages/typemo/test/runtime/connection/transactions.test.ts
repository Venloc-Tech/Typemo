/*
 * `connection.transaction()` on the real server, over the driver's
 * `withTransaction` (its retries, not ours), the ambient session (ALS), the per-transaction participant
 * registry and its rollback between retries (failpoint-forced TransientTransactionError), and the
 * one-operation-per-session rule.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type FailPointHandle, FailPointHelpers, MongoHarness } from "@venloc/typemo-test-kit";
import { MongoClient } from "mongodb";
import {
  ConfigurationError,
  ServerError,
  StrictModeError,
  type TransactionParticipant,
  type TransactionScope,
  TypemoClient,
} from "../../../src/index.ts";
import { Counter, Order, Person } from "../../fixtures/model/model-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("txn");
let failpoint: FailPointHandle | undefined;

/**
 * A valid person document input.
 * @param name The person's name; also used for the email.
 * @returns The plain input for `create`.
 */
const person = (name: string) => ({ name, email: `${name}@x.test`, tags: [], pets: [], lastSeen: null });

beforeEach(async () => {
  /* Collections must exist before a transaction writes to them on older servers; create them up front. */
  await t.connection.model(Person).createCollection();
  await t.connection.model(Counter).createCollection();
  await t.connection.model(Order).createCollection();
  t.commands.clear();
});

afterEach(async () => {
  await failpoint?.disable();
  failpoint = undefined;
});

/** A fake participant: records the callbacks and holds "in-memory state" that must roll back. */
class FakeDocument implements TransactionParticipant {
  readonly events: string[] = [];
  isNew = true;
  #snapshot: boolean | undefined;

  /**
   * What a document's save() does: enlist, snapshot, then change its state.
   * @param scope The transaction scope of the current attempt.
   */
  saved(scope: TransactionScope): void {
    if (this.#snapshot === undefined) this.#snapshot = this.isNew;
    scope.enlist(this);
    this.isNew = false;
  }

  onRetry(): void {
    this.events.push("retry");
    this.isNew = this.#snapshot ?? this.isNew;
  }

  onAbort(): void {
    this.events.push("abort");
    this.isNew = this.#snapshot ?? this.isNew;
  }

  onCommit(): void {
    this.events.push("commit");
    this.#snapshot = undefined;
  }
}

describe("transaction(): commit, abort, ambient session", () => {
  test("operations inside join the transaction without a session argument; commit makes them visible", async () => {
    const People = t.connection.model(Person);
    const result = await t.connection.transaction(async () => {
      await People.create(person("Ann"));
      await People.updateOne({ name: "Ann" }, { $set: { age: 3 } });
      expect(await People.countDocuments({ name: "Ann" })).toBe(1);
      return "done";
    });
    expect(result).toBe("done");
    expect((await People.findOne({ name: "Ann" }).lean())?.age).toBe(3);
    const inTxn = t.commands.all().filter((command) => command.command.txnNumber !== undefined);
    expect(inTxn.map((command) => command.commandName)).toEqual(["insert", "update", "aggregate", "commitTransaction"]);
    expect(new Set(inTxn.map((command) => JSON.stringify(command.command.lsid))).size).toBe(1);
  });

  test("an error in the callback aborts: nothing is written, the error reaches the caller unchanged", async () => {
    const People = t.connection.model(Person);
    const failure = new Error("business rule");
    const error = await t.connection
      .transaction(async () => {
        await People.create(person("Bob"));
        throw failure;
      })
      .catch((caught: unknown) => caught);
    expect(error).toBe(failure);
    expect(await People.countDocuments()).toBe(0);
  });

  test("session(null) / { session: null } run OUTSIDE the ambient transaction", async () => {
    const People = t.connection.model(Person);
    await t.connection
      .transaction(async () => {
        await People.create(person("Out"), { session: null });
        await People.create(person("In"));
        throw new Error("abort");
      })
      .catch(() => undefined);
    expect((await People.find().lean()).map((doc) => doc.name)).toEqual(["Out"]);
  });

  test("every operation kind uses the ambient session: find, cursor, aggregate, bulkWrite, insertMany, distinct", async () => {
    const People = t.connection.model(Person);
    await t.connection.transaction(async () => {
      await People.insertMany([person("A"), person("B")]);
      await People.find();
      for await (const _ of People.find().cursor()) break;
      await People.aggregate((p) => p.match({ name: "A" }));
      await People.bulkWrite([{ updateOne: { filter: { name: "A" }, update: { $set: { age: 1 } } } }]);
      await People.distinct("name");
    });
    const outside = t.commands
      .all()
      .filter((command) => ["insert", "find", "aggregate", "update", "distinct"].includes(command.commandName))
      .filter((command) => command.command.txnNumber === undefined);
    expect(outside.map((command) => command.commandName)).toEqual([]);
  });

  test("the session is ended after the transaction (no session leak)", async () => {
    let scope: TransactionScope | undefined;
    for (let n = 0; n < 20; n++) {
      await t.connection.transaction(async (s) => {
        scope = s;
        await t.connection.model(Counter).countDocuments();
      });
      expect(scope?.session.hasEnded).toBe(true);
    }
  });

  test("transactions do not nest; a model of another client cannot join (explicit error, not a silent non-participation)", async () => {
    const People = t.connection.model(Person);
    await expect(
      t.connection.transaction(async () => {
        await t.connection.transaction(async () => {});
      }),
    ).rejects.toThrow(/transactions do not nest/);
    const other = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName });
    await other.connect();
    try {
      const error = await t.connection
        .transaction(async () => {
          await other.connection.model(Person).countDocuments();
        })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toMatch(/another client.*session\(null\)/);
      await t.connection.transaction(async () => {
        expect(await other.connection.model(Person).countDocuments().session(null)).toBe(0);
        await People.countDocuments();
      });
    } finally {
      await other.close();
    }
  });
});

describe("per-operation options that conflict with the transaction are errors", () => {
  test.each([
    ["readConcern", () => t.connection.model(Person).find().readConcern("majority")],
    ["readPreference secondary", () => t.connection.model(Person).find().readPreference("secondary")],
    [
      "writeConcern",
      () =>
        t.connection
          .model(Person)
          .updateOne({ name: "x" }, { $set: { age: 1 } })
          .writeConcern({ w: 1 }),
    ],
  ])("%s inside a transaction → StrictModeError(transaction-option)", async (_, query) => {
    const error = await t.connection.transaction(async () => query()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("transaction-option");
  });

  test("an operation timeoutMS inside a transaction with timeoutMS is refused (driver rule)", async () => {
    const error = await t.connection
      .transaction(async () => t.connection.model(Person).find().timeoutMS(500), { timeoutMS: 5_000 })
      .catch((caught: unknown) => caught);
    expect((error as StrictModeError).reason).toBe("transaction-option");
  });

  test("readPreference primary is allowed; outside a transaction every option is allowed", async () => {
    await t.connection.transaction(async () => t.connection.model(Person).find().readPreference("primary"));
    await t.connection.model(Person).find().readConcern("majority").readPreference("secondaryPreferred");
  });
});

describe("retries: the driver's withTransaction retries, Typemo rolls back the participants", () => {
  test("a TransientTransactionError on a write: the callback runs again, participants get onRetry, then onCommit", async () => {
    const Counters = t.connection.model(Counter);
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["insert"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    const doc = new FakeDocument();
    const attempts: number[] = [];
    const seenIsNew: boolean[] = [];
    await t.connection.transaction(async (scope) => {
      attempts.push(scope.attempt);
      seenIsNew.push(doc.isNew);
      await Counters.create({ key: "a", value: 1 }); /* attempt 1 fails here (WriteConflictError, wrapped) */
      doc.saved(scope);
    });
    expect(attempts).toEqual([1, 2]);
    /* The retried callback sees the document as it was BEFORE the transaction (not "already inserted"). */
    expect(seenIsNew).toEqual([true, true]);
    expect(doc.isNew).toBe(false);
    expect(await Counters.countDocuments()).toBe(1);
  });

  test("the rollback runs for participants that changed state before the failing operation", async () => {
    const Counters = t.connection.model(Counter);
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["update"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    const doc = new FakeDocument();
    const seen: boolean[] = [];
    await t.connection.transaction(async (scope) => {
      seen.push(doc.isNew);
      await Counters.create({ key: "b", value: 1 });
      doc.saved(scope); /* state changed in attempt 1… */
      await Counters.updateOne({ key: "b" }, { $inc: { value: 1 } }); /* …then attempt 1 fails */
    });
    expect(seen).toEqual([true, true]);
    expect(doc.events).toEqual(["retry", "commit"]);
    expect((await Counters.findOne({ key: "b" }).lean())?.value).toBe(2);
  });

  test("a transient commit error retries the whole callback too (driver spec 10.2)", async () => {
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["commitTransaction"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    const doc = new FakeDocument();
    let runs = 0;
    await t.connection.transaction(async (scope) => {
      runs++;
      await t.connection.model(Counter).create({ key: `c${runs}`, value: 1 });
      doc.saved(scope);
    });
    expect(runs).toBe(2);
    expect(doc.events).toEqual(["retry", "commit"]);
  });

  test("a document loaded OUTSIDE the callback has its arithmetic change applied again by a retry (documented trap)", async () => {
    const Counters = t.connection.model(Counter);
    await Counters.insertOne({ key: "out", value: 100 });
    await Counters.insertOne({ key: "in", value: 100 });
    const outside = await Counters.findOne({ key: "out" }).orFail();
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["commitTransaction"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    let runs = 0;
    await t.connection.transaction(async () => {
      runs++;
      outside.value -= 10; /* the same object on every attempt: 100 → 90, then 90 → 80 */
      await outside.$save();
    });
    expect(runs).toBe(2);
    expect((await Counters.findOne({ key: "out" }).lean().orFail()).value).toBe(80);
    /* the remedy: load inside the callback (each attempt reads the stored 100 afresh), or an atomic $inc */
    await failpoint.disable();
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["commitTransaction"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    runs = 0;
    await t.connection.transaction(async () => {
      runs++;
      const inside = await Counters.findOne({ key: "in" }).orFail();
      inside.value -= 10;
      await inside.$save();
    });
    expect(runs).toBe(2);
    expect((await Counters.findOne({ key: "in" }).lean().orFail()).value).toBe(90);
  });

  test("a non-transient failure aborts: participants get onAbort, the caller gets the Typemo error", async () => {
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["insert"],
      errorCode: 2 /* BadValue: not transient (the server labels a 112 in a transaction as transient by itself) */,
      times: 1,
    });
    const doc = new FakeDocument();
    const error = await t.connection
      .transaction(async (scope) => {
        doc.saved(scope);
        await t.connection.model(Counter).create({ key: "d", value: 1 });
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServerError);
    expect((error as ServerError).code).toBe(2);
    expect((error as ServerError).cause).toBeDefined();
    expect(doc.events).toEqual(["abort"]);
    expect(doc.isNew).toBe(true);
  });
});

describe("one operation in flight per session", () => {
  test("Promise.all inside a transaction is refused with a clear error; the transaction aborts", async () => {
    const People = t.connection.model(Person);
    const error = await t.connection
      .transaction(async () => {
        await Promise.all([People.create(person("P1")), People.create(person("P2"))]);
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StrictModeError);
    expect((error as StrictModeError).reason).toBe("concurrent-session");
    expect((error as Error).message).toMatch(/in use by Person\.create.*one after another/);
    expect(await People.countDocuments()).toBe(0);
  });

  test("populate-like fan-out (Promise.all of finds) in a transaction is refused too", async () => {
    const People = t.connection.model(Person);
    await People.insertMany([person("F1"), person("F2")]);
    const error = await t.connection
      .transaction(async () => {
        const all = await People.find().lean();
        await Promise.all(all.map((doc) => People.findById(doc._id)));
      })
      .catch((caught: unknown) => caught);
    expect((error as StrictModeError).reason).toBe("concurrent-session");
  });

  test("an explicit session without a transaction: concurrent writes are refused (the driver would lose them)", async () => {
    const People = t.connection.model(Person);
    const session = await t.client.startSession();
    try {
      const error = await Promise.all([
        People.create(person("S1"), { session }),
        People.create(person("S2"), { session }),
      ]).catch((caught: unknown) => caught);
      expect((error as StrictModeError).reason).toBe("concurrent-session");
    } finally {
      await session.endSession();
    }
  });

  test("an explicit session without a transaction — concurrent READS are allowed and correct", async () => {
    const People = t.connection.model(Person);
    await People.insertMany([person("R1"), person("R2"), person("R3")]);
    const session = await t.client.startSession();
    try {
      const [all, one, count, names, rows] = await Promise.all([
        People.find().session(session).lean(),
        People.findOne({ name: "R2" }).session(session).lean(),
        People.countDocuments().session(session),
        People.distinct("name").session(session),
        People.aggregate((p) => p.match({ name: "R3" })).session(session),
      ]);
      expect(all.length).toBe(3);
      expect(one?.name).toBe("R2");
      expect(count).toBe(3);
      expect(names).toEqual(["R1", "R2", "R3"]);
      expect(rows.length).toBe(1);
      /* cursors in the same session read concurrently too (each batch fetch is a read) */
      const cursors = await Promise.all([
        People.find().batchSize(1).session(session).cursor().toArray(),
        People.find().session(session).lean(),
      ]);
      expect(cursors.map((list) => list.length)).toEqual([3, 3]);
    } finally {
      await session.endSession();
    }
  });

  test("an explicit session without a transaction — a write next to reads is refused", async () => {
    const People = t.connection.model(Person);
    await People.insertMany([person("W1")]);
    const session = await t.client.startSession();
    try {
      const error = await Promise.all([
        People.find().session(session).lean(),
        People.updateOne({ name: "W1" }, { $set: { name: "W2" } }).session(session),
      ]).catch((caught: unknown) => caught);
      expect((error as StrictModeError).reason).toBe("concurrent-session");
      const outError = await Promise.all([
        People.countDocuments().session(session),
        People.aggregate((p) => p.match({}).out("m_people_copy")).session(session),
      ]).catch((caught: unknown) => caught);
      expect((outError as StrictModeError).reason).toBe("concurrent-session");
      /* afterwards the session is free: the refused operations were never sent */
      expect(await People.countDocuments({ name: "W1" }).session(session)).toBe(1);
    } finally {
      await session.endSession();
    }
  });

  test("in a transaction concurrent reads stay refused (server code 117 otherwise)", async () => {
    const People = t.connection.model(Person);
    await People.insertMany([person("T1")]);
    const error = await t.connection
      .transaction(async () => {
        await Promise.all([People.countDocuments(), People.find().lean()]);
      })
      .catch((caught: unknown) => caught);
    expect((error as StrictModeError).reason).toBe("concurrent-session");
  });

  test("sequential operations, and a cursor with writes between its batches, are fine", async () => {
    const People = t.connection.model(Person);
    const Counters = t.connection.model(Counter);
    await People.insertMany([person("C1"), person("C2"), person("C3")]);
    await t.connection.transaction(async () => {
      for await (const doc of People.find().batchSize(1).cursor()) {
        await Counters.create({ key: doc.name, value: 1 });
      }
    });
    expect(await Counters.countDocuments()).toBe(3);
  });

  test("operations WITHOUT a session (implicit sessions) may run concurrently", async () => {
    const People = t.connection.model(Person);
    await Promise.all([People.create(person("I1")), People.create(person("I2")), People.find()]);
    expect(await People.countDocuments()).toBe(2);
  });

  test("evidence (driver 7.6, why the rule exists): concurrent writes in ONE plain session are acknowledged but not stored", async () => {
    const raw = new MongoClient(MongoHarness.getUri());
    await raw.connect();
    try {
      const collection = raw.db(t.mongo.dbName).collection("i3_evidence");
      const session = raw.startSession();
      const results = await Promise.all(Array.from({ length: 8 }, (_, n) => collection.insertOne({ n }, { session })));
      await session.endSession();
      expect(results.every((result) => result.acknowledged)).toBe(true);
      /* All 8 go out with the same txnNumber; the server treats 7 as retries of the first. */
      expect(await collection.countDocuments()).toBeLessThan(8);
    } finally {
      await raw.close();
    }
  });
});
