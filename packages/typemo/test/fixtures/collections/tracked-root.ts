/*
 * A minimal stand-in for the document layer in the collection tests: a root object whose fields
 * are hydrated through `Collections.fromStored`, and a save that merges the ops of every field, sends
 * them with the raw driver and resets. The real `Document.save` lives in the document layer; this keeps
 * the collections testable alone.
 */
import type { Collection, Document } from "mongodb";
import {
  BsonGuards,
  Collections,
  type CompiledSchema,
  type EntityClass,
  type HydratedFields,
  type OpsForm,
  SchemaCompiler,
  SchemaWalker,
  UpdateOps,
  type UpdateParts,
} from "../../../src/internal.ts";
import { Doc } from "./collection-entities.ts";

/** The compiled schema of `Doc`, the default entity of the tracked roots. */
export const DOC_SCHEMA: CompiledSchema = SchemaCompiler.compile(Doc);

/** A hydrated root of `T`: its fields as tracked values. */
export class TrackedRoot<T extends object = Doc> {
  readonly fields: Record<string, unknown> = {};

  private constructor(
    readonly schema: CompiledSchema,
    readonly id: unknown,
  ) {}

  /**
   * Hydrates a stored document into tracked fields.
   *
   * @param raw - the stored document
   * @param schema - the compiled schema of the document
   * @param partial - the keys hydrated as partially loaded
   * @returns the tracked root
   */
  static hydrate<E extends object = Doc>(
    raw: Readonly<Record<string, unknown>>,
    schema: CompiledSchema = DOC_SCHEMA,
    partial: readonly string[] = [],
  ): TrackedRoot<E> {
    const root = new TrackedRoot<E>(schema, raw._id);
    for (const node of schema.fields) {
      if (!Object.hasOwn(raw, node.dbKey)) continue;
      root.fields[node.key] = Collections.fromStored(node, raw[node.dbKey], root.fields, node.key, {
        partial: partial.includes(node.key),
      });
    }
    return root;
  }

  /**
   * Loads a `Doc` document.
   *
   * @param collection - the collection to read
   * @param id - the `_id` of the document
   * @param partial - the keys hydrated as partially loaded
   * @returns the tracked root
   * @throws when the document is missing
   */
  static async load(collection: Collection, id: unknown, partial: readonly string[] = []) {
    const raw = await collection.findOne({ _id: id } as Document);
    if (raw === null) throw new Error("seed missing");
    return TrackedRoot.hydrate<Doc>(raw, DOC_SCHEMA, partial);
  }

  /**
   * Loads a document of any entity from its collection.
   *
   * @param entity - the entity class
   * @param collection - the collection to read
   * @param id - the `_id` of the document
   * @returns the tracked root
   * @throws when the document is missing
   */
  static async loadOf<E extends object>(
    entity: EntityClass<E>,
    collection: Collection,
    id: unknown,
  ): Promise<TrackedRoot<E>> {
    const raw = await collection.findOne({ _id: id } as Document);
    if (raw === null) throw new Error("document missing");
    return TrackedRoot.hydrate<E>(raw, SchemaCompiler.compile(entity));
  }

  /** The fields typed as the hydrated document (what the document type gives). */
  get doc(): HydratedFields<T> {
    /* cast: the fields record is built from the schema of T */
    return this.fields as HydratedFields<T>;
  }

  /**
   * A field value, typed by the caller.
   *
   * @param key - the field key
   * @returns the value
   */
  get<V>(key: string): V {
    /* cast: the caller states the type of the field */
    return this.fields[key] as V;
  }

  /**
   * The pending update operations of every field.
   *
   * @param form - the key form of the operations (`db` by default)
   * @returns the merged update
   */
  ops(form: OpsForm = "db"): UpdateParts {
    return UpdateOps.merge(Object.values(this.fields).map((value) => Collections.toUpdateOps(value, form).ops));
  }

  /** Whether any field has pending changes. */
  hasChanges(): boolean {
    return Object.values(this.fields).some(Collections.hasChanges);
  }

  /**
   * Sends the ops (if any) with the raw driver and resets.
   *
   * @param collection - the collection to update
   * @returns what was sent, or `undefined` when there was nothing to send
   */
  async save(collection: Collection): Promise<UpdateParts | undefined> {
    const update = this.ops("db");
    if (UpdateOps.isEmpty(update)) return undefined;
    await collection.updateOne({ _id: this.id } as Document, update as Document);
    this.reset();
    return update;
  }

  /** Marks every field as saved. */
  reset(): void {
    for (const value of Object.values(this.fields)) Collections.reset(value);
  }

  /**
   * The in-memory state as the server stores it (database names, Maps as records), for comparison with a read.
   *
   * @returns the plain document
   */
  plain(): Record<string, unknown> {
    const out: Record<string, unknown> = { _id: this.id };
    for (const [key, value] of Object.entries(this.fields)) {
      const node = this.schema.field(key);
      if (node === undefined) continue;
      out[node.dbKey] = TrackedRoot.numbers(SchemaWalker.encodeValue(node, Collections.toPlain(value)));
    }
    return out;
  }

  /**
   * `Int32`/`Double` wrappers of the encoder read back as numbers (promoteValues).
   *
   * @param value - an encoded value
   * @returns the value with the wrappers replaced by numbers, at every depth
   */
  private static numbers(value: unknown): unknown {
    if (BsonGuards.isInt32(value) || BsonGuards.isDouble(value)) return value.valueOf();
    if (Array.isArray(value)) return value.map(TrackedRoot.numbers);
    if (BsonGuards.isPojo(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, TrackedRoot.numbers(item)]));
    }
    return value;
  }
}
