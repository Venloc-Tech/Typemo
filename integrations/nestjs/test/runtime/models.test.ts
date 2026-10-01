// N3: forFeature on the real server — one model object per class and connection, discriminators in any order, ids
// of other types, statics of plugins, another database, views and materialized results, the start-up sync, and the
// errors of a wrong list.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Injectable, Module } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  ConfigurationError,
  type Connection,
  Entity,
  fn,
  type Materialized,
  type Model,
  type PluginStatics,
  Prop,
  Schema,
  SyncError,
  type TypedView,
  type TypemoClient,
} from "@venloc/typemo";
import {
  getClientToken,
  getConnectionToken,
  getModelToken,
  InjectConnection,
  InjectModel,
  TypemoModule,
} from "../../src/index.ts";
import {
  NtAccount,
  NtClickEvent,
  NtCountPlugin,
  NtCountry,
  NtEvent,
  NtNote,
  NtOpenAccount,
  NtOwnerTotal,
  NtSignUpEvent,
} from "../fixtures/entities.ts";
import { NestTest } from "../support/nest-test.ts";

/** The collections of a database. */
const collections = async (client: TypemoClient, db: string): Promise<string[]> =>
  (await client.unsafeDriver().db(db).listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();

/** The error of a start that fails. */
const startError = async (imports: Parameters<typeof NestTest.module>[0]): Promise<unknown> => {
  try {
    const ref = await Test.createTestingModule({ imports: [...imports] }).compile();
    await ref.init();
    await ref.close();
  } catch (error) {
    return error;
  }
  throw new Error("the start did not fail");
};

describe("models", () => {
  test("the same entity in two modules is one model object (the core's per connection)", async () => {
    @Injectable()
    class A {
      constructor(@InjectModel(NtAccount) readonly accounts: Model<NtAccount>) {}
    }
    @Injectable()
    class B {
      constructor(@InjectModel(NtAccount) readonly accounts: Model<NtAccount>) {}
    }
    @Module({ imports: [TypemoModule.forFeature([NtAccount])], providers: [A] })
    class ModuleA {}
    @Module({ imports: [TypemoModule.forFeature([NtAccount])], providers: [B] })
    class ModuleB {}
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("same") }),
      ModuleA,
      ModuleB,
    ]);
    expect(ref.get(A).accounts).toBe(ref.get(B).accounts);
    expect(ref.get(A).accounts).toBe(ref.get<TypemoClient>(getClientToken()).connection.model(NtAccount));
    await ref.close();
  });

  test("the collection name comes from the entity's @Schema", async () => {
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("coll") }),
      TypemoModule.forFeature([NtAccount]),
    ]);
    expect(ref.get<Model<NtAccount>>(getModelToken(NtAccount)).collectionName).toBe("nt_accounts");
    await ref.close();
  });

  test("an entity with a string id", async () => {
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("ids") }),
      TypemoModule.forFeature([NtCountry]),
    ]);
    const countries = ref.get<Model<NtCountry>>(getModelToken(NtCountry));
    await countries.create({ _id: "FR", name: "France" });
    expect((await countries.findById("FR").orFail().lean()).name).toBe("France");
    await ref.close();
  });

  test("{ entity, statics }: the injected model has the plugin's statics", async () => {
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("statics") }),
      TypemoModule.forFeature([{ entity: NtNote, statics: NtCountPlugin }]),
    ]);
    const notes = ref.get<Model<NtNote> & PluginStatics<typeof NtCountPlugin>>(getModelToken(NtNote));
    await notes.create({ title: "a" });
    await notes.create({ title: "a" });
    expect(await notes.countTitled("a")).toBe(2);
    await ref.close();
  });

  test("{ entity, statics } with a plugin the entity does not apply fails the start", async () => {
    const error = await startError([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("nostatics") }),
      TypemoModule.forFeature([{ entity: NtAccount, statics: NtCountPlugin }]),
    ]);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toBe('NtAccount: plugin "nt-count" is not applied to this model\'s schema');
  });

  test("{ db }: the model and the injected connection are those of another database", async () => {
    @Injectable()
    class Probe {
      constructor(
        @InjectModel(NtAccount, { db: "nest_billing" }) readonly billing: Model<NtAccount>,
        @InjectModel(NtAccount) readonly main: Model<NtAccount>,
        @InjectConnection({ db: "nest_billing" }) readonly connection: Connection,
      ) {}
    }
    @Module({
      imports: [TypemoModule.forFeature([NtAccount]), TypemoModule.forFeature([NtAccount], { db: "nest_billing" })],
      providers: [Probe],
    })
    class BillingModule {}
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("db") }),
      BillingModule,
    ]);
    const probe = ref.get(Probe);
    expect(probe.billing.connection.name).toBe("nest_billing");
    expect(probe.connection).toBe(probe.billing.connection);
    expect(probe.main).not.toBe(probe.billing);
    expect(ref.get<Connection>(getConnectionToken({ db: "nest_billing" }))).toBe(probe.connection);
    await probe.billing.connection.client.unsafeDriver().db("nest_billing").dropDatabase();
    await ref.close();
  });
});

describe("discriminators", () => {
  const orders: [string, Parameters<typeof TypemoModule.forFeature>[0]][] = [
    ["base first", [NtEvent, NtClickEvent, NtSignUpEvent]],
    ["children first", [NtClickEvent, NtSignUpEvent, NtEvent]],
    ["mixed", [NtClickEvent, NtEvent, NtSignUpEvent]],
  ];
  test.each(orders)("children share the base collection whatever the order (%s)", async (_label, features) => {
    const db = NestTest.db("disc");
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: db, sync: "init" }),
      TypemoModule.forFeature(features),
    ]);
    const clicks = ref.get<Model<NtClickEvent>>(getModelToken(NtClickEvent));
    const events = ref.get<Model<NtEvent>>(getModelToken(NtEvent));
    const click = await clicks.create({ url: "https://example.com", time: new Date() });
    expect(click.__t).toBe("click");
    expect(await events.countDocuments({ __t: "click" })).toBe(1);
    expect(await collections(ref.get(getClientToken()), db)).toEqual(["nt_events"]);
    await ref.close();
  });

  test("a child alone: the base is compiled for it on the same collection, but has no provider", async () => {
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("child") }),
      TypemoModule.forFeature([NtSignUpEvent]),
    ]);
    const signUps = ref.get<Model<NtSignUpEvent>>(getModelToken(NtSignUpEvent));
    expect(signUps.collectionName).toBe("nt_events");
    expect((await signUps.create({ user: "ann", time: new Date() })).__t).toBe("signup");
    expect(() => ref.get(getModelToken(NtEvent))).toThrow();
    await ref.close();
  });
});

describe("views and materialized results", () => {
  const openAccounts = TypemoModule.view(NtOpenAccount, {
    on: NtAccount,
    pipeline: (p) => p.match({ balance: { $gt: 0 } }).project({ title: 1, balance: 1 }),
  });
  const ownerTotals = TypemoModule.materialized(NtOwnerTotal, {
    from: NtAccount,
    pipeline: (p) => p.match({ balance: { $gt: 0 } }).group((f) => ({ _id: f.title, total: fn.sum(f.balance) })),
    mode: "replace",
  });
  let ref: TestingModule;
  let db: string;

  beforeAll(async () => {
    db = NestTest.db("views");
    ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: db, sync: "init" }),
      TypemoModule.forFeature([NtAccount, openAccounts, ownerTotals]),
    ]);
  });
  afterAll(() => ref.close());

  test("sync: 'init' created the view; the injected TypedView reads the source live", async () => {
    const accounts = ref.get<Model<NtAccount>>(getModelToken(NtAccount));
    const view = ref.get<TypedView<NtOpenAccount>>(getModelToken(NtOpenAccount));
    expect(await collections(ref.get(getClientToken()), db)).toContain("nt_open_accounts");
    await accounts.create({ title: "Main", balance: 5, owner: "ann" });
    await accounts.create({ title: "Empty", balance: 0, owner: "ann" });
    expect((await view.find({})).map((row) => row.title)).toEqual(["Main"]);
    expect("create" in view).toBe(false);
  });

  test("the injected Materialized computes its target collection on refresh", async () => {
    const totals = ref.get<Materialized<NtOwnerTotal>>(getModelToken(NtOwnerTotal));
    await totals.refresh();
    expect(await totals.model.find({}).lean()).toEqual([{ _id: "Main", total: 5 }]);
  });

  test("a class registered as a model and as a view on one connection fails the start", async () => {
    const error = await startError([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("conflict") }),
      TypemoModule.forFeature([NtAccount, openAccounts]),
      TypemoModule.forFeature([NtOpenAccount]),
    ]);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toMatch(
      /^TypemoModule\.forFeature: NtOpenAccount is registered as a (view and as a model|model and as a view) on database "nest_conflict_\d+_\d+" of client "default"; a class is one of them$/,
    );
  });
});

describe("start-up sync", () => {
  @Schema({ collection: "nt_sync_items" })
  class NtSyncItem extends Entity {
    @Prop(() => String, { required: true, unique: true })
    code!: string;
  }

  test("sync: false (the default) writes nothing", async () => {
    const db = NestTest.db("nosync");
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: db }),
      TypemoModule.forFeature([NtSyncItem]),
    ]);
    expect(await collections(ref.get(getClientToken()), db)).toEqual([]);
    await ref.close();
  });

  test("sync: 'init' creates the collections and indexes of every forFeature model", async () => {
    const db = NestTest.db("init");
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: db, sync: "init" }),
      TypemoModule.forFeature([NtSyncItem]),
    ]);
    const client = ref.get<TypemoClient>(getClientToken());
    expect(await collections(client, db)).toEqual(["nt_sync_items"]);
    const indexes = await client.unsafeDriver().db(db).collection("nt_sync_items").indexes();
    expect(indexes.map((index) => index.name).sort()).toEqual(["_id_", "code_1"]);
    await ref.close();
  });

  test("sync: 'sync' brings the indexes in line (an index declared differently is replaced)", async () => {
    const db = NestTest.db("sync");
    const uri = await NestTest.uri();
    const first = await NestTest.module([TypemoModule.forRoot(uri, { dbName: db })]);
    const raw = first.get<TypemoClient>(getClientToken()).unsafeDriver().db(db).collection("nt_sync_items");
    await raw.createIndex({ code: 1 }, { name: "code_1" });
    await first.close();
    const ref = await NestTest.module([
      TypemoModule.forRoot(uri, { dbName: db, sync: "sync" }),
      TypemoModule.forFeature([NtSyncItem]),
    ]);
    const indexes = await ref
      .get<TypemoClient>(getClientToken())
      .unsafeDriver()
      .db(db)
      .collection("nt_sync_items")
      .indexes();
    expect(indexes.find((index) => index.name === "code_1")?.unique).toBe(true);
    await ref.close();
  });

  test("sync: 'init' with an index declared differently fails the start with SyncError", async () => {
    const db = NestTest.db("syncfail");
    const uri = await NestTest.uri();
    const first = await NestTest.module([TypemoModule.forRoot(uri, { dbName: db })]);
    await first
      .get<TypemoClient>(getClientToken())
      .unsafeDriver()
      .db(db)
      .collection("nt_sync_items")
      .createIndex({ code: 1 });
    await first.close();
    const error = await startError([
      TypemoModule.forRoot(uri, { dbName: db, sync: "init" }),
      TypemoModule.forFeature([NtSyncItem]),
    ]);
    expect(error).toBeInstanceOf(SyncError);
  });
});

describe("a wrong list", () => {
  test("a class listed twice", () => {
    expect(() => TypemoModule.forFeature([NtAccount, NtAccount])).toThrow(
      new ConfigurationError("TypemoModule.forFeature: NtAccount is listed twice"),
    );
  });

  test("an entry that is not a class", () => {
    expect(() => TypemoModule.forFeature(["NtAccount" as never])).toThrow(
      "TypemoModule.forFeature: an entry is an entity class, { entity, statics }, TypemoModule.view(...) or TypemoModule.materialized(...), got string",
    );
  });

  test("an unknown key next to entity", () => {
    expect(() => TypemoModule.forFeature([{ entity: NtAccount, collection: "x" } as never])).toThrow(
      'TypemoModule.forFeature: unknown key "collection" in { entity: NtAccount } (known: entity, statics)',
    );
  });

  test("a class that is not a @Schema fails the start", async () => {
    class NotASchema {}
    const error = await startError([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("noschema") }),
      TypemoModule.forFeature([NotASchema]),
    ]);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toBe("NotASchema: not a schema; decorate the class with @Schema()");
  });
});
