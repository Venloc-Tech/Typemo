/*
 * A `TypemoClient` per test file on the shared mongod (test-kit `MongoLifecycle` gives the database,
 * its cleanup and a raw driver client for assertions; this adds the Typemo client on the same database).
 */
import { afterAll, beforeAll } from "bun:test";
import { CommandRecorder, MongoHarness, MongoLifecycle, type MongoTestContext } from "@venloc/typemo-test-kit";
import { BsonOptions, type Connection, TypemoClient, type TypemoClientOptions } from "../../../src/index.ts";

/**
 * What a test file gets from `ModelLifecycle.useTypemo`. The client and connection exist only inside tests
 * and hooks (they are created in `beforeAll`).
 */
export interface TypemoTestContext {
  /** The raw driver side (assertions, seeding, failpoints). */
  readonly mongo: MongoTestContext;
  readonly client: TypemoClient;
  /** The connection to the test database. */
  readonly connection: Connection;
  /** Records the commands the TYPEMO client sends (attached for the whole file; `clear()` per test). */
  readonly commands: CommandRecorder;
}

/** Wires a Typemo client for the current test file. */
export class ModelLifecycle {
  /**
   * Registers the hooks that create and close a Typemo client for the current test file.
   *
   * @param prefix - the prefix of the test database name
   * @param options - extra client options
   * @returns the context; its client, connection and command recorder are getters valid inside tests
   */
  static useTypemo(prefix: string, options: TypemoClientOptions = {}): TypemoTestContext {
    const mongo = MongoLifecycle.useMongo(prefix, BsonOptions.apply({}));
    let client: TypemoClient | undefined;
    let commands: CommandRecorder | undefined;
    beforeAll(async () => {
      client = new TypemoClient(MongoHarness.getUri(), { dbName: mongo.dbName, monitorCommands: true, ...options });
      commands = CommandRecorder.attach(client.unsafeDriver());
      await client.connect();
    });
    afterAll(async () => {
      commands?.detach();
      await client?.close();
    });
    /* Returns the value, or fails when it is read outside a test or a hook. */
    const need = <T>(value: T | undefined): T => {
      if (value === undefined) throw new Error("the Typemo client exists only inside tests and hooks");
      return value;
    };
    return {
      mongo,
      get client() {
        return need(client);
      },
      get connection() {
        return need(client).connection;
      },
      get commands() {
        return need(commands);
      },
    };
  }
}
