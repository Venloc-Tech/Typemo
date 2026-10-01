import type { ClientSession } from "mongodb";
import type { Connection } from "../connection/connection.ts";
import { InternalError } from "../errors/internal-error.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { FieldBaseline } from "./collections/field-baseline.ts";
import type { HydrationPlan } from "./collections/hydration-plan.ts";

/**
 * Which top-level fields a read loaded (from the projection of the query).
 *
 * @example
 * ```ts
 * const selection: Selection = { mode: "include", keys: new Set(["name"]) };
 * ```
 */
export type Selection =
  | { readonly mode: "all" }
  | {
      readonly mode: "include" | "exclude";
      /** Code keys named by the projection (included, or excluded). */
      readonly keys: ReadonlySet<string>;
    };

/**
 * Mutable hidden state of one hydrated ROOT document. It lives in a `WeakMap` keyed by the document, never
 * in a property: a user field may be called `isNew`, `state` or `__v` without any collision, and
 * `Object.keys`, spread, `JSON.stringify` and `structuredClone` see only the data. Subdocuments and
 * containers keep their own state.
 *
 * @example
 * ```ts
 * const state: DocumentState = DocumentStates.of(user);
 * state.isNew; // false after the first insert
 * ```
 */
export interface DocumentState {
  /** The schema of the document's class (a discriminator's when the stored key chose one). */
  readonly schema: CompiledSchema;
  /** The hydration plan of the schema (field positions of the baselines). */
  readonly plan: HydrationPlan;
  /** The connection the document belongs to (its model runs `save`). */
  readonly connection: Connection;
  /** `true` until the first successful insert. */
  isNew: boolean;
  /** `true` after a successful `$deleteOne()`. */
  deleted: boolean;
  /** A `save` of this document is in flight (a second one is refused). */
  saving: boolean;
  /**
   * Field values at the last reset (load or successful save): the change tracking of the root compares
   * against it. `Date`s are compared by their time at the reset.
   */
  baseline: FieldBaseline;
  /**
   * The values put on the document by the read that loaded it (identity; `undefined` for a new document): a
   * field still holding its loaded value was cast by the read (the read does not fill {@link cast}).
   */
  loaded: FieldBaseline | undefined;
  /**
   * The last CAST value of scalar fields set after the load (`$set`, a default, or the save's own cast; created
   * on the first). A field whose value is neither this one nor the loaded one was assigned directly and is cast
   * once at `save` (H508: a `set` runs once).
   */
  cast: Map<string, unknown> | undefined;
  /** Paths forced into the next update (`$markModified`; created on the first). */
  marked: Set<string> | undefined;
  /** The version (`__v`) the document was loaded or last saved with; `undefined` when not loaded. */
  version: number | undefined;
  /** The fields a read loaded (populate narrows it when it strips a field it had to add). */
  selection: Selection;
  /** Code keys of arrays loaded in part (`$slice`, `arr.$`, `$elemMatch`; Mongoose H033/H503/H512). */
  readonly partial: ReadonlySet<string>;
  /** The session of the read that loaded the document, or the one set with `$session(s)`. */
  session: ClientSession | null | undefined;
  /** Free space for the application (Mongoose `$locals`; created on the first `$locals()`). */
  locals: Record<string, unknown> | undefined;
}

/** The hidden state of every hydrated root document. */
const STATES = new WeakMap<object, DocumentState>();

/** The state slot of root documents. */
export class DocumentStates {
  /**
   * Registers the state of a document.
   *
   * @param document - The hydrated root document.
   * @param state - Its state.
   */
  static set(document: object, state: DocumentState): void {
    STATES.set(document, state);
  }

  /**
   * The state of a hydrated root document.
   *
   * @param document - A hydrated root document.
   * @returns Its state.
   * @throws {InternalError} For anything that is not a hydrated root document.
   */
  static of(document: object): DocumentState {
    const state = STATES.get(document);
    if (state === undefined) throw new InternalError("not a hydrated Typemo document");
    return state;
  }

  /**
   * Whether a value is a root document built by Typemo.
   *
   * @param value - The value to test.
   * @returns `true` for a hydrated root document.
   */
  static is(value: unknown): value is object {
    return typeof value === "object" && value !== null && STATES.has(value);
  }

  /**
   * The cast values of `state`, created on the first write.
   *
   * @param state - The document state.
   * @returns The map of cast values by field key.
   */
  static castOf(state: DocumentState): Map<string, unknown> {
    state.cast ??= new Map();
    return state.cast;
  }

  /**
   * The value of field `key` known to be cast: the last one cast since the load, else the loaded one.
   *
   * @param state - The document state.
   * @param key - The field's code key.
   * @returns The known cast value, or `undefined` when there is none.
   */
  static castValue(state: DocumentState, key: string): unknown {
    const cast = state.cast;
    if (cast?.has(key)) return cast.get(key);
    const index = state.plan.index.get(key);
    return index === undefined ? undefined : state.loaded?.identity(index);
  }

  /**
   * Whether field `key` was loaded (or the document is new).
   *
   * @param state - The document state.
   * @param key - The field's code key.
   * @returns `true` when the field is part of the selection.
   */
  static isSelected(state: DocumentState, key: string): boolean {
    if (state.isNew) return true;
    const selection = state.selection;
    switch (selection.mode) {
      case "all":
        return true;
      case "include":
        return selection.keys.has(key);
      case "exclude":
        return !selection.keys.has(key);
    }
  }
}
