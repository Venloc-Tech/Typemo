/*
 * The life of one client in one application: the name is claimed once per application (two `forRoot` with the same
 * name would both provide `TypemoClient:<name>` and Nest would silently use one of them), the start-up `sync` runs
 * on the connections the features registered, and the client is closed when the application shuts down.
 */
import type { ModulesContainer } from "@nestjs/core";
import { ConfigurationError, type TypemoClient } from "@venloc/typemo";
import type { FeatureRegistry } from "./feature-registry.ts";
import type { TypemoSync } from "./options.ts";

/** The client names claimed per application (keyed by the application's module container). */
const CLAIMED = new WeakMap<ModulesContainer, Set<string>>();

/**
 * One client of one application (the core module holds it).
 *
 * @example
 * ```ts fragment
 * await lifecycle.sync();
 * await lifecycle.close();
 * ```
 */
export class ClientLifecycle {
  /** The client name. */
  readonly name: string;
  /** The provided client. */
  readonly client: TypemoClient;
  readonly #registry: FeatureRegistry;
  readonly #sync: TypemoSync;
  readonly #modules: ModulesContainer;

  /**
   * Claims the name in the application.
   *
   * @param name - The client name.
   * @param client - The provided client.
   * @param registry - The features of the client.
   * @param sync - The start-up sync.
   * @param modules - The application's modules.
   * @throws {ConfigurationError} When another `forRoot` of the application has the same name.
   */
  constructor(
    name: string,
    client: TypemoClient,
    registry: FeatureRegistry,
    sync: TypemoSync,
    modules: ModulesContainer,
  ) {
    let names = CLAIMED.get(modules);
    if (names === undefined) {
      names = new Set();
      CLAIMED.set(modules, names);
    }
    if (names.has(name)) {
      throw new ConfigurationError(
        `TypemoModule.forRoot: two clients named "${name}" in one application; give each forRoot its own name`,
      );
    }
    names.add(name);
    this.name = name;
    this.client = client;
    this.#registry = registry;
    this.#sync = sync;
    this.#modules = modules;
  }

  /**
   * Runs the start-up sync (`init` or `syncAll`) on every connection the features use; nothing with `sync: false`.
   *
   * @returns Resolves when every connection is done.
   * @throws {SyncError} The first connection's failure (the start stops).
   */
  async sync(): Promise<void> {
    if (this.#sync === false) return;
    for (const connection of this.#registry.connections) {
      if (this.#sync === "init") await connection.init();
      else await connection.syncAll();
    }
  }

  /**
   * Closes the client and releases the name.
   *
   * @returns Resolves when the client is closed.
   */
  async close(): Promise<void> {
    CLAIMED.get(this.#modules)?.delete(this.name);
    await this.client.close();
  }
}
