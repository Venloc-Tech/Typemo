/*
 * Ported from Mongoose: test/model.indexes.test.js, test/collection.capped.test.js,
 * test/model.watch.test.js, test/model.test.js (createCollection, watch), test/connection.test.js
 * (autoCreate/autoIndex, createCollections). The logic is kept; Mongoose's implicit `init()` (auto-create,
 * auto-index at model start) is Typemo's explicit `createCollection`/`syncIndexes`/`syncAll` — each row in
 * INDEX.md says what differs and why.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";
import {
  CollectionOptionsError,
  ConfigurationError,
  Discriminator,
  type DiscriminatorValue,
  type DuplicateKeyError,
  Entity,
  Index,
  IndexSyncError,
  Prop,
  Schema,
  SchemaCompiler,
  TypemoClient,
} from "../../../src/internal.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("p9_storage");

beforeEach(async () => {
  for (const { name } of await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith("p9_")) await t.mongo.db.dropCollection(name);
  }
});

const indexNames = async (collection: string) =>
  (await t.mongo.db.collection(collection).listIndexes().toArray()).map((index) => index.name);

@Schema({ collection: "p9_test" })
class Plain extends Entity {
  @Prop(() => String)
  name?: string;
}

@Schema({ collection: "p9_test" })
@Index({ name: 1 }, { unique: true })
class UniqueName extends Entity {
  @Prop(() => String)
  name?: string;
}

describe("model.indexes.test.js", () => {
  // ported from mongoose test/model.indexes.test.js:257 "error should emit on the model"
  test("error should emit on the model", async () => {
    await t.connection.model(Plain).create([{ name: "hi" }, { name: "hi" }]);
    const error = await t.connection
      .model(UniqueName)
      .createIndexes()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IndexSyncError);
    /* Divergence from the Mongoose test: the message of a duplicate key is short ("duplicate key on name_1 (code 11000
       DuplicateKey)"); the server's E11000 text is the `serverMessage` of the failure's error. */
    expect((error as Error).message).toContain("duplicate key");
    const failed = (error as IndexSyncError).failures[0]?.error as DuplicateKeyError;
    expect(/E11000 duplicate key error/.test(failed.serverMessage)).toBe(true);
  });

  // ported from mongoose test/model.indexes.test.js:278 "when one index creation errors"
  test("when one index creation errors", async () => {
    @Schema({ collection: "p9_deepindexed" })
    @Index({ name: 1 })
    class SingleIndexed extends Entity {
      @Prop(() => String)
      name?: string;

      @Prop(() => Boolean)
      secondValue?: boolean;
    }
    @Schema({ collection: "p9_deepindexed" })
    @Index({ name: 1 }, { unique: true })
    @Index({ secondValue: 1 })
    class DuplicateIndexed extends Entity {
      @Prop(() => String)
      name?: string;

      @Prop(() => Boolean)
      secondValue?: boolean;
    }
    await t.connection.model(SingleIndexed).createIndexes();
    const error = await t.connection
      .model(DuplicateIndexed)
      .createIndexes()
      .catch((caught: unknown) => caught);
    // name_1 exists with other options (code 86); secondValue_1 is still created.
    expect((error as IndexSyncError).failures.map((failure) => failure.name)).toEqual(["name_1"]);
    const names = await indexNames("p9_deepindexed");
    expect(names).toContain("name_1");
    expect(names).toContain("secondValue_1");
  });

  // ported from mongoose test/model.indexes.test.js:316 "creates descending indexes from schema definition(gh-8895)"
  test("creates descending indexes from schema definition(gh-8895)", async () => {
    @Schema({ collection: "p9_users" })
    @Index({ name: -1 })
    @Index({ address: -1 })
    class User extends Entity {
      @Prop(() => String)
      name?: string;

      @Prop(() => String)
      address?: string;
    }
    await t.connection.model(User).syncIndexes();
    const names = await indexNames("p9_users");
    expect(names).toContain("name_-1");
    expect(names).toContain("address_-1");
  });

  // ported from mongoose test/model.indexes.test.js:334 "auto creation > can be disabled"
  test("auto creation can be disabled (autoIndex: false leaves the indexes out of syncAll)", async () => {
    @Schema({ collection: "p9_noindex", autoIndex: false })
    @Index({ name: 1 })
    class NoIndex extends Entity {
      @Prop(() => String)
      name?: string;
    }
    const connection = t.client.db(t.mongo.dbName);
    connection.model(NoIndex);
    const report = await connection.syncAll();
    expect(report.collections.find((entry) => entry.collection === "p9_noindex")?.indexes).toBeUndefined();
    expect(await indexNames("p9_noindex")).toEqual(["_id_"]);
  });

  // ported from mongoose test/model.indexes.test.js:401 "model.ensureIndexes() creates indexes"
  test("createIndexes creates indexes (ensureIndexes)", async () => {
    @Schema({ collection: "p9_manual" })
    @Index({ name: 1 }, { sparse: true })
    class Manual extends Entity {
      @Prop(() => String)
      name?: string;
    }
    expect(await t.connection.model(Manual).createIndexes()).toEqual(["name_1"]);
    const index = (await t.mongo.db.collection("p9_manual").listIndexes().toArray()).find(
      (candidate) => candidate.name === "name_1",
    );
    expect(index?.sparse).toBe(true);
  });

  // ported from mongoose test/model.indexes.test.js:497 "decorated discriminator index with syncIndexes (gh-6347)"
  test("decorated discriminator index with syncIndexes (gh-6347)", async () => {
    @Schema({ collection: "p9_users_d", discriminatorKey: "kind", autoIndex: false })
    class UserBase extends Entity {
      @Prop(() => String)
      kind?: string;
    }
    @Discriminator("Customer")
    class Customer extends UserBase {
      declare readonly kind: DiscriminatorValue<"Customer">;
      // Typemo refuses `unique` on an optional field (every missing value would collide): required.
      @Prop(() => String, { unique: true, required: true })
      emailId!: string;

      @Prop(() => String)
      firstName?: string;
    }
    const Customers = t.connection.model(Customer);
    await Customers.syncIndexes();
    const index = (await t.mongo.db.collection("p9_users_d").listIndexes().toArray()).find(
      (candidate) => candidate.key.emailId === 1,
    );
    expect(index?.partialFilterExpression).toEqual({ kind: "Customer" });
    const again = await Customers.syncIndexes();
    expect(again.toDrop.length).toBe(0);
  });

  // ported from mongoose test/model.indexes.test.js:514 "uses schema-level collation by default (gh-9912)"
  test("uses schema-level collation by default (gh-9912)", async () => {
    @Schema({ collection: "p9_user_collated", collation: { locale: "en", strength: 2 } })
    @Index({ username: 1 }, { unique: true })
    class User extends Entity {
      @Prop(() => String)
      username?: string;
    }
    const Users = t.connection.model(User);
    await Users.createCollection();
    await Users.syncIndexes();
    const indexes = await Users.listIndexes();
    expect(indexes.length).toBe(2);
    expect(indexes[1]?.key).toEqual({ username: 1 });
    expect(indexes[1]?.collation?.strength).toBe(2);
    expect(await Users.diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
  });

  // ported from mongoose test/model.indexes.test.js:537 "different collation with syncIndexes() (gh-8521)"
  test("different collation with syncIndexes() (gh-8521)", async () => {
    @Schema({ collection: "p9_user_c1" })
    @Index({ username: 1 }, { unique: true })
    class UserA extends Entity {
      @Prop(() => String)
      username?: string;
    }
    @Schema({ collection: "p9_user_c1", autoIndex: false })
    @Index({ username: 1 }, { unique: true, collation: { locale: "en", strength: 2 } })
    class UserB extends Entity {
      @Prop(() => String)
      username?: string;
    }
    await t.connection.model(UserA).syncIndexes();
    let indexes = await t.connection.model(UserA).listIndexes();
    expect(indexes.length).toBe(2);
    expect(indexes[1]?.key).toEqual({ username: 1 });
    expect(indexes[1]?.collation === undefined || indexes[1]?.collation?.locale === "simple").toBe(true);
    await t.connection.model(UserB).syncIndexes();
    indexes = await t.connection.model(UserB).listIndexes();
    expect(indexes.length).toBe(2);
    expect(indexes[1]?.key).toEqual({ username: 1 });
    expect(indexes[1]?.collation?.locale).toBe("en");
  });

  // ported from mongoose test/model.indexes.test.js:572 "reports syncIndexes() error (gh-9303)"
  test("reports syncIndexes() error (gh-9303)", async () => {
    @Schema({ collection: "p9_user_9303" })
    class Loose extends Entity {
      @Prop(() => String)
      username?: string;

      @Prop(() => String)
      email?: string;
    }
    @Schema({ collection: "p9_user_9303", autoIndex: false })
    @Index({ username: 1 }, { unique: true })
    @Index({ email: 1 })
    class Strict extends Entity {
      @Prop(() => String)
      username?: string;

      @Prop(() => String)
      email?: string;
    }
    await t.connection.model(Loose).createCollection();
    expect((await t.connection.model(Loose).listIndexes()).length).toBe(1);
    await t.connection.model(Loose).create([
      { username: "test", email: "foo@bar" },
      { username: "test", email: "foo@bar" },
    ]);
    const error = await t.connection
      .model(Strict)
      .syncIndexes()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IndexSyncError);
    expect(((error as IndexSyncError).failures[0]?.error as { code?: number } | undefined)?.code).toBe(11000);
    const indexes = await t.connection.model(Strict).listIndexes();
    expect(indexes.length).toBe(2);
    expect(indexes[1]?.key).toEqual({ email: 1 });
  });

  // ported from mongoose test/model.indexes.test.js:600 "should not re-create a compound text index that involves non-text indexes, using syncIndexes (gh-13136)"
  // ported from mongoose test/model.indexes.test.js:632 "should not find a diff when calling diffIndexes after syncIndexes involving a text and non-text compound index (gh-13136)"
  test("a compound text index with non-text keys is not re-created (gh-13136)", async () => {
    @Schema({ collection: "p9_text_compound", autoIndex: false })
    @Index({ title: "text", description: "text", age: 1 })
    class Text extends Entity {
      @Prop(() => String)
      title?: string;

      @Prop(() => String)
      description?: string;

      @Prop(() => Number)
      age?: number;
    }
    const Texts = t.connection.model(Text);
    expect((await Texts.diffIndexes()).toCreate).toEqual(["title_text_description_text_age_1"]);
    const first = await Texts.syncIndexes();
    expect(first.toDrop).toEqual([]);
    const second = await Texts.syncIndexes();
    expect(second.toDrop).toEqual([]);
    expect(await Texts.diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
  });

  // ported from mongoose test/model.indexes.test.js:664 "cleanIndexes (gh-6676)"
  test("cleanIndexes (gh-6676): syncIndexes drops what the schema no longer declares", async () => {
    @Schema({ collection: "p9_clean", autoIndex: false })
    @Index({ name: 1 })
    class Before extends Entity {
      @Prop(() => String)
      name?: string;
    }
    @Schema({ collection: "p9_clean", autoIndex: false })
    class After extends Entity {
      @Prop(() => String)
      name?: string;
    }
    await t.connection.model(Before).createIndexes();
    expect((await t.connection.model(Before).listIndexes()).map((index) => index.key)).toEqual([
      { _id: 1 },
      { name: 1 },
    ]);
    await t.connection.model(After).syncIndexes();
    expect((await t.connection.model(After).listIndexes()).map((index) => index.key)).toEqual([{ _id: 1 }]);
  });

  // ported from mongoose test/model.indexes.test.js:688 "should prevent collation on text indexes (gh-10044)"
  test("should prevent collation on text indexes (gh-10044): explicit, a build error", async () => {
    @Schema({ collection: "p9_text_collated", collation: { locale: "en", strength: 2 } })
    @Index({ username: "text" })
    class Implicit extends Entity {
      @Prop(() => String)
      username?: string;
    }
    expect(() => SchemaCompiler.compileModel(Implicit)).toThrow(ConfigurationError);

    @Schema({ collection: "p9_text_collated", collation: { locale: "en", strength: 2 } })
    @Index({ username: "text" }, { collation: { locale: "simple" } })
    class Explicit extends Entity {
      @Prop(() => String)
      username?: string;
    }
    const Explicits = t.connection.model(Explicit);
    await Explicits.createCollection();
    await Explicits.syncIndexes();
    const indexes = await Explicits.listIndexes();
    expect(indexes[1]?.collation === undefined || indexes[1]?.collation?.locale === "simple").toBe(true);
    expect(await Explicits.diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
  });

  // ported from mongoose test/model.indexes.test.js:705 "should do a dryRun feat-10316"
  test("should do a dryRun feat-10316", async () => {
    @Schema({ collection: "p9_upson" })
    @Index({ password: 1 })
    @Index({ email: 1 })
    class Upson extends Entity {
      @Prop(() => String)
      username?: string;

      @Prop(() => String)
      password?: string;

      @Prop(() => String)
      email?: string;
    }
    await t.mongo.db.collection("p9_upson").createIndex({ age: 1 });
    await t.mongo.db.collection("p9_upson").createIndex({ weight: 1 });
    const result = await t.connection.model(Upson).diffIndexes();
    expect(result.toDrop).toEqual(["age_1", "weight_1"]);
    expect(result.toCreate).toEqual(["password_1", "email_1"]);
  });

  // ported from mongoose test/model.indexes.test.js:718 "running diffIndexes with a non-existent collection should not throw an error (gh-14010)"
  test("running diffIndexes with a non-existent collection should not throw an error (gh-14010)", async () => {
    @Schema({ collection: "p9_gh14010" })
    class Gh14010 extends Entity {
      @Prop(() => String)
      name?: string;
    }
    expect(await t.connection.model(Gh14010).diffIndexes()).toEqual({ toCreate: [], toDrop: [], toModify: [] });
  });
});

describe("collection.capped.test.js", () => {
  @Schema({ collection: "p9_capped", capped: { size: 1000 } })
  class Capped extends Entity {
    @Prop(() => String)
    key?: string;
  }

  // ported from mongoose test/collection.capped.test.js:30 "schemas should have option size"
  test("schemas should have option size", () => {
    const schema = SchemaCompiler.compileModel(Capped);
    expect(schema.options.capped).toEqual({ size: 1000 });
  });

  // ported from mongoose test/collection.capped.test.js:38 "creation"
  test("creation", async () => {
    await t.connection.model(Capped).createCollection();
    expect(await t.mongo.db.collection("p9_capped").isCapped()).toBe(true);
  });

  // ported from mongoose test/collection.capped.test.js:56 "skips when setting autoCreate to false (gh-8566)"
  test("skips when setting autoCreate to false (gh-8566)", async () => {
    @Schema({ collection: "p9_capped_nocreate", capped: { size: 1024 }, autoCreate: false })
    class NoCreate extends Entity {
      @Prop(() => String)
      name?: string;
    }
    const connection = t.client.db(t.mongo.dbName);
    const Model = connection.model(NoCreate);
    /* Typemo: the collection is not created, and a schema with nothing to create (no index) is skipped whole, with
       no error: its owner creates the collection. (With an index the missing collection is a SyncError, because the
       index would create it without its options; see implicit-create.test.ts.) */
    const report = await connection.syncAll();
    expect(report.collections.find((entry) => entry.collection === "p9_capped_nocreate")?.options).toBeUndefined();
    expect(report.failed).toBe(false);
    // Typemo does not create it either on request (autoCreate: false): it is created where it is owned, then used.
    await expect(Model.createCollection()).rejects.toBeInstanceOf(ConfigurationError);
    await t.mongo.db.createCollection("p9_capped_nocreate", { capped: true, size: 1024 });
    await Model.create({ name: "test" });
    expect(await t.mongo.db.collection("p9_capped_nocreate").isCapped()).toBe(true);
  });
});

describe("model.test.js: createCollection", () => {
  // ported from mongoose test/model.test.js:6200 "createCollection() respects schema collation (gh-6489)"
  test("createCollection() respects schema collation (gh-6489)", async () => {
    @Schema({ collection: "p9_user_6489", collation: { locale: "en_US", strength: 1 } })
    class User extends Entity {
      @Prop(() => String)
      name?: string;
    }
    const Users = t.connection.model(User);
    await Users.createCollection();
    await Users.create([{ name: "alpha" }, { name: "Zeta" }]);
    const res = await t.mongo.db.collection("p9_user_6489").find({}).sort({ name: 1 }).toArray();
    expect(res.map((row) => row.name)).toEqual(["alpha", "Zeta"]);
  });

  // ported from mongoose test/model.test.js:6220 "createCollection() respects timeseries (gh-10611)"
  test("createCollection() respects timeseries (gh-10611)", async () => {
    @Schema({
      collection: "p9_test_gh10611",
      timeseries: { timeField: "timestamp", metaField: "metadata", granularity: "hours", expireAfterSeconds: 86400 },
    })
    class Series extends Entity {
      @Prop(() => String)
      name?: string;

      @Prop(() => Date, { required: true })
      timestamp!: Date;

      @Prop(() => String)
      metadata?: string;
    }
    expect((await t.mongo.db.listCollections({ name: "p9_test_gh10611" }).toArray()).length).toBe(0);
    await t.connection.model(Series).createCollection();
    /* cast: driver typing — listCollections() info has no typed options */
    const coll = (await t.mongo.db.listCollections({ name: "p9_test_gh10611" }).toArray())[0] as unknown as {
      type: string;
      options: { timeseries: { timeField: string } };
    };
    expect(coll.type).toBe("timeseries");
    expect(coll.options.timeseries.timeField).toBe("timestamp");
  });

  // ported from mongoose test/model.test.js:6313 "createCollection() enforces expireAfterSeconds when set by Schema (gh-11229)"
  test("createCollection() enforces expireAfterSeconds when set by Schema (gh-11229)", async () => {
    @Schema({
      collection: "p9_gh11229",
      timeseries: { timeField: "timestamp", metaField: "metadata", granularity: "hours", expireAfterSeconds: 5 },
    })
    class Series extends Entity {
      @Prop(() => Date, { required: true })
      timestamp!: Date;

      @Prop(() => String)
      metadata?: string;
    }
    await t.connection.model(Series).createCollection();
    const options = await t.mongo.db.collection("p9_gh11229").options();
    expect(Number(options.expireAfterSeconds)).toBe(5);
    expect(options.timeseries).toBeDefined();
  });

  // ported from mongoose test/model.test.js:6369 "createCollection() respects clusteredIndex"
  test("createCollection() respects clusteredIndex", async () => {
    @Schema({ collection: "p9_clustered", clustered: { name: "clustered test" } })
    class Clustered extends Entity {
      @Prop(() => String)
      name?: string;
    }
    await t.connection.model(Clustered).createCollection();
    /* cast: driver typing — listCollections() info has no typed options */
    const coll = (await t.mongo.db.listCollections({ name: "p9_clustered" }).toArray())[0] as unknown as {
      options: { clusteredIndex: { key: unknown; name: string } };
    };
    expect(coll.options.clusteredIndex.key).toEqual({ _id: 1 });
    expect(coll.options.clusteredIndex.name).toBe("clustered test");
  });
});

describe("connection.test.js: autoCreate / createCollections", () => {
  // ported from mongoose test/connection.test.js:67 "with autoCreate (gh-6489)"
  test("with autoCreate (gh-6489): syncAll creates the collection with its collation", async () => {
    @Schema({ collection: "p9_gh6489_conn", collation: { locale: "en_US", strength: 1 } })
    class Conn extends Entity {
      @Prop(() => String)
      name?: string;
    }
    /* A database of its own: the shared connection holds models of other tests (with failures of their own). */
    const name = `${t.mongo.dbName}_6489`;
    const db = t.mongo.client.db(name);
    await db.dropDatabase();
    const connection = t.client.db(name);
    const Model = connection.model(Conn);
    await connection.syncAll();
    expect((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)).toContain("p9_gh6489_conn");
    await Model.create([{ name: "alpha" }, { name: "Zeta" }]);
    const res = await db.collection("p9_gh6489_conn").find({}).sort({ name: 1 }).toArray();
    expect(res.map((row) => row.name)).toEqual(["alpha", "Zeta"]);
  });

  // ported from mongoose test/connection.test.js:92 "with autoCreate = false (gh-8814)"
  test("with autoCreate = false (gh-8814)", async () => {
    @Schema({ collection: "p9_gh8814_conn", collation: { locale: "en_US", strength: 1 }, autoCreate: false })
    class Conn extends Entity {
      @Prop(() => String)
      name?: string;
    }
    const name = `${t.mongo.dbName}_8814`;
    const db = t.mongo.client.db(name);
    await db.dropDatabase();
    const connection = t.client.db(name);
    connection.model(Conn);
    /* Typemo: not created (autoCreate: false); the schema has no index to create, so it is skipped without an error. */
    expect((await connection.syncAll()).failed).toBe(false);
    expect((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)).not.toContain(
      "p9_gh8814_conn",
    );
  });

  // ported from mongoose test/connection.test.js:108 "autoCreate when collection already exists does not fail (gh-7122)"
  test("autoCreate when collection already exists does not fail (gh-7122)", async () => {
    @Schema({ collection: "p9_actors" })
    class Actor extends Entity {
      @Prop(() => String, { unique: true, required: true })
      name!: string;
    }
    const name = `${t.mongo.dbName}_7122`;
    const db = t.mongo.client.db(name);
    await db.dropDatabase();
    await db.createCollection("p9_actors");
    const connection = t.client.db(name);
    connection.model(Actor);
    const report = await connection.syncAll();
    expect(report.collections.find((entry) => entry.collection === "p9_actors")?.errors).toEqual([]);
  });

  // ported from mongoose test/connection.test.js:1792 "should create collections for all models on the connection with the createCollections() function (gh-13300)"
  test("creates collections for all models on the connection (gh-13300)", async () => {
    const connection = t.client.db(`${t.mongo.dbName}_13300`);
    const db = t.mongo.client.db(`${t.mongo.dbName}_13300`);
    await db.dropDatabase();
    for (const name of ["p9_gh13300a", "p9_gh13300b", "p9_gh13300c"]) {
      @Schema({ collection: name })
      class Each extends Entity {
        @Prop(() => String)
        name?: string;
      }
      connection.model(Each);
    }
    await connection.syncAll();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    expect(names).toEqual(["p9_gh13300a", "p9_gh13300b", "p9_gh13300c"]);
    await db.dropDatabase();
  });

  // ported from mongoose test/model.test.js:6400 "createCollection() handles NamespaceExists errors (gh-9447)" — the other half:
  // an existing collection with OTHER options is reported, not ignored (Mongoose ignored it).
  test("createCollection() of an existing collection with other options is an error", async () => {
    @Schema({ collection: "p9_ns_exists", capped: { size: 1024 } })
    class Exists extends Entity {}
    await t.mongo.db.createCollection("p9_ns_exists");
    await expect(t.connection.model(Exists).createCollection()).rejects.toThrow(CollectionOptionsError);
  });
});

describe("model.watch.test.js / model.test.js: watch", () => {
  @Schema({ collection: "p9_watch" })
  class Watched extends Entity {
    @Prop(() => String)
    name?: string;
  }

  // ported from mongoose test/model.test.js:4084 "watch() (gh-5964)"
  test("watch() (gh-5964)", async () => {
    const MyModel = t.connection.model(Watched);
    await MyModel.createCollection();
    const stream = await MyModel.watch();
    const doc = await MyModel.create({ name: "Ned Stark" });
    const change = await stream.next();
    await stream.close();
    expect(change.operationType).toBe("insert");
    if (change.operationType === "insert") expect(change.fullDocument._id.toHexString()).toBe(doc._id.toHexString());
  });

  // ported from mongoose test/model.test.js:4180 "fullDocument with immediate watcher and hydrate (gh-14049)"
  test("fullDocument with immediate watcher and hydrate (gh-14049)", async () => {
    const MyModel = t.connection.model(Watched);
    const doc = await MyModel.create({ name: "Ned Stark" });
    const stream = await MyModel.watch({ fullDocument: "updateLookup", hydrate: true });
    await MyModel.updateOne({ _id: doc._id }, { $set: { name: "Tony Stark" } });
    const change = await stream.next();
    await stream.close();
    if (change.operationType !== "update") throw new Error("expected an update");
    expect(change.fullDocument?._id.toHexString()).toBe(doc._id.toHexString());
    expect(change.fullDocument).toBeInstanceOf(Watched);
    expect(change.fullDocument?.name).toBe("Tony Stark");
  });

  // ported from mongoose test/model.test.js:4213 "respects discriminators (gh-11007)"
  test("respects discriminators (gh-11007)", async () => {
    @Schema({ collection: "p9_watch_disc" })
    class Base extends Entity {
      @Prop(() => String)
      name?: string;
    }
    @Discriminator("Test1")
    class Child extends Base {
      declare readonly __t: DiscriminatorValue<"Test1">;
      @Prop(() => String)
      email?: string;
    }
    const BaseModel = t.connection.model(Base);
    const ChildModel = t.connection.model(Child);
    await BaseModel.createCollection();
    const stream = await ChildModel.watch();
    await BaseModel.create({ name: "Base" });
    await ChildModel.create({ name: "Child", email: "test" });
    const change = await stream.next();
    await stream.close();
    expect(change.operationType).toBe("insert");
    if (change.operationType === "insert") expect(change.fullDocument.name).toBe("Child");
  });

  // ported from mongoose test/model.watch.test.js:25 "watch() before connecting (gh-5964)"
  test("watch() before connecting (gh-5964)", async () => {
    const client = new TypemoClient(MongoHarness.getUri(), { dbName: t.mongo.dbName });
    const MyModel = client.connection.model(Watched);
    // Called before connect(): waits for the connection, no buffer.
    const pending = MyModel.watch();
    await client.connect();
    const stream = await pending;
    await MyModel.create({ name: "Ned Stark" });
    const change = await stream.next();
    await stream.close();
    await client.close();
    if (change.operationType !== "insert") throw new Error("expected an insert");
    expect(change.fullDocument.name).toBe("Ned Stark");
  });

  // ported from mongoose test/model.watch.test.js:64 "watch() close() closes the stream (gh-7022)"
  test("watch() close() closes the stream (gh-7022)", async () => {
    const MyModel = t.connection.model(Watched);
    const stream = await MyModel.watch();
    await MyModel.create({ name: "Hodor" });
    await stream.close();
    expect(stream.closed).toBe(true);
  });
});
