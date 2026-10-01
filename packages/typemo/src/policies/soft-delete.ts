import { ConfigurationError } from "../errors/configuration-error.ts";
import type { Model } from "../model/model.ts";
import { ModelInternals } from "../model/model-internals.ts";
import type { WriteBuilder } from "../query/write-builder.ts";
import type { IdOf } from "../types/document-forms.ts";
import type { Filter } from "../types/filter.ts";
import type { DeleteResult, UpdateResult } from "../types/result.ts";
import { SoftDeletePolicy } from "./soft-delete-policy.ts";

/*
 * The explicit operations of the soft delete policy. A delete of a soft-delete model is an update
 * of the delete date by itself; these two do what a delete cannot:
 * - `restore(model, filter)` — the soft-deleted documents that match are live again (delete date `null`);
 * - `purge(model, filter)` — the soft-deleted documents that match are removed FOR GOOD (a live document
 *   is never purged by it: the operation sees deleted documents only).
 * Both are ordinary writes of the model (a `WriteBuilder`: lazy, `.session()`, `.policy()`, hooks, audit,
 * tenant), with the policy context `onlyDeleted` (and `hardDelete` for purge) set explicitly.
 */

/**
 * A filter of `T` that may name any path.
 *
 * @typeParam T - The entity type.
 * @example
 * const filter: AnyFilter<User> = { email: "a@b.c" };
 */
type AnyFilter<T> = Filter<T, true>;

/**
 * Restore and purge of soft-deleted documents.
 *
 * @example
 * await SoftDelete.restore(User, { email: "a@b.c" });
 * await SoftDelete.purge(User, { email: "a@b.c" });
 */
export class SoftDelete {
  /**
   * Brings the soft-deleted documents matching `filter` back (their delete date becomes `null`).
   *
   * @typeParam T - The entity type.
   * @param model - The soft-delete model.
   * @param filter - Selects the documents to restore.
   * @returns A write builder that resolves to the update result.
   * @throws {ConfigurationError} When the model has no soft delete.
   */
  static restore<T extends object>(model: Model<T>, filter: AnyFilter<T>): WriteBuilder<UpdateResult<IdOf<T>>> {
    const field = SoftDelete.field(model, "restore");
    const updateMany = model.updateMany as unknown as (
      filter: unknown,
      update: unknown,
    ) => WriteBuilder<UpdateResult<IdOf<T>>>;
    return updateMany.call(model, filter, { $set: { [field]: null } }).policy({ onlyDeleted: true });
  }

  /**
   * Removes for good the soft-deleted documents matching `filter` (live documents are never touched).
   *
   * @typeParam T - The entity type.
   * @param model - The soft-delete model.
   * @param filter - Selects the documents to remove.
   * @returns A write builder that resolves to the delete result.
   * @throws {ConfigurationError} When the model has no soft delete.
   */
  static purge<T extends object>(model: Model<T>, filter: AnyFilter<T>): WriteBuilder<DeleteResult> {
    SoftDelete.field(model, "purge");
    const deleteMany = model.deleteMany as unknown as (filter: unknown) => WriteBuilder<DeleteResult>;
    return deleteMany.call(model, filter).policy({ onlyDeleted: true, hardDelete: true });
  }

  /**
   * The delete-date path of a model.
   *
   * @typeParam T - The entity type.
   * @param model - The model.
   * @param what - The operation name, for the error.
   * @returns The path of the delete-date field.
   * @throws {ConfigurationError} When the model has no soft delete.
   */
  private static field<T extends object>(model: Model<T>, what: string): string {
    const node = SoftDeletePolicy.fieldOf(ModelInternals.schema(model));
    if (node === undefined) {
      throw new ConfigurationError(
        `SoftDelete.${what}: ${model.modelName} has no soft delete; declare @Schema({ softDelete })`,
      );
    }
    return node.path;
  }
}
