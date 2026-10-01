import type { StrictModeError } from "../../errors/strict-mode-error.ts";
import { PolicyErrors } from "../../policies/policy-errors.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { OperationContext } from "../pipeline/operation-context.ts";
import { OperationView, type WorkUnit } from "./operation-view.ts";

/*
 * The immutable fields of a replacement. A replacement REWRITES the stored document, so what it says about an
 * immutable field must agree with what is stored: the same value when it carries the field, no field when it leaves
 * the field out (a field the stored document does not have stays absent). Only the server knows the stored
 * document, so the replacement is made CONDITIONAL, like `$inc` on a field with min/max (`IncrementGuard`): the
 * filter gets `$expr` that holds when every immutable field agrees, so a replacement that would change, drop or add
 * an immutable value is never written, atomically.
 *
 * "Nothing matched" is then told from "an immutable field disagrees" by ONE follow-up read of the user's filter in
 * the same session (inside a transaction it sees the same snapshot): a document → `StrictModeError` with rule
 * `immutable` naming the field (the server says which check failed, so values are never compared in JavaScript);
 * none → the ordinary "no document". The success path costs no extra round trip.
 *
 * Two cases cannot wait for the write:
 * - an upsert would INSERT a new document when the guard, not the filter, fails, and the server does not take
 *   `$expr` in the filter of an upsert at all. So an upsert keeps its filter and first reads the documents the guard
 *   refuses (one read before the write). Inside a transaction the read and the write see the same snapshot; outside
 *   one, a document written between the read and the write is not compared (the race of such an upsert);
 * - `bulkWrite` reports no per-operation match counts, so every guarded `replaceOne` is checked by the same read
 *   before the bulk is sent: a refused operation fails like an invalid one (unordered: in the write errors, the
 *   others are written; ordered: nothing is sent). A document that changes after that read is not replaced and
 *   counted as not matched.
 */

/**
 * One immutable field of a replacement and what the stored document must hold.
 *
 * @example
 * const check: ImmutableCheck = { path: "country", dbPath: "country", given: true, condition: { $eq: ["$country", { $literal: "PL" }] } };
 */
export interface ImmutableCheck {
  /** The field in code names (the error). */
  readonly path: string;
  /** The field in database names (the field reference of the condition). */
  readonly dbPath: string;
  /** The replacement carries the field. */
  readonly given: boolean;
  /** The condition over the stored document, `true` when the field agrees (the `$expr` operand). */
  readonly condition: PlanDocument;
}

/**
 * What the executor needs to check one replacement.
 *
 * @example
 * const state = ReplacementGuard.of(ctx, 0);
 * if (state !== undefined) console.log(state.checks.map((check) => check.path));
 */
export interface ReplacementGuardState {
  /** The schema name (the error). */
  readonly schemaName: string;
  /** The user's filter in database form (without the guard). */
  readonly filter: PlanDocument;
  /** The guard in database form (the `$expr` operand). */
  readonly guard: PlanDocument;
  /** The immutable fields, in schema order. */
  readonly checks: readonly ImmutableCheck[];
  /** The replacement is an upsert. */
  readonly upsert: boolean;
}

/** The `ctx.locals` key of the guard states by unit index. */
const GUARDS = Symbol("typemo.steps.replacementGuard");

/** The projected value of a check that holds. */
const SAME = "same";

/** The conditional replacement of a schema with immutable fields. */
export class ReplacementGuard {
  /**
   * The immutable fields of a schema a replacement is checked against: every field with `immutable` but the
   * service fields (`_id` is kept by the server, the timestamps and the version by the core).
   *
   * @param schema - The compiled schema.
   * @param replacement - The replacement in database form.
   * @returns One check per immutable field; empty when the schema has none.
   */
  static checks(schema: CompiledSchema, replacement: PlanDocument): ImmutableCheck[] {
    const checks: ImmutableCheck[] = [];
    for (const field of schema.fields) {
      if (!field.immutable || field.service !== undefined) continue;
      const reference = `$${field.dbPath}`;
      const given = Object.hasOwn(replacement, field.dbPath);
      checks.push({
        path: field.path,
        dbPath: field.dbPath,
        given,
        condition: given
          ? { $eq: [reference, { $literal: replacement[field.dbPath] }] }
          : { $eq: [{ $type: reference }, "missing"] },
      });
    }
    return checks;
  }

  /**
   * Adds the guard of every replacement but an upsert to its (already encoded) filter and keeps the state for the
   * executor.
   *
   * @param ctx - The operation context, after the encode.
   */
  static apply(ctx: OperationContext): void {
    const schema = OperationView.schema(ctx);
    if (!schema.fields.some((field) => field.immutable && field.service === undefined)) return;
    const states = new Map<number, ReplacementGuardState>();
    OperationView.map(ctx, (unit: WorkUnit) => {
      if (unit.replacement === undefined) return unit;
      const checks = ReplacementGuard.checks(schema, unit.replacement);
      if (checks.length === 0) return unit;
      const filter = unit.filter ?? Object.freeze({});
      const guard = Object.freeze(
        checks.length === 1 ? (checks[0] as ImmutableCheck).condition : { $and: checks.map((one) => one.condition) },
      );
      const upsert = unit.upsert === true;
      states.set(unit.index, Object.freeze({ schemaName: schema.name, filter, guard, checks, upsert }));
      /* The server refuses $expr in the filter of an upsert: an upsert is checked by the read before it. */
      if (upsert) return unit;
      return { ...unit, filter: Object.freeze({ $and: Object.freeze([filter, Object.freeze({ $expr: guard })]) }) };
    });
    if (states.size > 0) ctx.locals.set(GUARDS, states);
  }

  /**
   * The guard state of one replacement.
   *
   * @param ctx - The operation context.
   * @param index - The unit index (`0` for a single replacement, the operation index in a `bulkWrite`).
   * @returns The state, or `undefined` when the replacement is not guarded.
   */
  static of(ctx: OperationContext, index: number): ReplacementGuardState | undefined {
    return (ctx.locals.get(GUARDS) as ReadonlyMap<number, ReplacementGuardState> | undefined)?.get(index);
  }

  /**
   * Every guarded replacement of the operation, by unit index.
   *
   * @param ctx - The operation context.
   * @returns The states; empty when nothing is guarded.
   */
  static all(ctx: OperationContext): ReadonlyMap<number, ReplacementGuardState> {
    return (ctx.locals.get(GUARDS) as ReadonlyMap<number, ReplacementGuardState> | undefined) ?? new Map();
  }

  /**
   * The filter of the documents the guard refuses: they match the user's filter and some immutable field disagrees.
   *
   * @param state - The guard state.
   * @returns The filter of the read before an upsert or a `bulkWrite`.
   */
  static refused(state: ReplacementGuardState): PlanDocument {
    return { $and: [state.filter, { $expr: { $not: [state.guard] } }] };
  }

  /**
   * The projection of the check read: per field, `"same"` when it agrees, else the BSON type of the stored value
   * (`"missing"` when the stored document has no such field).
   *
   * @param state - The guard state.
   * @returns The projection.
   */
  static projection(state: ReplacementGuardState): PlanDocument {
    const out: Record<string, unknown> = { _id: 0 };
    for (const [index, check] of state.checks.entries()) {
      out[`c${index}`] = { $cond: [check.condition, SAME, { $type: `$${check.dbPath}` }] };
    }
    return out;
  }

  /**
   * The error of a refused replacement, from the row of the check read.
   *
   * @param state - The guard state.
   * @param row - The projected row of the stored document.
   * @returns A `StrictModeError` with rule `immutable` naming the first field that disagrees.
   */
  static failure(state: ReplacementGuardState, row: Readonly<Record<string, unknown>>): StrictModeError {
    for (const [index, check] of state.checks.entries()) {
      const stored = row[`c${index}`];
      if (stored === SAME || stored === undefined) continue;
      if (!check.given) {
        return PolicyErrors.strict(
          "immutable",
          `a replacement of ${state.schemaName} without the immutable field "${check.path}" would drop it from the stored document; the document was not replaced. Include the stored value, or update the other fields with $set`,
          check.path,
        );
      }
      if (stored === "missing") {
        return PolicyErrors.strict(
          "immutable",
          `a replacement of ${state.schemaName} sets the immutable field "${check.path}", which the stored document does not have; the document was not replaced. An immutable field gets its value when the document is created`,
          check.path,
        );
      }
      return PolicyErrors.strict(
        "immutable",
        `a replacement of ${state.schemaName} changes the immutable field "${check.path}"; the document was not replaced. Carry the stored value`,
        check.path,
      );
    }
    /* The stored document changed between the write and the read: the guard still refused it at the write. */
    return PolicyErrors.strict(
      "immutable",
      `a replacement of ${state.schemaName} was not written: an immutable field disagreed with the stored document when it ran (the document changed since)`,
      state.checks[0]?.path,
    );
  }
}
