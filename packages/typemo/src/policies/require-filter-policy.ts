import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView, type UnitKind } from "../operation/steps/operation-view.ts";
import { PolicyErrors } from "./policy-errors.ts";

/*
 * An empty filter on an operation that changes or removes documents (one or many: which one would be arbitrary), is an
 * error (Mongoose `requireFilter` was off by default, H090, H300: a typo'd or uninitialized filter deleted
 * the collection). "Every document" on purpose is written explicitly: `Filters.all()` (a real, non-empty
 * filter). Checked on the USER's filter, before the core adds the tenant and soft delete clauses — those
 * never make a missing filter acceptable.
 */

/** The operation kinds that refuse an empty filter. */
const REQUIRES: ReadonlySet<UnitKind> = new Set([
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
]);

/** The kinds that touch one document: with an empty filter the document would be arbitrary. */
const ONE_FORMS: ReadonlySet<UnitKind> = new Set([
  "updateOne",
  "replaceOne",
  "deleteOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
]);

/** The require-filter policy. */
export class RequireFilterPolicy {
  /** The policy name, as it appears in diagnostics. */
  readonly name = "requireFilter";

  /**
   * Checks the filter of every unit of the operation.
   *
   * @param ctx - The operation context.
   * @throws {StrictModeError} When a unit needs a filter and has an empty one.
   */
  run(ctx: OperationContext): void {
    for (const unit of OperationView.units(ctx)) RequireFilterPolicy.check(unit.kind, unit.filter);
  }

  /**
   * Throws when `kind` needs a filter and `filter` is absent or `{}`.
   *
   * @param kind - The operation unit kind.
   * @param filter - The user's filter.
   * @throws {StrictModeError} With rule `empty-filter`.
   */
  static check(kind: UnitKind, filter: object | undefined): void {
    if (!REQUIRES.has(kind)) return;
    if (filter !== undefined && Object.keys(filter).length > 0) return;
    /* A One form touches a single arbitrary document, a Many form every one: the text says which. */
    const effect = ONE_FORMS.has(kind) ? "change or remove an arbitrary document" : "affect every document";
    throw PolicyErrors.strict(
      "empty-filter",
      `${kind} with an empty filter would ${effect}; pass a filter, or Filters.all() to mean every document on purpose`,
    );
  }
}
