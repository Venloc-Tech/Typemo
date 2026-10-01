// N2: the client of TypemoModule.forRoot / forRootAsync on the real server and on a dead one: tokens, the three
// async forms, `name` in a factory result, retries, lazy connection, the callbacks, two clients, shutdown.
import { describe, expect, spyOn, test } from "bun:test";
import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigurationError, type Connection, ConnectionError, type Model, TypemoClient } from "@venloc/typemo";
import { ClientConnector } from "../../src/client-connector.ts";
import {
  getClientToken,
  getConnectionToken,
  getModelToken,
  InjectClient,
  InjectConnection,
  InjectModel,
  TypemoModule,
  type TypemoModuleFactoryOptions,
  type TypemoOptionsFactory,
} from "../../src/index.ts";
import { NtAccount } from "../fixtures/entities.ts";
import { DEAD_URI, NestTest } from "../support/nest-test.ts";

/** Compiling a module whose start fails: the error of `compile()`. */
const startError = async (imports: Parameters<typeof NestTest.module>[0]): Promise<unknown> => {
  try {
    const ref = await Test.createTestingModule({ imports: [...imports] }).compile();
    ref.useLogger(false);
    await ref.close();
  } catch (error) {
    return error;
  }
  throw new Error("the start did not fail");
};

describe("forRoot", () => {
  test("connects; the client, its connection and a model are injectable and work", async () => {
    @Injectable()
    class Probe {
      constructor(
        @InjectClient() readonly client: TypemoClient,
        @InjectConnection() readonly connection: Connection,
        @InjectModel(NtAccount) readonly accounts: Model<NtAccount>,
      ) {}
    }
    @Module({ imports: [TypemoModule.forFeature([NtAccount])], providers: [Probe] })
    class AccountsModule {}
    const db = NestTest.db("forroot");
    const ref = await NestTest.module([TypemoModule.forRoot(await NestTest.uri(), { dbName: db }), AccountsModule]);
    const probe = ref.get(Probe);
    expect(probe.client).toBeInstanceOf(TypemoClient);
    expect(probe.connection).toBe(probe.client.connection);
    expect(probe.connection.name).toBe(db);
    expect(probe.accounts).toBe(probe.connection.model(NtAccount));
    await probe.accounts.create({ title: "Main", balance: 10 });
    expect(await probe.accounts.countDocuments({ title: "Main" })).toBe(1);
    await ref.close();
    expect(probe.client.state).toBe("closed");
  });

  test("with a name: the tokens carry it, the client is named so, and no default client exists", async () => {
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { name: "analytics", dbName: NestTest.db("named") }),
    ]);
    const client = ref.get<TypemoClient>(getClientToken("analytics"));
    expect(client.name).toBe("analytics");
    expect(ref.get<Connection>(getConnectionToken({ client: "analytics" }))).toBe(client.connection);
    expect(() => ref.get(getClientToken())).toThrow();
    await ref.close();
  });

  test("invalid module options are refused when forRoot is called", () => {
    expect(() => TypemoModule.forRoot("mongodb://x", { retryAttempts: -1 })).toThrow(
      new ConfigurationError("TypemoModule.forRoot: retryAttempts is a whole number of 0 or more, got -1"),
    );
    expect(() => TypemoModule.forRoot("mongodb://x", { sync: "all" as never })).toThrow(
      'TypemoModule.forRoot: sync is false, "init" or "sync", got "all"',
    );
    expect(() => TypemoModule.forRoot("mongodb://x", { name: "a/b" })).toThrow(
      'getClientToken: the client name is a non-empty string without "/", got "a/b"',
    );
    expect(() => TypemoModule.forRoot("", {})).toThrow(
      "TypemoModule.forRoot: the connection string is a non-empty string",
    );
  });

  test("two forRoot with the same name in one application are an error at start", async () => {
    const uri = await NestTest.uri();
    const error = await startError([
      TypemoModule.forRoot(uri, { dbName: NestTest.db("dup1") }),
      TypemoModule.forRoot(uri, { dbName: NestTest.db("dup2") }),
    ]);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as Error).message).toBe(
      'TypemoModule.forRoot: two clients named "default" in one application; give each forRoot its own name',
    );
  });

  test("two clients: the same entity on each gives two models in two databases", async () => {
    @Injectable()
    class Probe {
      constructor(
        @InjectModel(NtAccount) readonly main: Model<NtAccount>,
        @InjectModel(NtAccount, { client: "archive" }) readonly archive: Model<NtAccount>,
      ) {}
    }
    @Module({
      imports: [TypemoModule.forFeature([NtAccount]), TypemoModule.forFeature([NtAccount], { client: "archive" })],
      providers: [Probe],
    })
    class AccountsModule {}
    const uri = await NestTest.uri();
    const ref = await NestTest.module([
      TypemoModule.forRoot(uri, { dbName: NestTest.db("main") }),
      TypemoModule.forRoot(uri, { name: "archive", dbName: NestTest.db("archive") }),
      AccountsModule,
    ]);
    const { main, archive } = ref.get(Probe);
    expect(main).not.toBe(archive);
    expect(getModelToken(NtAccount)).not.toBe(getModelToken(NtAccount, { client: "archive" }));
    await main.create({ title: "A", balance: 1 });
    expect(await main.countDocuments({ title: "A" })).toBe(1);
    expect(await archive.countDocuments({ title: "A" })).toBe(0);
    expect(archive.connection.client.name).toBe("archive");
    await ref.close();
  });
});

describe("forRootAsync", () => {
  @Injectable()
  class Config {
    uri = "";
    db = "";
  }
  const configModule = async () => {
    const config = new Config();
    config.uri = await NestTest.uri();
    config.db = NestTest.db("async");
    @Module({ providers: [{ provide: Config, useValue: config }], exports: [Config] })
    class ConfigModule {}
    return { ConfigModule, config };
  };

  test("useFactory with inject", async () => {
    const { ConfigModule, config } = await configModule();
    const ref = await NestTest.module([
      TypemoModule.forRootAsync({
        imports: [ConfigModule],
        inject: [Config],
        useFactory: (c: Config): TypemoModuleFactoryOptions => ({ uri: c.uri, dbName: c.db }),
      }),
    ]);
    expect(ref.get<TypemoClient>(getClientToken()).connection.name).toBe(config.db);
    await ref.close();
  });

  test("useClass (the class injects what it needs)", async () => {
    const { ConfigModule, config } = await configModule();
    @Injectable()
    class Options implements TypemoOptionsFactory {
      constructor(private readonly c: Config) {}
      createTypemoOptions(): TypemoModuleFactoryOptions {
        return { uri: this.c.uri, dbName: this.c.db };
      }
    }
    const ref = await NestTest.module([TypemoModule.forRootAsync({ imports: [ConfigModule], useClass: Options })]);
    expect(ref.get<TypemoClient>(getClientToken()).connection.name).toBe(config.db);
    await ref.close();
  });

  test("useExisting (an options class another module provides) and a name next to it", async () => {
    const uri = await NestTest.uri();
    const db = NestTest.db("existing");
    @Injectable()
    class Options implements TypemoOptionsFactory {
      createTypemoOptions(): TypemoModuleFactoryOptions {
        return { uri, dbName: db };
      }
    }
    @Module({ providers: [Options], exports: [Options] })
    class OptionsModule {}
    const ref = await NestTest.module([
      TypemoModule.forRootAsync({ name: "reports", imports: [OptionsModule], useExisting: Options }),
    ]);
    const client = ref.get<TypemoClient>(getClientToken("reports"));
    expect(client.name).toBe("reports");
    expect(client.connection.name).toBe(db);
    await ref.close();
  });

  test.each(["useFactory", "useClass", "useExisting"] as const)(
    "%s: a result with `name` fails at once with a clear error, without retries",
    async (form) => {
      const result = { uri: DEAD_URI, name: "x", retryAttempts: 5, retryDelay: 10_000 };
      class Options implements TypemoOptionsFactory {
        createTypemoOptions(): TypemoModuleFactoryOptions {
          return result as never;
        }
      }
      @Module({ providers: [Options], exports: [Options] })
      class OptionsModule {}
      const options =
        form === "useFactory"
          ? { useFactory: () => result as never }
          : form === "useClass"
            ? { useClass: Options }
            : { imports: [OptionsModule], useExisting: Options };
      const started = performance.now();
      const error = await startError([TypemoModule.forRootAsync(options)]);
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toBe(
        `TypemoModule.forRootAsync (${form}): the result has "name"; name the client next to ${form}: forRootAsync({ name, ${form} })`,
      );
    },
  );

  test("not exactly one of useFactory, useClass, useExisting is an error", () => {
    expect(() => TypemoModule.forRootAsync({} as never)).toThrow(
      "TypemoModule.forRootAsync: give one of useFactory, useClass, useExisting (got none)",
    );
  });

  test("a result without uri is an error", async () => {
    const error = await startError([TypemoModule.forRootAsync({ useFactory: () => ({}) as never })]);
    expect((error as Error).message).toBe(
      "TypemoModule.forRootAsync (useFactory): uri is a non-empty connection string",
    );
  });
});

describe("retries and callbacks", () => {
  test("onClientCreate runs once before connecting; clientFactory gets the connected client; no error factory call", async () => {
    const calls: string[] = [];
    let created: TypemoClient | undefined;
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), {
        dbName: NestTest.db("callbacks"),
        onClientCreate: (client) => {
          created = client;
          calls.push(`create:${client.state}`);
        },
        clientFactory: (client) => {
          calls.push(`factory:${client.state}`);
          return client;
        },
        clientErrorFactory: (error) => {
          calls.push("error");
          return error as Error;
        },
      }),
    ]);
    expect(calls).toEqual(["create:idle", "factory:connected"]);
    /* cast: the client captured in onClientCreate is typed loosely; identity is what the test checks */
    expect(ref.get<TypemoClient>(getClientToken())).toBe(created as unknown as TypemoClient);
    await ref.close();
  });

  test("an unreachable server fails the start after retryAttempts tries, with the error of clientErrorFactory", async () => {
    let creates = 0;
    let seen: unknown;
    let client: TypemoClient | undefined;
    const started = performance.now();
    const error = await startError([
      TypemoModule.forRoot(DEAD_URI, {
        retryAttempts: 3,
        retryDelay: 20,
        onClientCreate: (c) => {
          creates += 1;
          client = c;
        },
        clientErrorFactory: (e) => {
          seen = e;
          return new Error("the database is down");
        },
      }),
    ]);
    expect((error as Error).message).toBe("the database is down");
    expect(seen).toBeInstanceOf(ConnectionError);
    expect((seen as ConnectionError).failure).toBe("server-selection");
    expect(creates).toBe(1);
    expect(client?.state).toBe("closed");
    // three tries of about 200 ms each (serverSelectionTimeoutMS) and two pauses
    expect(performance.now() - started).toBeGreaterThan(500);
  });

  test("clientFactory that returns no client is an error", async () => {
    const error = await startError([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("bad"), clientFactory: () => ({}) as never }),
    ]);
    expect((error as Error).message).toBe('TypemoModule: clientFactory of client "default" returned no TypemoClient');
  });
});

describe("lazyConnection", () => {
  test("starts without a server; onClientCreate runs; an operation then fails", async () => {
    let creates = 0;
    @Module({ imports: [TypemoModule.forFeature([NtAccount])] })
    class AccountsModule {}
    const ref = await NestTest.module([
      TypemoModule.forRoot(DEAD_URI, {
        lazyConnection: true,
        retryAttempts: 1,
        readyTimeoutMS: 300,
        onClientCreate: () => {
          creates += 1;
        },
      }),
      AccountsModule,
    ]);
    expect(creates).toBe(1);
    const accounts = ref.get<Model<NtAccount>>(getModelToken(NtAccount));
    const failure = await accounts
      .countDocuments({ title: "x" })
      .exec()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConnectionError);
    await ref.close();
  });

  test("with a reachable server the first query works", async () => {
    @Module({ imports: [TypemoModule.forFeature([NtAccount])] })
    class AccountsModule {}
    const ref = await NestTest.module([
      TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("lazy"), lazyConnection: true }),
      AccountsModule,
    ]);
    const accounts = ref.get<Model<NtAccount>>(getModelToken(NtAccount));
    expect(await accounts.countDocuments({ title: "x" })).toBe(0);
    await ref.close();
  });

  test("the same dead server without lazyConnection fails the start", async () => {
    const error = await startError([TypemoModule.forRoot(DEAD_URI, { retryAttempts: 1 })]);
    expect(error).toBeInstanceOf(ConnectionError);
  });
});

describe("the log of the retries", () => {
  test("names the client and the kind of failure, never the connection string", async () => {
    const lines: string[] = [];
    const spy = spyOn(ClientConnector.logger, "error").mockImplementation((message: unknown) => {
      lines.push(String(message));
    });
    try {
      await startError([
        TypemoModule.forRoot("mongodb://admin:s3cret@127.0.0.1:1/?serverSelectionTimeoutMS=100&directConnection=true", {
          retryAttempts: 2,
          retryDelay: 1,
        }),
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(lines).toEqual(['Unable to connect client "default" (ConnectionError: server-selection). Retrying (1)...']);
    expect(lines.join("\n")).not.toContain("s3cret");
    expect(lines.join("\n")).not.toContain("127.0.0.1");
  });
});

describe("a failure a retry cannot fix", () => {
  test("wrong credentials stop the tries at once", async () => {
    const uri = (await NestTest.uri()).replace("mongodb://", "mongodb://nobody:wrong@");
    let seen: unknown;
    const started = performance.now();
    await startError([
      TypemoModule.forRoot(uri, {
        retryAttempts: 5,
        retryDelay: 2_000,
        clientErrorFactory: (error) => {
          seen = error;
          return error as Error;
        },
      }),
    ]);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(seen).toBeInstanceOf(ConnectionError);
    expect((seen as ConnectionError).failure).toBe("authentication");
  });
});

describe("health through client.state", () => {
  test("connected, and a lazy client of a dead server", async () => {
    const live = await NestTest.module([TypemoModule.forRoot(await NestTest.uri(), { dbName: NestTest.db("health") })]);
    expect(live.get<TypemoClient>(getClientToken()).state).toBe("connected");
    await live.close();
    const dead = await NestTest.module([TypemoModule.forRoot(DEAD_URI, { lazyConnection: true, retryAttempts: 1 })]);
    expect(dead.get<TypemoClient>(getClientToken()).state).not.toBe("connected");
    await dead.close();
  });
});
