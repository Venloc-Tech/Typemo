/*
 * The global module of one client (one per `forRoot`/`forRootAsync`): it provides the client, the connection of its
 * default database and the feature registry to the whole application, runs the start-up sync after every module is
 * initialized (`onApplicationBootstrap`: by then every `forFeature` provider has registered its model), and closes
 * the client when the application shuts down.
 */
import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
} from "@nestjs/common";
import { ModulesContainer } from "@nestjs/core";
import { ConfigurationError, type TypemoClient } from "@venloc/typemo";
import { ClientConnector, type ResolvedConnectOptions } from "./client-connector.ts";
import { ClientLifecycle } from "./client-lifecycle.ts";
import { FeatureRegistry } from "./feature-registry.ts";
import type {
  TypemoModuleAsyncOptions,
  TypemoModuleFactoryOptions,
  TypemoModuleOptions,
  TypemoOptionsFactory,
} from "./options.ts";
import { DEFAULT_CLIENT, getClientToken, getConnectionToken, getRegistryToken } from "./tokens.ts";
import { TransactionalBinder } from "./transactional-binder.ts";

/** The checked options of one client (a provider local to its core module). */
const CORE_OPTIONS = Symbol("TypemoCoreOptions");
/** What a `forRootAsync` factory returned, before the checks (local). */
const ASYNC_RESULT = Symbol("TypemoAsyncResult");
/** The client's lifecycle (local). */
const LIFECYCLE = Symbol("TypemoLifecycle");

/**
 * The options of one client after the checks.
 *
 * @example
 * ```ts fragment
 * const options: CoreOptions = { uri: "mongodb://localhost:27017", resolved };
 * ```
 */
export interface CoreOptions {
  /** The connection string. */
  readonly uri: string;
  /** The checked module and client options. */
  readonly resolved: ResolvedConnectOptions;
}

/**
 * The global module of one client. Applications import `TypemoModule.forRoot` or `forRootAsync`, which import it.
 *
 * @example
 * ```ts fragment
 * imports: [TypemoModule.forRoot("mongodb://localhost:27017/app")];
 * ```
 */
@Global()
@Module({})
export class TypemoCoreModule implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly #lifecycle: ClientLifecycle;

  /**
   * @param lifecycle - The client of this module.
   */
  constructor(@Inject(LIFECYCLE) lifecycle: ClientLifecycle) {
    this.#lifecycle = lifecycle;
  }

  /**
   * The module of a client with options known now.
   *
   * @param uri - The connection string.
   * @param options - The module and client options.
   * @returns The dynamic module.
   * @throws {ConfigurationError} When an option is invalid.
   */
  static forRoot(uri: string, options: TypemoModuleOptions = {}): DynamicModule {
    const name = options.name ?? DEFAULT_CLIENT;
    getClientToken(name);
    if (typeof uri !== "string" || uri === "") {
      throw new ConfigurationError("TypemoModule.forRoot: the connection string is a non-empty string");
    }
    const core: CoreOptions = { uri, resolved: ClientConnector.resolve(options, "TypemoModule.forRoot") };
    return TypemoCoreModule.build(name, [{ provide: CORE_OPTIONS, useValue: core }], []);
  }

  /**
   * The module of a client whose options are made at start by a factory, a class or an existing provider.
   *
   * @param options - The client name, the imports and one of `useFactory`, `useClass`, `useExisting`.
   * @returns The dynamic module.
   * @throws {ConfigurationError} When not exactly one form is given or the name is invalid.
   */
  static forRootAsync(options: TypemoModuleAsyncOptions): DynamicModule {
    const name = options.name ?? DEFAULT_CLIENT;
    getClientToken(name);
    const forms = (["useFactory", "useClass", "useExisting"] as const).filter((key) => options[key] !== undefined);
    if (forms.length !== 1) {
      throw new ConfigurationError(
        `TypemoModule.forRootAsync: give one of useFactory, useClass, useExisting (got ${forms.length === 0 ? "none" : forms.join(", ")})`,
      );
    }
    const form = forms[0] as "useFactory" | "useClass" | "useExisting";
    const check = (raw: unknown): CoreOptions => TypemoCoreModule.checkAsync(raw, form);
    const providers: Provider[] = [];
    if (options.useFactory !== undefined) {
      const factory = options.useFactory as (...args: unknown[]) => unknown;
      providers.push({
        provide: ASYNC_RESULT,
        useFactory: async (...args: unknown[]) => factory(...args),
        inject: [...(options.inject ?? [])],
      });
    } else {
      const type = (options.useClass ?? options.useExisting) as NonNullable<TypemoModuleAsyncOptions["useClass"]>;
      if (options.useClass !== undefined) providers.push({ provide: type, useClass: type });
      providers.push({
        provide: ASYNC_RESULT,
        useFactory: async (factory: TypemoOptionsFactory) => factory.createTypemoOptions(),
        inject: [type],
      });
    }
    providers.push({ provide: CORE_OPTIONS, useFactory: check, inject: [ASYNC_RESULT] });
    return TypemoCoreModule.build(name, providers, [...(options.imports ?? [])]);
  }

  /**
   * Checks what a `forRootAsync` form returned.
   *
   * @param raw - The result.
   * @param form - `useFactory`, `useClass` or `useExisting`, for the messages.
   * @returns The checked options.
   * @throws {ConfigurationError} When the result is not an object, has `name` or has no `uri`.
   */
  private static checkAsync(raw: unknown, form: string): CoreOptions {
    const where = `TypemoModule.forRootAsync (${form})`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new ConfigurationError(`${where}: the options are an object with uri`);
    }
    const result = raw as Partial<TypemoModuleFactoryOptions> & Readonly<Record<string, unknown>>;
    if ("name" in result) {
      throw new ConfigurationError(
        `${where}: the result has "name"; name the client next to ${form}: forRootAsync({ name, ${form} })`,
      );
    }
    if (typeof result.uri !== "string" || result.uri === "") {
      throw new ConfigurationError(`${where}: uri is a non-empty connection string`);
    }
    return { uri: result.uri, resolved: ClientConnector.resolve(result, where) };
  }

  /**
   * The dynamic module of a client.
   *
   * @param name - The client name.
   * @param optionProviders - The providers that make `CORE_OPTIONS`.
   * @param imports - The modules the option providers need.
   * @returns The module.
   */
  private static build(
    name: string,
    optionProviders: Provider[],
    imports: NonNullable<DynamicModule["imports"]>,
  ): DynamicModule {
    const clientToken = getClientToken(name);
    const registryToken = getRegistryToken(name);
    const providers: Provider[] = [
      ...optionProviders,
      {
        provide: clientToken,
        useFactory: (core: CoreOptions) => ClientConnector.create(core.uri, name, core.resolved),
        inject: [CORE_OPTIONS],
      },
      {
        provide: getConnectionToken({ client: name }),
        useFactory: (client: TypemoClient) => client.connection,
        inject: [clientToken],
      },
      { provide: registryToken, useFactory: () => new FeatureRegistry(name) },
      {
        provide: LIFECYCLE,
        useFactory: async (
          client: TypemoClient,
          registry: FeatureRegistry,
          core: CoreOptions,
          modules: ModulesContainer,
        ) => {
          try {
            return new ClientLifecycle(name, client, registry, core.resolved.sync, modules);
          } catch (error) {
            await client.close();
            throw error;
          }
        },
        inject: [clientToken, registryToken, CORE_OPTIONS, ModulesContainer],
      },
      TransactionalBinder,
    ];
    return {
      module: TypemoCoreModule,
      imports,
      providers,
      exports: [clientToken, getConnectionToken({ client: name }), registryToken],
    };
  }

  /** Runs the start-up sync of the client. */
  async onApplicationBootstrap(): Promise<void> {
    await this.#lifecycle.sync();
  }

  /** Closes the client. */
  async onApplicationShutdown(): Promise<void> {
    await this.#lifecycle.close();
  }
}
