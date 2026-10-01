/*
 * What the `forFeature` providers of one client registered: the connections they use (the start-up `sync` runs on
 * them) and, per connection, what each class is there — a model, a view or a materialized result. One class is one
 * of them on a connection: the same class as a model in one module and as a view in another would give two different
 * objects for one collection, and the providers would hide the difference until a write reached a view.
 */
import { ConfigurationError, type Connection, type EntityClass } from "@venloc/typemo";

/**
 * What a class is on a connection.
 *
 * @example
 * ```ts
 * const kind: FeatureKind = "view";
 * ```
 */
export type FeatureKind = "model" | "view" | "materialized";

/**
 * The registry of one client in one application (a provider of the client's core module).
 *
 * @example
 * ```ts fragment
 * registry.register(client.connection, Account, "model");
 * ```
 */
export class FeatureRegistry {
  /** The client name, for the messages. */
  readonly client: string;
  readonly #kinds = new Map<Connection, Map<EntityClass, FeatureKind>>();

  /**
   * @param client - The client name.
   */
  constructor(client: string) {
    this.client = client;
  }

  /**
   * Records a class on a connection.
   *
   * @param connection - The connection of the feature.
   * @param entity - The class.
   * @param kind - What it is there.
   * @throws {ConfigurationError} When the class is registered on that connection as something else.
   */
  register(connection: Connection, entity: EntityClass, kind: FeatureKind): void {
    let kinds = this.#kinds.get(connection);
    if (kinds === undefined) {
      kinds = new Map();
      this.#kinds.set(connection, kinds);
    }
    const existing = kinds.get(entity);
    if (existing !== undefined && existing !== kind) {
      throw new ConfigurationError(
        `TypemoModule.forFeature: ${entity.name} is registered as a ${existing} and as a ${kind} on database "${connection.name}" of client "${this.client}"; a class is one of them`,
      );
    }
    kinds.set(entity, kind);
  }

  /** The connections the features use, in the order they were first used. */
  get connections(): readonly Connection[] {
    return [...this.#kinds.keys()];
  }
}
