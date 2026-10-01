import { BsonGuards } from "../bson/bson-guards.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { HydrationSupport } from "../schema/entity/hydration-support.ts";

/*
 * Documents read from the server become one of two result forms:
 * - hydrated (default): an instance of the entity class. Subdocuments and nested objects are instances of
 *   their classes too, Map fields are `Map`s, discriminated documents are instances of their class;
 * - lean: plain objects in code names; Map fields stay plain records (`Lean<T>`).
 * Database names (`dbName` aliases) become code names in both forms. Keys the schema does not know
 * (a `$meta` text score, a discriminator key) are kept as they came: the projection asked for them.
 */

/**
 * Tells whether any path of the schema is stored under another name than its code name.
 *
 * @param schema - The compiled schema.
 * @returns `true` when at least one path has a `dbName` alias.
 */
const hasAliases = (schema: CompiledSchema): boolean =>
  Object.values(schema.allPaths).some((node) => node.dbKey !== node.key);

/** Reading of stored documents into result forms. */
export class DocumentReader {
  /**
   * An entity instance of `schema` (or of the discriminator class the document names).
   *
   * @param schema - The compiled schema of the collection's root model.
   * @param raw - The document as the driver returned it.
   * @returns The hydrated entity instance, with database names turned into code names.
   */
  static hydrate<T extends object>(schema: CompiledSchema, raw: Readonly<Record<string, unknown>>): T {
    const target = DocumentReader.schemaFor(schema, raw);
    const instance = HydrationSupport.instantiate<T>(target) as Record<string, unknown>;
    for (const [key, value] of DocumentReader.entries(target, raw, true)) {
      Object.defineProperty(instance, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return instance as T;
  }

  /**
   * A plain object in code names. Without aliases the driver's document is returned as it is (no copy).
   *
   * @param schema - The compiled schema.
   * @param raw - The document as the driver returned it.
   * @returns The lean document.
   */
  static lean(schema: CompiledSchema, raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const target = DocumentReader.schemaFor(schema, raw);
    if (!hasAliases(target)) return raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of DocumentReader.entries(target, raw, false)) {
      Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }

  /**
   * Reads a stored document in the requested form.
   *
   * @param schema - The compiled schema.
   * @param raw - The document as the driver returned it.
   * @param lean - `true` for a plain object, `false` for an entity instance.
   * @returns The document in the requested form.
   */
  static read(schema: CompiledSchema, raw: Readonly<Record<string, unknown>>, lean: boolean): Record<string, unknown> {
    return lean ? DocumentReader.lean(schema, raw) : DocumentReader.hydrate(schema, raw);
  }

  /**
   * The schema that describes a document: the discriminator's schema when the document names one.
   *
   * @param schema - The root schema.
   * @param raw - The stored document.
   * @returns The discriminator schema, or `schema` itself.
   */
  private static schemaFor(schema: CompiledSchema, raw: Readonly<Record<string, unknown>>): CompiledSchema {
    if (schema.discriminators.size === 0) return schema;
    const value = raw[schema.discriminatorKey];
    return schema.root.discriminatorFor(value) ?? schema;
  }

  /**
   * The document's entries with database names turned into code names and values converted by their nodes.
   *
   * @param schema - The schema that describes the document.
   * @param raw - The stored document.
   * @param hydrate - `true` to build class instances and `Map`s.
   * @returns `[codeName, value]` pairs; keys unknown to the schema are kept as they came.
   */
  private static entries(
    schema: CompiledSchema,
    raw: Readonly<Record<string, unknown>>,
    hydrate: boolean,
  ): [string, unknown][] {
    const byDbKey = new Map(schema.fields.map((node) => [node.dbKey, node]));
    return Object.entries(raw).map(([dbKey, value]): [string, unknown] => {
      const node = byDbKey.get(dbKey);
      if (node === undefined) return [dbKey, value];
      return [node.key, value === null || value === undefined ? value : DocumentReader.value(node, value, hydrate)];
    });
  }

  /**
   * Converts one stored value by its schema node, recursing into arrays, maps and subdocuments.
   *
   * @param node - The schema node of the value.
   * @param value - The stored (non-null) value.
   * @param hydrate - `true` to build class instances and `Map`s.
   * @returns The converted value.
   */
  private static value(node: PathNode, value: unknown, hydrate: boolean): unknown {
    switch (node.kind) {
      case "array":
        return Array.isArray(value)
          ? value.map((item) => (item === null ? null : DocumentReader.value(node.element, item, hydrate)))
          : value;
      case "map": {
        if (!BsonGuards.isPlainObject(value)) return value;
        const entries = Object.entries(value).map(([key, item]): [string, unknown] => [
          key,
          item === null ? null : DocumentReader.value(node.value, item, hydrate),
        ]);
        if (hydrate) return new Map(entries);
        const out: Record<string, unknown> = {};
        for (const [key, item] of entries) {
          Object.defineProperty(out, key, { value: item, enumerable: true, writable: true, configurable: true });
        }
        return out;
      }
      case "subdocument":
      case "nested":
        if (!BsonGuards.isPlainObject(value)) return value;
        return hydrate ? DocumentReader.hydrate(node.schema, value) : DocumentReader.lean(node.schema, value);
      default:
        /* The encoded form of an insert (`Int32`/`Double` wrappers of the casters) reads back as numbers,
           as the server returns them (promoteValues). */
        return BsonGuards.isInt32(value) || BsonGuards.isDouble(value) ? value.valueOf() : value;
    }
  }
}
