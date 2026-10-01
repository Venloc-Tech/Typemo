/*
 * The options of `TypemoModule.forRoot` and `forRootAsync`: the client options of the core plus what the module adds
 * (retries, lazy connection, start-up sync, the client callbacks). `name` names the client and is part of the tokens;
 * in `forRootAsync` it stands next to the factory, never in what the factory returns (a `name` there is a compile error
 * and a clear error at start: `@nestjs/mongoose` let `connectionName` through and the driver then refused it with
 * retries, wrapper gotcha 13).
 */
import type { DynamicModule, ForwardReference, InjectionToken, OptionalFactoryDependency, Type } from "@nestjs/common";
import type { TypemoClient, TypemoClientOptions } from "@venloc/typemo";

/**
 * What the module creates in the database when the application starts: nothing (`false`, the default), what is
 * missing (`"init"`: `connection.init()`, never changes or drops anything) or everything brought in line with the
 * schemas (`"sync"`: `connection.syncAll()`, may replace indexes).
 *
 * @example
 * ```ts
 * const sync: TypemoSync = "init";
 * ```
 */
export type TypemoSync = false | "init" | "sync";

/**
 * What the module adds to the client options.
 *
 * @example
 * ```ts
 * const options: TypemoConnectOptions = { retryAttempts: 3, retryDelay: 500, sync: "init" };
 * ```
 */
export interface TypemoConnectOptions {
  /**
   * How many times the module tries to connect before the start fails; `0` and `1` both mean one try. Default 9,
   * as in `@nestjs/mongoose`.
   */
  readonly retryAttempts?: number;
  /** The pause between two tries, in milliseconds. Default 3000. */
  readonly retryDelay?: number;
  /**
   * `true`: the application starts without waiting for the connection, which is made in the background (with the
   * same retries); operations wait for it up to the client's `readyTimeoutMS`. A connection that never succeeds is
   * logged. Default `false`: the start waits and fails when the server is unreachable.
   */
  readonly lazyConnection?: boolean;
  /**
   * What to create in the database when the application starts, after every `forFeature` model is registered.
   * Default `false`: the module does not write to the database.
   */
  readonly sync?: TypemoSync;
  /**
   * Called once with the new client, before it connects and before any model exists: the place for `client.use`
   * (extensions), `client.connection.plugins` and `client.instrument`. Called with a lazy connection too.
   */
  readonly onClientCreate?: (client: TypemoClient) => void | Promise<void>;
  /**
   * Receives the connected client (with `lazyConnection`, the client that is connecting) and returns the client to
   * provide: the same one, usually after setting it up.
   */
  readonly clientFactory?: (client: TypemoClient) => TypemoClient | Promise<TypemoClient>;
  /** Receives the error of the last failed try and returns the error the start fails with. */
  readonly clientErrorFactory?: (error: unknown) => Error;
}

/**
 * The options of `TypemoModule.forRoot(uri, options)`: every `TypemoClientOptions` (`name`, `dbName`,
 * `readyTimeoutMS`, the driver's options) and {@link TypemoConnectOptions}.
 *
 * @example
 * ```ts
 * const options: TypemoModuleOptions = { name: "main", dbName: "app", retryAttempts: 3 };
 * ```
 */
export type TypemoModuleOptions = TypemoClientOptions & TypemoConnectOptions;

/**
 * What a `forRootAsync` factory returns: the connection string and the options, without `name` (the client is
 * named next to the factory, by `forRootAsync({ name })`).
 *
 * @example
 * ```ts
 * const options: TypemoModuleFactoryOptions = { uri: "mongodb://localhost:27017", dbName: "app" };
 * ```
 */
export type TypemoModuleFactoryOptions = Omit<TypemoClientOptions, "name"> &
  TypemoConnectOptions & {
    /** The connection string. */
    readonly uri: string;
    /** Not here: name the client with `forRootAsync({ name })`. */
    readonly name?: never;
  };

/**
 * A class that makes the options of `forRootAsync({ useClass })` or `forRootAsync({ useExisting })`.
 *
 * @example
 * ```ts
 * class DatabaseConfig implements TypemoOptionsFactory {
 *   createTypemoOptions(): TypemoModuleFactoryOptions {
 *     return { uri: "mongodb://localhost:27017", dbName: "app" };
 *   }
 * }
 * ```
 */
export interface TypemoOptionsFactory {
  /**
   * Makes the options.
   *
   * @returns The connection string and the options (no `name`).
   */
  createTypemoOptions(): TypemoModuleFactoryOptions | Promise<TypemoModuleFactoryOptions>;
}

/**
 * What `forRootAsync` shares between its three forms: the client name and the modules the factory needs.
 *
 * @example
 * ```ts
 * const common: TypemoAsyncCommon = { name: "main", imports: [] };
 * ```
 */
export interface TypemoAsyncCommon {
  /** The client name; default `"default"`. */
  readonly name?: string;
  /** Modules whose providers the factory injects. */
  readonly imports?: readonly (Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>)[];
}

/**
 * `forRootAsync` with a factory function.
 *
 * @example
 * ```ts
 * const options: TypemoAsyncFactory = {
 *   useFactory: () => ({ uri: "mongodb://localhost:27017", dbName: "app" }),
 * };
 * ```
 */
export interface TypemoAsyncFactory extends TypemoAsyncCommon {
  /**
   * Makes the options; its parameters are the providers listed in `inject`, in order. Declare their types: the
   * module does not know them.
   */
  readonly useFactory: (...args: never[]) => TypemoModuleFactoryOptions | Promise<TypemoModuleFactoryOptions>;
  /** The providers passed to `useFactory`. */
  readonly inject?: readonly (InjectionToken<unknown> | OptionalFactoryDependency)[];
  /** Only one of `useFactory`, `useClass`, `useExisting`. */
  readonly useClass?: never;
  /** Only one of `useFactory`, `useClass`, `useExisting`. */
  readonly useExisting?: never;
}

/**
 * `forRootAsync` with a class the module creates (its constructor may inject providers).
 *
 * @example
 * ```ts
 * class DatabaseConfig implements TypemoOptionsFactory {
 *   createTypemoOptions(): TypemoModuleFactoryOptions {
 *     return { uri: "mongodb://localhost:27017" };
 *   }
 * }
 * const options: TypemoAsyncClass = { useClass: DatabaseConfig };
 * ```
 */
export interface TypemoAsyncClass extends TypemoAsyncCommon {
  /** The options class. */
  readonly useClass: Type<TypemoOptionsFactory>;
  /** Only one of `useFactory`, `useClass`, `useExisting`. */
  readonly useFactory?: never;
  /** Only one of `useFactory`, `useClass`, `useExisting`. */
  readonly useExisting?: never;
  /** Not used with `useClass`: the class injects what it needs itself. */
  readonly inject?: never;
}

/**
 * `forRootAsync` with an options class that another module already provides.
 *
 * @example
 * ```ts
 * class DatabaseConfig implements TypemoOptionsFactory {
 *   createTypemoOptions(): TypemoModuleFactoryOptions {
 *     return { uri: "mongodb://localhost:27017" };
 *   }
 * }
 * const options: TypemoAsyncExisting = { useExisting: DatabaseConfig };
 * ```
 */
export interface TypemoAsyncExisting extends TypemoAsyncCommon {
  /** The provided options class. */
  readonly useExisting: Type<TypemoOptionsFactory>;
  /** Only one of `useFactory`, `useClass`, `useExisting`. */
  readonly useFactory?: never;
  /** Only one of `useFactory`, `useClass`, `useExisting`. */
  readonly useClass?: never;
  /** Not used with `useExisting`. */
  readonly inject?: never;
}

/**
 * The options of `TypemoModule.forRootAsync`: one of a factory, a class or an existing provider.
 *
 * @example
 * ```ts
 * const options: TypemoModuleAsyncOptions = {
 *   name: "main",
 *   useFactory: () => ({ uri: "mongodb://localhost:27017" }),
 * };
 * ```
 */
export type TypemoModuleAsyncOptions = TypemoAsyncFactory | TypemoAsyncClass | TypemoAsyncExisting;
