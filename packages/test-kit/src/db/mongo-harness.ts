import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * Which MongoDB release line to boot for tests. See VERSIONS.md.
 *
 * @example
 * ```ts
 * const channel: TypemoMongoChannel = "stable";
 * ```
 */
export type TypemoMongoChannel = "upcoming" | "stable";

/*
 * Keep in sync with VERSIONS.md. That file is the source of truth; these are
 * only the values `MongoHarness` currently boots.
 */

/** Version booted on the `upcoming` channel. */
const UPCOMING_VERSION = "9.0.0-rc0";
/** Version booted on the `stable` channel and used as the fallback. */
const STABLE_VERSION = "8.3.11";

/** Upper bound for starting a mongod. */
const START_TIMEOUT_MS = 180_000;

/**
 * What `MongoHarness` actually started.
 *
 * @example
 * ```ts
 * const { resolvedVersion, fellBackToStable }: MongoHarnessStatus = MongoHarness.getStatus();
 * ```
 */
export interface MongoHarnessStatus {
  /** The requested channel. */
  readonly channel: TypemoMongoChannel;
  /** The version of the requested channel. */
  readonly requestedVersion: string;
  /** The version that is really running. */
  readonly resolvedVersion: string;
  /** `true` when the upcoming release could not start and the stable one runs instead. */
  readonly fellBackToStable: boolean;
}

/**
 * Boots a single `MongoMemoryReplSet` (one node — a replica set is required
 * for transactions and change streams even with a single member) shared by
 * an entire `bun test` process. Callers get isolation via a unique database
 * name per test file (see `MongoLifecycle.useMongo`), not a separate mongod.
 *
 * The version is picked from VERSIONS.md — `upcoming` by
 * default, `stable` via `TYPEMO_MONGO=stable`. If `upcoming` cannot start on
 * this platform, we fall back to `stable` and say so loudly (never silently).
 */
export class MongoHarness {
  /** The running replica set, once started. */
  static #replSet: MongoMemoryReplSet | undefined;
  /** The in-flight start, shared by concurrent callers. */
  static #startPromise: Promise<MongoMemoryReplSet> | undefined;
  /** What was started. */
  static #status: MongoHarnessStatus | undefined;

  /**
   * The channel selected by the `TYPEMO_MONGO` environment variable.
   *
   * @returns `stable` when the variable says so, otherwise `upcoming`.
   */
  static resolveChannel(): TypemoMongoChannel {
    return process.env.TYPEMO_MONGO === "stable" ? "stable" : "upcoming";
  }

  /**
   * The mongod version of a channel.
   *
   * @param channel - The channel; defaults to the one from the environment.
   * @returns The version string passed to the server downloader.
   */
  static resolveVersion(channel: TypemoMongoChannel = MongoHarness.resolveChannel()): string {
    return channel === "stable" ? STABLE_VERSION : UPCOMING_VERSION;
  }

  /**
   * Starts the shared mongod. Idempotent: the first caller starts it, later callers await the same instance.
   *
   * @returns The running replica set.
   * @throws Error - When neither the requested version nor the stable fallback can start.
   */
  static async ensureStarted(): Promise<MongoMemoryReplSet> {
    if (MongoHarness.#replSet) {
      return MongoHarness.#replSet;
    }
    if (!MongoHarness.#startPromise) {
      MongoHarness.#startPromise = MongoHarness.#start();
    }
    return MongoHarness.#startPromise;
  }

  /**
   * Boots the requested version, falling back to stable with a warning.
   *
   * @returns The running replica set.
   * @throws Error - When the stable channel fails, or the fallback fails too.
   */
  static async #start(): Promise<MongoMemoryReplSet> {
    const channel = MongoHarness.resolveChannel();
    const requestedVersion = MongoHarness.resolveVersion(channel);
    let fellBackToStable = false;
    let resolvedVersion = requestedVersion;
    let replSet: MongoMemoryReplSet;

    try {
      replSet = await MongoHarness.#boot(requestedVersion);
    } catch (error) {
      if (channel === "stable") {
        /* Already the fallback channel — nothing left to fall back to. */
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      /* Do not hide this: the upcoming release is unavailable or refused to start on this platform. */
      console.warn(
        `[MongoHarness] upcoming MongoDB ${requestedVersion} failed to start (${reason}). ` +
          `Falling back to stable ${STABLE_VERSION}.`,
      );
      fellBackToStable = true;
      resolvedVersion = STABLE_VERSION;
      replSet = await MongoHarness.#boot(STABLE_VERSION);
    }

    MongoHarness.#replSet = replSet;
    MongoHarness.#status = { channel, requestedVersion, resolvedVersion, fellBackToStable };
    return replSet;
  }

  /**
   * Starts a one-node replica set of the given version.
   *
   * @param version - The mongod version.
   * @returns The running replica set.
   * @throws Error - When the server does not start in time.
   */
  static async #boot(version: string): Promise<MongoMemoryReplSet> {
    const replSet = new MongoMemoryReplSet({
      binary: { version },
      replSet: {
        count: 1,
        storageEngine: "wiredTiger",
        /* `configureFailPoint` (failCommand) requires test commands to be
           enabled. mongodb-memory-server does NOT set this on its own
           (no reference to "enableTestCommands" in mongodb-memory-server-core@11.3.0),
           so it must be requested explicitly. */
        args: ["--setParameter", "enableTestCommands=1"],
      },
    });
    await MongoHarness.#withTimeout(replSet.start(), START_TIMEOUT_MS, `mongod ${version} start()`);
    await MongoHarness.#withTimeout(
      replSet.waitUntilRunning(),
      START_TIMEOUT_MS,
      `mongod ${version} waitUntilRunning()`,
    );
    return replSet;
  }

  /**
   * Rejects when a promise does not settle in time.
   *
   * @param promise - The operation to wait for.
   * @param ms - The time limit in milliseconds.
   * @param label - Names the operation in the timeout message.
   * @returns The promise result.
   * @throws Error - On timeout, or with the original rejection.
   */
  static #withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms waiting for: ${label}`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  /**
   * The connection string of the shared replica set.
   *
   * @returns The URI.
   * @throws Error - When the harness is not started.
   */
  static getUri(): string {
    const replSet = MongoHarness.#replSet;
    if (!replSet) {
      throw new Error("MongoHarness is not started yet — call ensureStarted() first");
    }
    return replSet.getUri();
  }

  /**
   * What was started (channel, versions, fallback).
   *
   * @returns The status.
   * @throws Error - When the harness is not started.
   */
  static getStatus(): MongoHarnessStatus {
    if (!MongoHarness.#status) {
      throw new Error("MongoHarness is not started yet — call ensureStarted() first");
    }
    return MongoHarness.#status;
  }

  /**
   * Tells whether the shared mongod is running.
   *
   * @returns `true` after a successful `ensureStarted()` and before `stop()`.
   */
  static isStarted(): boolean {
    return MongoHarness.#replSet !== undefined;
  }

  /**
   * Stops the shared mongod. Safe to call even if never started.
   *
   * @returns Resolves when the server has stopped.
   */
  static async stop(): Promise<void> {
    const replSet = MongoHarness.#replSet;
    MongoHarness.#replSet = undefined;
    MongoHarness.#startPromise = undefined;
    MongoHarness.#status = undefined;
    if (replSet) {
      await replSet.stop();
    }
  }
}
