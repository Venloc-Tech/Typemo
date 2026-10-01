import type { ClientSession } from "mongodb";
import { BsonGuards } from "../bson/bson-guards.ts";
import { CastError } from "../errors/cast-error.ts";
import { QueryError } from "../errors/query-error.ts";
import { StrictModeError } from "../errors/strict-mode-error.ts";
import { PathResolver } from "../operation/steps/path-resolver.ts";
import { ImmutablePolicy } from "../policies/immutable-policy.ts";
import { DocumentPopulate } from "../populate/document-populate.ts";
import { ResponseMask } from "../query/response-mask.ts";
import type { DeleteResult } from "../types/result.ts";
import { ChangeTracker } from "./change-tracker.ts";
import { Collections } from "./collections/collections.ts";
import { HydrationPlan } from "./collections/hydration-plan.ts";
import { Delta } from "./delta.ts";
import { DocumentSave } from "./document-save.ts";
import { DocumentSerializer } from "./document-serializer.ts";
import { DocumentStates } from "./document-state.ts";
import type { DocumentChanges, SaveOptions, ToObjectOptions } from "./document-types.ts";

/*
 * The implementation of the `$`-methods of a root document. The layer class (`DocumentLayer`) only
 * forwards here: one place, tested without the class machinery.
 */

/**
 * A document seen as a bag of fields.
 *
 * @example
 * ```ts
 * const doc: Doc = { name: "Ann" };
 * ```
 */
type Doc = Record<string, unknown>;

/**
 * Something with a `$set(key, value)` of one field: a hydrated subdocument.
 *
 * @example
 * ```ts
 * const setter: FieldSetter = { $set: (key, value) => undefined };
 * ```
 */
interface FieldSetter {
  /**
   * Sets one field.
   *
   * @param key - The field name.
   * @param value - The new value.
   */
  $set(key: string, value: unknown): unknown;
}

/** Matches an array index segment of a dotted path. */
const NUMERIC = /^\d+$/;

/**
 * Defines an own enumerable, writable data property (bypassing any setter on the target).
 *
 * @param target - The object to define the property on.
 * @param key - The property name.
 * @param value - The property value.
 */
const define = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

/** The `$`-methods of hydrated root documents. */
export class DocumentApi {
  /**
   * `$isNew()`: `true` until the document is inserted.
   *
   * @param document - The hydrated document.
   */
  static isNew(document: object): boolean {
    return DocumentStates.of(document).isNew;
  }

  /**
   * `$locals()`: the application's scratch object, the same on every call and never saved.
   *
   * @param document - The hydrated document.
   */
  static locals(document: object): Record<string, unknown> {
    const state = DocumentStates.of(document);
    state.locals ??= {};
    return state.locals;
  }

  /**
   * `$isModified(path?)`: whether the document (or `path`, or something under it) changed since the last load or save.
   *
   * @param document - The hydrated document.
   * @param path - Limits the check to this path.
   */
  static isModified(document: object, path?: string): boolean {
    return ChangeTracker.isModified(document, path);
  }

  /**
   * `$markModified(path)`: forces `path` into the next save as a whole `$set`.
   *
   * @param document - The hydrated document.
   * @param path - A path of the document's schema.
   * @throws {QueryError} When `path` is not a path of the schema.
   */
  static markModified(document: object, path: string): void {
    const state = DocumentStates.of(document);
    if (typeof path !== "string" || !PathResolver.resolve(state.schema, path, "update").ok) {
      throw new QueryError(`$markModified: "${String(path)}" is not a path of ${state.schema.name}`, {
        path: String(path),
      });
    }
    state.marked ??= new Set();
    state.marked.add(path);
  }

  /**
   * `$getChanges()`: the update the next save would send, without side effects. It never throws: what the save
   * would refuse (a container replaced by assignment, stored unknown fields that would be lost, the version key
   * written by hand, …) is listed under `$problems` as path → the message of the error `$save()` throws, and the
   * rest of the update is still returned.
   *
   * @param document - The hydrated document.
   * @returns A frozen map of operators to paths to values, plus `$problems` when the save would be refused.
   */
  static getChanges(document: object): DocumentChanges {
    const problems = new Map<string, string>();
    const parts = Delta.build(document, { problems }).parts;
    if (problems.size === 0) return Object.freeze({ ...parts });
    return Object.freeze({ ...parts, $problems: Object.freeze(Object.fromEntries(problems)) });
  }

  /**
   * `$set(path, value)`: cast at once; a dotted path goes down through subdocuments, array indexes and Map keys.
   *
   * @param document - The hydrated document.
   * @param path - The dotted path to set.
   * @param value - The new value.
   * @throws {CastError} When the first segment is not a field, or the value cannot be cast.
   * @throws {QueryError} When the path is empty, targets a service field, or goes through an absent or non-container value.
   * @throws {StrictModeError} When the field is immutable and the document is not new.
   */
  static set(document: object, path: string, value: unknown): void {
    const state = DocumentStates.of(document);
    if (typeof path !== "string" || path === "") throw new QueryError("$set: a path");
    const [key, ...rest] = path.split(".") as [string, ...string[]];
    const node = state.schema.field(key);
    if (node === undefined) {
      throw new CastError({
        path,
        value,
        expected: state.schema.name,
        reason: "unknown-key",
        detail:
          key === path ? `not a field of ${state.schema.name}` : `"${key}" is not a field of ${state.schema.name}`,
      });
    }
    if (node.service === "version" || node.service === "createdAt" || node.service === "updatedAt") {
      throw new QueryError(`$set: "${key}" is maintained by the core (a service field)`, { path: key });
    }
    if (ImmutablePolicy.bound(node) && !state.isNew) {
      throw new StrictModeError(
        "immutable",
        `$set: "${key}" of ${state.schema.name} is immutable once the document exists`,
        {
          path: key,
        },
      );
    }
    const doc = document as Doc;
    if (rest.length === 0) {
      const cast = Collections.fromInput(node, value, document, key);
      const previous = doc[key];
      if (previous !== cast && HydrationPlan.isContainer(node)) Collections.detach(previous);
      define(document, key, cast);
      if (!HydrationPlan.isContainer(node)) DocumentStates.castOf(state).set(key, cast);
      return;
    }
    DocumentApi.setInside(doc[key], rest, value, path);
  }

  /**
   * Walks the rest of a dotted path inside a container (array, Map or subdocument) and sets the last segment.
   *
   * @param container - The value reached so far.
   * @param segments - The path segments still to walk (at least one).
   * @param value - The new value.
   * @param path - The whole path, for error messages.
   * @throws {QueryError} When the walk meets an absent value, a non-index segment of an array, or a non-container.
   */
  private static setInside(container: unknown, segments: readonly string[], value: unknown, path: string): void {
    const [segment, ...rest] = segments as [string, ...string[]];
    if (container === null || container === undefined) {
      throw new QueryError(`$set: "${path}" goes through an absent value; $set the parent first`, { path });
    }
    if (Array.isArray(container)) {
      if (!NUMERIC.test(segment)) throw new QueryError(`$set: "${path}": an array is entered by an index`, { path });
      const index = Number(segment);
      if (rest.length === 0) {
        (container as unknown as { set(index: number, value: unknown): unknown }).set(index, value);
        return;
      }
      DocumentApi.setInside(container[index], rest, value, path);
      return;
    }
    if (BsonGuards.isMap(container)) {
      if (rest.length === 0) {
        (container as Map<string, unknown>).set(segment, value);
        return;
      }
      DocumentApi.setInside(container.get(segment), rest, value, path);
      return;
    }
    if (typeof (container as Partial<FieldSetter>).$set === "function") {
      if (rest.length === 0) {
        (container as FieldSetter).$set(segment, value);
        return;
      }
      DocumentApi.setInside((container as Doc)[segment], rest, value, path);
      return;
    }
    throw new QueryError(`$set: "${path}" goes through a value that is not a document, an array or a Map`, { path });
  }

  /**
   * `$get(path)`: the value (the field's `get` applied), `undefined` when absent.
   *
   * @param document - The hydrated document.
   * @param path - The dotted path to read.
   * @throws {QueryError} When `path` is not a path of the schema.
   */
  static get(document: object, path: string): unknown {
    const state = DocumentStates.of(document);
    const resolution = PathResolver.resolve(state.schema, path, "update");
    if (!resolution.ok) throw new QueryError(`$get: "${path}" is not a path of ${state.schema.name}`, { path });
    let value: unknown = document;
    for (const segment of path.split(".")) {
      if (value === null || value === undefined) return undefined;
      if (Array.isArray(value)) value = NUMERIC.test(segment) ? value[Number(segment)] : undefined;
      else if (BsonGuards.isMap(value)) value = value.get(segment);
      else if (typeof value === "object") value = Object.hasOwn(value, segment) ? (value as Doc)[segment] : undefined;
      else return undefined;
    }
    const get = resolution.value.node.options.get;
    return value !== undefined && value !== null && typeof get === "function"
      ? (get as (v: unknown) => unknown)(value)
      : value;
  }

  /**
   * `$validate()`: validates the whole document. Values assigned directly (`doc.age = …`) are cast first.
   *
   * @param document - The hydrated document.
   * @throws {CastError} When a directly assigned value cannot be cast (its constraints are not checked then).
   * @throws {ValidationError} When any field is invalid (every issue in one error).
   */
  static validate(document: object): Promise<void> {
    return DocumentSave.validate(document);
  }

  /**
   * `$save(options?)`: inserts (new) or updates (the changes only).
   *
   * @param document - The hydrated document.
   * @param options - Session, timeout and policy of the write.
   * @returns The same document.
   */
  static save(document: object, options?: SaveOptions): Promise<object> {
    return DocumentSave.save(document, options);
  }

  /**
   * `$deleteOne(options?)`: deletes the document by `_id`.
   *
   * @param document - The hydrated document.
   * @param options - Session, timeout and policy of the write.
   */
  static deleteOne(document: object, options?: SaveOptions): Promise<DeleteResult> {
    return DocumentSave.deleteOne(document, options);
  }

  /**
   * `$updateOne(update, options?)`: updates this document by `_id` through the model's pipeline.
   *
   * @param document - The hydrated document.
   * @param update - The update document.
   * @param options - Session, timeout and policy of the write.
   */
  static updateOne(document: object, update: unknown, options?: SaveOptions): Promise<unknown> {
    return DocumentSave.updateOne(document, update, options);
  }

  /**
   * Applies the `mask` option to the serialized COPY (the document and its next save are untouched), before
   * the final transform. The spec is compiled once per spec object (the same tree as `.mask()` of a query).
   *
   * @param document - The hydrated document (its class name labels mask errors).
   * @param value - The serialized copy.
   * @param mask - The mask spec, or `undefined` for none.
   * @returns The masked copy.
   * @throws {StrictModeError} When a mask path is not a path of the document.
   */
  private static masked(document: object, value: unknown, mask: object | undefined): unknown {
    if (mask === undefined) return value;
    const tree = ResponseMask.compile(mask);
    /* Checked like `select` paths: a path the document does not have would mask nothing. */
    ResponseMask.check(tree, DocumentStates.of(document).schema);
    return ResponseMask.apply(tree, value, document.constructor.name);
  }

  /**
   * `$toObject(options)`: plain data shaped by the options of the call only (there are no schema-level defaults).
   * The data written by `save` comes from `DocumentSerializer.data`, never from these forms (Mongoose H168).
   *
   * @param document - The hydrated document.
   * @param options - Serialization options, optionally with a final `transform`.
   * @returns The plain data, or the result of `transform`.
   */
  static toObject(document: object, options: ToObjectOptions & { readonly transform?: unknown } = {}): unknown {
    const plain = DocumentSerializer.toObject(document, DocumentStates.of(document).schema, options);
    const out = DocumentApi.masked(document, plain, options.mask);
    return typeof options.transform === "function" ? (options.transform as (plain: unknown) => unknown)(out) : out;
  }

  /**
   * `$toJSON(options)`: the JSON form shaped by the options of the call.
   *
   * @param document - The hydrated document.
   * @param options - Serialization options, optionally with a final `transform`.
   * @returns The JSON form, or the result of `transform`.
   */
  static toJson(document: object, options: ToObjectOptions & { readonly transform?: unknown } = {}): unknown {
    const json = DocumentSerializer.toJson(document, DocumentStates.of(document).schema, options);
    const out = DocumentApi.masked(document, json, options.mask);
    return typeof options.transform === "function" ? (options.transform as (json: unknown) => unknown)(out) : out;
  }

  /**
   * `$toPlain(options)`: the plain form shaped by the options of the call.
   *
   * @param document - The hydrated document.
   * @param options - Serialization options, optionally with a final `transform`.
   * @returns The plain form, or the result of `transform`.
   */
  static toPlain(document: object, options: ToObjectOptions & { readonly transform?: unknown } = {}): unknown {
    const plain = DocumentSerializer.toPlain(document, DocumentStates.of(document).schema, options);
    const out = DocumentApi.masked(document, plain, options.mask);
    return typeof options.transform === "function" ? (options.transform as (plain: unknown) => unknown)(out) : out;
  }

  /**
   * `$populated(path)`: the stored ids behind a populated path.
   *
   * @param document - The hydrated document.
   * @param path - The populated path.
   */
  static populated(document: object, path: string): unknown {
    return DocumentPopulate.populated(document, path);
  }

  /**
   * `$depopulate(key?)`: the stored ids back in place of the populated values.
   *
   * @param document - The hydrated document.
   * @param key - Limits the depopulation to this field.
   */
  static depopulate(document: object, key?: string): object {
    return DocumentPopulate.depopulate(document, key);
  }

  /**
   * `$populate(spec)`: populates the document; a populated path is populated again from its ids.
   *
   * @param document - The hydrated document.
   * @param spec - A path or a populate spec.
   */
  static populate(document: object, spec: unknown): Promise<object> {
    return DocumentPopulate.populate(document, spec);
  }

  /**
   * `$assertPopulated(path)`: the document when the path is populated.
   *
   * @param document - The hydrated document.
   * @param spec - A path or a populate spec.
   * @throws {QueryError} When the path is not populated.
   */
  static assertPopulated(document: object, spec: unknown): object {
    return DocumentPopulate.assertPopulated(document, spec);
  }

  /**
   * `$is(Class)`: `true` when the document was read as `cls` or one of its discriminators. The document's
   * class is the one its discriminator value selected when it was read or created.
   *
   * @param document - The hydrated document.
   * @param cls - The root class or a discriminator class of the document's hierarchy.
   * @throws {QueryError} When `cls` is not a class of the hierarchy (a check that can never be true is a bug).
   */
  static is(document: object, cls: unknown): boolean {
    const schema = DocumentStates.of(document).schema;
    const root = schema.root;
    if (typeof cls !== "function") throw new QueryError("$is: a class of the document's hierarchy");
    const known = root.target === cls || [...root.discriminators.values()].some((member) => member.target === cls);
    if (!known) {
      throw new QueryError(
        `$is: ${cls.name || "the class"} is not ${root.name} or one of its discriminators (the document is a ${schema.name})`,
      );
    }
    const target = schema.target as abstract new () => object;
    return (
      target === cls || Object.prototype.isPrototypeOf.call((cls as { prototype: object }).prototype, target.prototype)
    );
  }

  /**
   * `$session(session?)`: reads the document's session, or sets it (`null` clears) when one is given.
   *
   * @param document - The hydrated document.
   * @param session - The session to set; `undefined` only reads.
   * @returns The document's session after the call.
   */
  static session(document: object, session?: ClientSession | null): ClientSession | undefined {
    const state = DocumentStates.of(document);
    if (session !== undefined) state.session = session;
    return state.session ?? undefined;
  }
}
