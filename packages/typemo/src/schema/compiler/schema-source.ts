import { ConfigurationError } from "../../errors/configuration-error.ts";
import { CompiledSchema, type SchemaInfo } from "./compiled-schema.ts";

/**
 * What the schema-level helpers (`CollectionManager`, `JsonSchemaGenerator`, `StandardSchema.of`,
 * `SyncAll.collections`) take: a model (`connection.model(User)`) or the `SchemaInfo` of one (`model.schema`).
 *
 * @example
 * ```ts
 * const Users = connection.model(User);
 * JsonSchemaGenerator.generate(Users);
 * JsonSchemaGenerator.generate(Users.schema);
 * ```
 */
export type SchemaSource = SchemaInfo | { readonly schema: SchemaInfo };

/** Turns a public schema argument into the compiled schema the core works with. */
export class SchemaSources {
  /**
   * The compiled schema behind a model or a `SchemaInfo`. Both come from a compiled model: a foreign object
   * with the right shape is refused, because the helpers need the real compiled tree.
   *
   * @param source - A model or its `SchemaInfo`.
   * @param where - The call, for the message.
   * @returns The compiled schema.
   * @throws {ConfigurationError} When the argument is neither a model nor the `schema` of one.
   */
  static resolve(source: SchemaSource, where: string): CompiledSchema {
    if (source instanceof CompiledSchema) return source;
    const inner = (source as { readonly schema?: unknown } | null)?.schema;
    if (inner instanceof CompiledSchema) return inner;
    throw new ConfigurationError(
      `${where}: a model (connection.model(Entity)) or its schema (model.schema) is expected, got ${
        source === null ? "null" : typeof source
      }`,
    );
  }
}
