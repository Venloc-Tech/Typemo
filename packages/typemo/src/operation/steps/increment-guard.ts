import { BsonGuards } from "../../bson/bson-guards.ts";
import { type SchemaIssue, ValidationError } from "../../errors/validation-error.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import { OperationView, type WorkUnit } from "./operation-view.ts";
import { PathResolver } from "./path-resolver.ts";

/*
 * `$inc`/`$mul` on a field with `min`/`max`. The result depends on the stored value, so it
 * cannot be validated before the write (Mongoose did not validate it at all). The update is made
 * CONDITIONAL instead: the filter gets `$expr` with the server's own arithmetic on the stored value —
 * `min ≤ (stored ?? 0) + d ≤ max` (`$multiply` for `$mul`; a missing field counts as 0, as `$inc`/`$mul`
 * treat it) — so an out-of-range result is never written, atomically, whatever runs concurrently.
 *
 * "Nothing matched" then has two causes, told apart by ONE follow-up read in the same session (inside a
 * transaction it sees the same snapshot):
 * - `updateOne` / `findOneAndUpdate`: after a write that matched nothing, `findOne(user filter)`: a
 *   document → the guard failed → `ValidationError` (the stored value and the would-be result on the
 *   issue); none → the ordinary "no document" (`matchedCount: 0`, `null`, or `orFail`);
 * - `updateMany`: the documents a guard would skip are found BEFORE the write
 *   (`findOne(filter AND NOT guard)`), and the write is not sent: skipping them silently would be a
 *   partial update nobody asked for. A document that leaves the range between the check and the write is
 *   still protected by the guard (not written), but then not reported — the report names this race.
 *   A filter that selects at most ONE document (`_id` equality) needs no pre-check: it is handled
 *   like `updateOne` (the write, and the follow-up read only when nothing matched) — one round trip on
 *   success instead of two, and no race.
 * Cost: the success path of updateOne / findOneAndUpdate / updateMany by `_id` is ONE round trip, as
 * without the guard (the `$expr` is evaluated on the matched document only); a failed guard or a missing
 * document costs one extra read; updateMany of several documents always pays the pre-check read.
 * Refused before sending (ValidationError): an upsert (the server would INSERT a new document when the
 * guard, not the filter, fails), `bulkWrite` (its result has no per-operation match counts to tell the
 * causes apart), and a guarded path through an array (`$`, `$[]`, `$[id]`, an index: `$expr` cannot
 * address "the matched element").
 */

/**
 * One guarded `$inc`/`$mul` path.
 *
 * @example
 * const guarded: GuardedPath = {
 *   path: "stock", dbPath: "stock", operator: "$inc", operand: -1, min: 0, max: undefined,
 * };
 */
export interface GuardedPath {
  /** The path in code names (issues). */
  readonly path: string;
  /** The path in database names (the `$expr` field reference, the follow-up read). */
  readonly dbPath: string;
  /** The operator that changes the value. */
  readonly operator: "$inc" | "$mul";
  /** The amount added or multiplied by. */
  readonly operand: number | bigint;
  /** The lowest allowed result, if the field has a `min`. */
  readonly min: number | bigint | undefined;
  /** The highest allowed result, if the field has a `max`. */
  readonly max: number | bigint | undefined;
}

/**
 * What the executor needs to tell "no document" from "guard failed".
 *
 * @example
 * const state: GuardState = { filter: { _id: id }, guard: IncrementGuard.expression(paths), paths };
 */
export interface GuardState {
  /** The user's filter in database form (without the guard). */
  readonly filter: PlanDocument;
  /** The guard expression in database form (the `$expr` operand). */
  readonly guard: PlanDocument;
  /** The guarded paths. */
  readonly paths: readonly GuardedPath[];
}

/** The `ctx.locals` key under which the guard state is kept. */
const GUARD = Symbol("typemo.steps.incrementGuard");

/** Matches a positional path segment: `$`, `$[]`, `$[id]` or an index. */
const POSITIONAL = /^(?:\$(?:\[[A-Za-z0-9]*\])?|\d+)$/;

/**
 * A `min`/`max` option as a bound; anything but a number or a bigint is no bound.
 *
 * @param value - The option value.
 * @returns The bound, or `undefined`.
 */
const bound = (value: unknown): number | bigint | undefined =>
  typeof value === "number" || typeof value === "bigint" ? value : undefined;

/**
 * The conditional `$inc`/`$mul` of fields with `min`/`max`.
 *
 * @example
 * const paths = IncrementGuard.paths(schema, { $inc: { stock: -1 } }, "updateOne");
 * const guard = IncrementGuard.expression(paths); // { $gte: [{ $add: [{ $ifNull: ["$stock", 0] }, -1] }, 0] }
 */
export class IncrementGuard {
  /** The `ctx.locals` key of the {@link GuardState}. */
  static readonly KEY: symbol = GUARD;

  /**
   * The guarded paths of an operator update (code form, cast values); throws for unguardable ones.
   *
   * @param schema - The compiled schema.
   * @param update - The cast update.
   * @param operation - The operation name (`bulkWrite` cannot be guarded).
   * @returns The `$inc`/`$mul` paths whose field has a `min` or `max`.
   * @throws {ValidationError} When a guarded path goes through an array, or the operation is `bulkWrite`.
   */
  static paths(schema: CompiledSchema, update: PlanDocument, operation: string): GuardedPath[] {
    const guarded: GuardedPath[] = [];
    const refused: SchemaIssue[] = [];
    for (const operator of ["$inc", "$mul"] as const) {
      const operand = update[operator];
      if (!BsonGuards.isPlainObject(operand)) continue;
      for (const [path, value] of Object.entries(operand)) {
        const resolution = PathResolver.resolve(schema, path, "update");
        if (!resolution.ok) continue;
        const node = resolution.value.node;
        const min = bound(node.options.min);
        const max = bound(node.options.max);
        if (min === undefined && max === undefined) continue;
        if (typeof value !== "number" && typeof value !== "bigint") continue;
        if (path.split(".").some((segment) => POSITIONAL.test(segment))) {
          refused.push({
            path: path.split("."),
            reason: min !== undefined ? "min" : "max",
            message: `${operator} on a field with min/max inside an array cannot be guarded atomically; use save() or $set with a validated value`,
            value,
          });
          continue;
        }
        guarded.push({ path, dbPath: resolution.value.dbPath, operator, operand: value, min, max });
      }
    }
    if (refused.length > 0) throw new ValidationError(refused);
    if (guarded.length > 0 && operation === "bulkWrite") {
      throw IncrementGuard.refuse(
        guarded,
        "in bulkWrite (no per-operation match count tells a failed guard from a missing document); use updateOne/updateMany",
      );
    }
    return guarded;
  }

  /**
   * The guard expression (database names): every guarded result within its bounds.
   *
   * @param paths - The guarded paths.
   * @returns The `$expr` operand.
   */
  static expression(paths: readonly GuardedPath[]): PlanDocument {
    const conditions: PlanDocument[] = [];
    for (const path of paths) {
      const stored = { $ifNull: [`$${path.dbPath}`, 0] };
      const result =
        path.operator === "$inc" ? { $add: [stored, path.operand] } : { $multiply: [stored, path.operand] };
      if (path.min !== undefined) conditions.push({ $gte: [result, path.min] });
      if (path.max !== undefined) conditions.push({ $lte: [result, path.max] });
    }
    return Object.freeze(conditions.length === 1 ? (conditions[0] as PlanDocument) : { $and: conditions });
  }

  /**
   * Adds the guard of each updating unit to its (already encoded) filter and keeps the state for the
   * executor. `plans` are the guarded paths computed before encoding, by unit index.
   *
   * @param ctx - The operation context.
   * @param plans - The guarded paths by work unit index.
   */
  static apply(ctx: OperationContext, plans: ReadonlyMap<number, readonly GuardedPath[]>): void {
    if (plans.size === 0) return;
    OperationView.map(ctx, (unit: WorkUnit) => {
      const paths = plans.get(unit.index);
      if (paths === undefined || paths.length === 0) return unit;
      const filter = unit.filter ?? Object.freeze({});
      const guard = IncrementGuard.expression(paths);
      ctx.locals.set(GUARD, Object.freeze({ filter, guard, paths }) satisfies GuardState);
      return { ...unit, filter: Object.freeze({ $and: Object.freeze([filter, Object.freeze({ $expr: guard })]) }) };
    });
  }

  /**
   * Refuses an upsert with a guarded path (checked before anything is sent).
   *
   * @param paths - The guarded paths.
   * @returns The error to throw.
   */
  static refuseUpsert(paths: readonly GuardedPath[]): ValidationError {
    return IncrementGuard.refuse(paths, "with upsert (a failed guard would insert a new document)");
  }

  /**
   * The error for guarded paths that cannot be guarded in the given situation.
   *
   * @param paths - The guarded paths.
   * @param why - The situation, completing the message.
   * @returns A `ValidationError` with one issue per path.
   */
  private static refuse(paths: readonly GuardedPath[], why: string): ValidationError {
    return new ValidationError(
      paths.map((path) => ({
        path: path.path.split("."),
        reason: path.min !== undefined ? "min" : "max",
        message: `${path.operator} on a field with min/max cannot be guarded ${why}`,
        value: path.operand,
      })),
    );
  }

  /**
   * The state of the operation, when its update is guarded.
   *
   * @param ctx - The operation context.
   * @returns The guard state, or `undefined` when the update is not guarded.
   */
  static stateOf(ctx: OperationContext): GuardState | undefined {
    return ctx.locals.get(GUARD) as GuardState | undefined;
  }

  /**
   * The projection of the follow-up read: the guarded fields only.
   *
   * @param state - The guard state.
   * @returns The projection.
   */
  static projection(state: GuardState): PlanDocument {
    return Object.fromEntries(state.paths.map((path) => [path.dbPath, 1]));
  }

  /**
   * Whether the user's filter selects at most one document (`_id` equality, the value not an operator
   * object), so `updateMany` can be handled like `updateOne`: no pre-check, a read only when nothing matched.
   *
   * @param state - The guard state (its filter is all that is read).
   * @returns `true` for a single-document filter.
   */
  static singleDocument(state: Pick<GuardState, "filter">): boolean {
    if (!Object.hasOwn(state.filter, "_id")) return false;
    const id = state.filter._id;
    if (!BsonGuards.isPlainObject(id)) return id !== undefined && id !== null;
    const keys = Object.keys(id);
    return keys.length === 1 && keys[0] === "$eq";
  }

  /**
   * The filter of the `updateMany` pre-check: documents the guard would skip.
   *
   * @param state - The guard state.
   * @returns The filter that matches the user's filter and fails the guard.
   */
  static outOfRange(state: GuardState): PlanDocument {
    return {
      $and: [state.filter, { $expr: { $not: [state.guard] } }],
    };
  }

  /**
   * The `ValidationError` of a failed guard, from the stored document the follow-up read found.
   *
   * @param state - The guard state.
   * @param stored - The stored document the follow-up read found.
   * @returns An error with one issue per bound the would-be result violates; a generic one when the stored
   * value changed since the write.
   */
  static failure(state: GuardState, stored: Readonly<Record<string, unknown>>): ValidationError {
    const issues: SchemaIssue[] = [];
    for (const path of state.paths) {
      const current = IncrementGuard.read(stored, path.dbPath);
      const result = IncrementGuard.result(path, current);
      const shown = `${path.operator} ${String(path.operand)} on ${String(current ?? "(absent)")} gives ${String(result)}`;
      if (result === undefined) continue;
      if (path.min !== undefined && result < path.min) {
        issues.push({
          path: path.path.split("."),
          reason: "min",
          message: `${shown}, below the minimum ${String(path.min)}; nothing was written`,
          value: result,
        });
      }
      if (path.max !== undefined && result > path.max) {
        issues.push({
          path: path.path.split("."),
          reason: "max",
          message: `${shown}, above the maximum ${String(path.max)}; nothing was written`,
          value: result,
        });
      }
    }
    if (issues.length > 0) return new ValidationError(issues);
    /* The document changed between the write and the read: the guard still held at the write. */
    return new ValidationError(
      state.paths.map((path) => ({
        path: path.path.split("."),
        reason: path.min !== undefined ? "min" : "max",
        message: `${path.operator} was not applied: the result was out of range when the update ran (the stored value changed since); nothing was written`,
        value: path.operand,
      })),
    );
  }

  /**
   * The value at a dotted database path of a stored document.
   *
   * @param doc - The stored document.
   * @param dbPath - The path in database names.
   * @returns The value, or `undefined` when the path does not lead through objects.
   */
  private static read(doc: Readonly<Record<string, unknown>>, dbPath: string): unknown {
    let value: unknown = doc;
    for (const segment of dbPath.split(".")) {
      if (!BsonGuards.isPlainObject(value)) return undefined;
      value = value[segment];
    }
    return value;
  }

  /**
   * The value `$inc`/`$mul` would produce from the stored value (a missing one counts as `0`).
   *
   * @param path - The guarded path.
   * @param current - The stored value.
   * @returns The result, or `undefined` when the stored value is not a number.
   */
  private static result(path: GuardedPath, current: unknown): number | bigint | undefined {
    const stored = current === undefined || current === null ? 0 : current;
    if (typeof stored === "bigint" || typeof path.operand === "bigint") {
      const a =
        typeof stored === "bigint" ? stored : typeof stored === "number" ? BigInt(Math.trunc(stored)) : undefined;
      const b = typeof path.operand === "bigint" ? path.operand : BigInt(Math.trunc(path.operand));
      if (a === undefined) return undefined;
      return path.operator === "$inc" ? a + b : a * b;
    }
    if (typeof stored !== "number") return undefined;
    return path.operator === "$inc" ? stored + (path.operand as number) : stored * (path.operand as number);
  }
}
