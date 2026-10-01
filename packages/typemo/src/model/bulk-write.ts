import type { UpdatePipelineFor } from "../aggregate/pipeline/update-pipelines.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";
import type { BulkWriteModel } from "../operation/pipeline/execution-plan.ts";
import type { PlanDocument } from "../query/plan.ts";
import { PlanValues } from "../query/plan-values.ts";
import { QuerySpecs } from "../query/query-specs.ts";
import { UpdatePlanner } from "../query/update-planner.ts";
import type { CreateInput, IdOf, Replacement } from "../types/document-forms.ts";
import type { Filter } from "../types/filter.ts";
import type { Update } from "../types/update.ts";

/*
 * `Model.bulkWrite`: the operations are typed by the entity, checked and copied like the builders' input.
 * The input is never mutated (Mongoose replaced documents/filters/updates inside the user's array).
 */

/**
 * An index hint: an index name or a key pattern.
 *
 * @example
 * ```ts
 * const byName: HintOf = "email_1";
 * const byKeys: HintOf = { email: 1 };
 * ```
 */
type HintOf = string | { readonly [path: string]: 1 | -1 | "text" | "2dsphere" | "2d" | "hashed" };

/**
 * One write of `bulkWrite`, typed by the entity `T`. Exactly one key names the operation. The `update` of
 * `updateOne`/`updateMany` is an object of update operators or an update pipeline (the pipeline builder's
 * update mode: `(p) => p.set(() => ({ … }))`), as in `Model.updateOne`.
 *
 * @example
 * ```ts
 * const operations: BulkWriteOperation<User>[] = [
 *   { insertOne: { document: { name: "Ann" } } },
 *   { updateOne: { filter: { name: "Ann" }, update: { $set: { age: 30 } } } },
 *   { deleteMany: { filter: { age: { $lt: 18 } } } },
 * ];
 * ```
 */
export type BulkWriteOperation<T> =
  | { readonly insertOne: { readonly document: CreateInput<T> } }
  | {
      readonly updateOne: {
        readonly filter: Filter<T>;
        readonly update: Update<T> | UpdatePipelineFor<T>;
        readonly upsert?: boolean;
        readonly arrayFilters?: readonly Readonly<Record<string, unknown>>[];
        readonly hint?: HintOf;
      };
    }
  | {
      readonly updateMany: {
        readonly filter: Filter<T>;
        readonly update: Update<T> | UpdatePipelineFor<T>;
        readonly upsert?: boolean;
        readonly arrayFilters?: readonly Readonly<Record<string, unknown>>[];
        readonly hint?: HintOf;
      };
    }
  | {
      readonly replaceOne: {
        readonly filter: Filter<T>;
        readonly replacement: Replacement<T>;
        readonly upsert?: boolean;
        readonly hint?: HintOf;
      };
    }
  | { readonly deleteOne: { readonly filter: Filter<T>; readonly hint?: HintOf } }
  | { readonly deleteMany: { readonly filter: Filter<T>; readonly hint?: HintOf } };

/**
 * The result of `bulkWrite` (driver `BulkWriteResult`, ids typed by `_id`, keys = input indexes).
 *
 * @example
 * ```ts
 * const result: BulkWriteResult<ObjectId> = await Users.bulkWrite([{ insertOne: { document: { name: "Ann" } } }]);
 * result.insertedIds[0]; // the id of the document inserted by operations[0]
 * ```
 */
export interface BulkWriteResult<Id> {
  /** Documents inserted. */
  readonly insertedCount: number;
  /** Documents matched by the update and replace operations. */
  readonly matchedCount: number;
  /** Documents actually changed. */
  readonly modifiedCount: number;
  /** Documents deleted. */
  readonly deletedCount: number;
  /** Documents created by upserts. */
  readonly upsertedCount: number;
  /** Ids of the inserted documents, keyed by the index of the operation. */
  readonly insertedIds: Readonly<Record<number, Id>>;
  /** Ids of the upserted documents, keyed by the index of the operation. */
  readonly upsertedIds: Readonly<Record<number, Id>>;
}

/**
 * The result type of `bulkWrite` on entity `T`.
 *
 * @example
 * ```ts
 * type Result = BulkWriteResultOf<User>; // BulkWriteResult<ObjectId>
 * ```
 */
export type BulkWriteResultOf<T> = BulkWriteResult<IdOf<T>>;

/** The names of the operations `bulkWrite` accepts. */
const KINDS = ["insertOne", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany"] as const;

/**
 * Checks that a value is a plain object.
 *
 * @param value - The value to check.
 * @param what - Where the value is, for the error message.
 * @returns The value as a record.
 * @throws {QueryError} When the value is not a plain object.
 */
const record = (value: unknown, what: string): Readonly<Record<string, unknown>> => {
  if (!BsonGuards.isPlainObject(value)) throw new QueryError(`${what}: an object`);
  return value;
};

/** Checks and copies of `bulkWrite` operations. */
export class BulkWritePlanner {
  /**
   * Frozen copies of the operations; the input is not mutated.
   *
   * @param operations - The operations as the user wrote them.
   * @returns The checked, frozen driver models.
   * @throws {QueryError} When the list or an operation is malformed; the message names the operation's index.
   */
  static plan(operations: readonly unknown[]): readonly BulkWriteModel[] {
    if (!Array.isArray(operations)) throw new QueryError("bulkWrite: a list of operations");
    return Object.freeze(operations.map((operation, index) => BulkWritePlanner.one(operation, index)));
  }

  /**
   * Checks and copies one operation.
   *
   * @param operation - The operation as the user wrote it.
   * @param index - Its position in the list, for error messages.
   * @returns The frozen driver model.
   * @throws {QueryError} When it is not exactly one known operation or its parts are malformed.
   */
  private static one(operation: unknown, index: number): BulkWriteModel {
    const where = `bulkWrite[${index}]`;
    const op = record(operation, where);
    const keys = Object.keys(op);
    const kind = KINDS.find((candidate) => candidate === keys[0]);
    if (keys.length !== 1 || kind === undefined) {
      throw new QueryError(`${where}: one of ${KINDS.join(", ")} (got ${keys.join(", ") || "nothing"})`);
    }
    const spec = record(op[kind], `${where}.${kind}`);
    const hint = spec.hint === undefined ? {} : { hint: QuerySpecs.hint(spec.hint) };
    const filter = (): PlanDocument => PlanValues.filter(record(spec.filter, `${where}.filter`), `${where}.filter`);
    switch (kind) {
      case "insertOne":
        return Object.freeze({
          insertOne: Object.freeze({
            document: PlanValues.copyObject(record(spec.document, `${where}.document`), "", `${where}.document`),
          }),
        });
      case "updateOne":
      case "updateMany": {
        const planned = UpdatePlanner.plan(spec.update, spec.arrayFilters);
        const body = Object.freeze({
          filter: filter(),
          update: planned.update,
          ...(planned.arrayFilters === undefined ? {} : { arrayFilters: planned.arrayFilters }),
          ...(spec.upsert === undefined ? {} : { upsert: spec.upsert === true }),
          ...hint,
        });
        return Object.freeze(kind === "updateOne" ? { updateOne: body } : { updateMany: body });
      }
      case "replaceOne": {
        const replacement = record(spec.replacement, `${where}.replacement`);
        const operator = Object.keys(replacement).find((key) => key.startsWith("$"));
        if (operator !== undefined)
          throw new QueryError(`${where}.replacement: "${operator}" — a replacement has no operators`);
        return Object.freeze({
          replaceOne: Object.freeze({
            filter: filter(),
            replacement: PlanValues.copyObject(replacement, "", `${where}.replacement`),
            ...(spec.upsert === undefined ? {} : { upsert: spec.upsert === true }),
            ...hint,
          }),
        });
      }
      case "deleteOne":
        return Object.freeze({ deleteOne: Object.freeze({ filter: filter(), ...hint }) });
      default:
        return Object.freeze({ deleteMany: Object.freeze({ filter: filter(), ...hint }) });
    }
  }
}
