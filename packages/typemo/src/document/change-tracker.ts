import type { PathNode } from "../schema/compiler/path-node.ts";
import { SchemaWalker } from "../schema/compiler/schema-walker.ts";
import { Collections } from "./collections/collections.ts";
import { HydrationPlan } from "./collections/hydration-plan.ts";
import { Lineage } from "./collections/lineage.ts";
import { Subdocuments } from "./collections/subdocument.ts";
import { ValueEquality } from "./collections/value-equality.ts";
import { type DocumentState, DocumentStates } from "./document-state.ts";
import { PopulatedFields } from "./populated-fields.ts";

/**
 * How one field differs from its baseline: `none`, `unset` (absent now, present before), `set` (a new
 * value), `child` (the same container with changes inside) or `replaced` (a container swapped around its
 * methods).
 *
 * @example
 * ```ts
 * const change: FieldChange = ChangeTracker.fieldChange(user, state, node); // "none"
 * ```
 */
export type FieldChange = "none" | "unset" | "set" | "child" | "replaced";

/**
 * A document as a bag of fields.
 *
 * @example
 * ```ts
 * const doc: Doc = { name: "Ada" };
 * ```
 */
type Doc = Record<string, unknown>;

/**
 * Change tracking of the ROOT document. One rule, the same as for subdocument fields: the current field
 * values are compared with the BASELINE (the values at the last load or save).
 * - a scalar: changed when it no longer equals the baseline by value (`ValueEquality`: `equals` of BSON
 *   values, time of dates) — assigning the saved value back is "not modified" (Mongoose H501);
 * - a container or subdocument: the same object with changes inside (`Collections.hasChanges`), or a new
 *   tracked value put in by `$set` (a whole `$set`); one put in by plain assignment around `$set` is
 *   `replaced` (the save refuses it with `DirectWriteError`);
 * - absent now, present before: `$unset` (a JS `delete doc.field`);
 * - `$markModified(path)`: forced.
 *
 * Nothing here has side effects: `$isModified` and `$getChanges` only read (Mongoose's `$getChanges`
 * changed the version and could throw).
 */
export class ChangeTracker {
  /**
   * How field `node` of `document` changed since the baseline.
   *
   * @param document - The hydrated root document.
   * @param state - Its state.
   * @param node - The field node.
   * @param index - The field's position in the baseline; looked up by key when omitted.
   * @returns The kind of change.
   */
  static fieldChange(
    document: object,
    state: DocumentState,
    node: PathNode,
    index: number = state.plan.index.get(node.key) ?? -1,
  ): FieldChange {
    const doc = document as Doc;
    /* A populated field is compared by its STORED value (the ids), never by the documents. */
    const current = PopulatedFields.stored(
      document,
      node.key,
      Object.hasOwn(doc, node.key) ? doc[node.key] : undefined,
    );
    const baseline = state.baseline;
    const base = baseline.identity(index);
    if (current === undefined) return base === undefined ? "none" : "unset";
    /* A `Date` can change in place: compared by its time at the reset, never by identity. */
    if (baseline.isDate(index)) return baseline.sameDate(index, current) ? "none" : "set";
    if (current === base) return Collections.isTracked(current) && Collections.hasChanges(current) ? "child" : "none";
    if (HydrationPlan.isContainer(node) && current !== null) {
      /* A tracked value owned by this document (put in by `$set`) is a whole `$set`; anything else went
         around the methods (a plain array or object assigned directly). */
      if (!Collections.isTracked(current) || !Lineage.isAttachedTo(current, document)) return "replaced";
      /* A new value equal to the stored one is no change (Mongoose gh-12992 / H501): compared as plain data. */
      return base !== undefined &&
        ValueEquality.equals(Collections.toPlain(current, { maps: "map" }), Collections.toPlain(base, { maps: "map" }))
        ? "none"
        : "set";
    }
    return ValueEquality.equals(current, base) ? "none" : "set";
  }

  /**
   * The code paths changed since the baseline (root keys, paths inside containers, forced paths).
   *
   * @param document - The hydrated root document.
   * @returns The distinct changed paths.
   */
  static modifiedPaths(document: object): readonly string[] {
    const state = DocumentStates.of(document);
    const doc = document as Doc;
    const paths: string[] = [];
    for (const field of state.plan.fields) {
      const node = field.node;
      const change = ChangeTracker.fieldChange(document, state, node, field.index);
      switch (change) {
        case "none":
          break;
        case "child":
          paths.push(
            node.key,
            ...Collections.modifiedPaths(PopulatedFields.stored(document, node.key, doc[node.key]), {
              code: node.key,
              db: node.dbKey,
            }),
          );
          break;
        default:
          paths.push(node.key);
      }
    }
    for (const path of state.marked ?? []) paths.push(path);
    return [...new Set(paths)];
  }

  /**
   * The rule of `$isModified(path?)`: anything, or `path`, an ancestor or a descendant of it.
   *
   * @param document - The hydrated root document.
   * @param path - The path to test; any change counts when omitted.
   * @returns `true` when the document (or the path) is modified.
   */
  static isModified(document: object, path?: string): boolean {
    const paths = ChangeTracker.modifiedPaths(document);
    if (path === undefined) return paths.length > 0;
    return paths.some(
      (changed) => changed === path || changed.startsWith(`${path}.`) || path.startsWith(`${changed}.`),
    );
  }

  /**
   * Whether a directly assigned value of a reference field is the referenced document itself (an object with an
   * own `_id`) rather than an id.
   *
   * @param node - The field node.
   * @param value - The assigned value.
   * @returns `true` for a document on a `ref`/`refPath`/`refModel` field.
   */
  private static isAssignedDocument(node: PathNode, value: unknown): value is object {
    const reference = node.ref !== undefined || node.refPath !== undefined || node.refModel !== undefined;
    return (
      reference && typeof value === "object" && value !== null && !Array.isArray(value) && Object.hasOwn(value, "_id")
    );
  }

  /**
   * Casts every scalar field assigned DIRECTLY since its last cast (`doc.age = …` bypasses `$set`), once:
   * the cast value is written back, so memory and database agree; a user `set` runs once (Mongoose H508). The
   * fields of subdocuments, of array elements and of Map values are cast too, at any depth. A value that cannot
   * be cast is a `CastError` (the first one, in the order of the schema fields), never an issue of a
   * `ValidationError`: the constraints of a field that did not cast are not checked.
   *
   * @param document - The hydrated root document.
   * @param state - Its state.
   * @throws {CastError} At the first directly assigned value that cannot be cast.
   */
  static castAssigned(document: object, state: DocumentState): void {
    const doc = document as Doc;
    for (const field of state.plan.fields) {
      const node = field.node;
      if (!Object.hasOwn(doc, node.key)) continue;
      if (field.container) {
        Subdocuments.castAssigned(PopulatedFields.stored(document, node.key, doc[node.key]), node.key);
        continue;
      }
      const value = PopulatedFields.stored(document, node.key, doc[node.key]);
      if (value === undefined || Object.is(value, DocumentStates.castValue(state, node.key))) continue;
      if (value === null && node.nullable) {
        DocumentStates.castOf(state).set(node.key, null);
        continue;
      }
      const cast = SchemaWalker.castValue(node, value, node.key);
      DocumentStates.castOf(state).set(node.key, cast);
      if (ChangeTracker.isAssignedDocument(node, value)) {
        /* A document assigned to a reference stays in place as its populated value (the populated type stays
           true); its `_id`, the cast value, is what is stored. */
        PopulatedFields.put(document, document, node.key, {
          path: node.key,
          original: cast,
          hadOriginal: true,
          value,
          virtual: false,
        });
        continue;
      }
      Object.defineProperty(doc, node.key, { value: cast, enumerable: true, writable: true, configurable: true });
    }
  }
}
