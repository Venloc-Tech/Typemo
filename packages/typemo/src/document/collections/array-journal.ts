import { TrackedProtocol } from "./tracked-protocol.ts";

/**
 * The atomic operations an array can send in one save.
 *
 * @example
 * ```ts
 * const kind: AtomicKind = "$push";
 * ```
 */
export type AtomicKind = "$push" | "$unshift" | "$addToSet" | "$pullAll" | "$pullIds" | "$pop";

/**
 * A copy of a journal's state (transaction snapshots).
 *
 * @example
 * ```ts
 * const state: JournalState = journal.state();
 * journal.restore(state);
 * ```
 */
export interface JournalState {
  /** The atomic kind recorded, if any. */
  readonly kind: AtomicKind | undefined;
  /** The values of the atomic. */
  readonly values: readonly unknown[];
  /** The end popped by a `$pop`. */
  readonly pop: 1 | -1 | undefined;
  /** The indexes written. */
  readonly indexes: readonly number[];
  /** Whether the whole array is written. */
  readonly whole: boolean;
  /** The elements added in this save. */
  readonly added: readonly unknown[];
  /** The tracked elements replaced by index, with their previous values. */
  readonly replaced: readonly (readonly [number, unknown])[];
}

/** The shared empty list of values. */
const EMPTY: readonly unknown[] = Object.freeze([]);
/** The shared empty set of indexes. */
const NO_INDEXES: ReadonlySet<number> = new Set<number>();
/** The shared empty list of replaced elements. */
const EMPTY_REPLACED: readonly (readonly [number, unknown])[] = Object.freeze([]);

/**
 * What happened to ONE array since it was loaded or saved, reduced to the smallest update the server
 * accepts (rules of Mongoose M4 §3.1 and server error code 40):
 * - one kind of atomic per array per save; the same kind coalesces (`push` ×2 → one `$each`);
 * - a second, different kind, an index write next to an atomic, a second `$pop`, or an operation that
 *   reorders (`splice`, `sort`, `reverse`, `clear`, `replace`) → `$set` of the whole array;
 * - index writes alone → `$set: { "path.i": v }`.
 *
 * The journal keeps references, not encoded values: values are encoded at save time, so an element
 * changed after `push` is sent as it is then. `added` holds the elements pushed in this save (they are
 * sent whole, so their own field changes are not separate ops).
 */
export class ArrayJournal {
  /* Fields and collections are created on first use: every hydrated array owns a journal, and most arrays
     are only read. */
  /** The one atomic kind of this save. */
  #kind: AtomicKind | undefined;
  /** The values of the atomic. */
  #values: unknown[] | undefined;
  /** The end popped by a `$pop`. */
  #pop: 1 | -1 | undefined;
  /** The indexes written. */
  #indexes: Set<number> | undefined;
  /** Whether the whole array is written. */
  #whole = false;
  /** The tracked elements pushed in this save. */
  #added: Set<unknown> | undefined;
  /**
   * Tracked elements replaced by `set(i, v)` or dropped by a whole rewrite (`splice`, `clear`, `replace`) since
   * the last save, with their index (for unknown fields).
   */
  #replaced: [number, unknown][] | undefined;

  /** The atomic kind recorded, if any. */
  get kind(): AtomicKind | undefined {
    return this.#kind;
  }

  /** The values of the atomic. */
  get values(): readonly unknown[] {
    return this.#values ?? EMPTY;
  }

  /** The end popped by a `$pop`. */
  get pop(): 1 | -1 | undefined {
    return this.#pop;
  }

  /** The indexes written by index assignments. */
  get indexes(): ReadonlySet<number> {
    return this.#indexes ?? NO_INDEXES;
  }

  /** Whether the whole array is written. */
  get whole(): boolean {
    return this.#whole;
  }

  /** Whether anything has been recorded. */
  get dirty(): boolean {
    return this.#whole || this.#kind !== undefined || (this.#indexes !== undefined && this.#indexes.size > 0);
  }

  /** Tracked elements replaced by `set(i, v)` or dropped by a whole rewrite. */
  get replaced(): readonly (readonly [number, unknown])[] {
    return this.#replaced ?? EMPTY_REPLACED;
  }

  /**
   * Records that a tracked element at `index` was replaced or dropped: its unknown fields would be lost.
   *
   * @param index - The index of the element.
   * @param previous - The element that was replaced.
   */
  recordReplaced(index: number, previous: unknown): void {
    this.#replaced ??= [];
    this.#replaced.push([index, previous]);
  }

  /**
   * Whether an element was pushed, unshifted or added in this save.
   *
   * @param element - The element to test.
   * @returns `true` when it was added in this save.
   */
  isAdded(element: unknown): boolean {
    return this.#added?.has(element) === true;
  }

  /**
   * Records an atomic operation, coalescing it with the previous one of the same kind or falling back to a
   * whole write.
   *
   * @param kind - The atomic kind.
   * @param values - The operation's values.
   */
  record(kind: AtomicKind, values: readonly unknown[]): void {
    if (this.#whole || (values.length === 0 && kind !== "$pop")) return;
    if (
      (this.#indexes !== undefined && this.#indexes.size > 0) ||
      (this.#kind !== undefined && (this.#kind !== kind || kind === "$pop"))
    ) {
      this.markWhole();
      return;
    }
    this.#kind = kind;
    if (kind === "$unshift") this.#values = [...values, ...(this.#values ?? EMPTY)];
    else {
      this.#values ??= [];
      for (const value of values) this.#values.push(value);
    }
    /* Only tracked elements (subdocuments, nested containers) are asked `isAdded`: other values are not kept. */
    if (kind === "$push" || kind === "$unshift" || kind === "$addToSet") {
      for (const value of values) {
        if (!TrackedProtocol.is(value)) continue;
        this.#added ??= new Set();
        this.#added.add(value);
      }
    }
  }

  /**
   * Records a `$pop`.
   *
   * @param direction - `1` removes the last element, `-1` the first.
   */
  recordPop(direction: 1 | -1): void {
    this.record("$pop", []);
    if (this.#kind === "$pop" && !this.#whole) this.#pop = direction;
  }

  /**
   * Records an index write; next to an atomic it becomes a whole write.
   *
   * @param index - The written index.
   */
  markIndex(index: number): void {
    if (this.#whole) return;
    if (this.#kind !== undefined) {
      this.markWhole();
      return;
    }
    this.#indexes ??= new Set();
    this.#indexes.add(index);
  }

  /** Marks the whole array as written (the update becomes a `$set` of the array). */
  markWhole(): void {
    this.#whole = true;
  }

  /** Forgets everything recorded. */
  reset(): void {
    this.#kind = undefined;
    this.#values = undefined;
    this.#pop = undefined;
    this.#indexes = undefined;
    this.#whole = false;
    this.#added = undefined;
    this.#replaced = undefined;
  }

  /**
   * A copy of the journal's state.
   *
   * @returns The state.
   */
  state(): JournalState {
    return {
      kind: this.#kind,
      values: [...(this.#values ?? EMPTY)],
      pop: this.#pop,
      indexes: [...(this.#indexes ?? NO_INDEXES)],
      whole: this.#whole,
      added: [...(this.#added ?? EMPTY)],
      replaced: (this.#replaced ?? EMPTY_REPLACED).map(([index, value]) => [index, value] as const),
    };
  }

  /**
   * Puts back a state taken by {@link ArrayJournal.state}.
   *
   * @param state - The state to restore.
   */
  restore(state: JournalState): void {
    this.reset();
    this.#kind = state.kind;
    this.#values = [...state.values];
    this.#pop = state.pop;
    if (state.indexes.length > 0) this.#indexes = new Set(state.indexes);
    this.#whole = state.whole;
    if (state.added.length > 0) this.#added = new Set(state.added);
    if (state.replaced.length > 0) this.#replaced = state.replaced.map(([index, value]) => [index, value]);
  }
}
