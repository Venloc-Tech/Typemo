import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { ExpressionPaths } from "../operation/steps/expression-paths.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import type { PopulatePlan } from "../query/plan.ts";
import {
  FIELD_OPERATORS,
  FilterScan,
  type FilterSite,
  GEO_OPERATORS,
  isOperatorObject,
  JAVASCRIPT_OPERATORS,
  LOGICAL_OPERATORS,
  ROOT_OPERATORS,
} from "./filter-scan.ts";
import type { GuardPosition } from "./guard-scan.ts";
import { PolicyErrors } from "./policy-errors.ts";

/*
 * `sanitizeFilter`, always on, and ONE point for every filter of an operation: the
 * query filter (find, findOne, count, distinct, cursor, explain, update/delete/findOneAnd* filters),
 * arrayFilters, `$pull` conditions, every `$match` (top level, `$facet`, `$lookup`/`$unionWith`
 * sub-pipelines), `$graphLookup.restrictSearchWithMatch`, `$geoNear.query`, and populate `match` —
 * the positions Mongoose forgot one by one (H016 count/cursor, H063 `$nor`/nested operators, H164
 * implicit `$in`, H420 `{ $ne: null }` from a request body, CVE-2025-23061 `$where` in populate match).
 *
 * A typed filter already separates operators from values at compile time; at run time the policy
 * refuses what can only be an injection or a mistake:
 * - JavaScript on the server anywhere (`$where`, `$function`, `$accumulator`);
 * - an unknown or misplaced operator (a field operator at the top level, a top-level one under a field);
 * - an object mixing operator keys and field keys (`{ $ne: null, a: 1 }`);
 * - an object of operators INSIDE an operand (`{ name: { $eq: { $ne: null } } }`, `{ $in: [{ $gt: "" }] }`)
 *   or `$`-keys inside a literal value (`{ profile: { bio: { $ne: 1 } } }`): data, not operators;
 * - an array where the path holds a scalar is NOT turned into `$in` (H164): the cast refuses it.
 * What remains valid is the typed grammar: `{ password: { $ne: null } }` IS a valid filter; code that
 * passes request data must pass it as a value (`{ password: input }` — an object there is refused by the
 * cast of a scalar path).
 *
 * NOTE: `GuardScan` (guard-scan.ts) stands in for this guard on input it calls clean — then
 * this guard does NOT run. Any new rule or position here → update `GuardScan`, `POSITIONS` below and the generator
 * and the cases in `test/unit/policies/guard-scan.test.ts`.
 */

/**
 * Appends `key` to a dotted path.
 *
 * @param base - The path so far; empty for the root.
 * @param key - The key to append.
 * @returns The extended path.
 */
const join = (base: string, key: string): string => (base === "" ? key : `${base}.${key}`);

/** Operators whose operand may itself be an object of operators. */
const OPERAND_OPERATORS: ReadonlySet<string> = new Set(["$not", "$elemMatch", ...GEO_OPERATORS]);

/**
 * The sanitize policy.
 *
 * @example
 * SanitizePolicy.filter({ $where: "1" }, "filter"); // throws StrictModeError (sanitize)
 */
export class SanitizePolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "sanitize";

  /** The positions this guard checks (each one is followed by `GuardScan`). */
  static readonly POSITIONS = [
    "filter",
    "arrayFilters",
    "update",
    "update.$pull",
    "updatePipeline",
    "pipeline",
    "pipeline.$match",
    "pipeline.$geoNear.query",
    "pipeline.$graphLookup.restrictSearchWithMatch",
    "pipeline.$lookup.pipeline",
    "pipeline.$unionWith.pipeline",
    "pipeline.$facet",
    "populate.match",
    "populate.populate",
  ] as const satisfies readonly GuardPosition[];

  /**
   * Checks every filter position, update and pipeline of the operation.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} With rule `sanitize` at the first violation.
   */
  run(ctx: OperationContext): void {
    for (const unit of OperationView.units(ctx)) {
      if (unit.filter !== undefined) SanitizePolicy.filter(unit.filter, "filter");
      for (const [index, filter] of (unit.arrayFilters ?? []).entries()) {
        SanitizePolicy.filter(filter, `arrayFilters.${index}`);
      }
      if (unit.update !== undefined) SanitizePolicy.update(unit.update);
    }
    const pipeline = OperationView.pipeline(ctx);
    if (pipeline !== undefined) SanitizePolicy.stages(pipeline, "pipeline");
    SanitizePolicy.populate(OperationView.populate(ctx), "populate");
  }

  /**
   * Checks one query filter.
   *
   * @param filter - The filter.
   * @param at - Where the filter sits, for the error path.
   * @throws {StrictModeError} With rule `sanitize`.
   */
  static filter(filter: unknown, at: string): void {
    if (!BsonGuards.isPlainObject(filter)) {
      throw PolicyErrors.strict("sanitize", `${at}: a filter is an object`, at);
    }
    FilterScan.visit(
      filter,
      (site) => {
        SanitizePolicy.site(site, at);
      },
      at,
    );
  }

  /**
   * Checks one position the filter scan reports.
   *
   * @param site - The position.
   * @param at - Where the filter sits, for the error.
   * @throws {StrictModeError} With rule `sanitize`.
   */
  private static site(site: FilterSite, at: string): void {
    switch (site.kind) {
      case "logical":
        if (!Array.isArray(site.value) || !site.value.every((clause: unknown) => BsonGuards.isPlainObject(clause))) {
          throw PolicyErrors.strict("sanitize", `${site.key} takes a list of filters (at "${site.path}")`, site.path);
        }
        return;
      case "root":
        if (JAVASCRIPT_OPERATORS.has(site.key)) SanitizePolicy.javascript(site.key, site.path);
        if (!ROOT_OPERATORS.has(site.key)) {
          const hint = FIELD_OPERATORS.has(site.key) ? " (a field operator needs a field: { path: { $op: … } })" : "";
          throw PolicyErrors.strict(
            "sanitize",
            `"${site.key}" is not a top-level filter operator${hint} (at "${site.path}")`,
            site.path,
          );
        }
        if (site.key === "$expr") SanitizePolicy.expression(site.value, site.path);
        return;
      case "field":
        SanitizePolicy.fieldValue(site.value, site.path);
        return;
      case "operator":
        SanitizePolicy.operator(site.key, site.value, site.path);
        return;
      case "value":
        throw PolicyErrors.strict("sanitize", `${at}: a filter clause is an object (at "${site.path}")`, site.path);
    }
  }

  /**
   * The value of a field: an object of operators, or data.
   *
   * @param value - The value.
   * @param path - The path of the field.
   * @throws {StrictModeError} With rule `sanitize` for an object that mixes operators and fields, or for `$`-keys
   * inside data.
   */
  private static fieldValue(value: unknown, path: string): void {
    if (!BsonGuards.isPlainObject(value)) {
      SanitizePolicy.literal(value, path);
      return;
    }
    const keys = Object.keys(value);
    const operators = keys.filter((key) => key.startsWith("$"));
    if (operators.length > 0 && operators.length < keys.length) {
      throw PolicyErrors.strict(
        "sanitize",
        `an object mixes operators (${operators.join(", ")}) and fields at "${path}": neither a condition nor a value`,
        path,
      );
    }
    if (operators.length === 0) SanitizePolicy.literal(value, path);
  }

  /**
   * One operator of a field condition: known, placed on a field, its operand data.
   *
   * @param key - The operator.
   * @param value - The operand.
   * @param path - The path of the operator.
   * @throws {StrictModeError} With rule `sanitize`.
   */
  private static operator(key: string, value: unknown, path: string): void {
    if (JAVASCRIPT_OPERATORS.has(key)) SanitizePolicy.javascript(key, path);
    if (LOGICAL_OPERATORS.has(key) || ROOT_OPERATORS.has(key)) {
      throw PolicyErrors.strict(
        "sanitize",
        `"${key}" is a top-level operator, not an operator of a field (at "${path}")`,
        path,
      );
    }
    if (!FIELD_OPERATORS.has(key)) {
      throw PolicyErrors.strict("sanitize", `"${key}" is not a query operator (at "${path}")`, path);
    }
    if (OPERAND_OPERATORS.has(key)) return;
    if (key === "$in" || key === "$nin" || key === "$all") {
      if (!Array.isArray(value)) return;
      value.forEach((item: unknown, index) => {
        if (
          key === "$all" &&
          BsonGuards.isPlainObject(item) &&
          Object.keys(item).length === 1 &&
          "$elemMatch" in item
        ) {
          return;
        }
        SanitizePolicy.literal(item, join(path, String(index)));
      });
      return;
    }
    SanitizePolicy.literal(value, path);
  }

  /**
   * A value compared as data: no object of operators, no `$`-key at any depth (Mongoose H420).
   *
   * @param value - The value.
   * @param path - The path of the value.
   * @throws {StrictModeError} With rule `sanitize` at the first `$`-key.
   */
  private static literal(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => {
        SanitizePolicy.literal(item, join(path, String(index)));
      });
      return;
    }
    if (!BsonGuards.isPlainObject(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("$")) {
        throw PolicyErrors.strict(
          "sanitize",
          `"${key}" inside a value at "${path}": an operator where a value is expected (query selector injection)`,
          join(path, key),
        );
      }
      SanitizePolicy.literal(item, join(path, key));
    }
  }

  /**
   * Refuses an operator that runs JavaScript on the server.
   *
   * @param key - The operator.
   * @param path - The path of the operator.
   * @throws {StrictModeError} Always, with rule `sanitize`.
   */
  private static javascript(key: string, path: string): never {
    throw PolicyErrors.strict(
      "sanitize",
      `"${key}" runs JavaScript on the server and is not supported (at "${path}"): JavaScript code in a query runs with the rights of the database, cannot be checked against the schema, and turns injected input into executed code (Mongoose CVE-2025-23061, $where in populate); write the condition with query or aggregation operators ($expr) instead`,
      path,
    );
  }

  /**
   * An aggregation expression: no operator that runs JavaScript.
   *
   * @param expression - The expression.
   * @param path - Where the expression sits, for the error.
   * @throws {StrictModeError} With rule `sanitize`.
   */
  static expression(expression: unknown, path: string): void {
    for (const operator of ExpressionPaths.operators(expression)) {
      if (JAVASCRIPT_OPERATORS.has(operator)) SanitizePolicy.javascript(operator, path);
    }
  }

  /**
   * An update: its `$pull` conditions are filters; an update pipeline is expressions.
   *
   * @param update - The update.
   * @throws {StrictModeError} With rule `sanitize`.
   */
  static update(update: unknown): void {
    if (Array.isArray(update)) {
      SanitizePolicy.stages(update as PipelineStage[], "update");
      return;
    }
    if (!BsonGuards.isPlainObject(update)) return;
    for (const [operator, operand] of Object.entries(update)) {
      if (JAVASCRIPT_OPERATORS.has(operator)) SanitizePolicy.javascript(operator, operator);
      if (operator !== "$pull" || !BsonGuards.isPlainObject(operand)) continue;
      for (const [path, condition] of Object.entries(operand)) {
        const at = join("$pull", path);
        if (isOperatorObject(condition)) FilterScan.operators(condition, (site) => SanitizePolicy.site(site, at), at);
        else if (BsonGuards.isPlainObject(condition)) SanitizePolicy.filter(condition, at);
        else SanitizePolicy.literal(condition, at);
      }
    }
  }

  /**
   * Every stage of a pipeline: JavaScript operators anywhere; every filter position checked.
   *
   * @param stages - The stages.
   * @param at - Where the stages sit, for the error path.
   * @throws {StrictModeError} With rule `sanitize`.
   */
  static stages(stages: readonly PipelineStage[], at: string): void {
    stages.forEach((stage, index) => {
      const path = join(at, String(index));
      SanitizePolicy.expression(stage, path);
      for (const [name, spec] of Object.entries(stage)) {
        const where = join(path, name);
        switch (name) {
          case "$match":
            SanitizePolicy.filter(spec, where);
            break;
          case "$geoNear":
            if (BsonGuards.isPlainObject(spec) && spec.query !== undefined)
              SanitizePolicy.filter(spec.query, join(where, "query"));
            break;
          case "$graphLookup":
            if (BsonGuards.isPlainObject(spec) && spec.restrictSearchWithMatch !== undefined) {
              SanitizePolicy.filter(spec.restrictSearchWithMatch, join(where, "restrictSearchWithMatch"));
            }
            break;
          case "$lookup":
          case "$unionWith":
            if (BsonGuards.isPlainObject(spec) && Array.isArray(spec.pipeline)) {
              SanitizePolicy.stages(spec.pipeline as PipelineStage[], join(where, "pipeline"));
            }
            break;
          case "$facet":
            if (BsonGuards.isPlainObject(spec)) {
              for (const [branch, branchStages] of Object.entries(spec)) {
                if (Array.isArray(branchStages))
                  SanitizePolicy.stages(branchStages as PipelineStage[], join(where, branch));
              }
            }
            break;
          default:
            break;
        }
      }
    });
  }

  /**
   * Populate `match` filters (checked at the same point as every other filter, Mongoose H145 / CVE-2025-23061).
   *
   * @param populate - The populate instructions.
   * @param at - Where they sit, for the error path.
   * @throws {StrictModeError} With rule `sanitize`.
   */
  static populate(populate: readonly PopulatePlan[], at: string): void {
    populate.forEach((entry, index) => {
      const path = join(at, `${index}(${entry.path})`);
      if (entry.match !== undefined) SanitizePolicy.filter(entry.match, join(path, "match"));
      SanitizePolicy.populate(entry.populate, path);
    });
  }
}
