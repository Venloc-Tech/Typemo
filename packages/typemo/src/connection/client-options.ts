import type { MongoClientOptions } from "mongodb";
import { BsonOptions, type CompatibleBsonOptions } from "../bson/bson-options.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";

/**
 * Driver options Typemo does not accept: the old timeouts, which the client-side operation timeout
 * (`timeoutMS`) replaces.
 *
 * @example
 * ```ts
 * const bad: LegacyTimeoutOption = "socketTimeoutMS"; // rejected by `new TypemoClient(...)`
 * ```
 */
export type LegacyTimeoutOption = "socketTimeoutMS" | "waitQueueTimeoutMS" | "wtimeoutMS";

const LEGACY_TIMEOUTS: readonly LegacyTimeoutOption[] = ["socketTimeoutMS", "waitQueueTimeoutMS", "wtimeoutMS"];

/**
 * Typemo's own client options (the ones the driver does not know).
 *
 * @example
 * ```ts
 * const own: TypemoOwnOptions = { name: "main", readyTimeoutMS: 5_000, dbName: "app" };
 * ```
 */
export interface TypemoOwnOptions {
  /**
   * How long an operation issued before `connect()` waits for the connection when it has no `timeoutMS` of
   * its own. Default 10 000 ms. `0` waits without a limit.
   */
  readonly readyTimeoutMS?: number;
  /** The client's name in instrumentation events. Default `"default"`. */
  readonly name?: string;
  /**
   * The default database of `client.connection`. Default: the database of the connection string, else
   * `"test"` (the driver's). A different database in the connection string is a conflict (error).
   */
  readonly dbName?: string;
  /**
   * Signs the keyset tokens (`keysetPage` `nextCursor`) with HMAC-SHA256, so a client can neither forge nor
   * edit a position. Off by default (the token is a position, not a permission: the query's filter still
   * applies to every page). A key of at least 32 bytes (a string is taken as UTF-8); a list rotates keys — the
   * first signs, every one verifies. With a key set, an unsigned or wrongly signed token is a
   * `KeysetTokenError`.
   */
  readonly keysetSecret?: string | Uint8Array | readonly (string | Uint8Array)[];
  /**
   * Strict reading: every document a query reads (`find`, `findOne`, `findById`, `findOneAnd*`, populated
   * documents; every result form) is checked against the schema before it becomes a result, and a stored value of
   * another type is a `CastError` with its path. Off by default: the check walks every document read, and data
   * written through Typemo already has the declared types. `true` checks always; `"development"` checks unless
   * `process.env.NODE_ENV` is `"production"` (read once, when the client is created). A query overrides the
   * setting with `.validateReads(enabled)`.
   */
  readonly validateReads?: boolean | "development";
}

/**
 * The options of a `TypemoClient`: the driver's `MongoClientOptions` (without the old timeouts) plus
 * Typemo's own.
 *
 * @example
 * ```ts
 * const options: TypemoClientOptions = { name: "main", timeoutMS: 30_000, maxPoolSize: 20 };
 * ```
 */
export type TypemoClientOptions = Omit<MongoClientOptions, LegacyTimeoutOption> & TypemoOwnOptions;

/**
 * The options after validation: what goes to the driver, and Typemo's own.
 *
 * @example
 * ```ts
 * const resolved: ResolvedClientOptions = client.options;
 * resolved.dbName; // "app"
 * ```
 */
export interface ResolvedClientOptions {
  /** The options passed to the driver (frozen, BSON options applied). */
  readonly driver: MongoClientOptions;
  /** How long an operation waits for the connection before `connect()` finished. */
  readonly readyTimeoutMS: number;
  /** The client's name in instrumentation events. */
  readonly name: string;
  /** The default database: `dbName`, else the URI's, else `"test"` (the driver's default). */
  readonly dbName: string;
  /** The keyset signing keys (copies; the first signs), empty when tokens are not signed. */
  readonly keysetSecrets: readonly Uint8Array[];
  /** Whether queries check the documents they read against the schema (`validateReads`, resolved). */
  readonly validateReads: boolean;
}

/** The shortest HMAC key accepted: 256 bits, the size of the SHA-256 output. */
const MIN_KEYSET_SECRET_BYTES = 32;

/**
 * Copies the keyset keys into byte arrays (the input is never kept or mutated).
 *
 * @param value - The `keysetSecret` option.
 * @returns The frozen list of keys, empty when the option is absent.
 * @throws {ConfigurationError} When the list is empty or a key is not a string / `Uint8Array` or is too short.
 */
const keysetSecrets = (value: TypemoOwnOptions["keysetSecret"]): readonly Uint8Array[] => {
  if (value === undefined) return Object.freeze([]);
  const list = Array.isArray(value) ? (value as readonly unknown[]) : [value];
  if (list.length === 0) throw new ConfigurationError("TypemoClient: keysetSecret is an empty list");
  return Object.freeze(
    list.map((secret, index) => {
      const bytes =
        typeof secret === "string"
          ? new TextEncoder().encode(secret)
          : secret instanceof Uint8Array
            ? new Uint8Array(secret)
            : undefined;
      if (bytes === undefined) {
        throw new ConfigurationError(`TypemoClient: keysetSecret[${index}] must be a string or a Uint8Array`);
      }
      if (bytes.byteLength < MIN_KEYSET_SECRET_BYTES) {
        throw new ConfigurationError(
          `TypemoClient: keysetSecret[${index}] is ${bytes.byteLength} bytes; an HMAC key needs at least ${MIN_KEYSET_SECRET_BYTES}`,
        );
      }
      return bytes;
    }),
  );
};

/**
 * Resolves the `validateReads` option.
 *
 * @param value - The option.
 * @returns Whether queries check what they read.
 * @throws {ConfigurationError} When the value is not `true`, `false` or `"development"`.
 */
const validateReads = (value: unknown): boolean => {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  if (value === "development") return globalThis.process?.env?.NODE_ENV !== "production";
  throw new ConfigurationError(
    `TypemoClient: validateReads must be true, false or "development", got ${typeof value === "string" ? `"${value}"` : String(value)}`,
  );
};

/** The default wait for the connection, in milliseconds. */
const DEFAULT_READY_TIMEOUT_MS = 10_000;

/**
 * Extracts the database of a connection string (`mongodb://host/db?…` gives `db`).
 *
 * @param uri - The connection string.
 * @returns The database name, `undefined` when the string names none.
 */
const uriDatabase = (uri: string): string | undefined => {
  const match = /^mongodb(?:\+srv)?:\/\/[^/?]*\/([^?]*)/.exec(uri);
  const name = match?.[1];
  return name === undefined || name === "" ? undefined : decodeURIComponent(name);
};

/**
 * Checks that a value is a non-negative integer.
 *
 * @param value - The value to check.
 * @param name - The option name, used in the error message.
 * @returns The value.
 * @throws {ConfigurationError} When the value is not a non-negative integer.
 */
const nonNegativeInteger = (value: unknown, name: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ConfigurationError(`TypemoClient: ${name} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
};

/** Validation of client options. */
export class ClientOptions {
  /**
   * Validates the options and splits them into the driver's and Typemo's. Never mutates the input.
   *
   * @param uri - The connection string (`mongodb://` or `mongodb+srv://`).
   * @param options - The client options.
   * @returns The frozen, validated options.
   * @throws {ConfigurationError} On a conflict: a BSON option against Typemo's fixed ones, a `dbName`
   *   different from the URI's database, a legacy timeout option, a negative timeout, a bad `name` or `validateReads`.
   */
  static resolve(uri: string, options: TypemoClientOptions = {}): ResolvedClientOptions {
    if (typeof uri !== "string" || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
      throw new ConfigurationError(
        "TypemoClient: the first argument is a connection string (mongodb:// or mongodb+srv://)",
      );
    }
    for (const legacy of LEGACY_TIMEOUTS) {
      if (Object.hasOwn(options, legacy) || new RegExp(`[?&]${legacy}=`, "i").test(uri)) {
        throw new ConfigurationError(
          `TypemoClient: ${legacy} is not supported; use timeoutMS (client-side operation timeout)`,
        );
      }
    }
    const { readyTimeoutMS, name, dbName, keysetSecret, validateReads: reads, ...driver } = options;
    const fromUri = uriDatabase(uri);
    if (dbName !== undefined && (typeof dbName !== "string" || dbName === "")) {
      throw new ConfigurationError("TypemoClient: dbName must be a non-empty string");
    }
    if (dbName !== undefined && fromUri !== undefined && dbName !== fromUri) {
      throw new ConfigurationError(
        `TypemoClient: dbName "${dbName}" conflicts with the database "${fromUri}" of the connection string`,
      );
    }
    if (driver.timeoutMS !== undefined) nonNegativeInteger(driver.timeoutMS, "timeoutMS");
    if (name !== undefined && (typeof name !== "string" || name === "")) {
      throw new ConfigurationError("TypemoClient: name must be a non-empty string");
    }
    /* The conditional type of `apply` reports conflicts at compile time; here the value is already typed. */
    const withBson = BsonOptions.apply(driver as CompatibleBsonOptions<MongoClientOptions>);
    return Object.freeze({
      driver: Object.freeze(withBson as MongoClientOptions),
      readyTimeoutMS:
        readyTimeoutMS === undefined ? DEFAULT_READY_TIMEOUT_MS : nonNegativeInteger(readyTimeoutMS, "readyTimeoutMS"),
      name: name ?? "default",
      dbName: dbName ?? fromUri ?? "test",
      keysetSecrets: keysetSecrets(keysetSecret),
      validateReads: validateReads(reads),
    });
  }
}
