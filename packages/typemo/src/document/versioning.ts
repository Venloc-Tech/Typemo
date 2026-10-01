import { QueryError } from "../errors/query-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import type { UpdateParts, VersionImpact } from "./collections/update-ops.ts";
import type { DocumentState } from "./document-state.ts";

/**
 * How a schema versions its documents (the version key is `__v`, added by `Versioned`):
 * - `"none"`: no version field;
 * - `"array"` (default with `Versioned`): positional array changes are guarded — a `$set arr.i…` is
 *   conditional on the version read (Mongoose H513: otherwise another element is written after a
 *   concurrent removal); a change of an array's length or order increments it; both flags are combined,
 *   never overwritten (Mongoose H078);
 * - `"optimistic"` (`@Schema({ optimisticConcurrency: true })`): EVERY saving update is conditional on
 *   the version and increments it; with a field list (`optimisticConcurrency: ["balance", "settings.$*"]`)
 *   only an update that touches a listed path does, any other save versions as in `"array"`.
 *
 * A save that needs the version of a document read WITHOUT `__v` (a projection) is an error — Mongoose
 * silently skipped the check.
 *
 * @example
 * ```ts
 * const mode: VersionMode = Versioning.mode(schema); // "array"
 * ```
 */
export type VersionMode = "none" | "array" | "optimistic";

/**
 * What one save does with the version.
 *
 * @example
 * ```ts
 * const plan: VersionPlan = { where: true, increment: false };
 * ```
 */
export interface VersionPlan {
  /** Add `__v: <read version>` to the filter. */
  readonly where: boolean;
  /** Add `$inc: { __v: 1 }`. */
  readonly increment: boolean;
}

/** The plan of a schema without versioning. */
const NONE: VersionPlan = Object.freeze({ where: false, increment: false });

/** Matches a path with an array index segment (`lines.2.qty`). */
const INDEX_SEGMENT = /(?:^|\.)\d+(?:\.|$)/;
/** Matches a path segment that is an array index. */
const INDEX = /^\d+$/;

/** Versioning rules. */
export class Versioning {
  /**
   * The version field of the schema (`Versioned`).
   *
   * @param schema - The compiled schema.
   * @returns The field node, or `undefined` without one.
   */
  static field(schema: CompiledSchema): PathNode | undefined {
    return schema.fields.find((node) => node.service === "version");
  }

  /**
   * `true` when the update depends on POSITIONS read earlier: a path through an array index under any
   * operator (`$set lines.2.qty`, `$push comments.0.likedBy` — Mongoose gh-11108), or `$pop` (it removes
   * whatever is last NOW: Mongoose versions it WHERE|INC too).
   *
   * @param update - The update parts of the save.
   * @returns `true` when the update is positional.
   */
  static positional(update: UpdateParts): boolean {
    return (
      (update.$pop !== undefined && Object.keys(update.$pop).length > 0) ||
      Object.values(update).some(
        (record) => record !== undefined && Object.keys(record as object).some((path) => INDEX_SEGMENT.test(path)),
      )
    );
  }

  /**
   * The versioning mode of a schema.
   *
   * @param schema - The compiled schema.
   * @returns `none` without a version field, `optimistic` with `optimisticConcurrency`, else `array`.
   */
  static mode(schema: CompiledSchema): VersionMode {
    if (Versioning.field(schema) === undefined) return "none";
    return schema.options.optimisticConcurrency === undefined ? "array" : "optimistic";
  }

  /**
   * Whether the save's update touches a path of the `optimisticConcurrency` list (always `true` for
   * `optimisticConcurrency: true`). A listed path and a written path overlap when one is a prefix of the other
   * segment by segment — array indexes of the written path skipped (`comments.0.text` is `comments.text`), `$*` of a
   * listed path matching any Map key (`settings.$*`, Mongoose H017) — so writing a whole array or subdocument that
   * contains a listed path counts (Mongoose gh-16054).
   *
   * @param schema - The compiled schema.
   * @param update - The update parts of the save.
   * @returns `true` when the update is subject to the version check.
   */
  static concurrent(schema: CompiledSchema, update: UpdateParts): boolean {
    const list = schema.options.optimisticConcurrency;
    if (list === undefined) return false;
    if (list === true) return true;
    const listed = list.map((path) => path.split("."));
    return Object.values(update).some(
      (record) =>
        record !== undefined &&
        Object.keys(record as object).some((path) => {
          const written = path.split(".").filter((segment) => !INDEX.test(segment));
          return listed.some((segments) => Versioning.overlaps(segments, written));
        }),
    );
  }

  /**
   * Whether a listed path and a written path overlap (one is a prefix of the other, `$*` matches any segment).
   *
   * @param listed - The segments of a listed path.
   * @param written - The segments of a written path, index segments removed.
   * @returns `true` when they overlap.
   */
  private static overlaps(listed: readonly string[], written: readonly string[]): boolean {
    const length = Math.min(listed.length, written.length);
    for (let index = 0; index < length; index++) {
      const segment = listed[index];
      if (segment !== "$*" && segment !== written[index]) return false;
    }
    return true;
  }

  /**
   * What a saving update does with the version. `impact` is the strongest impact the collections
   * reported; the positional writes are read from the update itself (`$set`/`$unset` of a path with an
   * index), so a save with both a positional write and a length change gets BOTH (H078).
   *
   * @param state - The document state.
   * @param impact - The strongest version impact the collections reported.
   * @param update - The update parts of the save.
   * @returns What the save does with the version.
   * @throws {QueryError} When the save needs the version but the document was read without it.
   */
  static plan(state: DocumentState, impact: VersionImpact, update: UpdateParts): VersionPlan {
    const mode = Versioning.mode(state.schema);
    /* With a field list, a save that touches none of the fields keeps the array versioning of the default
       mode (positional writes stay guarded, Mongoose H513) — Mongoose dropped that protection. */
    const plan: VersionPlan =
      mode === "none"
        ? NONE
        : mode === "optimistic" && Versioning.concurrent(state.schema, update)
          ? { where: true, increment: true }
          : { where: impact === "where" || Versioning.positional(update), increment: impact === "increment" };
    if ((plan.where || plan.increment) && state.version === undefined) {
      const key = Versioning.field(state.schema)?.key ?? "__v";
      throw new QueryError(
        `${state.schema.name}: this save needs the version "${key}", but the document was read without it (a projection left it out); select it, or read the document again — the check is never skipped silently`,
        { path: key },
      );
    }
    return plan;
  }
}
