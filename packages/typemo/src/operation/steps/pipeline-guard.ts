import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../../bson/bson-guards.ts";
import { type SchemaIssue, ValidationError } from "../../errors/validation-error.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import type { UpdateValidationContext } from "../../schema/options/prop-options.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import { OperationView, type WorkUnit } from "./operation-view.ts";
import { PathResolver } from "./path-resolver.ts";
import { UpdateCodec } from "./update-codec.ts";
import { UpdateValidator } from "./update-validator.ts";
import { IssueCollector } from "./value-validator.ts";

/*
 * Update pipelines and validation. A pipeline is a list of expressions, so what it writes is known only to the
 * server. Three cases, none of them silent:
 *
 * - a CONSTANT written by `$set`/`$addFields` (or by the object of `$replaceWith`/`$replaceRoot`) is a value like
 *   any other: it is cast (`CastError`) and validated (`ValidationError`) before anything is sent;
 * - a REMOVAL of a required field (`$unset`, `$$REMOVE`, an excluding or including `$project`, a `$replaceWith`
 *   object without the field) is a `ValidationError` before anything is sent;
 * - a COMPUTED value of a field with constraints makes the update CONDITIONAL, exactly like `$inc` on a field with
 *   `min`/`max` (`IncrementGuard`): the filter gets `$expr` with the same expression and the constraints on its
 *   result (`required`, `min`, `max`, `enum`, `minLength`, `maxLength`, `match`), so an invalid result is never
 *   written, atomically. "Nothing matched" is then told from "the guard failed" by one follow-up read, which also
 *   computes the refused values for the `ValidationError`.
 *
 * The guard evaluates the expression over the STORED document, so it is exact only while the expression reads
 * fields no earlier stage of the pipeline changed. Anything else cannot be guarded and is refused before sending
 * (`ValidationError`): a computed value that reads a field an earlier stage changed (or `$$ROOT`/`$$CURRENT` after
 * a change), a computed value after a stage that rewrites the whole document, a constrained path reached through
 * an array or a Map, a whole document computed by an expression on a schema with required fields, an upsert and a
 * `bulkWrite` (as for `$inc`).
 *
 * Not checked, because no expression of the server can tell: user `validate` functions, the constraints of the
 * elements INSIDE a computed array, Map or embedded document, and the type of a computed value of a field
 * without constraints. `maxLength`/`minLength` count code points on the server and UTF-16 units in JavaScript.
 */

/**
 * One constraint of a guarded value.
 *
 * @example
 * const check: GuardCheck = { reason: "min", condition: { $gte: ["$$value", 0] }, rule: "must be at least 0" };
 */
export interface GuardCheck {
  /** Which schema option the constraint comes from. */
  readonly reason: SchemaIssue["reason"];
  /** The condition over `$$value` (the computed value); `true` when the constraint holds. */
  readonly condition: PlanDocument;
  /** The rule in words, for the issue. */
  readonly rule: string;
}

/**
 * One computed value that is guarded: where it is written and what it must satisfy.
 *
 * @example
 * const value: GuardedValue = { path: "balance", dbPath: "bal", stage: 0, checks: [], secret: false };
 */
export interface GuardedValue {
  /** The path in code names (issues). */
  readonly path: string;
  /** The path in database names (the key of the encoded stage). */
  readonly dbPath: string;
  /** The index of the stage that writes the value. */
  readonly stage: number;
  /** The constraints, in the order they are reported. */
  readonly checks: readonly GuardCheck[];
  /** The field is `sensitive`: the computed value is kept out of the issues. */
  readonly secret: boolean;
}

/**
 * What the executor needs to tell "no document" from "guard failed".
 *
 * @example
 * const state = PipelineGuard.stateOf(ctx);
 * if (state !== undefined) console.log(state.guard);
 */
export interface PipelineGuardState {
  /** The user's filter in database form (without the guard). */
  readonly filter: PlanDocument;
  /** The guard expression in database form (the `$expr` operand). */
  readonly guard: PlanDocument;
  /** The guarded values with their encoded expressions. */
  readonly values: readonly (GuardedValue & { readonly expression: unknown })[];
}

/** The `ctx.locals` key under which the guard state is kept. */
const GUARD = Symbol("typemo.steps.pipelineGuard");

/** The stages that set fields. */
const SET_STAGES: ReadonlySet<string> = new Set(["$set", "$addFields"]);

/** The BSON type names of "no value". */
const NULLISH = Object.freeze(["missing", "null", "undefined"]);

/** The prefix of the computed fields of the follow-up read. */
const READ_PREFIX = "typemoGuard";

/**
 * A constant found in a stage: its plain value.
 *
 * @example
 * const constant: Constant = { value: 5 };
 */
interface Constant {
  readonly value: unknown;
}

/**
 * A path a stage writes, resolved against the schema.
 *
 * @example
 * const target: Target = { node, dbPath: "bal", through: false };
 */
interface Target {
  readonly node: PathNode;
  readonly dbPath: string;
  /** The path goes through an array or a Map: the stage writes every element, not one value. */
  readonly through: boolean;
}

/**
 * What the walk over the stages has seen so far.
 *
 * @example
 * const seen: Seen = { changed: [], rewritten: false };
 */
interface Seen {
  /** The paths earlier stages wrote or removed. */
  readonly changed: string[];
  /** An earlier stage rewrote the whole document. */
  rewritten: boolean;
}

/**
 * Validation of update pipelines: constants before sending, computed values by a guard in the filter.
 *
 * @example
 * const stages = PipelineGuard.cast(schema, [{ $set: { age: "5" } }]); // [{ $set: { age: 5 } }]
 * const guarded = await PipelineGuard.plan(schema, stages, { operation: "updateOne", upsert: false, filter: {} });
 */
export class PipelineGuard {
  /** The `ctx.locals` key of the {@link PipelineGuardState}. */
  static readonly KEY: symbol = GUARD;

  /**
   * The constant of a stage value, if it is one: a literal (`{ $literal }`), a scalar that is not a field
   * reference, or an array or object made of constants only.
   *
   * @param value - The stage value.
   * @returns The constant, or `undefined` for an expression.
   */
  static constant(value: unknown): Constant | undefined {
    if (typeof value === "string") return value.startsWith("$") ? undefined : { value };
    if (value === null || typeof value !== "object") return { value };
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (const item of value as readonly unknown[]) {
        const constant = PipelineGuard.constant(item);
        if (constant === undefined) return undefined;
        items.push(constant.value);
      }
      return { value: items };
    }
    if (!BsonGuards.isPojo(value)) return { value };
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$literal") return { value: value.$literal };
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (key.startsWith("$")) return undefined;
      const constant = PipelineGuard.constant(value[key]);
      if (constant === undefined) return undefined;
      out[key] = constant.value;
    }
    return { value: out };
  }

  /**
   * The constants of the stages cast by their fields; the scalar ones are written back cast (a string that the
   * safe casts turn into a number is sent as the number).
   *
   * @param schema - The compiled schema.
   * @param stages - The stages in code names.
   * @returns The stages with cast constants; the input is not changed.
   * @throws {CastError} When a constant does not fit its field.
   */
  static cast(schema: CompiledSchema, stages: readonly PipelineStage[]): readonly PipelineStage[] {
    let changed = false;
    const out = stages.map((stage) => {
      const [name] = Object.keys(stage);
      if (name === undefined || !SET_STAGES.has(name)) return stage;
      const spec = stage[name];
      if (!BsonGuards.isPlainObject(spec)) return stage;
      let fields: Record<string, unknown> | undefined;
      for (const [key, value] of Object.entries(spec)) {
        const constant = PipelineGuard.constant(value);
        if (constant === undefined) continue;
        const target = PipelineGuard.target(schema, key);
        if (target === undefined || target.through) continue;
        const cast = PipelineGuard.castConstant(schema, key, constant.value);
        if (cast === constant.value || !PipelineGuard.scalar(cast)) continue;
        fields ??= { ...spec };
        fields[key] = PipelineGuard.literal(cast);
      }
      if (fields === undefined) return stage;
      changed = true;
      return Object.freeze({ [name]: Object.freeze(fields) }) as PipelineStage;
    });
    return changed ? out : stages;
  }

  /**
   * Checks what the stages write (see the file description): validates the constants, refuses the removal of a
   * required field and whatever cannot be guarded, and returns the computed values to guard.
   *
   * @param schema - The compiled schema.
   * @param stages - The stages in code names, constants cast.
   * @param base - The context of the validators (operation, upsert, filter).
   * @returns The computed values of fields with constraints.
   * @throws {ValidationError} With every issue found.
   */
  static async plan(
    schema: CompiledSchema,
    stages: readonly PipelineStage[],
    base: Omit<UpdateValidationContext, "kind" | "operator" | "path">,
  ): Promise<GuardedValue[]> {
    const sink = new IssueCollector();
    const constants: Record<string, unknown> = {};
    const guarded = new Map<string, GuardedValue>();
    const seen: Seen = { changed: [], rewritten: false };
    const write = (key: string, value: unknown, stage: number, at: string): void => {
      guarded.delete(key);
      delete constants[key];
      const target = PipelineGuard.target(schema, key);
      if (value === "$$REMOVE") {
        PipelineGuard.removed(target, key, at, sink);
      } else if (target !== undefined) {
        const constant = PipelineGuard.constant(value);
        if (constant !== undefined) {
          if (!target.through) constants[key] = PipelineGuard.castConstant(schema, key, constant.value);
        } else {
          const checks = PipelineGuard.checks(target.node);
          if (checks.length > 0) {
            const refusal = PipelineGuard.unguardable(target, value, seen);
            if (refusal === undefined) {
              const sensitive = target.node.options.sensitive;
              const secret = sensitive !== undefined && sensitive !== "show";
              guarded.set(key, { path: key, dbPath: target.dbPath, stage, checks, secret });
            } else {
              sink.issues.push({
                path: key.split("."),
                reason: checks[0]?.reason ?? "validator",
                message: `${at}: the computed value of "${key}" cannot be checked against its constraints: ${refusal}`,
                value: undefined,
              });
            }
          }
        }
      }
      seen.changed.push(key);
    };
    stages.forEach((stage, index) => {
      const [name] = Object.keys(stage);
      if (name === undefined) return;
      const spec = stage[name];
      const at = `update.${index}.${name}`;
      if (SET_STAGES.has(name)) {
        if (BsonGuards.isPlainObject(spec))
          for (const [key, value] of Object.entries(spec)) write(key, value, index, at);
        return;
      }
      if (name === "$unset") {
        const paths = typeof spec === "string" ? [spec] : Array.isArray(spec) ? (spec as readonly unknown[]) : [];
        for (const path of paths) if (typeof path === "string") write(path, "$$REMOVE", index, at);
        return;
      }
      if (name === "$project") {
        PipelineGuard.project(schema, spec, index, at, sink, write);
        seen.rewritten = true;
        return;
      }
      if (name === "$replaceWith" || name === "$replaceRoot") {
        const root = name === "$replaceRoot" && BsonGuards.isPlainObject(spec) ? spec.newRoot : spec;
        PipelineGuard.replace(schema, root, index, at, sink, write);
        seen.rewritten = true;
      }
    });
    if (Object.keys(constants).length > 0) UpdateValidator.collect(schema, { $set: constants }, base, sink);
    await sink.finish();
    return [...guarded.values()];
  }

  /**
   * Refuses guarded values where a failed guard could not be told from a missing document.
   *
   * @param values - The guarded values of the update.
   * @param why - The situation, completing the message.
   * @returns The error to throw.
   */
  static refuse(values: readonly GuardedValue[], why: string): ValidationError {
    return new ValidationError(
      values.map((value) => ({
        path: value.path.split("."),
        reason: value.checks[0]?.reason ?? "validator",
        message: `the computed value of "${value.path}" cannot be checked against its constraints ${why}`,
        value: undefined,
      })),
    );
  }

  /**
   * Adds the guard of each pipeline update to its (already encoded) filter and keeps the state for the executor.
   *
   * @param ctx - The operation context, its values in database form.
   * @param plans - The guarded values by work unit index.
   * @throws {ValidationError} When the encoded stage of a guarded value cannot be found.
   */
  static apply(ctx: OperationContext, plans: ReadonlyMap<number, readonly GuardedValue[]>): void {
    if (plans.size === 0) return;
    OperationView.map(ctx, (unit: WorkUnit) => {
      const planned = plans.get(unit.index);
      if (planned === undefined || planned.length === 0 || !Array.isArray(unit.update)) return unit;
      const stages = unit.update as readonly PipelineStage[];
      const values = planned.map((value) => {
        const stage = stages[value.stage];
        const spec = stage === undefined ? undefined : Object.values(stage)[0];
        if (!BsonGuards.isPlainObject(spec) || !Object.hasOwn(spec, value.dbPath))
          throw PipelineGuard.refuse([value], "(the encoded stage does not hold the value)");
        return { ...value, expression: spec[value.dbPath] };
      });
      const filter = unit.filter ?? Object.freeze({});
      const conditions = values.map((value) => PipelineGuard.condition(value.expression, value.checks));
      const guard = Object.freeze(conditions.length === 1 ? (conditions[0] as PlanDocument) : { $and: conditions });
      ctx.locals.set(GUARD, Object.freeze({ filter, guard, values }) satisfies PipelineGuardState);
      return { ...unit, filter: Object.freeze({ $and: Object.freeze([filter, Object.freeze({ $expr: guard })]) }) };
    });
  }

  /**
   * The state of the operation, when its pipeline update is guarded.
   *
   * @param ctx - The operation context.
   * @returns The guard state, or `undefined` when the update is not guarded.
   */
  static stateOf(ctx: OperationContext): PipelineGuardState | undefined {
    return ctx.locals.get(GUARD) as PipelineGuardState | undefined;
  }

  /**
   * The projection of the follow-up read: every guarded value as the pipeline would compute it, and whether each
   * of its constraints holds.
   *
   * @param state - The guard state.
   * @returns The projection.
   */
  static projection(state: PipelineGuardState): PlanDocument {
    const out: Record<string, unknown> = { _id: 0 };
    state.values.forEach((value, index) => {
      out[`${READ_PREFIX}${index}`] = value.expression;
      value.checks.forEach((check, position) => {
        out[`${READ_PREFIX}${index}_${position}`] = PipelineGuard.condition(value.expression, [check]);
      });
    });
    return out;
  }

  /**
   * The `ValidationError` of a failed guard, from what the follow-up read computed.
   *
   * @param state - The guard state.
   * @param computed - The row of the follow-up read ({@link PipelineGuard.projection}).
   * @returns An error with one issue per constraint the computed value breaks; a generic one when the stored
   * document changed since the write.
   */
  static failure(state: PipelineGuardState, computed: Readonly<Record<string, unknown>>): ValidationError {
    const issues: SchemaIssue[] = [];
    state.values.forEach((value, index) => {
      const result = computed[`${READ_PREFIX}${index}`];
      value.checks.forEach((check, position) => {
        if (computed[`${READ_PREFIX}${index}_${position}`] !== false) return;
        issues.push({
          path: value.path.split("."),
          reason: check.reason,
          message: `the update pipeline computes ${value.secret ? "a value" : PipelineGuard.show(result)}; the value ${check.rule}; nothing was written`,
          value: value.secret ? undefined : result,
        });
      });
    });
    if (issues.length > 0) return new ValidationError(issues);
    /* The document changed between the write and the read: the guard still held at the write. */
    return new ValidationError(
      state.values.map((value) => ({
        path: value.path.split("."),
        reason: value.checks[0]?.reason ?? "validator",
        message:
          "the update pipeline was not applied: a computed value broke a constraint when the update ran (the stored document changed since); nothing was written",
        value: undefined,
      })),
    );
  }

  /**
   * The constraints of a node that the server can check on a computed value.
   *
   * @param node - The node of the written path.
   * @returns The checks; empty when the node has none.
   */
  static checks(node: PathNode): GuardCheck[] {
    const value = "$$value";
    const out: GuardCheck[] = [];
    const present = { $not: [{ $in: [{ $type: value }, NULLISH] }] };
    /* Validators skip `null` and an absent value; only `required` refuses them. */
    const whenPresent = (condition: unknown): PlanDocument => ({ $or: [{ $not: [present] }, condition] });
    const typed = (type: PlanDocument, condition: unknown): PlanDocument =>
      whenPresent({ $cond: [type, condition, false] });
    if (node.required && node.nullable) {
      /* `required` + `nullable`: `null` is a value, only an absent key is refused. */
      const exists = { $not: [{ $in: [{ $type: value }, ["missing", "undefined"]] }] };
      out.push({ reason: "required", condition: exists, rule: "is required (null allowed)" });
    } else if (node.required) out.push({ reason: "required", condition: present, rule: "is required (not null)" });
    if (node.kind !== "scalar") return out;
    const options = node.options;
    const isString = { $eq: [{ $type: value }, "string"] };
    if (node.enumValues !== undefined) {
      out.push({
        reason: "enum",
        condition: whenPresent({ $in: [value, { $literal: [...node.enumValues] }] }),
        rule: `must be one of ${node.enumValues.map((one) => JSON.stringify(one)).join(", ")}`,
      });
    }
    for (const [reason, operator, word] of [
      ["min", "$gte", "at least"],
      ["max", "$lte", "at most"],
    ] as const) {
      const limit = options[reason];
      if (limit === undefined) continue;
      const type = BsonGuards.isDate(limit) ? { $eq: [{ $type: value }, "date"] } : { $isNumber: value };
      out.push({
        reason,
        condition: typed(type, { [operator]: [value, limit] }),
        rule: `must be ${word} ${BsonGuards.isDate(limit) ? limit.toISOString() : String(limit)}`,
      });
    }
    for (const [reason, operator, word] of [
      ["minLength", "$gte", "at least"],
      ["maxLength", "$lte", "at most"],
    ] as const) {
      const limit = options[reason];
      if (typeof limit !== "number") continue;
      out.push({
        reason,
        condition: typed(isString, { [operator]: [{ $strLenCP: value }, limit] }),
        rule: `must be ${word} ${limit} characters long`,
      });
    }
    const match = options.match;
    if (match instanceof RegExp) {
      /* The server's flags: i, m, s, x. `u` is its default; stateful flags are refused when the schema is built. */
      const flags = [...match.flags].filter((flag) => "imsx".includes(flag)).join("");
      out.push({
        reason: "match",
        condition: typed(isString, { $regexMatch: { input: value, regex: match.source, options: flags } }),
        rule: `must match ${String(match)}`,
      });
    }
    return out;
  }

  /**
   * The condition "the value of `expression` satisfies `checks`", the expression evaluated once.
   *
   * @param expression - The encoded expression of the value.
   * @param checks - The constraints.
   * @returns The condition.
   */
  private static condition(expression: unknown, checks: readonly GuardCheck[]): PlanDocument {
    const conditions = checks.map((check) => check.condition);
    return {
      $let: {
        vars: { value: expression },
        in: conditions.length === 1 ? conditions[0] : { $and: conditions },
      },
    };
  }

  /**
   * Why a computed value cannot be guarded, if it cannot.
   *
   * @param target - The written path.
   * @param expression - The expression of the value.
   * @param seen - What earlier stages did.
   * @returns The reason, or `undefined` when the value can be guarded.
   */
  private static unguardable(target: Target, expression: unknown, seen: Seen): string | undefined {
    if (target.through)
      return "the path goes through an array or a Map (the stage writes every element); use $set of the elements or save()";
    if (seen.rewritten)
      return "an earlier stage rewrites the whole document; compute the value in the first stage, or write a constant";
    const reads = PipelineGuard.reads(expression);
    if (seen.changed.length === 0) return undefined;
    if (reads.root)
      return "it reads the whole document ($$ROOT/$$CURRENT) after an earlier stage changed it; compute it in the first stage";
    const overlap = reads.paths.find((path) =>
      seen.changed.some(
        (changed) => changed === path || changed.startsWith(`${path}.`) || path.startsWith(`${changed}.`),
      ),
    );
    return overlap === undefined
      ? undefined
      : `it reads "${overlap}", which an earlier stage of the pipeline changes; compute both in one stage`;
  }

  /**
   * The fields an expression reads.
   *
   * @param expression - The expression in code names.
   * @returns The field paths, and whether the whole document is read.
   */
  private static reads(expression: unknown): { readonly paths: string[]; readonly root: boolean } {
    const paths: string[] = [];
    let root = false;
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        if (value.startsWith("$$")) {
          const name = value.slice(2).split(".")[0];
          if (name === "ROOT" || name === "CURRENT") root = true;
        } else if (value.startsWith("$")) paths.push(value.slice(1));
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value as readonly unknown[]) visit(item);
        return;
      }
      if (!BsonGuards.isPojo(value)) return;
      for (const [key, item] of Object.entries(value)) if (key !== "$literal") visit(item);
    };
    visit(expression);
    return { paths, root };
  }

  /**
   * `$project`: an excluded path is a removal, a computed one a write, and an including projection removes every
   * field it does not name.
   *
   * @param schema - The compiled schema.
   * @param spec - The stage spec.
   * @param stage - The stage index.
   * @param at - Where the stage sits, for issues.
   * @param sink - Receives the issues.
   * @param write - Records one written path.
   */
  private static project(
    schema: CompiledSchema,
    spec: unknown,
    stage: number,
    at: string,
    sink: IssueCollector,
    write: (key: string, value: unknown, stage: number, at: string) => void,
  ): void {
    if (!BsonGuards.isPlainObject(spec)) return;
    const flag = (value: unknown): boolean | undefined =>
      value === 1 || value === true ? true : value === 0 || value === false ? false : undefined;
    const entries = Object.entries(spec);
    const including = entries.some(([key, value]) => key !== "_id" && flag(value) !== false);
    for (const [key, value] of entries) {
      const kept = flag(value);
      if (kept === false) write(key, "$$REMOVE", stage, at);
      else if (kept === undefined) write(key, value, stage, at);
    }
    if (including) PipelineGuard.dropped(schema, new Set(entries.map(([key]) => key.split(".")[0] ?? key)), at, sink);
  }

  /**
   * `$replaceWith` / `$replaceRoot`: an object of fields is the new document (each field a write, every other
   * field removed); `$mergeObjects` of `$$ROOT` and objects of fields is a `$set`; any other expression computes
   * a document nobody can check.
   *
   * @param schema - The compiled schema.
   * @param root - The new root expression.
   * @param stage - The stage index.
   * @param at - Where the stage sits, for issues.
   * @param sink - Receives the issues.
   * @param write - Records one written path.
   */
  private static replace(
    schema: CompiledSchema,
    root: unknown,
    stage: number,
    at: string,
    sink: IssueCollector,
    write: (key: string, value: unknown, stage: number, at: string) => void,
  ): void {
    const fields = (value: unknown): value is Readonly<Record<string, unknown>> =>
      BsonGuards.isPojo(value) && Object.keys(value).every((key) => !key.startsWith("$"));
    if (fields(root)) {
      for (const [key, value] of Object.entries(root)) write(key, value, stage, at);
      PipelineGuard.dropped(schema, new Set(Object.keys(root)), at, sink);
      return;
    }
    const merged = BsonGuards.isPojo(root) && Object.keys(root).length === 1 ? root.$mergeObjects : undefined;
    if (Array.isArray(merged) && merged[0] === "$$ROOT" && merged.slice(1).every(fields)) {
      for (const part of merged.slice(1) as readonly Readonly<Record<string, unknown>>[])
        for (const [key, value] of Object.entries(part)) write(key, value, stage, at);
      return;
    }
    const constrained = schema.fields.filter(
      (field) => field.service !== "id" && (field.required || PipelineGuard.checks(field).length > 0),
    );
    if (constrained.length === 0) return;
    sink.issues.push({
      path: [constrained[0]?.key ?? ""],
      reason: constrained[0]?.required === true ? "required" : "validator",
      message: `${at}: the stage computes the whole document, so the fields with constraints (${constrained
        .map((field) => field.key)
        .join(", ")}) cannot be checked; use $set, or an object of fields`,
      value: undefined,
    });
  }

  /**
   * Reports the required top-level fields a whole-document stage does not keep.
   *
   * @param schema - The compiled schema.
   * @param kept - The top-level fields the stage keeps or writes.
   * @param at - Where the stage sits, for issues.
   * @param sink - Receives the issues.
   */
  private static dropped(schema: CompiledSchema, kept: ReadonlySet<string>, at: string, sink: IssueCollector): void {
    for (const field of schema.fields) {
      if (!field.required || field.service === "id" || kept.has(field.key)) continue;
      sink.issues.push({
        path: [field.key],
        reason: "required",
        message: `${at}: the field is required; the stage would remove it`,
        value: undefined,
      });
    }
  }

  /**
   * Reports the removal of a required field.
   *
   * @param target - The removed path, when the schema knows it.
   * @param key - The removed path in code names.
   * @param at - Where the stage sits, for issues.
   * @param sink - Receives the issues.
   */
  private static removed(target: Target | undefined, key: string, at: string, sink: IssueCollector): void {
    if (target === undefined || !target.node.required) return;
    sink.issues.push({
      path: key.split("."),
      reason: "required",
      message: `${at}: the field is required; the pipeline would remove it`,
      value: undefined,
    });
  }

  /**
   * Resolves a written path.
   *
   * @param schema - The compiled schema.
   * @param key - The path in code names.
   * @returns The node, the database path and whether the path goes through an array or a Map; `undefined` for a
   * path the schema does not know.
   */
  private static target(schema: CompiledSchema, key: string): Target | undefined {
    const resolution = PathResolver.resolve(schema, key, "read");
    if (!resolution.ok) return undefined;
    const segments = key.split(".");
    let through = false;
    for (let length = 1; length < segments.length; length++) {
      const prefix = PathResolver.resolve(schema, segments.slice(0, length).join("."), "read");
      if (prefix.ok && (prefix.value.node.kind === "array" || prefix.value.node.kind === "map")) through = true;
    }
    return { node: resolution.value.node, dbPath: resolution.value.dbPath, through };
  }

  /**
   * A constant cast by the field of its path, as `$set` casts it.
   *
   * @param schema - The compiled schema.
   * @param key - The path in code names.
   * @param value - The constant.
   * @returns The cast value.
   * @throws {CastError} When the constant does not fit the field.
   */
  private static castConstant(schema: CompiledSchema, key: string, value: unknown): unknown {
    const cast = UpdateCodec.walk(schema, { $set: { [key]: value } }, "cast").$set;
    return BsonGuards.isPlainObject(cast) ? cast[key] : value;
  }

  /**
   * `true` for a value that is written back as it is: not an array, a plain object or a Map.
   *
   * @param value - The cast value.
   * @returns Whether the value is a scalar.
   */
  private static scalar(value: unknown): boolean {
    return !Array.isArray(value) && !BsonGuards.isPojo(value) && !BsonGuards.isMap(value);
  }

  /**
   * A scalar as a stage value: a string that would read as a field reference is wrapped in `$literal`.
   *
   * @param value - The scalar.
   * @returns The stage value.
   */
  private static literal(value: unknown): unknown {
    return typeof value === "string" && value.startsWith("$") ? { $literal: value } : value;
  }

  /**
   * A computed value in words, for a message.
   *
   * @param value - The value.
   * @returns Its text.
   */
  private static show(value: unknown): string {
    if (value === undefined) return "no value";
    if (BsonGuards.isDate(value)) return value.toISOString();
    return typeof value === "string" ? JSON.stringify(value) : String(value);
  }
}
