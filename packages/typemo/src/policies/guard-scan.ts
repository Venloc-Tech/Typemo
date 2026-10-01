import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import type { PopulatePlan } from "../query/plan.ts";
import {
  FIELD_OPERATORS,
  GEO_OPERATORS,
  isOperatorObject,
  JAVASCRIPT_OPERATORS,
  LOGICAL_OPERATORS,
  ROOT_OPERATORS,
} from "./filter-scan.ts";

/*
 * ONE walk over the raw input for the four walking guards of `normalize` — `UndefinedPolicy`, `SanitizePolicy`,
 * `EmptyLogicalPolicy`, `LimitPolicy` — instead of four walks that each build a path string per node. It only
 * ANSWERS: `clean(ctx)` is `true` when none of the four would throw. Anything else — a violation, or merely a
 * shape this walk does not follow (`$pull`, an unusual `$all`, a JavaScript operator name anywhere, an empty
 * logical list even inside an expression) — is `false`, and the step then runs the four guards themselves, in
 * their order, so the error (which rule, which path, which message) is exactly theirs. The walk may say `false`
 * for input the guards accept (it only costs their walk); it must never say `true` for input one of them refuses
 * (the differential test `test/unit/policies/guard-scan.test.ts` checks this over generated input).
 *
 * This walk is a second copy of the four guards' grammar, so the positions are
 * declared: each guard lists the positions it checks (`static readonly POSITIONS`), all named from
 * `GUARD_POSITIONS` below — the positions this walk follows. A guard position this walk does not follow does not
 * compile, and `guard-scan.test.ts` holds, per guard and position, an input the guard refuses there, which this walk
 * must not call clean. A new rule in a guard → update this walk AND the generator in `guard-scan.test.ts`.
 */

/** The positions of the raw input the walk follows (and the four guards may check). */
const GUARD_POSITIONS = [
  "limit",
  "skip",
  "filter",
  "arrayFilters",
  "update",
  "update.$pull",
  "updatePipeline",
  "replacement",
  "document",
  "projection",
  "pipeline",
  "pipeline.$match",
  "pipeline.$limit",
  "pipeline.$skip",
  "pipeline.$geoNear.query",
  "pipeline.$graphLookup.restrictSearchWithMatch",
  "pipeline.$lookup.pipeline",
  "pipeline.$unionWith.pipeline",
  "pipeline.$facet",
  "populate.match",
  "populate.limit",
  "populate.perDocumentLimit",
  "populate.skip",
  "populate.populate",
] as const;

/**
 * A position of the raw input a walking guard checks.
 *
 * @example
 * const position: GuardPosition = "pipeline.$match";
 */
export type GuardPosition = (typeof GUARD_POSITIONS)[number];

/** Operators whose operand is not checked as data by the sanitize policy (their operands are objects by design). */
const OPERAND_OPERATORS: ReadonlySet<string> = new Set(["$not", "$elemMatch", ...GEO_OPERATORS]);

/**
 * `true` for an integer greater than zero.
 *
 * @param value - The value to test.
 * @returns Whether `value` is a positive integer.
 */
const isPositiveInteger = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
/**
 * `true` for an integer that is zero or greater.
 *
 * @param value - The value to test.
 * @returns Whether `value` is a non-negative integer.
 */
const isCount = (value: unknown): boolean => typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * The fused check of the raw-input guards.
 *
 * @example
 * if (GuardScan.clean(ctx)) skipGuards(); else runGuardsOneByOne();
 */
export class GuardScan {
  /** The positions this walk follows (every guard's `POSITIONS` is a subset). */
  static readonly POSITIONS: ReadonlySet<GuardPosition> = new Set(GUARD_POSITIONS);

  /**
   * `true` when `UndefinedPolicy`, `SanitizePolicy`, `EmptyLogicalPolicy` and `LimitPolicy` all accept `ctx`.
   *
   * @param ctx - The operation context.
   * @returns `true` when none of the four guards would throw; `false` when one might.
   */
  static clean(ctx: OperationContext): boolean {
    if (!GuardScan.limit(OperationView.planField(ctx, "limit"))) return false;
    if (!GuardScan.skip(OperationView.planField(ctx, "skip"))) return false;
    for (const unit of OperationView.units(ctx)) {
      if (unit.filter !== undefined && !GuardScan.filter(unit.filter)) return false;
      if (unit.arrayFilters !== undefined) {
        /* `UndefinedPolicy` checks the list, the other guards each filter. */
        if (!Array.isArray(unit.arrayFilters)) return false;
        for (const filter of unit.arrayFilters) if (!GuardScan.filter(filter)) return false;
      }
      if (unit.update !== undefined && !GuardScan.update(unit.update)) return false;
      if (unit.replacement !== undefined && !GuardScan.defined(unit.replacement)) return false;
      if (unit.document !== undefined && !GuardScan.defined(unit.document)) return false;
    }
    const pipeline = OperationView.pipeline(ctx);
    if (pipeline !== undefined && !GuardScan.stages(pipeline)) return false;
    if (ctx.projection !== undefined && !GuardScan.defined(ctx.projection)) return false;
    return GuardScan.populate(OperationView.populate(ctx));
  }

  /**
   * A `limit`: absent or a positive integer.
   *
   * @param value - The limit.
   * @returns Whether it is acceptable.
   */
  private static limit(value: unknown): boolean {
    return value === undefined || isPositiveInteger(value);
  }
  /**
   * A `skip`: absent or a non-negative integer.
   *
   * @param value - The skip.
   * @returns Whether it is acceptable.
   */
  private static skip(value: unknown): boolean {
    return value === undefined || isCount(value);
  }

  /**
   * No `undefined` at any depth (plain objects, arrays, Maps: the positions `UndefinedPolicy` walks).
   *
   * @param value - The value to walk.
   * @returns Whether no `undefined` was found.
   */
  private static defined(value: unknown): boolean {
    if (Array.isArray(value)) {
      for (const item of value) if (item === undefined || !GuardScan.defined(item)) return false;
      return true;
    }
    if (BsonGuards.isMap(value)) {
      for (const item of value.values()) if (item === undefined || !GuardScan.defined(item)) return false;
      return true;
    }
    if (!BsonGuards.isPlainObject(value)) return true;
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item === undefined || !GuardScan.defined(item)) return false;
    }
    return true;
  }

  /**
   * {@link defined}, and no JavaScript operator name as a key anywhere (the sanitize expression scan).
   *
   * @param value - The value to walk.
   * @returns Whether it is free of `undefined` and JavaScript operators.
   */
  private static safe(value: unknown): boolean {
    if (Array.isArray(value)) {
      for (const item of value) if (item === undefined || !GuardScan.safe(item)) return false;
      return true;
    }
    if (BsonGuards.isMap(value)) {
      for (const item of value.values()) if (item === undefined || !GuardScan.safe(item)) return false;
      return true;
    }
    if (!BsonGuards.isPlainObject(value)) return true;
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item === undefined || JAVASCRIPT_OPERATORS.has(key) || !GuardScan.safe(item)) return false;
    }
    return true;
  }

  /**
   * A query filter in the grammar of `FilterScan` (sanitize, empty logical lists, undefined).
   *
   * @param filter - The filter.
   * @returns Whether the four guards would accept it.
   */
  private static filter(filter: unknown): boolean {
    if (!BsonGuards.isPlainObject(filter)) return false;
    for (const key of Object.keys(filter)) {
      const value = filter[key];
      if (value === undefined) return false;
      if (LOGICAL_OPERATORS.has(key)) {
        if (!Array.isArray(value) || value.length === 0) return false;
        for (const clause of value) if (!GuardScan.filter(clause)) return false;
        continue;
      }
      if (key.startsWith("$")) {
        if (!ROOT_OPERATORS.has(key) || !GuardScan.safe(value)) return false;
        continue;
      }
      if (!GuardScan.field(value)) return false;
    }
    return true;
  }

  /**
   * The value of a field condition: a literal, or an object of operators only.
   *
   * @param value - The condition.
   * @returns Whether the four guards would accept it.
   */
  private static field(value: unknown): boolean {
    if (!BsonGuards.isPlainObject(value)) return GuardScan.literal(value);
    const keys = Object.keys(value);
    let operators = 0;
    for (const key of keys) if (key.startsWith("$")) operators++;
    if (operators === 0) return GuardScan.literal(value);
    if (operators < keys.length) return false;
    return GuardScan.operators(value);
  }

  /**
   * The operators of one field condition.
   *
   * @param condition - The operator object.
   * @returns Whether the four guards would accept it.
   */
  private static operators(condition: Readonly<Record<string, unknown>>): boolean {
    for (const key of Object.keys(condition)) {
      const value = condition[key];
      if (value === undefined || !FIELD_OPERATORS.has(key)) return false;
      if (key === "$not") {
        if (!(isOperatorObject(value) ? GuardScan.operators(value) : GuardScan.safe(value))) return false;
        continue;
      }
      if (key === "$elemMatch") {
        if (!BsonGuards.isPlainObject(value)) {
          if (!GuardScan.safe(value)) return false;
          continue;
        }
        const operand =
          isOperatorObject(value) && !Object.keys(value).some((name) => LOGICAL_OPERATORS.has(name))
            ? GuardScan.operators(value)
            : GuardScan.filter(value);
        if (!operand) return false;
        continue;
      }
      if (OPERAND_OPERATORS.has(key)) {
        if (!GuardScan.safe(value)) return false;
        continue;
      }
      if ((key === "$in" || key === "$nin" || key === "$all") && Array.isArray(value)) {
        for (const item of value) {
          /* `$all` of `$elemMatch` conditions: only the single-key form is followed here. */
          if (key === "$all" && BsonGuards.isPlainObject(item) && "$elemMatch" in item) {
            if (Object.keys(item).length !== 1 || !GuardScan.operators(item)) return false;
            continue;
          }
          if (item === undefined || !GuardScan.literal(item)) return false;
        }
        continue;
      }
      if (!GuardScan.literal(value)) return false;
    }
    return true;
  }

  /**
   * A value compared as data: no `$`-key at any depth, no `undefined`.
   *
   * @param value - The value.
   * @returns Whether it is plain data.
   */
  private static literal(value: unknown): boolean {
    if (Array.isArray(value)) {
      for (const item of value) if (item === undefined || !GuardScan.literal(item)) return false;
      return true;
    }
    if (BsonGuards.isMap(value)) return GuardScan.safe(value);
    if (!BsonGuards.isPlainObject(value)) return true;
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item === undefined || key.startsWith("$") || !GuardScan.literal(item)) return false;
    }
    return true;
  }

  /**
   * An update of operators (no `$pull`: its conditions are left to the guards), or an update pipeline.
   *
   * @param update - The update.
   * @returns Whether the four guards would accept it.
   */
  private static update(update: unknown): boolean {
    if (Array.isArray(update)) return GuardScan.stages(update as readonly PipelineStage[]);
    if (!BsonGuards.isPlainObject(update)) return GuardScan.defined(update);
    for (const operator of Object.keys(update)) {
      if (JAVASCRIPT_OPERATORS.has(operator) || operator === "$pull") return false;
    }
    return GuardScan.defined(update);
  }

  /**
   * Every stage: undefined, JavaScript, `$limit`/`$skip`, and the filters and sub-pipelines the guards follow.
   *
   * @param stages - The stages.
   * @returns Whether the four guards would accept them.
   */
  private static stages(stages: readonly PipelineStage[]): boolean {
    for (const stage of stages) {
      if (stage === undefined || !BsonGuards.isPlainObject(stage)) return false;
      for (const name of Object.keys(stage)) {
        const spec = stage[name];
        if (spec === undefined || JAVASCRIPT_OPERATORS.has(name)) return false;
        if (!GuardScan.stage(name, spec)) return false;
      }
    }
    return true;
  }

  /**
   * One stage.
   *
   * @param name - The stage name.
   * @param spec - The stage spec.
   * @returns Whether the four guards would accept it.
   */
  private static stage(name: string, spec: unknown): boolean {
    switch (name) {
      case "$match":
        return GuardScan.filter(spec);
      case "$limit":
        return isPositiveInteger(spec);
      case "$skip":
        return isCount(spec);
      case "$geoNear":
      case "$graphLookup": {
        if (!BsonGuards.isPlainObject(spec)) return GuardScan.safe(spec);
        const key = name === "$geoNear" ? "query" : "restrictSearchWithMatch";
        for (const field of Object.keys(spec)) {
          const value = spec[field];
          if (value === undefined || JAVASCRIPT_OPERATORS.has(field)) return false;
          if (!(field === key ? GuardScan.filter(value) : GuardScan.safe(value))) return false;
        }
        return true;
      }
      case "$lookup":
      case "$unionWith": {
        if (!BsonGuards.isPlainObject(spec)) return GuardScan.safe(spec);
        for (const field of Object.keys(spec)) {
          const value = spec[field];
          if (value === undefined || JAVASCRIPT_OPERATORS.has(field)) return false;
          const ok =
            field === "pipeline" && Array.isArray(value)
              ? GuardScan.stages(value as readonly PipelineStage[])
              : GuardScan.safe(value);
          if (!ok) return false;
        }
        return true;
      }
      case "$facet": {
        if (!BsonGuards.isPlainObject(spec)) return GuardScan.safe(spec);
        for (const branch of Object.keys(spec)) {
          const value = spec[branch];
          if (value === undefined || JAVASCRIPT_OPERATORS.has(branch)) return false;
          const ok = Array.isArray(value) ? GuardScan.stages(value as readonly PipelineStage[]) : GuardScan.safe(value);
          if (!ok) return false;
        }
        return true;
      }
      default:
        return GuardScan.safe(spec);
    }
  }

  /**
   * Populate instructions: `match` filters, limits and skips at every level.
   *
   * @param populate - The populate instructions.
   * @returns Whether the four guards would accept them.
   */
  private static populate(populate: readonly PopulatePlan[]): boolean {
    for (const entry of populate) {
      if (entry.match !== undefined && !GuardScan.filter(entry.match)) return false;
      if (!GuardScan.limit(entry.options?.limit) || !GuardScan.limit(entry.perDocumentLimit)) return false;
      if (!GuardScan.skip(entry.options?.skip)) return false;
      if (!GuardScan.populate(entry.populate)) return false;
    }
    return true;
  }
}
