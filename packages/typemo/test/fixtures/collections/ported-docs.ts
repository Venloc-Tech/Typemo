/*
 * The Mongoose "new M(...) → save() → findById()" flow of the ported collection tests, without a full
 * document layer: insert through the Typemo model (`create`: the operation pipeline, defaults, cast),
 * read back as a `TrackedRoot` (the tracked fields), save its ops with the driver, read again.
 */
import type { CreateInput, EntityClass } from "../../../src/internal.ts";
import { SchemaCompiler } from "../../../src/internal.ts";
import type { TypemoTestContext } from "../model/model-lifecycle.ts";
import { TrackedRoot } from "./tracked-root.ts";

/** Static helpers of the ported collection tests. */
export class PortedDocs {
  /**
   * Inserts a document through the model and reads it back as a tracked root.
   *
   * @param t - the test context
   * @param entity - the entity class
   * @param input - the document to create
   * @returns the tracked root of the stored document
   */
  static async create<E extends object>(
    t: TypemoTestContext,
    entity: EntityClass<E>,
    input: CreateInput<E>,
  ): Promise<TrackedRoot<E>> {
    /* cast: a generic entity has no _id in its type; a created document always has one */
    const created = (await t.connection.model(entity).create(input)) as unknown as { _id: unknown };
    return PortedDocs.find(t, entity, created._id);
  }

  /**
   * Reads a stored document as a tracked root.
   *
   * @param t - the test context
   * @param entity - the entity class
   * @param id - the `_id` of the document
   * @returns the tracked root
   */
  static find<E extends object>(t: TypemoTestContext, entity: EntityClass<E>, id: unknown): Promise<TrackedRoot<E>> {
    return TrackedRoot.loadOf(entity, t.mongo.db.collection(SchemaCompiler.compile(entity).collection), id);
  }

  /**
   * `await doc.save(); doc = await M.findById(doc._id)`.
   *
   * @param t - the test context
   * @param entity - the entity class
   * @param root - the tracked root to save
   * @returns the tracked root read again after the save
   */
  static async saveAndFind<E extends object>(
    t: TypemoTestContext,
    entity: EntityClass<E>,
    root: TrackedRoot<E>,
  ): Promise<TrackedRoot<E>> {
    await root.save(t.mongo.db.collection(SchemaCompiler.compile(entity).collection));
    return PortedDocs.find(t, entity, root.id);
  }
}
