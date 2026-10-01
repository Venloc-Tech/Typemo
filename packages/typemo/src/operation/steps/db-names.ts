import { BsonGuards } from "../../bson/bson-guards.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import type { ResultShape } from "./result-shape.ts";

/*
 * Stored documents back to code names (Mongoose H14): the inverse of the translation the encode step applies.
 * Used by the result post-processing (find results, find-and-modify documents, aggregation rows by
 * their `ResultShape`). Keys the schema does not know (computed by a pipeline) are kept as they are; Map
 * keys are data and are never translated. The input is not mutated: a translated document is a new object.
 *
 * The translation is COMPILED once per schema (and once per result shape, i.e. once
 * per aggregation plan), not re-derived per row. A shape with nothing to translate compiles to "no
 * translator": the driver's rows are the result as they are (they are fresh objects nobody else holds).
 */

/**
 * Translates one stored value to code names (a new value; `undefined` translator: nothing to translate).
 *
 * @example
 * const translate: RowTranslator = (value) => value;
 */
export type RowTranslator = (value: unknown) => unknown;

/** The fields of each schema by stored name (its discriminators' fields included). */
const byDbKey = new WeakMap<CompiledSchema, ReadonlyMap<string, PathNode>>();
/** The translator of each schema; `null`: the schema has nothing to translate (its rows stay as stored). */
const bySchema = new WeakMap<CompiledSchema, RowTranslator | null>();

/**
 * Own data property, safe for a `__proto__` key (the prototype of `out` is never replaced).
 *
 * @param out - The object to write to.
 * @param key - The key.
 * @param value - The value.
 */
const put = (out: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === "__proto__") SafeRecord.set(out, key, value);
  else out[key] = value;
};

/**
 * Translation of stored documents to code names.
 *
 * @example
 * const doc = DbNames.document(schema, { adr: { zip: "10115" } }); // { address: { zip: "10115" } }
 */
export class DbNames {
  /**
   * A row of a result with the given shape, in code names (the row itself when nothing is translated).
   *
   * @param shape - How the rows map back to code names.
   * @param row - One stored row.
   * @returns The translated row, or `row` when the shape has nothing to translate.
   */
  static toCode(shape: ResultShape, row: unknown): unknown {
    const translate = DbNames.translator(shape);
    return translate === undefined ? row : translate(row);
  }

  /**
   * The translator of a result shape, compiled once per call — the caller keeps it for all its rows (once
   * per plan and batch); the schema parts are compiled once per schema. `undefined` when no row of that
   * shape can hold a stored name different from its code name — the rows are the result as they are.
   * (Not cached per shape: a shape lives for one operation, and a weak map entry per operation costs GC.)
   *
   * @param shape - How the rows map back to code names.
   * @returns The translator, or `undefined` when the rows need no translation.
   */
  static translator(shape: ResultShape): RowTranslator | undefined {
    const base = shape.schema === undefined ? undefined : DbNames.forSchema(shape.schema);
    return shape.fields.size === 0 ? base : DbNames.compileShape(shape, base);
  }

  /**
   * A stored document of `schema` in code names (always a new object).
   *
   * @param schema - The schema the document is stored by.
   * @param document - The stored document.
   * @returns A new object in code names.
   */
  static document(schema: CompiledSchema, document: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const translate = DbNames.forSchema(schema);
    return translate === undefined ? { ...document } : (translate(document) as Record<string, unknown>);
  }

  /**
   * `true` when some path of the schema is stored under another name (nothing to translate otherwise).
   *
   * @param schema - The compiled schema.
   * @returns Whether any path of the schema or its discriminators has a different database name.
   */
  static hasAliases(schema: CompiledSchema): boolean {
    return [schema, ...schema.discriminators.values()].some((one) =>
      Object.values(one.allPaths).some((node) => node.dbPath !== node.path),
    );
  }

  /**
   * The translator of a shape whose fields have shapes of their own: the schema part first, then each field.
   *
   * @param shape - The result shape.
   * @param base - The translator of the shape's schema, if any.
   * @returns The translator, or `base` when no field needs translation.
   */
  private static compileShape(shape: ResultShape, base: RowTranslator | undefined): RowTranslator | undefined {
    const fields: [string, RowTranslator][] = [];
    for (const [key, fieldShape] of shape.fields) {
      const translate = DbNames.translator(fieldShape);
      if (translate !== undefined) fields.push([key, translate]);
    }
    if (fields.length === 0) return base;
    return (row) => {
      if (!BsonGuards.isPlainObject(row)) return row;
      /* A new object either way: the schema translator already made one, a copy otherwise (spread defines own keys). */
      const out: Record<string, unknown> = base === undefined ? { ...row } : (base(row) as Record<string, unknown>);
      for (const [key, translate] of fields) {
        if (!Object.hasOwn(out, key)) continue;
        const value = out[key];
        put(out, key, Array.isArray(value) ? value.map(translate) : translate(value));
      }
      return out;
    };
  }

  /**
   * The translator of stored documents of a schema (its discriminators' fields included), compiled once.
   * Recursive schemas: the entry is registered before the fields are compiled, so a cycle resolves to it.
   *
   * @param schema - The compiled schema.
   * @returns The translator, or `undefined` when no key of the schema is renamed.
   */
  private static forSchema(schema: CompiledSchema): RowTranslator | undefined {
    const cached = bySchema.get(schema);
    if (cached !== undefined) return cached ?? undefined;
    if (!DbNames.renames(schema, new Set())) {
      bySchema.set(schema, null);
      return undefined;
    }
    let compiled: RowTranslator = (value) => value;
    bySchema.set(schema, (value) => compiled(value));
    const entries = new Map<string, { readonly key: string; readonly value: RowTranslator | undefined }>();
    for (const [dbKey, node] of DbNames.fields(schema)) {
      entries.set(dbKey, { key: node.key, value: DbNames.forNode(node) });
    }
    compiled = (value) => {
      if (!BsonGuards.isPlainObject(value)) return value;
      const out: Record<string, unknown> = {};
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const item = value[key];
        const entry = entries.get(key);
        if (entry === undefined) put(out, key, item);
        else put(out, entry.key, entry.value === undefined || item === null ? item : entry.value(item));
      }
      return out;
    };
    return bySchema.get(schema) ?? undefined;
  }

  /**
   * The translator of the values of one path (`undefined`: stored as in code).
   *
   * @param node - The path node.
   * @returns The translator, or `undefined` when the values need none.
   */
  private static forNode(node: PathNode): RowTranslator | undefined {
    switch (node.kind) {
      case "array": {
        const element = DbNames.forNode(node.element);
        if (element === undefined) return undefined;
        return (value) =>
          Array.isArray(value)
            ? value.map((item: unknown) => (item === null || item === undefined ? item : element(item)))
            : value;
      }
      case "map": {
        const item = DbNames.forNode(node.value);
        if (item === undefined) return undefined;
        return (value) => {
          if (!BsonGuards.isPlainObject(value)) return value;
          const out: Record<string, unknown> = {};
          for (const [key, one] of Object.entries(value)) {
            SafeRecord.set(out, key, one === null || one === undefined ? one : item(one));
          }
          return out;
        };
      }
      case "subdocument":
      case "nested":
        return DbNames.forSchema(node.schema);
      default:
        return undefined;
    }
  }

  /**
   * Whether some document of the schema (nested schemas and discriminators included) has a renamed key.
   *
   * @param schema - The compiled schema.
   * @param seen - The schemas already visited (breaks cycles).
   * @returns Whether any key is stored under another name.
   */
  private static renames(schema: CompiledSchema, seen: Set<CompiledSchema>): boolean {
    if (seen.has(schema)) return false;
    seen.add(schema);
    for (const node of DbNames.fields(schema).values()) {
      if (node.dbKey !== node.key || DbNames.nodeRenames(node, seen)) return true;
    }
    return false;
  }

  /**
   * Whether the values of a node hold a renamed key (through arrays, Maps and embedded documents).
   *
   * @param node - The path node.
   * @param seen - The schemas already visited (breaks cycles).
   * @returns Whether any key below is stored under another name.
   */
  private static nodeRenames(node: PathNode, seen: Set<CompiledSchema>): boolean {
    switch (node.kind) {
      case "array":
        return DbNames.nodeRenames(node.element, seen);
      case "map":
        return DbNames.nodeRenames(node.value, seen);
      case "subdocument":
      case "nested":
        return DbNames.renames(node.schema, seen);
      default:
        return false;
    }
  }

  /**
   * The fields of a schema and of its discriminators by stored name.
   *
   * @param schema - The compiled schema.
   * @returns The fields keyed by stored name; the first field wins on a repeated name.
   */
  private static fields(schema: CompiledSchema): ReadonlyMap<string, PathNode> {
    const cached = byDbKey.get(schema);
    if (cached !== undefined) return cached;
    const map = new Map<string, PathNode>();
    for (const one of [schema, ...schema.discriminators.values()]) {
      for (const field of one.fields) if (!map.has(field.dbKey)) map.set(field.dbKey, field);
    }
    byDbKey.set(schema, map);
    return map;
  }
}
