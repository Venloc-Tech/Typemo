/*
 * Ported from mongoose test/connection.test.js onto Typemo. The connection is
 * `TypemoClient` (lifecycle) + `Connection` (a database and its models). Events of the Mongoose connection
 * (`connected`, `disconnecting`, …) are `onStateChange` states; buffering tests are replaced by the
 * readiness rule (an operation waits for the connection) — see test/ported/INDEX.md.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import {
  ConfigurationError,
  ConnectionError,
  Entity,
  Prop,
  Schema,
  type SchemaPlugin,
  TypemoClient,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("ported_conn");
const clients: TypemoClient[] = [];
const client = (uri = MongoHarness.getUri(), options: ConstructorParameters<typeof TypemoClient>[1] = {}) => {
  const created = new TypemoClient(uri, options);
  clients.push(created);
  return created;
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

@Schema({ collection: "p_things" })
class Thing extends Entity {
  @Prop(() => String)
  body?: string;

  @Prop(() => Number)
  thing?: number;
}

@Schema({ collection: "p_plugged" })
class Plugged extends Entity {}

@Schema({ collection: "p_unplugged" })
class Unplugged extends Entity {}

describe("connection (ported)", () => {
  // ported from mongoose test/connection.test.js:128 "connection plugins (gh-7378)"
  test("connection plugins (gh-7378)", async () => {
    const conn1 = client(MongoHarness.getUri(), { dbName: t.mongo.dbName }).db(`${t.mongo.dbName}_c1`);
    const conn2 = client(MongoHarness.getUri(), { dbName: t.mongo.dbName }).db(`${t.mongo.dbName}_c2`);
    const called: string[] = [];
    const plugin: SchemaPlugin<undefined> = { name: "record", apply: (builder) => called.push(builder.target.name) };
    conn1.plugins.use(plugin);
    conn2.model(Unplugged);
    expect(called.length).toBe(0);
    conn1.model(Plugged);
    expect(called).toEqual(["Plugged"]);
  });

  // ported from mongoose test/connection.test.js:273 "should allow closing a closed connection"
  test("should allow closing a closed connection", async () => {
    const db = client();
    expect(db.state).toBe("idle");
    await db.close();
    await db.close();
  });

  // ported from mongoose test/connection.test.js:305 "readyState is disconnected if initial connection fails (gh-6244)"
  test("readyState is disconnected if initial connection fails (gh-6244)", async () => {
    const db = client("mongodb://127.0.0.1:1/", { serverSelectionTimeoutMS: 100 });
    const error = await db.connect().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConnectionError);
    expect(db.state).toBe("idle");
  });

  // ported from mongoose test/connection.test.js:322 "should return an error if malformed uri passed"
  test("should return an error if malformed uri passed", () => {
    expect(() => client("mongodb:///fake")).toThrow();
    expect(() => client("fail connection")).toThrow(ConfigurationError);
  });

  // ported from mongoose test/connection.test.js:536 "dbName option (gh-6106)"
  test("dbName option (gh-6106)", async () => {
    const db = await TypemoClient.connect(MongoHarness.getUri(), { dbName: "bacon" });
    clients.push(db);
    expect(db.connection.name).toBe("bacon");
  });

  // ported from mongoose test/connection.test.js:547 "uses default database in uri if options.dbName is not provided"
  test("uses default database in uri if options.dbName is not provided", async () => {
    const uri = MongoHarness.getUri();
    const [base, query = ""] = uri.split("?");
    const db = client(`${base?.replace(/\/[^/]*$/, "")}/default-db-name${query === "" ? "" : `?${query}`}`);
    await db.connect();
    expect(db.connection.name).toBe("default-db-name");
  });

  // ported from mongoose test/connection.test.js:559 "startSession() (gh-6653)"
  test("startSession() (gh-6653)", async () => {
    const session = await t.client.startSession();
    expect(session).toBeDefined();
    const lastUse = session.serverSession?.lastUse;
    await Bun.sleep(10);
    await t.connection.model(Thing).findOne({}).session(session);
    expect((session.serverSession?.lastUse ?? 0) > (lastUse ?? 0)).toBe(true);
    await session.endSession();
  });

  // ported from mongoose test/connection.test.js:606 "works" (useDb)
  test("useDb works", () => {
    const db2 = t.connection.useDb("mongoose2");
    expect(db2.name).toBe("mongoose2");
    expect(db2.client).toBe(t.connection.client);
  });

  // ported from mongoose test/connection.test.js:625 "saves correctly" (useDb)
  test("useDb saves correctly", async () => {
    const db2 = t.connection.useDb(`${t.mongo.dbName}_second`);
    const m1 = t.connection.model(Thing);
    const m2 = db2.model(Thing);
    const i1 = await m1.create({ body: "this is some text", thing: 1 });
    const i2 = await m2.create({ body: "this is another body", thing: 2 });
    const item1 = await m1.findById(i1._id).orFail();
    expect([item1.body, item1.thing]).toEqual(["this is some text", 1]);
    const item2 = await m2.findById(i2._id).orFail();
    expect([item2.body, item2.thing]).toEqual(["this is another body", 2]);
    expect(await m1.findById(i2._id)).toBeNull();
    expect(await m2.findById(i1._id)).toBeNull();
    await t.client.unsafeDriver().db(`${t.mongo.dbName}_second`).dropDatabase();
  });

  // ported from mongoose test/connection.test.js:830 "cache connections to the same db"
  test("cache connections to the same db", () => {
    expect(t.connection.useDb("same")).toBe(t.connection.useDb("same"));
  });

  // ported from mongoose test/connection.test.js:1088 "throws a MongooseServerSelectionError on server selection timeout (gh-8451)"
  test("throws a server selection error on server selection timeout (gh-8451)", async () => {
    const error = await client("mongodb://baddomain:27017/test", { serverSelectionTimeoutMS: 100 })
      .connect()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConnectionError);
    expect((error as ConnectionError).failure).toBe("server-selection");
    expect(((error as ConnectionError).cause as Error).name).toBe("MongoServerSelectionError");
  });

  // ported from mongoose test/connection.test.js:1101 "avoids unhandled error on createConnection() if error handler registered (gh-14377)"
  test("no unhandled rejection when connect() fails and the caller handles it (gh-14377, H203)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await client("mongodb://baddomain:27017/test", { serverSelectionTimeoutMS: 100 })
        .connect()
        .catch(() => undefined);
      await Bun.sleep(20);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});
