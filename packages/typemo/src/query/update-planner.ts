import { type UpdatePipelineFor, UpdatePipelines } from "../aggregate/expressions/public.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import { QueryError } from "../errors/query-error.ts";
import type { PlanDocument } from "./plan.ts";
import { PlanValues } from "./plan-values.ts";

/*
 * The runtime twin of `types/update.ts` for what needs no schema: the update is an object of known
 * operators or an update-pipeline callback of the pipeline builder, nothing is empty, a
 * path is not changed by two operators (server code 40), operand keys are paths (not operators, Mongoose H105),
 * `$rename` targets are paths (Mongoose H172), and `arrayFilters` match the `$[id]` identifiers of the update
 * exactly (the server refuses a missing or an unused filter; the same identifier twice in one path is
 * ambiguous — Mongoose gh-7431 "same array filter"). Paths are checked against the schema later, by the
 * operation pipeline.
 */

/** The update operators a plan accepts. */
const OPERATORS = new Set([
  "$set",
  "$setOnInsert",
  "$unset",
  "$inc",
  "$mul",
  "$min",
  "$max",
  "$currentDate",
  "$rename",
  "$push",
  "$addToSet",
  "$pull",
  "$pullAll",
  "$pop",
  "$bit",
]);

/** Matches the `$[id]` array-filter identifiers of an update path. */
const IDENTIFIER = /\.\$\[([^\]]*)\]/g;

/**
 * The update and its `arrayFilters` of a plan, checked and copied.
 *
 * @example
 * const planned: PlannedUpdate = { update: { $set: { "items.$[i].qty": 1 } }, arrayFilters: [{ "i.sku": "a" }] };
 */
export interface PlannedUpdate {
  /** An object of operators, or the stages of an update pipeline (`UpdatePipelines.compile`). */
  readonly update: PlanDocument | readonly PlanDocument[];
  /** The filters of the `$[id]` identifiers used by the update. */
  readonly arrayFilters?: readonly PlanDocument[];
}

/**
 * Checks and copies updates.
 *
 * @example
 * const { update } = UpdatePlanner.plan({ $set: { name: "a" }, $inc: { age: 1 } }, undefined);
 */
export class UpdatePlanner {
  /**
   * Checks an update and its `arrayFilters` and returns frozen copies.
   *
   * @param update - An object of update operators, or an update-pipeline callback.
   * @param arrayFilters - The `arrayFilters` given with the update, if any.
   * @returns The planned update.
   * @throws {QueryError} When the update is empty or malformed, an operator is unknown, a path is changed twice,
   * a `$rename` target is invalid, or the `arrayFilters` do not match the identifiers of the update.
   */
  static plan(update: unknown, arrayFilters: unknown): PlannedUpdate {
    if (typeof update === "function") return UpdatePlanner.pipeline(update as UpdatePipelineFor<unknown>, arrayFilters);
    if (Array.isArray(update)) {
      throw new QueryError(
        "update: an update pipeline is built with the pipeline builder: updateOne(filter, (p) => p.set({ … })), not passed as an array",
      );
    }
    if (!BsonGuards.isPlainObject(update)) throw new QueryError("update: an object of update operators");
    const operators = Object.keys(update);
    if (operators.length === 0) throw new QueryError("update: an empty update changes nothing");
    const copy = PlanValues.copyObject(update, "", "update");
    const seen = new Map<string, string>();
    const identifiers = new Set<string>();
    for (const operator of operators) {
      if (!operator.startsWith("$")) {
        throw new QueryError(`update: "${operator}" is not an update operator (write { $set: { … } })`, {
          path: operator,
        });
      }
      if (!OPERATORS.has(operator)) throw new QueryError(`update: unknown operator "${operator}"`, { path: operator });
      const operand = copy[operator];
      if (!BsonGuards.isPlainObject(operand))
        throw new QueryError(`update: "${operator}" takes an object of paths`, { path: operator });
      const paths = Object.keys(operand);
      if (paths.length === 0) throw new QueryError(`update: operator "${operator}" is empty`, { path: operator });
      for (const path of paths) {
        if (path.startsWith("$")) {
          throw new QueryError(`update: "${operator}.${path}" — a path is expected, not an operator`, {
            path: `${operator}.${path}`,
          });
        }
        const other = seen.get(path);
        if (other !== undefined) {
          throw new QueryError(`update: "${path}" is changed by ${other} and ${operator} (server code 40)`, { path });
        }
        seen.set(path, operator);
        UpdatePlanner.collectIdentifiers(path, identifiers);
        if (operator === "$rename") {
          const target = operand[path];
          if (typeof target !== "string" || target === "" || target.includes("$")) {
            throw new QueryError(`update: $rename "${path}" needs a target path`, { path });
          }
        }
      }
    }
    const filters = UpdatePlanner.arrayFilters(arrayFilters, identifiers);
    return filters === undefined ? { update: copy } : { update: copy, arrayFilters: filters };
  }

  /**
   * An update pipeline: the callback of the pipeline builder in its "update" mode, compiled to stages.
   *
   * @param build - The pipeline builder callback.
   * @param arrayFilters - The `arrayFilters` given with the update; must be absent.
   * @returns The planned update whose `update` is the frozen list of stages.
   * @throws {QueryError} When `arrayFilters` is given.
   */
  private static pipeline(build: UpdatePipelineFor<unknown>, arrayFilters: unknown): PlannedUpdate {
    /* The server refuses arrayFilters with a pipeline update (it has no positional paths). */
    if (arrayFilters !== undefined) throw new QueryError("arrayFilters: not allowed with an update pipeline");
    const stages = UpdatePipelines.compile(build);
    return {
      update: Object.freeze(
        stages.map((stage, index) => PlanValues.copy(stage, String(index), "update pipeline") as PlanDocument),
      ),
    };
  }

  /**
   * Collects the `$[id]` identifiers of an update path.
   *
   * @param path - The update path.
   * @param into - The set that receives the identifiers.
   * @throws {QueryError} When the same identifier appears twice in the path.
   */
  private static collectIdentifiers(path: string, into: Set<string>): void {
    const own = new Set<string>();
    for (const match of path.matchAll(IDENTIFIER)) {
      const id = match[1] ?? "";
      if (id === "") continue;
      if (own.has(id)) throw new QueryError(`update: "${path}" uses the array filter "${id}" twice`, { path });
      own.add(id);
      into.add(id);
    }
  }

  /**
   * Collects the identifiers an array filter names: the first segment of each key, through logical operators.
   *
   * @param filter - One array filter.
   * @param into - The set that receives the identifiers.
   */
  private static identifiersOf(filter: PlanDocument, into: Set<string>): void {
    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith("$")) {
        if (Array.isArray(value))
          for (const clause of value) if (BsonGuards.isPlainObject(clause)) UpdatePlanner.identifiersOf(clause, into);
        continue;
      }
      into.add(key.split(".")[0] ?? key);
    }
  }

  /**
   * Checks the `arrayFilters` against the identifiers the update uses: each one needs a filter and each filter
   * must be used.
   *
   * @param filters - The `arrayFilters` given, if any.
   * @param used - The identifiers of the update.
   * @returns The frozen copies of the filters, or `undefined` when there are none.
   * @throws {QueryError} On a missing, unused or malformed filter.
   */
  private static arrayFilters(filters: unknown, used: ReadonlySet<string>): readonly PlanDocument[] | undefined {
    if (filters === undefined) {
      const [first] = used;
      if (first !== undefined)
        throw new QueryError(`arrayFilters: no filter for the identifier "${first}" of the update`);
      return undefined;
    }
    if (!Array.isArray(filters) || filters.length === 0)
      throw new QueryError("arrayFilters: a non-empty list of filters");
    const copies = filters.map((filter: unknown, index) => {
      if (!BsonGuards.isPlainObject(filter)) throw new QueryError(`arrayFilters: element ${index} is not a filter`);
      return PlanValues.filter(filter, "arrayFilters", String(index));
    });
    const named = new Set<string>();
    for (const copy of copies) UpdatePlanner.identifiersOf(copy, named);
    for (const id of used)
      if (!named.has(id)) throw new QueryError(`arrayFilters: no filter for the identifier "${id}" of the update`);
    for (const id of named) {
      if (!used.has(id))
        throw new QueryError(`arrayFilters: the filter for "${id}" is not used by the update (the server refuses it)`);
    }
    return Object.freeze(copies);
  }
}
