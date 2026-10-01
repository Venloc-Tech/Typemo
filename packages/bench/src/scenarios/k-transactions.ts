/*
 * Group K — transactions (replica set). Driver: `session.withTransaction`; Mongoose: `connection.transaction`
 * (it tracks document state between retries); Typemo: `client.transaction` (ALS, no session passing).
 *  - K.tx.short: insert + $inc + read back, 3 operations.
 *  - K.tx.ops1000: 1 000 sequential `$inc` updates in one transaction (operations in a transaction are
 *    sequential for everyone: the server allows one in flight per session).
 *  - K.tx.retry: a failpoint makes the FIRST `update` of the run fail with TransientTransactionError; the
 *    driver retries the whole callback. A document created BEFORE the transaction is saved inside it, so the
 *    retry must insert it again (Mongoose/Typemo roll the in-memory document back). Verified: the callback
 *    ran twice, the document exists exactly once, the counter was incremented exactly once.
 * Typemo has no automatic transaction for audit writes: they join the operation's session/transaction, so
 * that case is not benchmarked.
 */
import "reflect-metadata";
import { Entity, Prop, Schema } from "@venloc/typemo";
import { FailPointHelpers } from "@venloc/typemo-test-kit";
import type { Db, MongoClient, ObjectId } from "mongodb";
import type { Model as MModel } from "mongoose";
import type { MongooseHandle } from "../adapters/bench-context.ts";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { BbChecksum } from "./support-bb/bb-checksum.ts";
import { ISeed } from "./support-bb/populate-models.ts";

/** The accounts collection. */
const K_ACCOUNTS = "bb_k_accounts";
/** The items collection. */
const K_ITEMS = "bb_k_items";

/** An account with a key and a counter. */
@Schema({ collection: K_ACCOUNTS })
class KAccount extends Entity {
  @Prop(() => String, { required: true })
  key!: string;

  @Prop(() => Number, { required: true })
  n!: number;
}

/** An item with a value. */
@Schema({ collection: K_ITEMS })
class KItem extends Entity {
  @Prop(() => Number, { required: true })
  v!: number;
}

/**
 * A loosely typed Mongoose document.
 *
 * @example
 * ```ts
 * const doc: MDoc = { key: "k1", n: 0 };
 * ```
 */
type MDoc = Record<string, unknown>;

/** The Mongoose models of group K. */
class KMongoose {
  /**
   * The accounts model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static accounts(handle: MongooseHandle): MModel<MDoc> {
    return handle.model(
      "BbKAccount",
      K_ACCOUNTS,
      (m) => new m.Schema({ key: { type: String, required: true }, n: { type: Number, required: true } }),
    );
  }

  /**
   * The items model.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static items(handle: MongooseHandle): MModel<MDoc> {
    return handle.model("BbKItem", K_ITEMS, (m) => new m.Schema({ v: { type: Number, required: true } }));
  }
}

/** The contestants of group K. */
const CONTESTANTS_K: readonly ContestantId[] = ["driver", "mongoose", "mongoose-safe", "typemo"];

/**
 * Clears the accounts of a contestant (untimed, once per repeat).
 *
 * @param db - The contestant's database.
 * @returns A function that clears the accounts.
 */
const clearAccounts = (db: Db) => async (): Promise<void> => {
  await db.collection(K_ACCOUNTS).deleteMany({});
};

/** K.tx.short: insert, `$inc` and read back in one transaction. */
class ShortTx extends Scenario {
  readonly id = "K.tx.short";
  readonly group = "K" as const;
  readonly title = "transaction: insert + $inc + findOne (3 ops)";
  readonly profiles: readonly ProfileName[] = ["quick", "standard", "full"];
  override readonly contestants = CONTESTANTS_K;
  override readonly notes = "One new account per run (key = iteration), read back inside the transaction: n = 5.";

  /**
   * Builds a contestant that runs the short transaction.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const verify = async (read: unknown, i: number, db: Db): Promise<Outcome> => {
      const n = (read as { n?: unknown } | null)?.n;
      const stored = await db.collection(K_ACCOUNTS).countDocuments({ key: `k${i}`, n: 5 });
      if (n !== 5 || stored !== 1) throw new Error(`${contestant}: read n=${String(n)}, committed ${stored}`);
      return { count: 1, checksum: "n=5" };
    };
    const mongoose = (handle: MongooseHandle) => () => {
      const Accounts = KMongoose.accounts(handle);
      return ScenarioKit.impl<unknown>({
        setup: clearAccounts(handle.db),
        run: (i) =>
          handle.connection.transaction(async (session) => {
            await Accounts.create([{ key: `k${i}`, n: 0 }], { session });
            await Accounts.updateOne({ key: `k${i}` }, { $inc: { n: 5 } }, { session });
            return Accounts.findOne({ key: `k${i}` })
              .session(session)
              .lean();
          }),
        verify: (read, i) => verify(read, i, handle.db),
      });
    };
    return ScenarioKit.pick(
      {
        driver: () => {
          const { client, db } = env.ctx.driver;
          const accounts = db.collection(K_ACCOUNTS);
          return ScenarioKit.impl<unknown>({
            setup: clearAccounts(db),
            run: async (i) => {
              const session = client.startSession();
              try {
                return await session.withTransaction(async () => {
                  await accounts.insertOne({ key: `k${i}`, n: 0 }, { session });
                  await accounts.updateOne({ key: `k${i}` }, { $inc: { n: 5 } }, { session });
                  return accounts.findOne({ key: `k${i}` }, { session });
                });
              } finally {
                await session.endSession();
              }
            },
            verify: (read, i) => verify(read, i, db),
          });
        },
        mongoose: mongoose(env.ctx.mongoose),
        "mongoose-safe": mongoose(env.ctx.mongooseSafe),
        typemo: () => {
          const handle = env.ctx.typemo;
          const Accounts = handle.model(KAccount);
          return ScenarioKit.impl<unknown>({
            setup: clearAccounts(handle.db),
            run: (i) =>
              handle.client.transaction(async () => {
                await Accounts.insertOne({ key: `k${i}`, n: 0 });
                await Accounts.updateOne({ key: `k${i}` }, { $inc: { n: 5 } });
                return Accounts.findOne({ key: `k${i}` }).lean();
              }),
            verify: (read, i) => verify(read, i, handle.db),
          });
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** Operations per transaction for each dataset size. */
const OPS_OF: Readonly<Record<SizeName, number>> = { T: 50, S: 1_000, M: 1_000, L: 1_000, XL: 1_000 };

/** K.tx.ops1000: a thousand sequential updates in one transaction. */
class ManyOpsTx extends Scenario {
  readonly id = "K.tx.ops1000";
  readonly group = "K" as const;
  readonly title = "transaction: 1 000 sequential $inc updates";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly contestants = CONTESTANTS_K;
  override readonly iterations = { warmup: 1, minSamples: 3, maxSamples: 8, maxTimeMs: 2500 };
  override readonly notes = "1 000 items, each +1 once per run; `before` resets v = 0 (untimed). State: Σv = 1 000.";

  /**
   * Operations per transaction.
   *
   * @param size - The dataset size.
   * @returns The number of updates.
   */
  override unitsPerOp(size: SizeName): number {
    return OPS_OF[size];
  }

  /**
   * The ids of the items that are updated.
   *
   * @param size - The dataset size.
   * @returns The ids.
   */
  private ids(size: SizeName): ObjectId[] {
    return Array.from({ length: OPS_OF[size] }, (_, i) => ISeed.oid(0x20, i));
  }

  /**
   * Seeds the items of every contestant.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    const ids = this.ids(env.size);
    for (const contestant of this.contestants) {
      const items = env.ctx.dbOf(contestant).collection(K_ITEMS);
      await items.deleteMany({});
      await items.insertMany(ids.map((_id) => ({ _id, v: 0 })));
    }
  }

  /**
   * Builds a contestant that runs the many-operations transaction.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const ids = this.ids(env.size);
    const reset = (db: Db) => async (): Promise<void> => {
      await db.collection(K_ITEMS).updateMany({}, { $set: { v: 0 } });
    };
    const verify = async (db: Db): Promise<Outcome> => {
      const [row] = await db
        .collection(K_ITEMS)
        .aggregate<{ sum: number; n: number }>([{ $group: { _id: null, sum: { $sum: "$v" }, n: { $sum: 1 } } }])
        .toArray();
      if (row?.sum !== ids.length) throw new Error(`${contestant}: Σv = ${row?.sum}, expected ${ids.length}`);
      return { count: row.n, checksum: `sum=${row.sum}`, state: BbChecksum.of([`${row.n}:${row.sum}`]) };
    };
    const mongoose = (handle: MongooseHandle) => () => {
      const Items = KMongoose.items(handle);
      return ScenarioKit.impl<unknown>({
        before: reset(handle.db),
        run: () =>
          handle.connection.transaction(async (session) => {
            for (const _id of ids) await Items.updateOne({ _id }, { $inc: { v: 1 } }, { session });
          }),
        verify: () => verify(handle.db),
      });
    };
    return ScenarioKit.pick(
      {
        driver: () => {
          const { client, db } = env.ctx.driver;
          const items = db.collection(K_ITEMS);
          return ScenarioKit.impl<unknown>({
            before: reset(db),
            run: async () => {
              const session = client.startSession();
              try {
                await session.withTransaction(async () => {
                  for (const _id of ids) await items.updateOne({ _id }, { $inc: { v: 1 } }, { session });
                });
              } finally {
                await session.endSession();
              }
            },
            verify: () => verify(db),
          });
        },
        mongoose: mongoose(env.ctx.mongoose),
        "mongoose-safe": mongoose(env.ctx.mongooseSafe),
        typemo: () => {
          const handle = env.ctx.typemo;
          const Items = handle.model(KItem);
          return ScenarioKit.impl<unknown>({
            before: reset(handle.db),
            run: () =>
              handle.client.transaction(async () => {
                for (const _id of ids) await Items.updateOne({ _id }, { $inc: { v: 1 } });
              }),
            verify: () => verify(handle.db),
          });
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/**
 * What one run of the retry scenario reports.
 *
 * @example
 * ```ts
 * const result: RetryResult = { attempts: 2, key: "r1", isNew: false };
 * ```
 */
interface RetryResult {
  /** How many times the callback ran. */
  readonly attempts: number;
  /** The key of the document that was saved. */
  readonly key: string;
  /** In-memory state of the saved document after the transaction (`isNew` must be false). */
  readonly isNew: boolean;
}

/** The id of the counter document. */
const RETRY_COUNTER = ISeed.oid(0x21, 0);

/** K.tx.retry: a transaction retried once after a transient error. */
class RetryTx extends Scenario {
  readonly id = "K.tx.retry";
  readonly group = "K" as const;
  readonly title = "transaction retried once (failpoint: TransientTransactionError on update) + document rollback";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly contestants = CONTESTANTS_K;
  override readonly iterations = { warmup: 1, minSamples: 5, maxSamples: 20, maxTimeMs: 1500 };
  override readonly notes =
    "Server failpoint failCommand(update, code 112, TransientTransactionError, times 1) set before every run " +
    "(untimed). Callback: save a document created OUTSIDE the transaction, then $inc a counter. Verified: 2 " +
    "attempts, the document stored once, counter = 1, the in-memory document is not new.";

  /**
   * Fails early and clearly when the server has no test commands (`enableTestCommands=1`).
   *
   * @param env - The scenario environment.
   * @throws Error - When the server rejects the fail point command.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    try {
      await env.ctx.driver.client.db("admin").command({ configureFailPoint: "failCommand", mode: "off" });
    } catch (error) {
      throw new Error("K.tx.retry needs failpoints: start mongod with --setParameter enableTestCommands=1", {
        cause: error,
      });
    }
  }

  /**
   * Builds a contestant that runs the retried transaction.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const admin: MongoClient = env.ctx.driver.client;
    const before = (db: Db) => async (): Promise<void> => {
      await db.collection(K_ACCOUNTS).deleteMany({});
      await db.collection(K_ACCOUNTS).insertOne({ _id: RETRY_COUNTER, key: "counter", n: 0 });
      await FailPointHelpers.configureFailCommand(admin, {
        failCommands: ["update"],
        errorCode: 112,
        errorLabels: ["TransientTransactionError"],
        times: 1,
      });
    };
    const verify = async (result: RetryResult, db: Db): Promise<Outcome> => {
      const accounts = db.collection(K_ACCOUNTS);
      const saved = await accounts.countDocuments({ key: result.key });
      const counter = await accounts.findOne({ _id: RETRY_COUNTER });
      const line = `attempts=${result.attempts} saved=${saved} counter=${String(counter?.n)} isNew=${result.isNew}`;
      if (result.attempts !== 2 || saved !== 1 || counter?.n !== 1 || result.isNew)
        throw new Error(`${contestant}: ${line}`);
      return { count: 1, checksum: line };
    };
    const mongoose = (handle: MongooseHandle) => () => {
      const Accounts = KMongoose.accounts(handle);
      return ScenarioKit.impl<RetryResult>({
        before: before(handle.db),
        run: async (i) => {
          const doc = new Accounts({ key: `r${i}`, n: 1 });
          let attempts = 0;
          await handle.connection.transaction(async (session) => {
            attempts++;
            await doc.save({ session });
            await Accounts.updateOne({ _id: RETRY_COUNTER }, { $inc: { n: 1 } }, { session });
          });
          return { attempts, key: `r${i}`, isNew: doc.isNew };
        },
        verify: (result) => verify(result, handle.db),
      });
    };
    return ScenarioKit.pick(
      {
        driver: () => {
          const { client, db } = env.ctx.driver;
          const accounts = db.collection(K_ACCOUNTS);
          return ScenarioKit.impl<RetryResult>({
            before: before(db),
            run: async (i) => {
              const doc = { key: `r${i}`, n: 1 };
              let attempts = 0;
              const session = client.startSession();
              try {
                await session.withTransaction(async () => {
                  attempts++;
                  /* A copy: the driver writes `_id` into its argument (the retry must insert the same doc). */
                  await accounts.insertOne({ ...doc }, { session });
                  await accounts.updateOne({ _id: RETRY_COUNTER }, { $inc: { n: 1 } }, { session });
                });
              } finally {
                await session.endSession();
              }
              return { attempts, key: doc.key, isNew: false };
            },
            verify: (result) => verify(result, db),
          });
        },
        mongoose: mongoose(env.ctx.mongoose),
        "mongoose-safe": mongoose(env.ctx.mongooseSafe),
        typemo: () => {
          const handle = env.ctx.typemo;
          const Accounts = handle.model(KAccount);
          return ScenarioKit.impl<RetryResult>({
            before: before(handle.db),
            run: async (i) => {
              const doc = Accounts.new({ key: `r${i}`, n: 1 });
              const attempts = await handle.client.transaction(async (scope) => {
                await doc.$save();
                await Accounts.updateOne({ _id: RETRY_COUNTER }, { $inc: { n: 1 } });
                return scope.attempt;
              });
              return { attempts, key: `r${i}`, isNew: doc.$isNew() };
            },
            verify: (result) => verify(result, handle.db),
          });
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }

  /**
   * Turns the fail point off.
   *
   * @param env - The scenario environment.
   */
  override async cleanup(env: ScenarioEnv): Promise<void> {
    await env.ctx.driver.client.db("admin").command({ configureFailPoint: "failCommand", mode: "off" });
  }
}

/** The scenarios of group K. */
export const SCENARIOS: readonly Scenario[] = [new ShortTx(), new ManyOpsTx(), new RetryTx()];
