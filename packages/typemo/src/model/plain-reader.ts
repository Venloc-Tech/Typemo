import { BsonGuards } from "../bson/bson-guards.ts";
import { BsonTypeTable } from "../bson/bson-type-table.ts";
import type { PopulatePlan } from "../query/plan.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";

/*
 * The plain form of LEAN rows: what `.plain()` of a query returns, with no hydration. A row (code
 * names, populated values in place: what the lean pipeline produced) is walked by its schema, so the fields the
 * schema knows are converted by their node (a Map field's record becomes a `Map`, a subdocument is walked by its own
 * schema, a discriminated row by its class's); every scalar goes through the ONE type table
 * (`BsonTypeTable.toPlain`). Keys the schema does not know (a text score, fields of another schema version) are
 * converted by the table alone.
 *
 * Populated values: the populate executor remembers the schema of every lean document it found (`remember`), so a
 * populated document is walked by ITS schema (its Map fields become `Map`s too, its `Hidden` fields follow the same
 * option). The query's populate plans say which paths hold populated values and which were transformed: a
 * transform result is the user's value and stays as it is (only its container — a Map's record — takes the form).
 * `Hidden` fields are left out unless `{ hidden: true }` (as `$toPlain()`), at every depth.
 */

type Doc = Record<string, unknown>;

/**
 * The options of `.plain(options)`.
 *
 * @example
 * ```ts
 * const options: PlainReadOptions = { hidden: true };
 * const rows = await users.find().plain(options); // the Hidden fields included
 * ```
 */
export interface PlainReadOptions {
  /** Keep the `Hidden` fields a query selected (`+field`); default: left out, as `$toPlain()` does. */
  readonly hidden?: boolean;
}

/** One level of the walk: the options and the populate plans of the document being walked. */
interface Level {
  readonly hidden: boolean;
  readonly plans: readonly PopulatePlan[];
}

/** The schema of each lean document the populate executor found (a weak registry: it never keeps a document). */
const SCHEMAS = new WeakMap<object, CompiledSchema>();

const join = (path: string, key: string | number): string => (path === "" ? String(key) : `${path}.${key}`);

const define = (target: Doc, key: string, value: unknown): void => {
  if (key === "__proto__")
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
};

/** The plain form of lean rows. */
export class PlainReader {
  /**
   * Records the schema of a lean document found by populate (its plain form is walked by it).
   *
   * @param doc - The lean document.
   * @param schema - The schema it was read with.
   */
  static remember(doc: object, schema: CompiledSchema): void {
    SCHEMAS.set(doc, schema);
  }

  /**
   * A lean row of `schema` (or `null`) in its plain form.
   *
   * @param schema - The schema of the row.
   * @param row - The lean row.
   * @param options - Whether `Hidden` fields are kept.
   * @param plans - The populate plans of the query.
   * @returns The plain row; `null`/`undefined` pass through.
   */
  static row(schema: CompiledSchema, row: unknown, options: PlainReadOptions, plans: readonly PopulatePlan[]): unknown {
    if (row === null || row === undefined) return row;
    if (!BsonGuards.isPlainObject(row)) return BsonTypeTable.toPlain(row);
    return PlainReader.document(schema, row, { hidden: options.hidden === true, plans }, "", "");
  }

  /**
   * Rows of a query (`find`, a cursor batch) in their plain form.
   *
   * @param schema - The schema of the rows.
   * @param rows - The lean rows.
   * @param options - Whether `Hidden` fields are kept.
   * @param plans - The populate plans of the query.
   * @returns The plain rows.
   */
  static rows(
    schema: CompiledSchema,
    rows: readonly unknown[],
    options: PlainReadOptions,
    plans: readonly PopulatePlan[],
  ): unknown[] {
    return rows.map((row) => PlainReader.row(schema, row, options, plans));
  }

  private static schemaFor(schema: CompiledSchema, raw: Readonly<Doc>): CompiledSchema {
    if (schema.discriminators.size === 0) return schema;
    return schema.root.discriminatorFor(raw[schema.discriminatorKey]) ?? schema;
  }

  /**
   * One document (a row, a subdocument, a populated document). `path` locates errors (with array indexes);
   * `relative` is the dotted path of this document inside the document the populate plans of `level` start from (no
   * indexes: plans name fields, not elements) — kept only while there are plans (no string work otherwise).
   */
  private static document(
    declared: CompiledSchema,
    doc: Readonly<Doc>,
    level: Level,
    path: string,
    relative: string,
  ): Doc {
    const schema = PlainReader.schemaFor(declared, doc);
    const tracking = level.plans.length > 0;
    const out: Doc = {};
    for (const key of Object.keys(doc)) {
      const value = doc[key];
      if (value === undefined) continue;
      const node = schema.field(key);
      const inner = tracking ? join(relative, key) : "";
      if (node === undefined) {
        define(out, key, PlainReader.unknownKey(schema, key, value, level, join(path, key), inner));
        continue;
      }
      if (node.hidden && !level.hidden) continue;
      define(out, key, PlainReader.value(node, value, level, path, key, inner));
    }
    return out;
  }

  /** A key the schema has no field for: a populated virtual, or any other value (by the table alone). */
  private static unknownKey(
    schema: CompiledSchema,
    key: string,
    value: unknown,
    level: Level,
    path: string,
    relative: string,
  ): unknown {
    if (
      level.plans.length > 0 &&
      schema.virtuals.some((virtual) => virtual.kind === "populate" && virtual.key === key)
    ) {
      const plan = PlainReader.planAt(level, relative);
      if (plan !== undefined) return PlainReader.populated(value, plan, level, path);
    }
    return BsonTypeTable.toPlain(value, path);
  }

  /** The populate plan of a path of this level (a Map's values may be named `field.$*`). */
  private static planAt(level: Level, relative: string): PopulatePlan | undefined {
    for (const plan of level.plans) {
      if (plan.path === relative || plan.path === `${relative}.$*`) return plan;
    }
    return undefined;
  }

  /**
   * A populated value: documents found (walked by their own schema, with the plan's nested populate), `null`s, a
   * count, arrays and records of them; a transform result stays as it is.
   */
  private static populated(value: unknown, plan: PopulatePlan, level: Level, path: string): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map((item: unknown, index) => PlainReader.populated(item, plan, level, join(path, index)));
    }
    if (plan.transform !== undefined) return value;
    if (typeof value === "object") {
      const schema = SCHEMAS.get(value);
      if (schema !== undefined) {
        return PlainReader.document(schema, value as Doc, { hidden: level.hidden, plans: plan.populate }, path, "");
      }
    }
    return BsonTypeTable.toPlain(value, path);
  }

  /** The value at `parent.key` of a field node (the path is joined only where it can be needed). */
  private static value(
    node: PathNode,
    value: unknown,
    level: Level,
    parent: string,
    key: string | number,
    relative: string,
  ): unknown {
    if (value === null) return null;
    switch (node.kind) {
      case "array": {
        const path = join(parent, key);
        if (!Array.isArray(value)) return PlainReader.populatedOr(value, level, path, relative);
        const element = node.element;
        return value.map((item: unknown, index) =>
          item === null || item === undefined ? item : PlainReader.value(element, item, level, path, index, relative),
        );
      }
      case "map": {
        const path = join(parent, key);
        if (!BsonGuards.isPlainObject(value)) return PlainReader.populatedOr(value, level, path, relative);
        const plan = level.plans.length > 0 ? PlainReader.planAt(level, relative) : undefined;
        const inner = level.plans.length > 0 ? `${relative}.$*` : "";
        const out = new Map<string, unknown>();
        for (const name of Object.keys(value)) {
          const item = value[name];
          if (item === undefined) continue;
          out.set(
            name,
            plan !== undefined
              ? PlainReader.populated(item, plan, level, join(path, name))
              : item === null
                ? null
                : PlainReader.value(node.value, item, level, path, name, inner),
          );
        }
        return out;
      }
      case "subdocument":
      case "nested":
        if (!BsonGuards.isPlainObject(value)) return BsonTypeTable.toPlain(value, join(parent, key));
        return PlainReader.document(node.schema, value, level, join(parent, key), relative);
      default:
        // The values whose plain form is themselves (no path, no table lookup).
        switch (typeof value) {
          case "string":
          case "boolean":
          case "number":
            return value;
        }
        return PlainReader.populatedOr(value, level, join(parent, key), relative);
    }
  }

  /** A scalar (or unexpected) value: a populated one when a plan names the path, else the table's plain row. */
  private static populatedOr(value: unknown, level: Level, path: string, relative: string): unknown {
    if (level.plans.length > 0) {
      const plan = PlainReader.planAt(level, relative);
      if (plan !== undefined) return PlainReader.populated(value, plan, level, path);
    }
    return BsonTypeTable.scalarToPlain(value, path);
  }
}
