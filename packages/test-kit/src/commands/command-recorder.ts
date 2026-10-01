import type { CommandStartedEvent, Document, MongoClient } from "mongodb";

/**
 * One command as it was sent to the server.
 *
 * @example
 * ```ts
 * const [first]: readonly RecordedCommand[] = recorder.byName("find");
 * ```
 */
export interface RecordedCommand {
  /** The wire command name, e.g. `find`. */
  readonly commandName: string;
  /** The database the command ran on. */
  readonly databaseName: string;
  /** The collection the command targets, when it has one. */
  readonly collectionName: string | undefined;
  /** The raw command document exactly as sent to the server. */
  readonly command: Readonly<Document>;
  /** `command.filter` (find/count/distinct) or the first update's `q`, when present. */
  readonly filter: Readonly<Document> | undefined;
  /** The updates sent, each with its exact `q` (filter) and `u` (update document). */
  readonly updates: ReadonlyArray<{ readonly filter: Readonly<Document>; readonly update: unknown }>;
}

/**
 * Scope of `CommandRecorder.expectCommands`.
 *
 * @example
 * ```ts
 * recorder.expectCommands(["insert"], { collectionName: "users" });
 * ```
 */
export interface ExpectCommandsOptions {
  /** Keep only commands with this name. */
  readonly commandName?: string;
  /** Keep only commands on this collection. */
  readonly collectionName?: string;
}

/** Command fields whose string value is the collection name. */
const COLLECTION_BEARING_KEYS = [
  "find",
  "insert",
  "update",
  "delete",
  "aggregate",
  "findAndModify",
  "count",
  "distinct",
  "createIndexes",
  "dropIndexes",
  "drop",
  "listIndexes",
] as const;

/**
 * Records the exact wire commands a `MongoClient` sends, using the driver's
 * own command monitoring. The client passed in must have been
 * constructed with `{ monitorCommands: true }` — `MongoLifecycle.useMongo()`
 * already does this.
 */
export class CommandRecorder {
  /** Commands seen so far. */
  #records: RecordedCommand[] = [];
  /** The monitored client. */
  readonly #client: MongoClient;
  /** The listener; kept so `detach` can remove it. */
  readonly #onStarted: (event: CommandStartedEvent) => void;

  /**
   * @param client - The client to monitor.
   */
  private constructor(client: MongoClient) {
    this.#client = client;
    this.#onStarted = (event: CommandStartedEvent): void => {
      this.#records.push(CommandRecorder.#toRecordedCommand(event));
    };
    this.#client.on("commandStarted", this.#onStarted);
  }

  /**
   * Starts recording the commands of a client.
   *
   * @param client - A client created with `monitorCommands: true`.
   * @returns The recorder.
   */
  static attach(client: MongoClient): CommandRecorder {
    return new CommandRecorder(client);
  }

  /**
   * Converts a driver event to a record.
   *
   * @param event - The `commandStarted` event.
   * @returns The record.
   */
  static #toRecordedCommand(event: CommandStartedEvent): RecordedCommand {
    const command = event.command as Document;
    const collectionName = CommandRecorder.#collectionNameOf(command);
    const updates = Array.isArray(command.updates)
      ? (command.updates as Document[]).map((entry) => ({
          filter: (entry.q ?? {}) as Document,
          update: entry.u,
        }))
      : [];
    const filter =
      (command.filter as Document | undefined) ?? (command.query as Document | undefined) ?? updates[0]?.filter;

    return {
      commandName: event.commandName,
      databaseName: event.databaseName,
      collectionName,
      command,
      filter,
      updates,
    };
  }

  /**
   * Finds the collection a command targets.
   *
   * @param command - The command document.
   * @returns The collection name, or `undefined` for a database-level command.
   */
  static #collectionNameOf(command: Document): string | undefined {
    for (const key of COLLECTION_BEARING_KEYS) {
      const value = command[key];
      if (typeof value === "string") {
        return value;
      }
    }
    return undefined;
  }

  /** Detach the listener. Call this once the recorder is no longer needed (e.g. in `afterEach`). */
  detach(): void {
    this.#client.off("commandStarted", this.#onStarted);
  }

  /** Forgets the recorded commands. */
  clear(): void {
    this.#records = [];
  }

  /**
   * Every recorded command.
   *
   * @returns The records in send order.
   */
  all(): readonly RecordedCommand[] {
    return this.#records;
  }

  /**
   * Recorded commands with a given name.
   *
   * @param commandName - The wire command name.
   * @returns The matching records.
   */
  byName(commandName: string): readonly RecordedCommand[] {
    return this.#records.filter((record) => record.commandName === commandName);
  }

  /**
   * Recorded commands on a given collection.
   *
   * @param collectionName - The collection.
   * @returns The matching records.
   */
  byCollection(collectionName: string): readonly RecordedCommand[] {
    return this.#records.filter((record) => record.collectionName === collectionName);
  }

  /**
   * Asserts the exact sequence of command names (optionally scoped to a
   * collection) matches `expected`, in order.
   *
   * @param expected - The expected command names.
   * @param options - Optional scope by command or collection.
   * @throws Error - With a readable diff on mismatch.
   */
  expectCommands(expected: readonly string[], options: ExpectCommandsOptions = {}): void {
    const pool = options.collectionName ? this.byCollection(options.collectionName) : this.#records;
    const filtered = options.commandName ? pool.filter((r) => r.commandName === options.commandName) : pool;
    const actual = filtered.map((record) => record.commandName);
    const matches = actual.length === expected.length && actual.every((name, index) => name === expected[index]);
    if (!matches) {
      throw new Error(
        `expectCommands mismatch.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
      );
    }
  }
}
