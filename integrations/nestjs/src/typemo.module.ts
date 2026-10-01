/*
 * The module applications import: `forRoot`/`forRootAsync` create a client (a global module per client), `forFeature`
 * provides the models of a module's entities by class, on a client and a database. A model provider calls
 * `connection.model(Entity)`, which returns the same object for the same class on the same connection, so the same
 * entity in two modules is one model; discriminators are resolved by the core (a child alone compiles its base on
 * the same collection).
 */
import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { ConfigurationError, type EntityClass, type TypemoClient } from "@venloc/typemo";
import { Features, type TypemoFeature } from "./feature.ts";
import type { FeatureRegistry } from "./feature-registry.ts";
import type { TypemoModuleAsyncOptions, TypemoModuleOptions } from "./options.ts";
import {
  DEFAULT_CLIENT,
  type FeatureTarget,
  getClientToken,
  getConnectionToken,
  getModelToken,
  getRegistryToken,
} from "./tokens.ts";
import { TypemoCoreModule } from "./typemo-core.module.ts";

/**
 * The Typemo module of a Nest application.
 *
 * @example
 * ```ts
 * @Schema({ collection: "accounts" })
 * class Account extends Entity {}
 *
 * @Module({
 *   imports: [TypemoModule.forRoot("mongodb://localhost:27017/app"), TypemoModule.forFeature([Account])],
 * })
 * class AppModule {}
 * ```
 */
@Module({})
export class TypemoModule {
  /**
   * Creates a client, connects it when the application starts (with retries) and closes it when it shuts down.
   * The client, the connection of its default database and the models of `forFeature` are available in the whole
   * application.
   *
   * @param uri - The connection string.
   * @param options - The client options (`name`, `dbName`, the driver's) and the module's (`retryAttempts`,
   *   `retryDelay`, `lazyConnection`, `sync`, `onClientCreate`, `clientFactory`, `clientErrorFactory`).
   * @returns The module to import.
   * @throws {ConfigurationError} When an option is invalid.
   */
  static forRoot(uri: string, options: TypemoModuleOptions = {}): DynamicModule {
    return { module: TypemoModule, imports: [TypemoCoreModule.forRoot(uri, options)] };
  }

  /**
   * Like {@link TypemoModule.forRoot}, with the options made when the application starts (`useFactory` with
   * `inject`, `useClass` or `useExisting`). The client is named by `name` here, never in what the factory returns.
   *
   * @param options - The client name, the imports and the options source.
   * @returns The module to import.
   * @throws {ConfigurationError} When not exactly one source is given or the name is invalid; at start, when the
   *   result has `name` or no `uri`.
   */
  static forRootAsync(options: TypemoModuleAsyncOptions): DynamicModule {
    return { module: TypemoModule, imports: [TypemoCoreModule.forRootAsync(options)] };
  }

  /**
   * Provides the models (and views, and materialized results) of entities to the module that imports it, under
   * `getModelToken(Entity, target)`: inject them with `@InjectModel(Entity, target)`.
   *
   * @param features - Entity classes, `{ entity, statics }`, `TypemoModule.view(...)`, `TypemoModule.materialized(...)`.
   * @param target - The client (`"default"`) and the database (the client's default) of every entry.
   * @returns The module to import.
   * @throws {ConfigurationError} When an entry is invalid or a class is listed twice.
   */
  static forFeature(features: readonly TypemoFeature[], target: FeatureTarget = {}): DynamicModule {
    if (!Array.isArray(features)) throw new ConfigurationError("TypemoModule.forFeature: a list of entities");
    const client = target.client ?? DEFAULT_CLIENT;
    const db = target.db;
    const clientToken = getClientToken(client);
    const registryToken = getRegistryToken(client);
    const seen = new Set<EntityClass>();
    const providers: Provider[] = features.map((feature) => {
      const entry = Features.normalize(feature);
      if (seen.has(entry.entity)) {
        throw new ConfigurationError(`TypemoModule.forFeature: ${entry.entity.name} is listed twice`);
      }
      seen.add(entry.entity);
      return {
        provide: getModelToken(entry.entity, target),
        useFactory: (typemo: TypemoClient, registry: FeatureRegistry) => {
          const connection = db === undefined ? typemo.connection : typemo.db(db);
          registry.register(connection, entry.entity, entry.kind);
          return entry.create(connection);
        },
        inject: [clientToken, registryToken],
      };
    });
    if (db !== undefined) {
      providers.push({
        provide: getConnectionToken(target),
        useFactory: (typemo: TypemoClient) => typemo.db(db),
        inject: [clientToken],
      });
    }
    return {
      module: TypemoModule,
      providers,
      exports: providers.map((provider) => (provider as { readonly provide: string | symbol }).provide),
    };
  }

  /** A view entry of `forFeature`; see {@link Features.view}. */
  static readonly view = Features.view;

  /** A materialized result entry of `forFeature`; see {@link Features.materialized}. */
  static readonly materialized = Features.materialized;
}
