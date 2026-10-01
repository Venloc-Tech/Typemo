/**
 * Input-mutation sweeps: freeze an input deeply, compare it before and after.
 * `snapshot` is a stable text form (bigint as `123n`, BSON values by their JSON form) — a mutation of a frozen
 * object throws in strict mode anyway; the snapshot also catches replaced contents of unfrozen parts (Map, Date).
 */
export class Freeze {
  /**
   * Freezes `value` and everything reachable through its own enumerable properties.
   *
   * @param value - The input to freeze.
   * @returns The same value.
   */
  static deep<T>(value: T): T {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value) && !ArrayBuffer.isView(value)) {
      Object.freeze(value);
      for (const item of Object.values(value)) Freeze.deep(item);
    }
    return value;
  }

  /**
   * A comparable text form of an input.
   *
   * @param value - Any input.
   * @returns JSON text, with bigint and Map contents made visible.
   */
  static snapshot(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? `${item}n` : item instanceof Map ? [...item.entries()] : item,
    );
  }
}
