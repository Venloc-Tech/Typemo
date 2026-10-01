import { afterAll, afterEach, beforeAll } from "bun:test";
import { randomBytes } from "node:crypto";
import { type Db, MongoClient, type MongoClientOptions } from "mongodb";
import { MongoHarness } from "./mongo-harness.ts";

/** Time allowed for the first `beforeAll`, which may download and start a mongod. */
const STARTUP_HOOK_TIMEOUT_MS = 180_000;

/**
 * The connection handles that `MongoLifecycle.useMongo` gives to a test file. The getters throw until the
 * `beforeAll` hook has run.
 *
 * @example
 * ```ts
 * const mongo: MongoTestContext = MongoLifecycle.useMongo();
 * test("ping", async () => {
 *   await mongo.db.command({ ping: 1 });
 * });
 * ```
 */
export interface MongoTestContext {
  /** Connected client for the shared mongod, unique per test file's database. */
  readonly client: MongoClient;
  /** The unique database created for this test file. */
  readonly db: Db;
  /** Name of that database. */
  readonly dbName: string;
}

/**
 * `bun:test` lifecycle wiring for `MongoHarness`.
 *
 * Call `MongoLifecycle.useMongo()` once at the top of a test file (outside
 * any `describe`, so hooks run at file scope). It:
 * - starts the shared mongod on first use (`beforeAll`),
 * - connects a fresh `MongoClient` (with `clientOptions`, e.g. Typemo's enforced BSON options
 *   `BsonOptions.apply({})`) to a database unique to this file,
 * - clears all collections in that database after every test (`afterEach`),
 * - drops the database and closes the client once the file is done (`afterAll`).
 *
 * The mongod itself is process-wide (one mongod per test process) and is stopped
 * separately with `MongoHarness.stop()`, not by this helper, since other test files
 * may still be using it.
 */
export class MongoLifecycle {
  /**
   * Registers the hooks and returns lazily resolved handles.
   *
   * @param namePrefix - Prefix of the unique database name.
   * @param clientOptions - Extra `MongoClient` options (for example Typemo's enforced BSON options).
   * @returns The context whose `client` and `db` are usable inside tests and hooks.
   * @throws Error - From the `client` / `db` getters when read before the `beforeAll` hook has run.
   */
  static useMongo(namePrefix = "typemo_test", clientOptions: MongoClientOptions = {}): MongoTestContext {
    const dbName = `${namePrefix}_${randomBytes(6).toString("hex")}`;
    let client: MongoClient | undefined;
    let db: Db | undefined;

    beforeAll(async () => {
      await MongoHarness.ensureStarted();
      client = new MongoClient(MongoHarness.getUri(), { monitorCommands: true, ...clientOptions });
      await client.connect();
      db = client.db(dbName);
    }, STARTUP_HOOK_TIMEOUT_MS);

    afterEach(async () => {
      if (!db) {
        return;
      }
      /* Views and `system.*` collections cannot be written to (`deleteMany` fails on them): only
         regular collections are cleared; a view reads them, so it is empty afterwards too. */
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      const writable = collections.filter((c) => c.type !== "view" && !c.name.startsWith("system."));
      await Promise.all(writable.map((collection) => db?.collection(collection.name).deleteMany({})));
    });

    afterAll(async () => {
      if (db) {
        await db.dropDatabase();
      }
      await client?.close();
    });

    return {
      get client(): MongoClient {
        if (!client) {
          throw new Error("MongoClient is not ready yet — access client/db only from inside a test or a hook");
        }
        return client;
      },
      get db(): Db {
        if (!db) {
          throw new Error("Db is not ready yet — access client/db only from inside a test or a hook");
        }
        return db;
      },
      dbName,
    };
  }
}
