/*
 * Creates the `TypemoClient` of a `forRoot`: checks the module options, creates the client, calls `onClientCreate`
 * (always, also with `lazyConnection`: `@nestjs/mongoose` skipped `onConnectionCreate` for a lazy connection, wrapper
 * gotcha 7), connects with retries (or in the background), and hands the client to `clientFactory`.
 * One client is reused across the tries: the core's `connect()` can be called again after a failure, so the
 * extensions registered by `onClientCreate` stay registered and `onClientCreate` runs once.
 */
import { Logger } from "@nestjs/common";
import { ConfigurationError, ConnectionError, ErrorClassifier, TypemoClient } from "@venloc/typemo";
import type { TypemoConnectOptions, TypemoModuleOptions, TypemoSync } from "./options.ts";

/**
 * The module options after the checks, split from the client options.
 *
 * @example
 * ```ts fragment
 * const resolved: ResolvedConnectOptions = ClientConnector.resolve(options, "TypemoModule.forRoot");
 * ```
 */
export interface ResolvedConnectOptions {
  /** How many tries, at least 1. */
  readonly attempts: number;
  /** The pause between tries, ms. */
  readonly delay: number;
  /** Whether the start does not wait for the connection. */
  readonly lazy: boolean;
  /** What to create when the application starts. */
  readonly sync: TypemoSync;
  /** See `TypemoConnectOptions.onClientCreate`. */
  readonly onClientCreate: TypemoConnectOptions["onClientCreate"];
  /** See `TypemoConnectOptions.clientFactory`. */
  readonly clientFactory: TypemoConnectOptions["clientFactory"];
  /** See `TypemoConnectOptions.clientErrorFactory`. */
  readonly clientErrorFactory: TypemoConnectOptions["clientErrorFactory"];
  /** The rest: the options of `new TypemoClient` (without `name`, which the module sets). */
  readonly client: Readonly<Record<string, unknown>>;
}

/** The keys the module reads; everything else goes to `new TypemoClient`. */
const MODULE_KEYS: ReadonlySet<string> = new Set([
  "retryAttempts",
  "retryDelay",
  "lazyConnection",
  "sync",
  "onClientCreate",
  "clientFactory",
  "clientErrorFactory",
  "name",
  "uri",
]);

/** Creates and connects the clients of the module. */
export class ClientConnector {
  /** The logger of the module (the retries, a lazy connection that failed). */
  static readonly logger = new Logger("TypemoModule");

  /**
   * Checks the module options and splits them from the client options; the input is not changed.
   *
   * @param options - The options of `forRoot` or of a `forRootAsync` factory.
   * @param where - The caller, for the messages.
   * @returns The checked options.
   * @throws {ConfigurationError} When an option of the module has a wrong value.
   */
  static resolve(
    options: TypemoModuleOptions | Readonly<Record<string, unknown>>,
    where: string,
  ): ResolvedConnectOptions {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new ConfigurationError(`${where}: the options are an object`);
    }
    const all = options as Readonly<Record<string, unknown>>;
    const count = (key: string, fallback: number): number => {
      const value = all[key] ?? fallback;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new ConfigurationError(`${where}: ${key} is a whole number of 0 or more, got ${String(value)}`);
      }
      return value;
    };
    const callback = <F>(key: string): F | undefined => {
      const value = all[key];
      if (value !== undefined && typeof value !== "function") {
        throw new ConfigurationError(`${where}: ${key} is a function, got ${typeof value}`);
      }
      return value as F | undefined;
    };
    const lazy = all.lazyConnection ?? false;
    if (typeof lazy !== "boolean") {
      throw new ConfigurationError(`${where}: lazyConnection is true or false, got ${String(lazy)}`);
    }
    const sync = all.sync ?? false;
    if (sync !== false && sync !== "init" && sync !== "sync") {
      throw new ConfigurationError(`${where}: sync is false, "init" or "sync", got ${JSON.stringify(sync)}`);
    }
    const client: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(all)) if (!MODULE_KEYS.has(key)) client[key] = value;
    return {
      attempts: Math.max(1, count("retryAttempts", 9)),
      delay: count("retryDelay", 3000),
      lazy,
      sync,
      onClientCreate: callback("onClientCreate"),
      clientFactory: callback("clientFactory"),
      clientErrorFactory: callback("clientErrorFactory"),
      client: Object.freeze(client),
    };
  }

  /**
   * Creates the client, calls `onClientCreate`, connects (with retries, or in the background with
   * `lazyConnection`) and returns what `clientFactory` returns.
   *
   * @param uri - The connection string.
   * @param name - The client name.
   * @param options - The checked options.
   * @returns The client to provide.
   * @throws {ConfigurationError} When the client options are invalid, or `clientFactory` returns something else
   *   than a `TypemoClient`.
   * @throws The error of the last try (through `clientErrorFactory`) when no try connected.
   */
  static async create(uri: string, name: string, options: ResolvedConnectOptions): Promise<TypemoClient> {
    if (typeof uri !== "string" || uri === "") {
      throw new ConfigurationError(`TypemoModule: the connection string of client "${name}" is a non-empty string`);
    }
    const client = new TypemoClient(uri, { ...options.client, name });
    try {
      await options.onClientCreate?.(client);
      if (options.lazy) {
        ClientConnector.connect(client, options).catch((error: unknown) => {
          if (client.state === "closed") return;
          ClientConnector.logger.error(
            `Client "${name}" could not connect after ${options.attempts} ${options.attempts === 1 ? "try" : "tries"} (${ClientConnector.describe(error)}); its operations fail until it connects`,
          );
        });
      } else {
        try {
          await ClientConnector.connect(client, options);
        } catch (error) {
          throw options.clientErrorFactory === undefined ? error : options.clientErrorFactory(error);
        }
      }
      const provided = options.clientFactory === undefined ? client : await options.clientFactory(client);
      if (!(provided instanceof TypemoClient)) {
        throw new ConfigurationError(`TypemoModule: clientFactory of client "${name}" returned no TypemoClient`);
      }
      return provided;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  /**
   * Connects with retries: a retryable failure (no server, network) is tried again after `delay`, up to `attempts`
   * tries; a failure a retry cannot fix (wrong credentials, a configuration error) and a closed client stop at once.
   *
   * @param client - The client.
   * @param options - The tries and the pause.
   * @returns Resolves when connected.
   * @throws The error of the last try.
   */
  static async connect(client: TypemoClient, options: ResolvedConnectOptions): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await client.connect();
        return;
      } catch (error) {
        const last = attempt >= options.attempts || client.state === "closed" || !ErrorClassifier.isRetryable(error);
        if (last) throw error;
        ClientConnector.logger.error(
          `Unable to connect client "${client.name}" (${ClientConnector.describe(error)}). Retrying (${attempt})...`,
        );
        await ClientConnector.pause(client, options.delay);
      }
    }
  }

  /**
   * The error for the log: its class and, for a connection error, why it failed; never the message, which may hold
   * the connection string's hosts.
   *
   * @param error - The error.
   * @returns A short description.
   */
  static describe(error: unknown): string {
    if (error instanceof ConnectionError) return `${error.name}: ${error.failure}`;
    return error instanceof Error ? error.name : typeof error;
  }

  /**
   * Waits between two tries; ends early when the client is closed (the application stopped during the retries).
   *
   * @param client - The client.
   * @param ms - The pause.
   * @returns Resolves after the pause or at the close.
   */
  static pause(client: TypemoClient, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let stop = (): unknown => undefined;
      const finish = (): void => {
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(finish, ms);
      stop = client.onStateChange((state) => {
        if (state === "closed") finish();
      });
    });
  }
}
