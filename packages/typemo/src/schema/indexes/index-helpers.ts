import type { IndexDescription } from "mongodb";
import type { CompiledIndex } from "../compiler/compiled-schema.ts";
import type { IndexDirection, IndexFields, IndexOptions, PartialFilter } from "../options/index-options.ts";

/**
 * Index helpers: one static class for everything about index specs — path mapping, prefixing for
 * subdocuments, names, equality and the driver form.
 */
export class IndexHelpers {
  /**
   * Index keys with every path mapped (aliases, prefixes); order is kept (it is the index order).
   *
   * @param keys - The index keys.
   * @param map - Maps a path.
   * @returns The frozen mapped keys.
   */
  static mapKeys(keys: IndexFields, map: (path: string) => string): Readonly<Record<string, IndexDirection>> {
    return Object.freeze(Object.fromEntries(Object.entries(keys).map(([path, direction]) => [map(path), direction])));
  }

  /**
   * A partial filter with every field path mapped. Operator keys (`$and`, `$or`, `$exists`, …) are
   * never mapped, and `$and`/`$or` are walked into: Mongoose prefixed a subdocument's
   * `partialFilterExpression` key by key, turning `$or` into `address.$or`.
   *
   * @param filter - The partial filter.
   * @param map - Maps a field path.
   * @returns The frozen mapped filter.
   */
  static mapFilter(filter: PartialFilter, map: (path: string) => string): PartialFilter {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (key === "$and" || key === "$or") {
        out[key] = (value as readonly PartialFilter[]).map((clause) => IndexHelpers.mapFilter(clause, map));
      } else if (key.startsWith("$")) {
        out[key] = value;
      } else {
        out[map(key)] = value;
      }
    }
    return Object.freeze(out) as PartialFilter;
  }

  /**
   * A path mapper that prefixes a path of a subdocument: `city` under `addresses` → `addresses.city`.
   *
   * @param prefix - The subdocument's path; empty for the root.
   * @returns A function that prefixes a path.
   */
  static prefix(prefix: string) {
    return (path: string): string => (prefix === "" ? path : `${prefix}.${path}`);
  }

  /**
   * Field paths used by a partial filter (through `$and`/`$or`).
   *
   * @param filter - The partial filter.
   * @returns The field paths.
   */
  static filterPaths(filter: PartialFilter): string[] {
    return Object.entries(filter).flatMap(([key, value]) =>
      key === "$and" || key === "$or"
        ? (value as readonly PartialFilter[]).flatMap(IndexHelpers.filterPaths)
        : key.startsWith("$")
          ? []
          : [key],
    );
  }

  /**
   * The name the server gives an index without an explicit name: `a_1_b_-1`, `title_text`.
   *
   * @param keys - The index keys.
   * @returns The default name.
   */
  static defaultName(keys: Readonly<Record<string, IndexDirection>>): string {
    return Object.entries(keys)
      .map(([path, direction]) => `${path}_${direction}`)
      .join("_");
  }

  /**
   * The name of an index: explicit or the server default.
   *
   * @param index - The index.
   * @returns The name.
   */
  static nameOf(index: Pick<CompiledIndex, "keys" | "options">): string {
    return index.options.name ?? IndexHelpers.defaultName(index.keys);
  }

  /**
   * Whether the keys describe a text index.
   *
   * @param keys - The index keys.
   * @returns `true` when a key has the `text` direction.
   */
  static isText(keys: Readonly<Record<string, IndexDirection>>): boolean {
    return Object.values(keys).includes("text");
  }

  /**
   * Whether two key sets have the same keys in the same order with the same directions.
   *
   * @param a - The first key set.
   * @param b - The second key set.
   * @returns `true` when they are equal.
   */
  static sameKeys(a: Readonly<Record<string, IndexDirection>>, b: Readonly<Record<string, IndexDirection>>): boolean {
    const left = Object.entries(a);
    const right = Object.entries(b);
    return (
      left.length === right.length &&
      left.every(([path, direction], index) => right[index]?.[0] === path && right[index]?.[1] === direction)
    );
  }

  /**
   * Scopes an index of a discriminator class to its documents: `partialFilterExpression` gets
   * `{ key: value }` (combined with an existing filter through `$and`), like Mongoose's
   * `decorateDiscriminatorIndexOptions`.
   *
   * @param options - The index options.
   * @param key - The discriminator key.
   * @param value - The discriminator value.
   * @returns The frozen options with the scope added.
   */
  static scopeToDiscriminator(options: IndexOptions, key: string, value: string): IndexOptions {
    const scope: PartialFilter = { [key]: value };
    const existing = options.partialFilterExpression;
    return Object.freeze({
      ...options,
      partialFilterExpression: existing === undefined ? scope : { $and: [scope, existing] },
    });
  }

  /**
   * The driver form for `collection.createIndexes([...])`.
   *
   * @param index - The compiled index.
   * @returns The index description.
   */
  static toDescription(index: CompiledIndex): IndexDescription {
    return {
      key: { ...index.keys },
      ...IndexHelpers.plainOptions(index.options),
    };
  }

  /**
   * The options without `undefined` values, as the driver expects them.
   *
   * @param options - The index options.
   * @returns The options that have a value.
   */
  private static plainOptions(options: IndexOptions): Omit<IndexDescription, "key"> {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(options)) if (value !== undefined) out[name] = value;
    return out as Omit<IndexDescription, "key">;
  }
}
