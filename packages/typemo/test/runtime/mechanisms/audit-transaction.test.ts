/*
 * An audited write outside a transaction runs in its OWN transaction, so that the write and
 * its audit entry commit together. A replica set is required: on a standalone mongod it is a ConfigurationError
 * that says so, before anything is written. What is checked here: the commands really are transactional, an
 * explicit session is used for it, `session(null)` gets its own, the write's write concern / timeoutMS go to the
 * transaction, a transient error retries the write once (one entry), and models without audit stay untouched.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type FailPointHandle, FailPointHelpers, StandaloneMongo } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import { ConfigurationError, type Model, TypemoClient } from "../../../src/index.ts";
import { Label, Payment } from "../../fixtures/mechanisms/mechanism-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("m10_audit_txn");
let Payments: Model<Payment>;
let failpoint: FailPointHandle | undefined;
/**
 * The audit trail collection of `Payment`.
 * @returns The driver collection.
 */
const trail = () => t.mongo.db.collection("m9_payments_trail");

beforeEach(async () => {
  await trail()
    .drop()
    .catch(() => undefined);
  Payments = t.connection.model(Payment);
  t.commands.clear();
});

afterEach(async () => {
  await failpoint?.disable();
  failpoint = undefined;
});

/**
 * The `insert` commands recorded so far.
 * @returns The command documents.
 */
const inserts = () => t.commands.byName("insert").map((recorded) => recorded.command);

describe("the audited write and its entry are one transaction", () => {
  test("outside a transaction: both inserts carry the same lsid and txnNumber, autocommit false, then commitTransaction", async () => {
    await Payments.insertOne({ amount: 1 });
    const [write, audit] = inserts();
    expect(write?.insert).toBe("m9_payments");
    expect(audit?.insert).toBe("m9_payments_trail");
    expect(write?.txnNumber).toBeDefined();
    expect(write?.autocommit).toBe(false);
    expect(audit?.txnNumber).toEqual(write?.txnNumber);
    expect(audit?.lsid).toEqual(write?.lsid);
    expect(t.commands.byName("commitTransaction").length).toBe(1);
  });

  test("a model without audit is not wrapped (no transaction)", async () => {
    await t.connection.model(Label).insertOne({ name: "plain" });
    const [write] = inserts();
    expect(
      write?.autocommit,
    ).toBeUndefined(); /* a retryable write has a txnNumber too; autocommit marks a transaction */
    expect(write?.startTransaction).toBeUndefined();
    expect(t.commands.byName("commitTransaction").length).toBe(0);
  });

  test("an explicit session that is not in a transaction is the transaction's session", async () => {
    const session = await t.client.startSession();
    try {
      await Payments.insertOne({ amount: 2 }, { session });
      const [write, audit] = inserts();
      expect(write?.lsid).toEqual(session.id);
      expect(audit?.lsid).toEqual(session.id);
      expect(write?.txnNumber).toBeDefined();
      expect(session.inTransaction()).toBe(false);
    } finally {
      await session.endSession();
    }
  });

  test("inside a transaction the write joins it (no second transaction)", async () => {
    await t.connection.transaction(async () => {
      await Payments.insertOne({ amount: 3 });
      await Payments.insertOne({ amount: 4 });
    });
    const numbers = new Set(inserts().map((command) => JSON.stringify(command.txnNumber)));
    expect(numbers.size).toBe(1);
    expect(t.commands.byName("commitTransaction").length).toBe(1);
  });

  test("session(null) inside a transaction: its own transaction, committed even when the outer one aborts", async () => {
    await expect(
      t.connection.transaction(async () => {
        await Payments.insertOne({ amount: 5 }, { session: null });
        throw new Error("abort the outer");
      }),
    ).rejects.toThrow("abort the outer");
    expect(await t.mongo.db.collection("m9_payments").countDocuments({ amount: 5 })).toBe(1);
    expect(await trail().countDocuments()).toBe(1);
  });

  test("the write's write concern and timeoutMS become the transaction's (no 'inside a transaction' refusal)", async () => {
    await Payments.updateMany({ amount: { $gte: 0 } }, { $inc: { amount: 1 } })
      .writeConcern({ w: "majority" })
      .timeoutMS(5_000)
      .exec();
    const [commit] = t.commands.byName("commitTransaction");
    expect(commit?.command.writeConcern).toMatchObject({ w: "majority" });
    const [update] = t.commands.byName("update");
    expect(update?.command.writeConcern).toBeUndefined();
  });

  test("a TransientTransactionError retries the whole write: one document, one entry", async () => {
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["insert"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    await Payments.insertOne({ amount: 6 });
    expect(await t.mongo.db.collection("m9_payments").countDocuments({ amount: 6 })).toBe(1);
    expect(await trail().countDocuments()).toBe(1);
  });
});

describe("a server write error of a bulk inside a transaction", () => {
  test("the bulk error is the error — no audit write into the aborted transaction (it looped on 251 retries)", async () => {
    const id = new ObjectId();
    await Payments.insertOne({ _id: id, amount: 0 } as never);
    const started = performance.now();
    const error = await t.connection
      .transaction(async () => {
        await Payments.insertMany([{ amount: 1 }, { _id: id, amount: 2 } as never], { ordered: false });
      })
      .catch((caught: unknown) => caught);
    expect((error as Error).name).toBe("BulkWriteError");
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(await t.mongo.db.collection("m9_payments").countDocuments()).toBe(1);
  });
});

describe("a standalone mongod cannot run audited writes", () => {
  let standalone: StandaloneMongo;
  let client: TypemoClient;

  beforeAll(async () => {
    standalone = await StandaloneMongo.start();
    client = await TypemoClient.connect(standalone.uri, { dbName: "m10_standalone" });
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await standalone?.stop();
  });

  test("the topology is known to have no transactions", () => {
    expect(client.supportsTransactions).toBe(false);
  });

  test("ConfigurationError that names the replica set requirement; nothing is written", async () => {
    const error = await client.connection
      .model(Payment)
      .insertOne({ amount: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toContain("Payment.insertOne: the model is audited");
    expect((error as Error).message).toContain("needs a replica set or a sharded cluster");
    expect(await client.unsafeDriver().db("m10_standalone").collection("m9_payments").countDocuments()).toBe(0);
  });

  test("the error names the method the user called: create, not insertOne", async () => {
    const error = await client.connection
      .model(Payment)
      .create({ amount: 1 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toContain("Payment.create: the model is audited");
  });

  test("models without audit work on a standalone", async () => {
    await client.connection.model(Label).insertOne({ name: "ok" });
    expect(await client.connection.model(Label).countDocuments()).toBe(1);
  });

  test("client.transaction() is a ConfigurationError before anything is written", async () => {
    const Labels = client.connection.model(Label);
    const before = await Labels.countDocuments();
    let ran = false;
    const error = await client
      .transaction(async () => {
        ran = true;
        await Labels.insertOne({ name: "in-transaction" });
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toContain("transactions need a replica set or a sharded cluster");
    expect((error as Error).message).toContain("standalone mongod");
    expect(ran).toBe(false);
    expect(await Labels.countDocuments()).toBe(before);
  });
});
