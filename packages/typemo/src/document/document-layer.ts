import type { ClientSession } from "mongodb";
import type { ClassRef } from "../schema/metadata/metadata-types.ts";
import type { DeleteResult } from "../types/result.ts";
import { DocumentApi } from "./document-api.ts";
import { DocumentInspection, type Inspect } from "./document-inspection.ts";
import type { DocumentChanges, SaveOptions, ToObjectOptions } from "./document-types.ts";

/**
 * A constructor of the layer class of an entity.
 *
 * @example
 * ```ts
 * const layer: Layer = DocumentLayer.of(User);
 * ```
 */
type Layer = abstract new () => object;

/** The layer class of each entity class, built once. */
const LAYERS = new WeakMap<ClassRef, Layer>();

/**
 * Builds and caches the layer of a root document class: a subclass `class extends Entity {}` built ONCE per
 * entity class, whose prototype carries the `$`-methods. A document is created with
 * `Reflect.construct(Entity, [], Layer)`: the user's constructor runs, `doc instanceof Entity` holds,
 * methods, getters and `#private` work, and no foreign prototype is patched. The same technique as the
 * subdocument layer; the method sets differ (a root saves, a subdocument knows its parent).
 *
 * JSON: when the entity class has no `toJSON` of its own, the layer adds one that returns `$toJSON()`, so
 * `JSON.stringify(doc)` gives the serialized forms (a `Map` would otherwise serialize as `{}` and an int64
 * throw).
 */
export class DocumentLayer {
  /**
   * The layer class of `target` (built on first use).
   *
   * @param target - The entity class.
   * @returns The layer class.
   */
  static of(target: ClassRef): Layer {
    const cached = LAYERS.get(target);
    if (cached !== undefined) return cached;
    const layer = DocumentLayer.build(target as abstract new () => object);
    LAYERS.set(target, layer);
    return layer;
  }

  /**
   * Builds the layer class: `class extends target` carrying the `$`-methods of a root document.
   *
   * @param target - The entity class.
   * @returns The layer class.
   */
  private static build(target: abstract new () => object): Layer {
    abstract class DocumentLayerClass extends target {
      /**
       * Whether the document has not been inserted yet.
       *
       * @returns `true` until the first successful insert.
       */
      $isNew(): boolean {
        return DocumentApi.isNew(this);
      }

      /**
       * A root document, not a subdocument (a subdocument answers `false`).
       *
       * @returns `true`.
       */
      $isRoot(): boolean {
        return true;
      }

      /**
       * Free space for the application, created on the first call.
       *
       * @returns The document's locals object.
       */
      $locals(): Record<string, unknown> {
        return DocumentApi.locals(this);
      }

      /**
       * Whether the document, or a path in it, changed since the last load or save.
       *
       * @param path - The path to test; any change counts when omitted.
       * @returns `true` when modified.
       */
      $isModified(path?: string): boolean {
        return DocumentApi.isModified(this, path);
      }

      /**
       * Forces a path into the next update.
       *
       * @param path - The path to mark.
       * @returns This document.
       */
      $markModified(path: string): this {
        DocumentApi.markModified(this, path);
        return this;
      }

      /**
       * The update the next save would send, without side effects.
       *
       * @returns A map of operators to paths to values.
       */
      $getChanges(): DocumentChanges {
        return DocumentApi.getChanges(this);
      }

      /**
       * Assigns a value at a path through the cast pipeline.
       *
       * @param path - The path to set.
       * @param value - The value to cast and assign.
       * @returns This document.
       */
      $set(path: string, value: unknown): this {
        DocumentApi.set(this, path, value);
        return this;
      }

      /**
       * Reads the value at a path.
       *
       * @param path - The path to read.
       * @returns The value, or `undefined` when absent.
       */
      $get(path: string): unknown {
        return DocumentApi.get(this, path);
      }

      /**
       * Validates the whole document.
       *
       * @returns Resolves when the document is valid.
       * @throws {ValidationError} With every issue found.
       */
      $validate(): Promise<void> {
        return DocumentApi.validate(this);
      }

      /**
       * Inserts the document, or writes its changes.
       *
       * @param options - Save options.
       * @returns This document after the save.
       */
      async $save(options?: SaveOptions): Promise<this> {
        await DocumentApi.save(this, options);
        return this;
      }

      /**
       * Deletes the document from the database.
       *
       * @param options - Options of the write.
       * @returns The delete result.
       */
      $deleteOne(options?: SaveOptions): Promise<DeleteResult> {
        return DocumentApi.deleteOne(this, options);
      }

      /**
       * Updates this document by `_id` through the model's pipeline.
       *
       * @param update - The update document.
       * @param options - Session, timeout and policy of the write.
       * @returns The update result.
       */
      $updateOne(update: unknown, options?: SaveOptions): Promise<unknown> {
        return DocumentApi.updateOne(this, update, options);
      }

      /**
       * The plain object of the document; maps stay `Map`s.
       *
       * @param options - Serialization options.
       * @returns The plain object.
       */
      $toObject(options?: ToObjectOptions): unknown {
        return DocumentApi.toObject(this, options);
      }

      /**
       * The JSON-safe form of the document.
       *
       * @param options - Serialization options.
       * @returns The JSON-safe object.
       */
      $toJSON(options?: ToObjectOptions): unknown {
        return DocumentApi.toJson(this, options);
      }

      /**
       * What `console.log` and `util.inspect` print: the class name and the data (`$toObject` without `Hidden` fields).
       *
       * @param depth - The remaining depth.
       * @param options - The inspect options of the caller.
       * @param inspect - The caller's `util.inspect`.
       * @returns The text.
       */
      [DocumentInspection.CUSTOM](depth: number, options: object | undefined, inspect: Inspect): string {
        return DocumentInspection.render(
          this,
          () => DocumentApi.toObject(this, { hidden: false }),
          depth,
          options,
          inspect,
        );
      }

      /**
       * The plain form of the document with plain arrays and objects.
       *
       * @param options - Serialization options.
       * @returns The plain form.
       */
      $toPlain(options?: ToObjectOptions): unknown {
        return DocumentApi.toPlain(this, options);
      }

      /**
       * The stored ids of a populated path.
       *
       * @param path - The populated path.
       * @returns The original ids, or `undefined` when the path is not populated.
       */
      $populated(path: string): unknown {
        return DocumentApi.populated(this, path);
      }

      /**
       * Puts the stored ids back in place of populated documents.
       *
       * @param key - The field to depopulate; every populated field when omitted.
       * @returns This document.
       */
      $depopulate(key?: string): this {
        DocumentApi.depopulate(this, key);
        return this;
      }

      /**
       * Populates references of the loaded document.
       *
       * @param spec - The populate specification.
       * @returns This document after populate.
       */
      async $populate(spec: unknown): Promise<this> {
        await DocumentApi.populate(this, spec);
        return this;
      }

      /**
       * Checks that the given path is populated.
       *
       * @param spec - A path or a populate specification.
       * @returns This document.
       * @throws {QueryError} When the path is not populated.
       */
      $assertPopulated(spec: unknown): this {
        DocumentApi.assertPopulated(this, spec);
        return this;
      }

      /**
       * Whether the document was read as the given class or one of its discriminators.
       *
       * @param cls - The root class or a discriminator class of the document's hierarchy.
       * @returns `true` when the document belongs to it.
       * @throws {QueryError} When `cls` is not a class of the hierarchy.
       */
      $is(cls: unknown): boolean {
        return DocumentApi.is(this, cls);
      }

      /**
       * Reads or sets the session of the document.
       *
       * @param session - The session to set (`null` clears it); omitted to read.
       * @returns The current session when called without an argument, otherwise this document.
       */
      $session(session?: ClientSession | null): unknown {
        const current = DocumentApi.session(this, session);
        return session === undefined ? current : this;
      }
    }
    Object.defineProperty(DocumentLayerClass, "name", { value: target.name });
    if (!("toJSON" in target.prototype)) {
      Object.defineProperty(DocumentLayerClass.prototype, "toJSON", {
        value(this: object): unknown {
          return DocumentApi.toJson(this);
        },
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    return DocumentLayerClass;
  }
}
