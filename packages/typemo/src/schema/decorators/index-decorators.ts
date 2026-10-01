import { MetadataBuilder } from "../metadata/metadata-builder.ts";
import type { IndexFields, IndexOptions, SearchIndexOptions } from "../options/index-options.ts";
import type { EntityClass } from "../options/type-spec.ts";
import type { IndexCheck } from "./class-checks.ts";

/**
 * A compound (or any) index on the class. Keys, `partialFilterExpression`, `weights` and
 * `wildcardProjection` paths are checked against the class without an explicit `<User>` type argument.
 * Repeatable: every application declares one more index.
 *
 * @param fields - The index keys in order, each with its direction or kind.
 * @param options - Index options such as `unique`, `sparse`, `expireAfterSeconds`.
 * @returns A class decorator that records the index in the class metadata.
 * @example
 * ```ts
 * @Index({ name: 1, age: -1 }, { unique: true })
 * @Schema()
 * class User { ... }
 * ```
 */
export const Index =
  <const F extends IndexFields, const O extends IndexOptions = Record<never, never>>(fields: F, options?: O) =>
  <C extends EntityClass>(target: C & IndexCheck<C, F, O>): void => {
    MetadataBuilder.for(target).addIndex(fields, options ?? {});
  };

/**
 * An Atlas Search / Vector Search index description. The decorator only records it in the class
 * metadata; the index is created when the collection is synchronised.
 *
 * @param options - The search index name, type and definition.
 * @returns A class decorator that records the search index in the class metadata.
 * @example
 * ```ts
 * @SearchIndex({ name: "default", definition: { mappings: { dynamic: true } } })
 * @Schema()
 * class Article { ... }
 * ```
 */
export const SearchIndex =
  (options: SearchIndexOptions) =>
  <C extends EntityClass>(target: C): void => {
    MetadataBuilder.for(target).addSearchIndex(options);
  };
