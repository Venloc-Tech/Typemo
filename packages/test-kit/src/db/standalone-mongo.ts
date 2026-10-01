import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoHarness } from "./mongo-harness.ts";

/**
 * A STANDALONE `mongod` (not a replica set) of the same version as the shared harness, for the tests of what a
 * standalone server cannot do, such as the error raised when a transaction is unavailable. Started per test file
 * and stopped by the caller; the shared replica set of `MongoHarness` is untouched.
 *
 * @example
 * ```ts
 * const standalone = await StandaloneMongo.start();
 * const client = new MongoClient(standalone.uri);
 * // ...
 * await client.close();
 * await standalone.stop();
 * ```
 */
export class StandaloneMongo {
  readonly #server: MongoMemoryServer;

  /**
   * @param server - The started in-memory server.
   */
  private constructor(server: MongoMemoryServer) {
    this.#server = server;
  }

  /**
   * Starts a standalone mongod of the channel's version (`upcoming`, or `stable` with `TYPEMO_MONGO=stable`).
   *
   * @returns The running server wrapper.
   */
  static async start(): Promise<StandaloneMongo> {
    const server = await MongoMemoryServer.create({ binary: { version: MongoHarness.resolveVersion() } });
    return new StandaloneMongo(server);
  }

  /** The connection string (no `replicaSet`). */
  get uri(): string {
    return this.#server.getUri();
  }

  /** Stops the server and removes its data. */
  async stop(): Promise<void> {
    await this.#server.stop();
  }
}
