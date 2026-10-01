import type { ClientSession } from "mongodb";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { Connection } from "../connection/connection.ts";
import { CastError } from "../errors/cast-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { SchemaWalker } from "../schema/compiler/schema-walker.ts";
import { HydrationSupport } from "../schema/entity/hydration-support.ts";
import { Collections, type FromStoredOptions } from "./collections/collections.ts";
import { FieldBaseline } from "./collections/field-baseline.ts";
import { HydrationPlan, HydrationPlans, type StoredContainer } from "./collections/hydration-plan.ts";
import { DocumentLayer } from "./document-layer.ts";
import { type DocumentState, DocumentStates, type Selection } from "./document-state.ts";

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
 * What a read knows about the document besides its data.
 *
 * @example
 * ```ts
 * const info: HydrateInfo = Documents.readInfo(schema, { name: 1 }, undefined);
 * ```
 */
export interface HydrateInfo {
  /** Which top-level fields the read loaded. */
  readonly selection: Selection;
  /** Code keys of arrays loaded in part. */
  readonly partial: ReadonlySet<string>;
  /** The session of the read. */
  readonly session?: ClientSession | undefined;
  /**
   * The record comes from the DRIVER (a read, a cursor, populate, `findOneAnd*`, a change event): every key is
   * an own enumerable data property, so the pass over the stored keys for keys the schema does not know runs
   * only when their count differs from the fields found. Absent (`Model.hydrate(raw)`, any record a user
   * built): the pass always runs — a schema field that is a non-enumerable own property would hide an unknown
   * key from the count.
   */
  readonly driver?: boolean;
}

/** The shared empty set of partially loaded arrays. */
const NO_PARTIAL: ReadonlySet<string> = new Set<string>();
/** The selection of a read without a projection. */
const ALL_SELECTED: Selection = Object.freeze({ mode: "all" });
/** What a read of a user-built record without a projection loaded. */
const ALL: HydrateInfo = Object.freeze({ selection: ALL_SELECTED, partial: NO_PARTIAL });
/** Collection options for a driver record. */
const FROM_DRIVER: FromStoredOptions = Object.freeze({ driver: true });
/** What a read from the driver without a projection loaded. */
const DRIVER_ALL: HydrateInfo = Object.freeze({ selection: ALL_SELECTED, partial: NO_PARTIAL, driver: true });

/** Hydration plans of root document schemas (on the document layer). */
const PLANS = new WeakMap<CompiledSchema, HydrationPlan>();

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
 * Whether a field is a service field the core fills at save, never as a default at creation.
 *
 * @param node - The field node.
 * @returns `true` for `createdAt`, `updatedAt` and the version field.
 */
const isSaveField = (node: PathNode): boolean =>
  node.service === "createdAt" || node.service === "updatedAt" || node.service === "version";

/**
 * Factories of hydrated root documents. Documents come from a READ (`hydrate`: the stored form, trusted,
 * database names) or from NEW input (`create`: cast once, code names). Either way the document IS an instance
 * of the entity class — `Reflect.construct(Entity, [], Layer)` runs the user's no-arg constructor and gives the
 * `$`-methods of the layer; the own `undefined` properties of schema paths (define semantics) are deleted; then
 * the data is assigned as own enumerable properties, containers and subdocuments through the typed collections.
 *
 * Defaults: a new document gets them at once; a READ document missing a SELECTED field with a default gets it
 * too, as a change — the next save writes it (a field a projection left out never gets one: Mongoose H445
 * overwrote real data with defaults of deselected paths).
 */
export class Documents {
  /**
   * `ctx.locals` key under which a model's executor leaves its connection, so the post-processing of a
   * read can bind the documents it hydrates to it (their `save` runs through that connection's model).
   */
  static readonly CONNECTION: symbol = Symbol("typemo.document.connection");

  /** What a read from the driver without a projection loaded: everything. */
  static readonly DRIVER: HydrateInfo = DRIVER_ALL;

  /**
   * Whether a value is a hydrated root document.
   *
   * @param value - The value to test.
   * @returns `true` for a hydrated root document.
   */
  static is(value: unknown): value is object {
    return DocumentStates.is(value);
  }

  /**
   * A document read from the server (stored form: database names, driver values).
   *
   * @param connection - The connection the document belongs to.
   * @param base - The schema of the read model; a discriminator's schema is chosen by the stored key.
   * @param raw - The stored record.
   * @param info - What the read loaded.
   * @returns The hydrated document.
   */
  static hydrate(
    connection: Connection,
    base: CompiledSchema,
    raw: Readonly<Record<string, unknown>>,
    info: HydrateInfo = ALL,
  ): object {
    const schema = Documents.storedSchema(base, raw);
    const { doc, plan } = Documents.instantiate(schema);
    const baseline = FieldBaseline.empty(plan);
    const state: DocumentState = {
      schema,
      plan,
      connection,
      isNew: false,
      deleted: false,
      saving: false,
      baseline,
      loaded: baseline,
      cast: undefined,
      marked: undefined,
      version: undefined,
      selection: info.selection,
      partial: info.partial,
      session: info.session,
      locals: undefined,
    };
    DocumentStates.set(doc, state);
    /* One pass over the fields in schema order, shared with the subdocuments (`HydrationPlans.fill`). Keys the
       schema does not know (a text score, a computed field of a projection) are kept as they came: the query
       asked for them; they are not data of the schema and are never saved (Mongoose H023) — never over a member
       of the class (Mongoose H474/H069), never under the code name of a renamed field. */
    HydrationPlans.fill(doc, plan, baseline, raw, info.driver !== true, Documents.field, info);
    const version = plan.version === undefined ? undefined : doc[plan.version.key];
    if (typeof version === "number") state.version = version;
    if (plan.defaults.length > 0) Documents.applyDefaults(doc, state);
    return doc;
  }

  /**
   * A container field of a stored root document: tracked, linked to the document, partial when loaded in part.
   * An arrow because it is passed as a callback.
   */
  private static readonly field: StoredContainer<HydrateInfo> = (field, stored, doc, info) => {
    const partial = info.partial;
    const driver = info.driver === true;
    return Collections.fromStored(
      field.node,
      stored,
      doc,
      field.key,
      partial.size === 0 ? (driver ? FROM_DRIVER : undefined) : { partial: partial.has(field.key), driver },
    );
  };

  /**
   * A new document from user input: every field cast once, defaults applied.
   *
   * @param connection - The connection the document belongs to.
   * @param base - The schema of the model; a discriminator's schema is chosen by the input's key.
   * @param input - The user input.
   * @returns The new document.
   * @throws {CastError} When the input is not an object, has a key the schema does not know, or a value that
   * cannot be cast.
   */
  static create(connection: Connection, base: CompiledSchema, input: unknown): object {
    if (typeof input !== "object" || input === null || Array.isArray(input) || BsonGuards.tagOf(input) !== undefined) {
      throw new CastError({
        path: "",
        value: input,
        expected: base.name,
        reason: "type",
        detail: "a document is an object",
      });
    }
    const record = input as Readonly<Record<string, unknown>>;
    const schema = Documents.inputSchema(base, record);
    for (const key of Object.keys(record)) {
      if (schema.field(key) === undefined) {
        throw new CastError({
          path: key,
          value: record[key],
          expected: schema.name,
          reason: "unknown-key",
          detail: `not a field of ${schema.name}`,
        });
      }
    }
    const { doc, plan } = Documents.instantiate(schema);
    const cast = new Map<string, unknown>();
    const state: DocumentState = {
      schema,
      plan,
      connection,
      isNew: true,
      deleted: false,
      saving: false,
      baseline: FieldBaseline.empty(plan),
      loaded: undefined,
      cast,
      marked: undefined,
      version: undefined,
      selection: ALL_SELECTED,
      partial: NO_PARTIAL,
      session: undefined,
      locals: undefined,
    };
    DocumentStates.set(doc, state);
    for (const node of schema.fields) {
      let value: unknown;
      if (Object.hasOwn(record, node.key)) {
        value = Collections.fromInput(node, record[node.key], doc, node.key);
      } else if (node.service === "discriminatorKey" && schema.discriminator !== undefined) {
        value = schema.discriminator.value;
      } else if (node.defaultValue !== undefined && !isSaveField(node)) {
        value = Documents.defaultOf(node, doc);
      } else {
        continue;
      }
      if (value === undefined) continue;
      define(doc, node.key, value);
      if (!HydrationPlan.isContainer(node)) cast.set(node.key, value);
    }
    return doc;
  }

  /**
   * What a read's projection (database form, after the policies) loaded: the selected top-level fields,
   * and the arrays loaded in part — `{ arr: { $slice } }`, `{ arr: { $elemMatch } }`, `{ "arr.$": 1 }`
   * (Mongoose H033/H503/H512: saving such an array whole would destroy the elements that were not loaded). The
   * record is the driver's.
   *
   * @param schema - The compiled schema.
   * @param projection - The projection in database form, if any.
   * @param session - The session of the read.
   * @returns What the read loaded.
   */
  static readInfo(
    schema: CompiledSchema,
    projection: Readonly<Record<string, unknown>> | undefined,
    session: ClientSession | undefined,
  ): HydrateInfo {
    if (projection === undefined || Object.keys(projection).length === 0) return { ...DRIVER_ALL, session };
    const byDbKey = new Map(schema.fields.map((node) => [node.dbKey, node.key]));
    const include = new Set<string>();
    const exclude = new Set<string>();
    const partial = new Set<string>();
    for (const [path, spec] of Object.entries(projection)) {
      const [head = path, ...rest] = path.split(".");
      const key = byDbKey.get(head) ?? head;
      if (BsonGuards.isPlainObject(spec)) {
        if ("$slice" in spec) partial.add(key);
        if ("$elemMatch" in spec) {
          partial.add(key);
          include.add(key);
        }
        /* `$meta`: a computed key, no selection. */
        continue;
      }
      if (rest.length === 1 && rest[0] === "$") {
        partial.add(key);
        include.add(key);
        continue;
      }
      if (spec === 0 || spec === false) {
        /* An excluded sub-path leaves the field loaded in part (it is selected, not whole). */
        if (rest.length === 0) exclude.add(key);
      } else {
        include.add(key);
      }
    }
    const selection: Selection =
      include.size > 0
        ? {
            mode: "include",
            keys: projection._id === 0 || projection._id === false ? include : new Set([...include, "_id"]),
          }
        : exclude.size > 0
          ? { mode: "exclude", keys: exclude }
          : { mode: "all" };
    return { selection, partial, session, driver: true };
  }

  /**
   * Removes a top-level field a read loaded only for Typemo's own use (populate adds the foreign field to
   * a `select` that left it out, to match the documents): the document is then exactly what the select asked
   * for — the field is not loaded (not saved, not validated, no default), as its type says.
   *
   * @param document - The hydrated document.
   * @param key - The code key of the field to remove.
   */
  static forget(document: object, key: string): void {
    const state = DocumentStates.of(document);
    delete (document as Doc)[key];
    state.baseline.delete(key);
    state.loaded?.delete(key);
    state.cast?.delete(key);
    const selection = state.selection;
    state.selection =
      selection.mode === "include"
        ? { mode: "include", keys: new Set([...selection.keys].filter((name) => name !== key)) }
        : selection.mode === "exclude"
          ? { mode: "exclude", keys: new Set([...selection.keys, key]) }
          : { mode: "exclude", keys: new Set([key]) };
  }

  /**
   * A fresh instance of the schema's class with the document layer, no own `undefined` schema properties, and
   * the plan of the schema (built from the first instance; `clean` skipped when the constructor leaves no such
   * property).
   *
   * @param schema - The compiled schema.
   * @returns The instance and the hydration plan.
   */
  private static instantiate(schema: CompiledSchema): { readonly doc: Doc; readonly plan: HydrationPlan } {
    const doc = Reflect.construct(schema.target, [], DocumentLayer.of(schema.target)) as Doc;
    const plan = HydrationPlans.of(PLANS, schema, doc);
    if (plan.clean) HydrationSupport.clean(schema, doc);
    return { doc, plan };
  }

  /**
   * Applies the defaults of the selected fields a stored document lacks (a change: the next save writes them).
   *
   * @param doc - The hydrated document.
   * @param state - Its state.
   */
  private static applyDefaults(doc: Doc, state: DocumentState): void {
    for (const field of state.plan.defaults) {
      const node = field.node;
      if (Object.hasOwn(doc, node.key)) continue;
      if (!DocumentStates.isSelected(state, node.key)) continue;
      const value = Documents.defaultOf(node, doc);
      if (value === undefined) continue;
      HydrationPlans.put(doc, field, value);
      if (!field.container) DocumentStates.castOf(state).set(node.key, value);
    }
  }

  /**
   * The default of `node` as a field value of `doc`. The default is already cast (the compiler cast a
   * static default into a fresh copy): a container goes through its stored form, so no `set` runs twice.
   *
   * @param node - The field node.
   * @param doc - The document the field belongs to.
   * @returns The default value, or `undefined` when there is none.
   */
  private static defaultOf(node: PathNode, doc: Doc): unknown {
    const value = node.defaultValue?.();
    if (value === null || value === undefined || !HydrationPlan.isContainer(node)) return value;
    return Collections.fromStored(node, SchemaWalker.encodeValue(node, value), doc, node.key);
  }

  /**
   * The discriminator schema a stored document names (the base when absent or unknown).
   *
   * @param base - The schema of the read model.
   * @param raw - The stored record.
   * @returns The schema to hydrate with.
   */
  private static storedSchema(base: CompiledSchema, raw: Readonly<Record<string, unknown>>): CompiledSchema {
    if (base.discriminators.size === 0) return base;
    const key = base.field(base.discriminatorKey)?.dbKey ?? base.discriminatorKey;
    return base.root.discriminatorFor(raw[key]) ?? base;
  }

  /**
   * The discriminator schema new input names (its key), checked like the cast of a document.
   *
   * @param base - The schema of the model.
   * @param input - The user input.
   * @returns The schema to build the document with.
   * @throws {CastError} When the input names a discriminator value that does not exist.
   */
  private static inputSchema(base: CompiledSchema, input: Readonly<Record<string, unknown>>): CompiledSchema {
    const key = base.discriminatorKey;
    if (base.discriminators.size === 0 || !Object.hasOwn(input, key)) return base;
    const value = input[key];
    const selected = base.root.discriminatorFor(value);
    if (selected === undefined) {
      if (base.discriminator !== undefined && value === base.discriminator.value) return base;
      throw new CastError({
        path: key,
        value,
        expected: base.root.name,
        reason: "type",
        detail: `${JSON.stringify(value)} is not a discriminator value of ${base.root.name} (known: ${[...base.discriminators.keys()].join(", ")})`,
      });
    }
    return selected;
  }
}
