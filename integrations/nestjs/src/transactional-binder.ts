/*
 * Binds the objects of one Nest application that have `@Transactional()` methods to that application's clients.
 * Per application, not per process: two applications in one process (tests) each find their own clients. A singleton
 * instance is bound itself; a request-scoped or transient class (its instances do not exist yet) through its
 * prototype. The binding is removed when the application shuts down.
 */
import { Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ModuleRef, ModulesContainer } from "@nestjs/core";
import { ConfigurationError, TypemoClient } from "@venloc/typemo";
import { getClientToken } from "./tokens.ts";
import { TransactionalMethods } from "./transactional.ts";

/**
 * The provider that binds `@Transactional()` methods to the clients of its application (the core module and
 * `provideClientMock` add it).
 *
 * @example
 * ```ts fragment
 * providers: [TransactionalBinder];
 * ```
 */
@Injectable()
export class TransactionalBinder implements OnModuleInit, OnApplicationShutdown {
  readonly #modules: ModulesContainer;
  readonly #moduleRef: ModuleRef;
  readonly #bound: object[] = [];
  // A field, not a method: it is stored in the bindings and called without `this`.
  readonly #resolve = (name: string): TypemoClient => {
    let client: unknown;
    try {
      client = this.#moduleRef.get(getClientToken(name), { strict: false });
    } catch (error) {
      throw new ConfigurationError(
        `@Transactional(): no TypemoClient named "${name}" in this application (TypemoModule.forRoot(uri, { name: "${name}" }))`,
        { cause: error },
      );
    }
    if (!(client instanceof TypemoClient) && typeof (client as { transaction?: unknown })?.transaction !== "function") {
      throw new ConfigurationError(`@Transactional(): the provider of client "${name}" has no transaction()`);
    }
    return client as TypemoClient;
  };

  /**
   * @param modules - The modules of the application.
   * @param moduleRef - Finds the clients.
   */
  constructor(modules: ModulesContainer, moduleRef: ModuleRef) {
    this.#modules = modules;
    this.#moduleRef = moduleRef;
  }

  /** Binds every object of the application that has decorated methods. */
  onModuleInit(): void {
    for (const module of this.#modules.values()) {
      for (const wrapper of [...module.providers.values(), ...module.controllers.values()]) {
        const target = wrapper.isDependencyTreeStatic()
          ? (wrapper.instance as unknown)
          : (wrapper.metatype as { prototype?: unknown } | null)?.prototype;
        if (typeof target !== "object" || target === null) continue;
        if (!TransactionalMethods.has(target) || TransactionalMethods.bindings.has(target)) continue;
        TransactionalMethods.bindings.set(target, this.#resolve);
        this.#bound.push(target);
      }
    }
  }

  /** Removes the bindings this application made. */
  onApplicationShutdown(): void {
    for (const target of this.#bound) {
      if (TransactionalMethods.bindings.get(target) === this.#resolve) TransactionalMethods.bindings.delete(target);
    }
    this.#bound.length = 0;
  }
}
