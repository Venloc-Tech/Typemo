import { ConfigurationError } from "../errors/configuration-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { Model } from "./model.ts";

/*
 * Users see `model.schema` as the read-only `SchemaInfo`; the compiled schema (paths, casters, hooks,
 * indexes) is core mechanics. It stays in a `#private` field of `Model`, reachable only through this
 * class, which lives in `src/internal.ts` and never in the public entry `src/index.ts`.
 * `Model` installs the accessor from a static block (the `ConnectionInternals` pattern).
 */

/** Internal access to a model's compiled schema. Not part of the public API. */
export class ModelInternals {
  static #read: ((model: Model<object>) => CompiledSchema) | undefined;

  /**
   * Called once by `Model`'s static block; later calls are ignored.
   *
   * @param read - Reads the compiled schema out of a model's private field.
   */
  static install(read: (model: Model<object>) => CompiledSchema): void {
    ModelInternals.#read ??= read;
  }

  /**
   * The schema of the model compiled with its connection's context.
   *
   * @param model - The model.
   * @returns The compiled schema.
   * @throws {ConfigurationError} When `Model` has not been loaded yet.
   */
  static schema<T extends object>(model: Model<T>): CompiledSchema {
    const read = ModelInternals.#read;
    if (read === undefined) throw new ConfigurationError("ModelInternals: Model is not loaded");
    return read(model as unknown as Model<object>);
  }
}
