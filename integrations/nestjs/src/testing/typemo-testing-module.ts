/*
 * The module of integration and e2e tests on a real MongoDB: `TypemoModule.forRoot` with a database of its own per
 * call (tests never see each other's data), the collections and indexes created at start (`sync: "init"`, so a
 * transaction does not race the creation of a collection) and one try to connect. `clear` empties the collections of
 * the registered models between tests, through the models (`Filters.all()`), across tenants and soft deletes.
 */
import type { DynamicModule } from "@nestjs/common";
import { Filters, PolicyContext, TypedView } from "@venloc/typemo";
import type { FeatureRegistry } from "../feature-registry.ts";
import type { TypemoModuleOptions } from "../options.ts";
import { DEFAULT_CLIENT, getRegistryToken } from "../tokens.ts";
import { TypemoModule } from "../typemo.module.ts";

/**
 * What `clear` needs from a testing module or an application: `get` with `strict: false`.
 *
 * @example
 * ```ts fragment
 * const ref: ProviderLookup = moduleRef;
 * ```
 */
export interface ProviderLookup {
  /**
   * Finds a provider anywhere in the application.
   *
   * @param token - The token.
   * @param options - `{ strict: false }`.
   * @returns The provider.
   */
  get(token: string, options: { readonly strict: false }): unknown;
}

/** A counter in the database names, so two modules made in the same millisecond still differ. */
let created = 0;

/** The Typemo module of tests. */
export class TypemoTestingModule {
  /**
   * `TypemoModule.forRoot` for a test: a fresh database (`typemo_test_<time>_<n>` unless `dbName` is given),
   * `sync: "init"`, `retryAttempts: 1`; every option can be overridden.
   *
   * @param uri - The connection string of the test server.
   * @param options - Overrides.
   * @returns The module to import.
   * @example
   * ```ts
   * const imports = [TypemoTestingModule.forRoot("mongodb://localhost:27017")];
   * ```
   */
  static forRoot(uri: string, options: TypemoModuleOptions = {}): DynamicModule {
    created += 1;
    return TypemoModule.forRoot(uri, {
      dbName: `typemo_test_${Date.now()}_${created}`,
      sync: "init",
      retryAttempts: 1,
      ...options,
    });
  }

  /**
   * Deletes the documents of every model registered with `forFeature` on a client (views skipped), across tenants
   * and including soft-deleted ones.
   *
   * @param ref - The testing module or the application.
   * @param name - The client name; default `"default"`.
   * @returns Resolves when every collection is empty.
   * @example
   * ```ts fragment
   * afterEach(() => TypemoTestingModule.clear(moduleRef));
   * ```
   */
  static async clear(ref: ProviderLookup, name: string = DEFAULT_CLIENT): Promise<void> {
    const registry = ref.get(getRegistryToken(name), { strict: false }) as FeatureRegistry;
    for (const connection of registry.connections) {
      for (const model of connection.models) {
        if (TypedView.isView(connection, model.collectionName)) continue;
        await PolicyContext.run({ allTenants: true, includeDeleted: true, hardDelete: true }, () =>
          model.deleteMany(Filters.all() as never),
        );
      }
    }
  }
}
