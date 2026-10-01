import type { PathNode } from "../../schema/compiler/path-node.ts";
import { CollectionHydrator } from "./collection-hydrator.ts";
import { Lineage } from "./lineage.ts";
import { Subdocuments } from "./subdocument.ts";
import {
  COMMIT,
  DELTA,
  type FoundUnknown,
  HAS_CHANGES,
  MARK,
  NODE_OF,
  type NodeMark,
  type NodeSnapshot,
  type PathPair,
  type PlainOptions,
  RESET,
  RESTORE,
  REVERT_RESET,
  SNAPSHOT,
  TrackedProtocol,
  UNMARK,
} from "./tracked-protocol.ts";
import { type UnknownFields, UnknownFieldsError } from "./unknown-fields-error.ts";
import { type CollectionDelta, DeltaBuilder, type OpsForm } from "./update-ops.ts";

/**
 * An opaque saved state of a tracked value (`Collections.snapshot`).
 *
 * @example
 * ```ts
 * const snapshot: CollectionSnapshot = Collections.snapshot(user.tags);
 * ```
 */
export interface CollectionSnapshot {
  /** The snapshot of the tracked value; `undefined` for a value that is not tracked. */
  readonly node: NodeSnapshot | undefined;
}

/**
 * What a write took from a field value (`Collections.mark`): opaque, handed back to `commit`/`unmark`.
 *
 * @example
 * ```ts
 * const mark: CommitMark = Collections.mark(user.tags);
 * ```
 */
export interface CommitMark {
  /** The mark of the tracked value; `undefined` for a value that is not tracked. */
  readonly node: NodeMark | undefined;
}

/**
 * Options of `Collections.fromStored`.
 *
 * @example
 * ```ts
 * const options: FromStoredOptions = { partial: true, driver: true };
 * ```
 */
export interface FromStoredOptions {
  /**
   * The array was loaded in part (`$slice`, `arr.$`, `$elemMatch`): positional and whole writes are refused at
   * save.
   */
  readonly partial?: boolean;
  /** The value comes from the driver (the count of stored keys may stand for the exact check). */
  readonly driver?: boolean;
}

/** The delta of a value that is not tracked. */
const EMPTY_DELTA: CollectionDelta = Object.freeze({
  ops: Object.freeze({}),
  version: "none",
  modifiedPaths: [],
  unknown: [],
});

/**
 * Options of `Collections.toUpdateOps`.
 *
 * @example
 * ```ts
 * const options: UpdateOpsOptions = { unknownFields: "report" };
 * ```
 */
export interface UpdateOpsOptions {
  /**
   * What to do when the ops would rewrite or replace stored subdocuments with fields unknown to the schema:
   * `"throw"` (default) an `UnknownFieldsError`; `"report"` return them in `CollectionDelta.unknown`.
   */
  readonly unknownFields?: "throw" | "report";
}

/**
 * The façade of the typed collections for the document layer. Every function accepts any field value:
 * tracked values (arrays, subdocument arrays, Maps, subdocuments, nested objects) are handled, anything else
 * is a no-op. The document never needs the concrete classes.
 */
export class Collections {
  /**
   * The hydrated value of a field of `owner` from its stored (database) form: a tracked container or
   * subdocument for `array | map | subdocument | nested` nodes, the value itself (numbers promoted) for
   * scalars.
   *
   * @param node - The field node.
   * @param stored - The stored value.
   * @param owner - The document or subdocument that owns the field.
   * @param key - The CODE name of the field (`node.key`).
   * @param options - Hydration options.
   * @returns The hydrated value.
   */
  static fromStored(
    node: PathNode,
    stored: unknown,
    owner: object,
    key: string,
    options: FromStoredOptions = {},
  ): unknown {
    const value = CollectionHydrator.fromStored(node, stored, options.partial === true, options.driver === true);
    Lineage.attach(value, owner, key);
    return value;
  }

  /**
   * The hydrated value of a field of `owner` from user input: cast at once, then tracked.
   *
   * @param node - The field node.
   * @param input - The user input.
   * @param owner - The document or subdocument that owns the field.
   * @param key - The CODE name of the field.
   * @returns The cast, possibly tracked value.
   * @throws {CastError} When the input cannot be cast.
   */
  static fromInput(node: PathNode, input: unknown, owner: object, key: string): unknown {
    const value = CollectionHydrator.fromInput(node, input, () => {
      const base = Lineage.fullPath(owner);
      return base === undefined || base === "" ? key : `${base}.${key}`;
    });
    Lineage.attach(value, owner, key);
    return value;
  }

  /**
   * Whether a value is a tracked container or subdocument.
   *
   * @param value - The value to test.
   * @returns `true` for a tracked value.
   */
  static isTracked(value: unknown): boolean {
    return TrackedProtocol.is(value);
  }

  /**
   * Whether the value or anything inside it changed since the last reset (direct writes included). Never throws.
   *
   * @param value - The field value.
   * @returns `true` when changed.
   */
  static hasChanges(value: unknown): boolean {
    return TrackedProtocol.is(value) && value[HAS_CHANGES]();
  }

  /**
   * The update ops of a field value.
   *
   * @param value - The field value.
   * @param form - Database names with encoded values, or code names with plain values.
   * @param at - The value's paths; defaults to the node's own paths (right for a top-level field of a root
   * document).
   * @param options - Options of the walk.
   * @returns The ops, version impact, modified paths and unknown fields.
   * @throws {DirectWriteError} When the value was written around its methods.
   * @throws {PartialArrayError} When a partially loaded array would be overwritten.
   * @throws {UnknownFieldsError} When the ops would drop unknown stored fields and `unknownFields` is not
   * `"report"`.
   */
  static toUpdateOps(value: unknown, form: OpsForm, at?: PathPair, options: UpdateOpsOptions = {}): CollectionDelta {
    if (!TrackedProtocol.is(value)) return EMPTY_DELTA;
    const out = new DeltaBuilder(form, true);
    value[DELTA](at ?? Collections.pathsOf(value[NODE_OF]()), out);
    const result = out.result();
    if (result.unknown.length > 0 && options.unknownFields !== "report") {
      throw new UnknownFieldsError(Collections.publicUnknown(result.unknown));
    }
    return result;
  }

  /**
   * The stored subdocuments with fields unknown to the schema inside a value. Remembered at hydration: no query.
   *
   * @param value - The field value.
   * @param path - The value's own code path.
   * @returns The subdocuments with unknown stored keys.
   */
  static unknownFields(value: unknown, path: string): readonly UnknownFields[] {
    return Collections.publicUnknown(TrackedProtocol.unknownIn(value, path));
  }

  /**
   * The unknown-field entries with the instances that hold them (internal form of {@link unknownFields}).
   *
   * @param value - The field value.
   * @param path - The value's own code path.
   * @returns The found entries.
   */
  static unknownIn(value: unknown, path: string): readonly FoundUnknown[] {
    return TrackedProtocol.unknownIn(value, path);
  }

  /**
   * Called when a save accepted the loss: the unknown keys of these subdocuments are forgotten (and removed).
   *
   * @param found - The entries the save dropped.
   */
  static forgetUnknown(found: readonly FoundUnknown[]): void {
    for (const entry of found) Subdocuments.forgetUnknown(entry.owner);
  }

  /**
   * The public form of found unknown fields (without the owning instances).
   *
   * @param found - The found entries.
   * @returns The path and keys of each.
   */
  private static publicUnknown(found: readonly FoundUnknown[]): readonly UnknownFields[] {
    return found.map((entry) => ({ path: entry.path, keys: entry.keys }));
  }

  /**
   * The code paths changed inside a field value (direct writes reported as a change, never thrown).
   *
   * @param value - The field value.
   * @param at - The value's paths; defaults to the node's own paths.
   * @returns The changed code paths.
   */
  static modifiedPaths(value: unknown, at?: PathPair): readonly string[] {
    if (!TrackedProtocol.is(value) || !value[HAS_CHANGES]()) return [];
    const out = new DeltaBuilder("code", false);
    try {
      value[DELTA](at ?? Collections.pathsOf(value[NODE_OF]()), out);
    } catch {
      /* A partially loaded array refuses the ops, but it is still modified. */
      return [(at ?? Collections.pathsOf(value[NODE_OF]())).code];
    }
    return out.result().modifiedPaths;
  }

  /**
   * Commits after a successful write: journals emptied, shadows and baselines = current state (recursive).
   *
   * @param value - The field value.
   */
  static reset(value: unknown): void {
    if (TrackedProtocol.is(value)) value[RESET]();
  }

  /**
   * Called when a write's ops were built, before it is sent. The journals being sent are
   * taken out; changes made while the write is in flight go into fresh journals, so they are neither lost when
   * the write succeeds nor sent twice. Every mark must end in {@link commit} or {@link unmark}.
   *
   * @param value - The field value.
   * @returns The mark to hand back to `commit` or `unmark`.
   */
  static mark(value: unknown): CommitMark {
    return {
      node: TrackedProtocol.is(value) ? value[MARK]() : undefined,
    };
  }

  /**
   * The write of a {@link mark} succeeded: the sent state is the baseline; in-flight changes stay changes.
   *
   * @param value - The field value.
   * @param mark - The mark taken before the write.
   */
  static commit(value: unknown, mark: CommitMark): void {
    if (TrackedProtocol.is(value) && mark.node !== undefined) value[COMMIT](mark.node);
  }

  /**
   * The write of a {@link mark} failed: the sent journals come back. A part changed in flight too is
   * written whole next time (its current content covers both).
   *
   * @param value - The field value.
   * @param mark - The mark taken before the write.
   */
  static unmark(value: unknown, mark: CommitMark): void {
    if (TrackedProtocol.is(value) && mark.node !== undefined) value[UNMARK](mark.node);
  }

  /**
   * The full state of a field value (content, journals with every op kind, shadows, baselines, links).
   *
   * @param value - The field value.
   * @returns The snapshot.
   */
  static snapshot(value: unknown): CollectionSnapshot {
    return {
      node: TrackedProtocol.is(value) ? value[SNAPSHOT]() : undefined,
    };
  }

  /**
   * Puts back a state taken by {@link snapshot} (transaction abort / retry).
   *
   * @param value - The field value.
   * @param snapshot - The snapshot taken earlier.
   */
  static restore(value: unknown, snapshot: CollectionSnapshot): void {
    if (TrackedProtocol.is(value) && snapshot.node !== undefined) value[RESTORE](snapshot.node);
  }

  /**
   * After a failed write whose `reset` already ran (Mongoose `$__undoReset`): the journals and baselines
   * of the snapshot come back; a part that changed while the write was in flight is written whole next
   * time (the current content covers both).
   *
   * @param value - The field value.
   * @param snapshot - The snapshot taken before the write.
   */
  static revertReset(value: unknown, snapshot: CollectionSnapshot): void {
    if (TrackedProtocol.is(value) && snapshot.node !== undefined) value[REVERT_RESET](snapshot.node);
  }

  /**
   * Plain data of a value (Maps as native `Map`s or records).
   *
   * @param value - The field value.
   * @param options - Plain-data options.
   * @returns The plain data.
   */
  static toPlain(value: unknown, options: PlainOptions = { maps: "map" }): unknown {
    return TrackedProtocol.toPlain(value, options);
  }

  /**
   * Breaks the link of a value that leaves its owner (a replaced field).
   *
   * @param value - The value to detach.
   */
  static detach(value: unknown): void {
    Lineage.detach(value);
  }

  /**
   * Full code path of a tracked value inside its root document.
   *
   * @param value - The tracked value.
   * @returns The path, or `undefined` when detached.
   */
  static fullPath(value: object): string | undefined {
    return Lineage.fullPath(value);
  }

  /**
   * The paths of a node as a pair.
   *
   * @param node - The path node.
   * @returns The node's code and database paths.
   */
  private static pathsOf(node: PathNode): PathPair {
    return { code: node.path, db: node.dbPath };
  }
}
