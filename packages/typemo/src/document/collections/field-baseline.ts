import { BsonGuards } from "../../bson/bson-guards.ts";
import type { HydrationPlan } from "./hydration-plan.ts";

/** Marks a field with no value in the baseline. */
const ABSENT: unique symbol = Symbol("typemo.baseline.absent");

/**
 * `BsonGuards.isDate` with the common cases first (a `Date` of this realm, a BSON value, a primitive).
 *
 * @param value - The value to test.
 * @returns `true` when the value is a `Date`.
 */
const isDate = (value: unknown): value is Date =>
  value instanceof Date ||
  (typeof value === "object" && value !== null && BsonGuards.tagOf(value) === undefined && BsonGuards.isDate(value));

/**
 * The field values of a (sub)document at its last reset (a load or a successful save), by the POSITION of the
 * field in its schema. It replaces a `Map` filled by a second pass over the fields: hydration writes each
 * value once, where it puts it on the instance, into a preallocated array.
 *
 * A value is kept by IDENTITY (no copy): at a load it is the very value put on the instance, so the same array
 * also tells which values were cast (a value that is still the loaded one needs no cast at save). The one
 * mutable scalar, `Date`, can change in place (`date.setTime(…)`): its time at the reset is kept beside it and a
 * `Date` is compared by time (`getTime()`), never by identity alone. BSON binaries are immutable; containers
 * and subdocuments track their own changes.
 *
 * Keys outside the schema (the `_id` a save adds to a schema without one) go to a small side map.
 */
export class FieldBaseline {
  /** The hydration plan of the schema (field positions). */
  readonly #plan: HydrationPlan;
  /** The values by field position; {@link ABSENT} for a field with no value. */
  readonly #values: unknown[];
  /** The time of each `Date` value at the reset (sparse: allocated on the first `Date`). */
  #times: number[] | undefined;
  /** Values of keys outside the schema. */
  #extra: Map<string, unknown> | undefined;

  /**
   * @param plan - The hydration plan of the schema.
   * @param values - The values by field position.
   * @param times - The times of `Date` values by field position.
   */
  private constructor(plan: HydrationPlan, values: unknown[], times: number[] | undefined) {
    this.#plan = plan;
    this.#values = values;
    this.#times = times;
  }

  /**
   * A baseline with no values yet (filled by {@link FieldBaseline.record} during hydration).
   *
   * @param plan - The hydration plan of the schema.
   * @returns The empty baseline.
   */
  static empty(plan: HydrationPlan): FieldBaseline {
    return new FieldBaseline(plan, new Array<unknown>(plan.fields.length).fill(ABSENT), undefined);
  }

  /**
   * A baseline of the given values by code key (after a save; `Date`s are compared by the time they have now).
   *
   * @param plan - The hydration plan of the schema.
   * @param values - The values by code key.
   * @returns The baseline.
   */
  static of(plan: HydrationPlan, values: ReadonlyMap<string, unknown>): FieldBaseline {
    const baseline = FieldBaseline.empty(plan);
    for (const [key, value] of values) baseline.set(key, value);
    return baseline;
  }

  /**
   * Hydration: records the value of the field at `index`.
   *
   * @param index - The field position.
   * @param value - The value (never `undefined`).
   * @param container - Whether the value is a tracked container, which is never a `Date`.
   */
  record(index: number, value: unknown, container = false): void {
    this.#values[index] = value;
    if (container || !isDate(value)) return;
    this.#times ??= [];
    this.#times[index] = value.getTime();
  }

  /**
   * Sets the baseline value of a key; `undefined` marks it absent.
   *
   * @param key - The code key.
   * @param value - The value.
   */
  set(key: string, value: unknown): void {
    const index = this.#plan.index.get(key);
    if (index === undefined) {
      this.#extra ??= new Map();
      this.#extra.set(key, value);
      return;
    }
    if (this.#times !== undefined) delete this.#times[index];
    if (value === undefined) this.#values[index] = ABSENT;
    else this.record(index, value);
  }

  /**
   * Whether the baseline has a value for a key.
   *
   * @param key - The code key.
   * @returns `true` when a value is recorded.
   */
  has(key: string): boolean {
    const index = this.#plan.index.get(key);
    return index === undefined ? (this.#extra?.has(key) ?? false) : this.#values[index] !== ABSENT;
  }

  /**
   * The baseline value of `key`, `undefined` when absent. A `Date` is returned as a copy with its baseline time
   * (the value itself may have been changed in place since).
   *
   * @param key - The code key.
   * @returns The baseline value.
   */
  get(key: string): unknown {
    const index = this.#plan.index.get(key);
    if (index === undefined) return this.#extra?.get(key);
    return this.at(index);
  }

  /**
   * {@link get} by position.
   *
   * @param index - The field position.
   * @returns The baseline value.
   */
  at(index: number): unknown {
    const value = this.#values[index];
    if (value === ABSENT) return undefined;
    const time = this.#times?.[index];
    return time === undefined ? value : new Date(time);
  }

  /**
   * The value itself (identity, no `Date` copy): the loaded value of a field.
   *
   * @param index - The field position.
   * @returns The value, or `undefined` when absent.
   */
  identity(index: number): unknown {
    const value = this.#values[index];
    return value === ABSENT ? undefined : value;
  }

  /**
   * Whether the baseline of the field at `index` is a `Date` (compared by time).
   *
   * @param index - The field position.
   * @returns `true` for a `Date` baseline.
   */
  isDate(index: number): boolean {
    return this.#times?.[index] !== undefined;
  }

  /**
   * Whether `current` equals the baseline `Date` of the field at `index` (by time, as `ValueEquality`).
   *
   * @param index - The field position.
   * @param current - The current value.
   * @returns `true` when both are dates with the same time.
   */
  sameDate(index: number, current: unknown): boolean {
    return BsonGuards.isDate(current) && current.getTime() === this.#times?.[index];
  }

  /**
   * Removes the baseline value of a key.
   *
   * @param key - The code key.
   */
  delete(key: string): void {
    const index = this.#plan.index.get(key);
    if (index === undefined) {
      this.#extra?.delete(key);
      return;
    }
    this.#values[index] = ABSENT;
    if (this.#times !== undefined) delete this.#times[index];
  }

  /**
   * An independent copy (snapshots of a transaction attempt).
   *
   * @returns The copy.
   */
  copy(): FieldBaseline {
    const copy = new FieldBaseline(
      this.#plan,
      [...this.#values],
      this.#times === undefined ? undefined : [...this.#times],
    );
    if (this.#extra !== undefined) copy.#extra = new Map(this.#extra);
    return copy;
  }
}
