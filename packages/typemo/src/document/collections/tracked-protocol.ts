import { TypemoError } from "../../errors/typemo-error.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import type { DeltaBuilder } from "./update-ops.ts";
import { ValueEquality } from "./value-equality.ts";

/**
 * Options of a tracked value's `$toPlain()`: the ones that do not change the shape of a value.
 *
 * @example
 * ```ts
 * const options: PlainFormOptions = { getters: true, hidden: false };
 * ```
 */
export interface PlainFormOptions {
  /** Apply the fields' `get` functions. */
  readonly getters?: boolean;
  /** Include `Hidden` fields of subdocuments inside the value. Default `false`. */
  readonly hidden?: boolean;
}

/**
 * The document serializer's plain walk of one value of `node` (registered by it: no import cycle).
 *
 * @example
 * ```ts
 * const form: PlainForm = (node, value, options) => value;
 * ```
 */
type PlainForm = (node: PathNode, value: unknown, options: PlainFormOptions) => unknown;

/*
 * The internal protocol every tracked value of a hydrated document speaks (arrays, subdocument arrays,
 * Maps, subdocuments and nested objects). The members are keyed by symbols, so they never show in
 * autocompletion, in `Object.keys` or in `JSON.stringify`, and never collide with user fields. The
 * public façade over the protocol is `Collections`; the document layer talks only to it.
 */

/** Builds the update ops of one tracked value under a path (see `DeltaBuilder`). */
export const DELTA: unique symbol = Symbol("typemo.collections.delta");
/** `true` when the value (or anything below it) changed since the last reset. Never throws. */
export const HAS_CHANGES: unique symbol = Symbol("typemo.collections.hasChanges");
/** Commits: the journal is emptied and the shadow/baseline becomes the current state (recursively). */
export const RESET: unique symbol = Symbol("typemo.collections.reset");
/** The full state (content, journal, shadow, baselines, links), recursively. */
export const SNAPSHOT: unique symbol = Symbol("typemo.collections.snapshot");
/** Puts back a state taken by {@link SNAPSHOT}. */
export const RESTORE: unique symbol = Symbol("typemo.collections.restore");
/** Undoes a reset after a failed write, keeping changes made while the write was in flight (Mongoose H500). */
export const REVERT_RESET: unique symbol = Symbol("typemo.collections.revertReset");
/**
 * Takes the journals a write is about to send (Mongoose H500): the value keeps journaling the changes
 * made while the write is in flight into FRESH journals; the returned mark holds what is being sent.
 */
export const MARK: unique symbol = Symbol("typemo.collections.mark");
/** After the write succeeded: the sent state becomes the baseline; changes made in flight stay changes. */
export const COMMIT: unique symbol = Symbol("typemo.collections.commit");
/** After the write failed: the sent journals come back (merged with in-flight changes: a whole write then). */
export const UNMARK: unique symbol = Symbol("typemo.collections.unmark");
/** Collects the stored subdocuments with fields unknown to the schema inside a value. */
export const UNKNOWN: unique symbol = Symbol("typemo.collections.unknown");
/** Plain data (untracked arrays, Maps or records, plain objects). */
export const TO_PLAIN: unique symbol = Symbol("typemo.collections.toPlain");
/** The schema node the value belongs to. */
export const NODE_OF: unique symbol = Symbol("typemo.collections.node");
/**
 * The elements of a tracked array as the core reads them — WITHOUT marking them accessed (the array's own
 * indexes are accessors that mark every element handed to user code). For the lineage (`$index()`, full paths).
 */
export const ITEMS: unique symbol = Symbol("typemo.collections.items");

/**
 * An opaque saved state of a tracked value.
 *
 * @example
 * ```ts
 * const snapshot: NodeSnapshot = tags[SNAPSHOT]();
 * ```
 */
export interface NodeSnapshot {
  /** The kind of value the snapshot was taken from. */
  readonly kind: "array" | "map" | "subdocument";
}

/**
 * What a write took from one tracked value ({@link MARK}): opaque to everything but the value itself.
 *
 * @example
 * ```ts
 * const mark: NodeMark = tags[MARK]();
 * ```
 */
export interface NodeMark {
  /** The kind of value the mark was taken from. */
  readonly kind: "array" | "map" | "subdocument";
}

/**
 * A stored subdocument with fields the schema does not know, and the instance that holds them.
 *
 * @example
 * ```ts
 * const found: FoundUnknown = { path: "address", keys: ["legacyZip"], owner: address };
 * ```
 */
export interface FoundUnknown {
  /** Code path of the subdocument. */
  readonly path: string;
  /** Its stored keys the schema does not declare. */
  readonly keys: readonly string[];
  /** The instance that holds them. */
  readonly owner: object;
}

/**
 * How Maps inside plain data are given: native `Map`s (`toObject`) or records (lean / JSON).
 *
 * @example
 * ```ts
 * const options: PlainOptions = { maps: "record" };
 * ```
 */
export interface PlainOptions {
  /** `map` keeps native `Map`s, `record` turns them into records. */
  readonly maps: "map" | "record";
}

/**
 * The code path and the database path of one position, carried together through a delta walk.
 *
 * @example
 * ```ts
 * const at: PathPair = { code: "items.0.sku", db: "items.0.s" };
 * ```
 */
export interface PathPair {
  /** The path in code names. */
  readonly code: string;
  /** The path in database names. */
  readonly db: string;
}

/**
 * What every tracked value implements.
 *
 * @example
 * ```ts
 * if (TrackedProtocol.is(value)) value[RESET]();
 * ```
 */
export interface Tracked {
  /**
   * Builds the update ops of this value under a path.
   *
   * @param at - The path of the value.
   * @param out - The delta being built.
   */
  [DELTA](at: PathPair, out: DeltaBuilder): void;
  /**
   * Whether the value (or anything below it) changed since the last reset.
   *
   * @returns `true` when changed.
   */
  [HAS_CHANGES](): boolean;
  /** Commits: empties the journal and makes the current state the baseline. */
  [RESET](): void;
  /**
   * Captures the full state.
   *
   * @returns The snapshot.
   */
  [SNAPSHOT](): NodeSnapshot;
  /**
   * Puts back a captured state.
   *
   * @param snapshot - A snapshot taken from this value.
   */
  [RESTORE](snapshot: NodeSnapshot): void;
  /**
   * Undoes a reset after a failed write, keeping changes made while the write was in flight.
   *
   * @param snapshot - The snapshot taken before the write.
   */
  [REVERT_RESET](snapshot: NodeSnapshot): void;
  /**
   * Takes what a write is about to send.
   *
   * @returns The mark of the sent state.
   */
  [MARK](): NodeMark;
  /**
   * Confirms a successful write.
   *
   * @param mark - The mark taken by {@link MARK}.
   */
  [COMMIT](mark: NodeMark): void;
  /**
   * Gives the sent state back after a failed write.
   *
   * @param mark - The mark taken by {@link MARK}.
   */
  [UNMARK](mark: NodeMark): void;
  /**
   * Collects the stored subdocuments with unknown fields inside this value.
   *
   * @param path - The path of this value.
   * @param found - The list to append to.
   */
  [UNKNOWN](path: string, found: FoundUnknown[]): void;
  /**
   * The plain data of this value.
   *
   * @param options - Plain-data options.
   * @returns The plain data.
   */
  [TO_PLAIN](options: PlainOptions): unknown;
  /**
   * The schema node this value belongs to.
   *
   * @returns The path node.
   */
  [NODE_OF](): PathNode;
}

/**
 * Turns user input into a tracked value of a node (cast through `SchemaWalker`, `CastError` at once).
 * Injected into the containers by `CollectionHydrator`, so the containers do not import it (the hydrator
 * imports the containers: no module cycle).
 *
 * @example
 * ```ts
 * const value = factory.fromInput(node, ["a", "b"], () => "tags");
 * ```
 */
export interface TrackedFactory {
  /**
   * Casts `input` for `node` and hydrates the result (a container becomes tracked, a scalar is cast).
   *
   * @param node - The node the value belongs to.
   * @param input - The user input.
   * @param path - Computes the path, used only for an error message.
   * @returns The cast, possibly tracked value.
   * @throws {CastError} When the input cannot be cast.
   */
  fromInput(node: PathNode, input: unknown, path: () => string): unknown;
}

/** Runtime checks of the protocol. */
export class TrackedProtocol {
  /** The serializer's plain walk, registered once. */
  static #plainForm: PlainForm | undefined;

  /**
   * Called once by `DocumentSerializer`: the plain form of a tracked value is the document's walk of it.
   *
   * @param form - The plain walk.
   */
  static registerPlainForm(form: PlainForm): void {
    TrackedProtocol.#plainForm = form;
  }

  /**
   * The plain form of a tracked value, exactly as the document's `$toPlain()` gives it at that path.
   *
   * @param value - The tracked value.
   * @param options - Plain-form options.
   * @returns The plain form.
   * @throws {TypemoError} When the plain serializer is not loaded.
   */
  static plainForm(value: Tracked, options: PlainFormOptions | undefined): unknown {
    const form = TrackedProtocol.#plainForm;
    if (form === undefined) throw new TypemoError("Internal error: the plain serializer is not loaded");
    return form(value[NODE_OF](), value, options ?? {});
  }

  /**
   * Whether a value speaks the tracked protocol.
   *
   * @param value - The value to test.
   * @returns `true` for a tracked value.
   */
  static is(value: unknown): value is Tracked {
    return typeof value === "object" && value !== null && typeof (value as Partial<Tracked>)[DELTA] === "function";
  }

  /**
   * Appends a segment to a path pair.
   *
   * @param at - The parent path pair.
   * @param code - The segment in code names.
   * @param db - The segment in database names; defaults to `code`.
   * @returns The joined pair.
   */
  static join(at: PathPair, code: string, db: string = code): PathPair {
    return {
      code: at.code === "" ? code : `${at.code}.${code}`,
      db: at.db === "" ? db : `${at.db}.${db}`,
    };
  }

  /**
   * Whether two values hold the same data (tracked values compared by their plain form).
   *
   * @param a - The first value.
   * @param b - The second value.
   * @returns `true` when the data are equal.
   */
  static sameData(a: unknown, b: unknown): boolean {
    return (
      a === b ||
      ValueEquality.equals(TrackedProtocol.toPlain(a, { maps: "map" }), TrackedProtocol.toPlain(b, { maps: "map" }))
    );
  }

  /**
   * The stored subdocuments with unknown fields inside `value`.
   *
   * @param value - The value to search.
   * @param path - The value's own path.
   * @param found - The list to append to.
   * @returns The `found` list.
   */
  static unknownIn(value: unknown, path: string, found: FoundUnknown[] = []): FoundUnknown[] {
    if (TrackedProtocol.is(value)) value[UNKNOWN](path, found);
    return found;
  }

  /**
   * Plain data of any value: tracked values convert themselves, everything else is returned as is.
   *
   * @param value - The value to convert.
   * @param options - Plain-data options.
   * @returns The plain data.
   */
  static toPlain(value: unknown, options: PlainOptions): unknown {
    return TrackedProtocol.is(value) ? value[TO_PLAIN](options) : value;
  }
}
