import { BsonGuards } from "../bson/bson-guards.ts";
import { BsonTypeTable } from "../bson/bson-type-table.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { Collections } from "./collections/collections.ts";
import { Subdocuments } from "./collections/subdocument.ts";
import { type PlainFormOptions, TrackedProtocol } from "./collections/tracked-protocol.ts";
import { DocumentStates } from "./document-state.ts";
import type { ToObjectOptions } from "./document-types.ts";
import { PopulatedFields } from "./populated-fields.ts";

/**
 * A document as a bag of fields.
 *
 * @example
 * ```ts
 * const doc: Doc = { name: "Ada" };
 * ```
 */
type Doc = Record<string, unknown>;

/**
 * The form a walk produces: three forms, one walk.
 *
 * @example
 * ```ts
 * const form: Form = "json";
 * ```
 */
type Form = "object" | "json" | "plain";

/**
 * The settings of one serialization walk.
 *
 * @example
 * ```ts
 * const walk: Walk = { form: "json", getters: false, virtuals: false, hidden: false };
 * ```
 */
interface Walk {
  /** The form to produce. */
  readonly form: Form;
  /** Whether fields' `get` functions are applied. */
  readonly getters: boolean;
  /** Whether getter virtuals are included. */
  readonly virtuals: boolean;
  /** Whether `Hidden` fields are included. */
  readonly hidden: boolean;
}

/**
 * Defines an own enumerable data property.
 *
 * @param target - The object to write to.
 * @param key - The property key.
 * @param value - The value.
 */
const define = (target: Doc, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * Puts `value` on a fresh plain object: assignment is the same own data property for every key but `__proto__`.
 *
 * @param target - The fresh object.
 * @param key - The property key.
 * @param value - The value.
 */
const put = (target: Doc, key: string, value: unknown): void => {
  if (key === "__proto__") define(target, key, value);
  else target[key] = value;
};

/**
 * Joins a path and a key.
 *
 * @param path - The parent path; empty for the root.
 * @param key - The key or index to append.
 * @returns The dotted path.
 */
const join = (path: string, key: string | number): string => (path === "" ? String(key) : `${path}.${key}`);

/**
 * One field of a schema as the walk reads it.
 *
 * @example
 * ```ts
 * const entry: FieldEntry = { node, key: "name", hidden: false, get: undefined };
 * ```
 */
interface FieldEntry {
  /** The field node. */
  readonly node: PathNode;
  /** The field's code key. */
  readonly key: string;
  /** Whether the field is `Hidden`. */
  readonly hidden: boolean;
  /** The field's `get`, applied with `getters: true`. */
  readonly get: ((value: unknown) => unknown) | undefined;
}

/**
 * The walk of one schema, built once: the fields with their flags, the virtuals by kind.
 *
 * @example
 * ```ts
 * const plan: SerializePlan = planOf(schema);
 * ```
 */
interface SerializePlan {
  /** The fields in schema order. */
  readonly fields: readonly FieldEntry[];
  /** Keys of populate virtuals. */
  readonly populateVirtuals: readonly string[];
  /** Keys of getter virtuals. */
  readonly getterVirtuals: readonly string[];
}

/** The serialization plan of each schema, built once. */
const PLANS = new WeakMap<CompiledSchema, SerializePlan>();

/**
 * The serialization plan of a schema (built on first use).
 *
 * @param schema - The compiled schema.
 * @returns The plan.
 */
const planOf = (schema: CompiledSchema): SerializePlan => {
  let plan = PLANS.get(schema);
  if (plan === undefined) {
    plan = {
      fields: schema.fields.map((node) => ({
        node,
        key: node.key,
        hidden: node.hidden,
        get: typeof node.options.get === "function" ? (node.options.get as (value: unknown) => unknown) : undefined,
      })),
      populateVirtuals: schema.virtuals.filter((virtual) => virtual.kind === "populate").map((virtual) => virtual.key),
      getterVirtuals: schema.virtuals.filter((virtual) => virtual.kind === "getter").map((virtual) => virtual.key),
    };
    PLANS.set(schema, plan);
  }
  return plan;
};

/**
 * The serialized forms of a hydrated document, walked by the schema so every option applies at every depth
 * (Mongoose applied `transform` to the top level only, H194):
 * - `$toObject()` — the data: arrays, `Map`s (kept as `Map`, as the type `ObjectForm<T>` says), plain
 *   objects; BSON values as they are (mutable ones — `Date`, `RegExp`, binaries — copied: the result
 *   never aliases the document);
 * - `$toJSON()` — the JSON forms of the single BSON type table (`BsonTypeTable.toJson`): ids, dates, int64,
 *   Decimal128 as strings; `Timestamp` → `{ t, i }`; binaries → base64; a vector → `number[]`; `RegExp` →
 *   `"/src/flags"`; `Map` → a record (there is no per-field transform: it would make the JSON type lie);
 * - `$toPlain()` — the plain forms of the same table (`BsonTypeTable.toPlain`): the MongoDB types as their
 *   JSON strings, `Date`/`RegExp` copied, bytes as `Uint8Array`, a vector as `number[]`, `Map` kept as `Map`;
 * - options: `getters` (the fields' `get`), `virtuals` (the class's getter virtuals), `hidden` (loaded
 *   `Hidden` fields: in by default for `$toObject`, out by default for `$toJSON`/`$toPlain`), a final `transform`.
 *
 * The walk of a schema is prepared once per schema; paths are joined only where a value can fail (a BSON
 * value, not a string, a boolean or a finite number); the result objects are filled by assignment
 * (`__proto__` excepted: a fresh `{}` has no other setter), unknown keys never reach them; the populated and
 * virtual passes run only when there is something to do.
 */
export class DocumentSerializer {
  /**
   * The data of a document for writing and validation: code names, plain containers, `Map`s kept,
   * values as they are (no getters, no copies), only the schema's fields with a value.
   *
   * @param document - The hydrated document.
   * @param schema - The compiled schema of the document.
   * @returns The plain data.
   */
  static data(document: object, schema: CompiledSchema): Doc {
    const doc = document as Doc;
    const out: Doc = {};
    for (const node of schema.fields) {
      if (!Object.hasOwn(doc, node.key) || doc[node.key] === undefined) continue;
      /* A populated field is written (and validated) as its stored ids. */
      const value = PopulatedFields.stored(document, node.key, doc[node.key]);
      if (value === undefined) continue;
      put(out, node.key, Collections.toPlain(value, { maps: "map" }));
    }
    return out;
  }

  /**
   * `$toObject(options)` without the final transform.
   *
   * @param document - The hydrated document.
   * @param schema - The compiled schema of the document.
   * @param options - Serialization options.
   * @returns The data form.
   */
  static toObject(document: object, schema: CompiledSchema, options: ToObjectOptions): Doc {
    return DocumentSerializer.document(document as Doc, schema, "", {
      form: "object",
      getters: options.getters === true,
      virtuals: options.virtuals === true,
      hidden: options.hidden !== false,
    });
  }

  /**
   * `$toJSON(options)` without the final transform.
   *
   * @param document - The hydrated document.
   * @param schema - The compiled schema of the document.
   * @param options - Serialization options.
   * @returns The JSON form.
   */
  static toJson(document: object, schema: CompiledSchema, options: ToObjectOptions): Doc {
    return DocumentSerializer.document(document as Doc, schema, "", {
      form: "json",
      getters: options.getters === true,
      virtuals: options.virtuals === true,
      hidden: options.hidden === true,
    });
  }

  /**
   * `$toPlain(options)` without the final transform.
   *
   * @param document - The hydrated document.
   * @param schema - The compiled schema of the document.
   * @param options - Serialization options.
   * @returns The plain form.
   */
  static toPlain(document: object, schema: CompiledSchema, options: ToObjectOptions): Doc {
    return DocumentSerializer.document(document as Doc, schema, "", {
      form: "plain",
      getters: options.getters === true,
      virtuals: options.virtuals === true,
      hidden: options.hidden === true,
    });
  }

  /**
   * The plain form of one value of `node` (a tracked collection's `$toPlain()`): the same walk as the document's.
   *
   * @param node - The field node the value belongs to.
   * @param value - The value to convert.
   * @param options - Plain-form options.
   * @returns The plain form of the value.
   */
  static plainOf(node: PathNode, value: unknown, options: PlainFormOptions): unknown {
    return DocumentSerializer.value(node, value, "", node.path, {
      form: "plain",
      getters: options.getters === true,
      virtuals: false,
      hidden: options.hidden === true,
    });
  }

  /**
   * Serializes a document or subdocument.
   *
   * @param doc - The document or subdocument.
   * @param schema - Its compiled schema.
   * @param path - Its path from the root; empty for the root.
   * @param walk - The settings of the walk.
   * @returns The serialized fields.
   */
  private static document(doc: Doc, schema: CompiledSchema, path: string, walk: Walk): Doc {
    const plan = planOf(schema);
    const out: Doc = {};
    const populated = PopulatedFields.has(doc);
    for (const field of plan.fields) {
      const key = field.key;
      /* Own first: a member of the prototype with the field's name is never read. */
      if (!Object.hasOwn(doc, key)) continue;
      const current = doc[key];
      if (current === undefined) continue;
      if (field.hidden && !walk.hidden) continue;
      /* A populated field shows its populated value, each document in its own plain / JSON form. */
      if (populated && PopulatedFields.get(doc, key) !== undefined) {
        put(out, key, DocumentSerializer.populated(current, walk));
        continue;
      }
      const value = walk.getters && field.get !== undefined ? field.get(current) : current;
      put(out, key, DocumentSerializer.value(field.node, value, path, key, walk));
    }
    /* A populated virtual is data of the result (its type has it): always shown. */
    if (populated) {
      for (const key of plan.populateVirtuals) {
        if (PopulatedFields.get(doc, key) === undefined) continue;
        put(out, key, DocumentSerializer.populated(doc[key], walk));
      }
    }
    if (walk.virtuals) {
      for (const key of plan.getterVirtuals) {
        const value = doc[key];
        if (value === undefined) continue;
        put(out, key, DocumentSerializer.virtual(value, join(path, key), walk.form));
      }
    }
    return out;
  }

  /**
   * A getter virtual's value in the form of the walk (`$toObject` keeps it as the getter returned it).
   *
   * @param value - The value the getter returned.
   * @param path - The virtual's path, for errors.
   * @param form - The form to produce.
   * @returns The converted value.
   */
  private static virtual(value: unknown, path: string, form: Form): unknown {
    switch (form) {
      case "object":
        return value;
      case "json":
        return BsonTypeTable.toJson(value, path);
      case "plain":
        return BsonTypeTable.toPlain(value, path);
    }
  }

  /**
   * The serialized form of a populated value (documents in their own forms; counts and transform results as
   * they are).
   *
   * @param value - The populated value.
   * @param walk - The settings of the walk.
   * @returns The serialized value.
   */
  private static populated(value: unknown, walk: Walk): unknown {
    if (value === null || value === undefined) return value;
    if (DocumentStates.is(value))
      return DocumentSerializer.document(value as Doc, DocumentStates.of(value).schema, "", walk);
    if (Array.isArray(value)) return value.map((item: unknown) => DocumentSerializer.populated(item, walk));
    if (BsonGuards.isMap(value)) {
      const entries: [string, unknown][] = [...value].map(([key, item]) => [
        String(key),
        DocumentSerializer.populated(item, walk),
      ]);
      if (walk.form !== "json") return new Map(entries);
      const record: Doc = {};
      for (const [key, item] of entries) put(record, key, item);
      return record;
    }
    return value;
  }

  /**
   * An element of a container (its node's `get` applied with `getters: true`).
   *
   * @param node - The element node.
   * @param value - The element value.
   * @param parent - The container's path.
   * @param key - The element's index or Map key.
   * @param walk - The settings of the walk.
   * @returns The serialized element.
   */
  private static element(node: PathNode, value: unknown, parent: string, key: string | number, walk: Walk): unknown {
    const read =
      walk.getters && typeof node.options.get === "function"
        ? (node.options.get as (v: unknown) => unknown)(value)
        : value;
    return DocumentSerializer.value(node, read, parent, key, walk);
  }

  /**
   * The form of `value` of `node` at `parent.key` (the path is joined only where it can be needed).
   *
   * @param node - The field node.
   * @param value - The value to serialize.
   * @param parent - The parent path.
   * @param key - The key or index of the value in its parent.
   * @param walk - The settings of the walk.
   * @returns The serialized value.
   */
  private static value(node: PathNode, value: unknown, parent: string, key: string | number, walk: Walk): unknown {
    if (value === null || value === undefined) return value;
    switch (node.kind) {
      case "array": {
        if (!Array.isArray(value)) return value;
        const path = join(parent, key);
        return value.map((item: unknown, index) =>
          item === null ? null : DocumentSerializer.element(node.element, item, path, index, walk),
        );
      }
      case "map": {
        if (!BsonGuards.isMap(value)) return value;
        const path = join(parent, key);
        const entries: [string, unknown][] = [...value].map(([name, item]) => [
          String(name),
          item === null ? null : DocumentSerializer.element(node.value, item, path, String(name), walk),
        ]);
        if (walk.form !== "json") return new Map(entries);
        const record: Doc = {};
        for (const [name, item] of entries) put(record, name, item);
        return record;
      }
      case "subdocument":
      case "nested": {
        if (typeof value !== "object") return value;
        const schema = Subdocuments.isSubdocument(value) ? Subdocuments.schemaOf(value) : node.schema;
        return DocumentSerializer.document(value as Doc, schema, join(parent, key), walk);
      }
      default:
        /* The values whose every form is themselves (no path, no table lookup): a string, a boolean, a finite
           number (`toJson` refuses only NaN/Infinity, with the path; the other forms keep them). */
        switch (typeof value) {
          case "string":
          case "boolean":
            return value;
          case "number":
            if (walk.form !== "json" || Number.isFinite(value)) return value;
            break;
        }
        switch (walk.form) {
          case "json":
            return BsonTypeTable.toJson(value, join(parent, key));
          case "plain":
            return BsonTypeTable.scalarToPlain(value, join(parent, key));
          case "object":
            return BsonTypeTable.toLean(value, join(parent, key));
        }
    }
  }
}

TrackedProtocol.registerPlainForm(DocumentSerializer.plainOf);
