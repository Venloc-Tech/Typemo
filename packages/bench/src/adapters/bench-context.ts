import "reflect-metadata";
import { type EntityClass, type Model, TypemoClient, type Connection as TypemoConnection } from "@venloc/typemo";
import { type Db, MongoClient, type MongoClientOptions, type WriteConcernSettings } from "mongodb";
import mongoose from "mongoose";
import type { ContestantId } from "../harness/types.ts";

/**
 * Settings shared by every contestant so that the comparison is equal (same pool, same write concern).
 * Each contestant owns its own `MongoClient` with these options and its own database (`<prefix>_<contestant>`),
 * so write scenarios never see each other's data.
 *
 * @example
 * ```ts
 * const settings: ConnectionSettings = ConnectionDefaults.settings({ maxPoolSize: 20 });
 * ```
 */
export interface ConnectionSettings {
  /** Connection string of the benchmark server. */
  readonly uri: string;
  /** Prefix of every contestant's database name. */
  readonly dbPrefix: string;
  /** Pool size of every client. */
  readonly maxPoolSize: number;
  /** Write concern of every client. */
  readonly writeConcern: WriteConcernSettings;
  /** `true` in the commands pass only: driver command monitoring costs time and must stay out of timings. */
  readonly monitorCommands: boolean;
}

/** The connection string of the Docker server started by `docker/mongo.sh`. */
export const DEFAULT_URI = "mongodb://localhost:27117/?replicaSet=rs0&directConnection=true";

/** Default connection settings of the benchmark. */
export class ConnectionDefaults {
  /**
   * The connection string: `BENCH_MONGO_URI` or the default.
   *
   * @returns The connection string.
   */
  static uri(): string {
    return process.env.BENCH_MONGO_URI ?? DEFAULT_URI;
  }

  /**
   * The default settings with overrides.
   *
   * @param overrides - Settings that replace the defaults.
   * @returns The settings.
   */
  static settings(overrides: Partial<ConnectionSettings> = {}): ConnectionSettings {
    return {
      uri: ConnectionDefaults.uri(),
      dbPrefix: "typemo_bench",
      maxPoolSize: 10,
      writeConcern: { w: 1 },
      monitorCommands: false,
      ...overrides,
    };
  }

  /**
   * The driver options every contestant's client uses.
   *
   * @param settings - The shared settings.
   * @returns The `MongoClient` options.
   */
  static driverOptions(settings: ConnectionSettings): MongoClientOptions {
    return {
      maxPoolSize: settings.maxPoolSize,
      writeConcern: settings.writeConcern,
      monitorCommands: settings.monitorCommands,
      readPreference: "primary",
    };
  }
}

/** The raw driver contestant: the "floor" every other contestant is compared with. */
export class DriverHandle {
  /** The contestant id. */
  readonly id = "driver" as const;
  /**
   * @param client - The connected client.
   * @param db - The contestant's database.
   */
  constructor(
    readonly client: MongoClient,
    readonly db: Db,
  ) {}

  /** The client the contestant talks through. */
  get mongo(): MongoClient {
    return this.client;
  }
}

/** Mongoose, one isolated `Mongoose` instance per mode (global options differ). */
export class MongooseHandle {
  /** Models created on this connection, by name. */
  readonly #models = new Map<string, mongoose.Model<Record<string, unknown>>>();

  /**
   * @param id - The contestant id.
   * @param instance - The isolated Mongoose instance.
   * @param connection - Its connection.
   */
  constructor(
    readonly id: "mongoose" | "mongoose-safe",
    readonly instance: mongoose.Mongoose,
    readonly connection: mongoose.Connection,
  ) {}

  /** `true` for the mode with `runValidators`, `sanitizeFilter` and strict queries. */
  get safe(): boolean {
    return this.id === "mongoose-safe";
  }

  /** The client the contestant talks through. */
  get mongo(): MongoClient {
    return this.connection.getClient() as unknown as MongoClient;
  }

  /** The contestant's native database. */
  get db(): Db {
    return this.connection.db as unknown as Db;
  }

  /**
   * One model per (name, connection). `define` builds the schema with THIS instance's `Schema` class — schemas
   * must not be shared across Mongoose instances.
   *
   * @param name - The model name.
   * @param collection - The collection name.
   * @param define - Builds the schema with the given Mongoose instance.
   * @returns The cached or newly created model.
   */
  model<Raw extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    collection: string,
    define: (m: mongoose.Mongoose) => mongoose.Schema,
  ): mongoose.Model<Raw> {
    const existing = this.#models.get(name);
    if (existing !== undefined) return existing as unknown as mongoose.Model<Raw>;
    const created = this.connection.model(name, define(this.instance), collection);
    this.#models.set(name, created as unknown as mongoose.Model<Record<string, unknown>>);
    return created as unknown as mongoose.Model<Raw>;
  }

  /**
   * Drops the model cache (startup scenarios recreate models).
   *
   * @param name - The model name.
   */
  forget(name: string): void {
    this.#models.delete(name);
    if (this.connection.models[name] !== undefined) this.connection.deleteModel(name);
  }
}

/** Typemo, hydrated or lean: separate clients so that the modes never share a pool. */
export class TypemoHandle {
  /**
   * @param id - The contestant id.
   * @param client - The Typemo client.
   * @param connection - Its connection; defaults to the client's own.
   */
  constructor(
    readonly id: "typemo" | "typemo-lean",
    readonly client: TypemoClient,
    readonly connection: TypemoConnection = client.connection,
  ) {}

  /** `true` for the mode whose reads return plain objects. */
  get lean(): boolean {
    return this.id === "typemo-lean";
  }

  /** The client the contestant talks through. */
  get mongo(): MongoClient {
    return this.client.unsafeDriver();
  }

  /** The contestant's native database. */
  get db(): Db {
    return this.client.unsafeDriver().db(this.connection.name);
  }

  /**
   * The Typemo model of an entity class.
   *
   * @param entity - The entity class.
   * @returns The model.
   */
  model<T extends object>(entity: EntityClass<T>): Model<T> {
    return this.connection.model(entity);
  }
}

/**
 * The handle of any contestant.
 *
 * @example
 * ```ts
 * const handle: AnyHandle = ctx.handle("typemo");
 * ```
 */
export type AnyHandle = DriverHandle | MongooseHandle | TypemoHandle;

/**
 * All five contestants, connected. Scenarios receive it as `env.ctx` and pick their handle.
 * `open` also lets the runner check that the driver inside Mongoose is the same as the one Typemo uses.
 */
export class BenchContext {
  /** The scratch-database view of this context, created on first use. */
  #writable: BenchContext | undefined;

  /**
   * @param settings - The shared settings.
   * @param driver - The raw driver contestant.
   * @param mongoose - Mongoose without the safety options.
   * @param mongooseSafe - Mongoose with the safety options.
   * @param typemo - Typemo, hydrated.
   * @param typemoLean - Typemo, lean.
   */
  private constructor(
    readonly settings: ConnectionSettings,
    readonly driver: DriverHandle,
    readonly mongoose: MongooseHandle,
    readonly mongooseSafe: MongooseHandle,
    readonly typemo: TypemoHandle,
    readonly typemoLean: TypemoHandle,
  ) {}

  /**
   * The database name of a contestant.
   *
   * @param settings - The shared settings.
   * @param contestant - Who owns the database.
   * @returns `<prefix>_<contestant>` with `-` replaced by `_`.
   */
  static dbName(settings: ConnectionSettings, contestant: ContestantId): string {
    return `${settings.dbPrefix}_${contestant.replace("-", "_")}`;
  }

  /**
   * Connects all five contestants.
   *
   * @param settings - The shared settings.
   * @returns The connected context.
   */
  static async open(settings: ConnectionSettings): Promise<BenchContext> {
    const options = ConnectionDefaults.driverOptions(settings);

    const client = new MongoClient(settings.uri, options);
    await client.connect();
    const driver = new DriverHandle(client, client.db(BenchContext.dbName(settings, "driver")));

    const openMongoose = async (id: "mongoose" | "mongoose-safe"): Promise<MongooseHandle> => {
      const instance = new mongoose.Mongoose();
      /* Indexes are created by the harness for every contestant alike (same indexes). */
      instance.set("autoIndex", false);
      instance.set("autoCreate", false);
      instance.set("strictQuery", id === "mongoose-safe" ? "throw" : false);
      if (id === "mongoose-safe") {
        instance.set("runValidators", true);
        instance.set("sanitizeFilter", true);
      }
      const connection = instance.createConnection(settings.uri, {
        ...options,
        dbName: BenchContext.dbName(settings, id),
      } as mongoose.ConnectOptions);
      await connection.asPromise();
      return new MongooseHandle(id, instance, connection);
    };

    const openTypemo = async (id: "typemo" | "typemo-lean"): Promise<TypemoHandle> => {
      const typemo = new TypemoClient(settings.uri, {
        ...options,
        dbName: BenchContext.dbName(settings, id),
        name: id,
      });
      await typemo.connect();
      return new TypemoHandle(id, typemo);
    };

    const [m, ms, t, tl] = await Promise.all([
      openMongoose("mongoose"),
      openMongoose("mongoose-safe"),
      openTypemo("typemo"),
      openTypemo("typemo-lean"),
    ]);
    return new BenchContext(settings, driver, m, ms, t, tl);
  }

  /** Suffix of the scratch databases of mutating scenarios. */
  static readonly WRITE_SUFFIX = "_w";

  /**
   * The same five clients (same pools) over SCRATCH databases `<db>_w`: mutating scenarios (B, F, G, H) work
   * there, so the read datasets of C/D/E stay pristine and identical across contestants.
   *
   * @returns The scratch-database view; it is its own `writable`.
   */
  get writable(): BenchContext {
    if (this.#writable !== undefined) return this.#writable;
    const s = BenchContext.WRITE_SUFFIX;
    const mongooseOf = (h: MongooseHandle): MongooseHandle =>
      new MongooseHandle(h.id, h.instance, h.connection.useDb(`${h.connection.name}${s}`, { useCache: true }));
    const typemoOf = (h: TypemoHandle): TypemoHandle =>
      new TypemoHandle(h.id, h.client, h.client.db(`${h.connection.name}${s}`));
    const writable = new BenchContext(
      this.settings,
      new DriverHandle(this.driver.client, this.driver.client.db(`${this.driver.db.databaseName}${s}`)),
      mongooseOf(this.mongoose),
      mongooseOf(this.mongooseSafe),
      typemoOf(this.typemo),
      typemoOf(this.typemoLean),
    );
    writable.#writable = writable;
    this.#writable = writable;
    return writable;
  }

  /**
   * The handle of a contestant.
   *
   * @param contestant - Who.
   * @returns The handle.
   */
  handle(contestant: ContestantId): AnyHandle {
    switch (contestant) {
      case "driver":
        return this.driver;
      case "mongoose":
        return this.mongoose;
      case "mongoose-safe":
        return this.mongooseSafe;
      case "typemo":
        return this.typemo;
      case "typemo-lean":
        return this.typemoLean;
    }
  }

  /**
   * The `MongoClient` a contestant talks through (for CommandRecorder).
   *
   * @param contestant - Who.
   * @returns The client.
   */
  mongoOf(contestant: ContestantId): MongoClient {
    return this.handle(contestant).mongo;
  }

  /**
   * The native `Db` of a contestant (untimed seeding / state probes).
   *
   * @param contestant - Who.
   * @returns The database.
   */
  dbOf(contestant: ContestantId): Db {
    return this.handle(contestant).db;
  }

  /** Closes every contestant's connection; failures are ignored. */
  async close(): Promise<void> {
    await Promise.allSettled([
      this.driver.client.close(),
      this.mongoose.connection.close(),
      this.mongooseSafe.connection.close(),
      this.typemo.client.close(),
      this.typemoLean.client.close(),
    ]);
  }
}
