/**
 * Copying user-supplied objects key by key. A plain `out[key] = value` with `key === "__proto__"`
 * (possible for objects from `JSON.parse`) replaces the prototype of `out` instead of creating a key:
 * the key is silently lost and `out` inherits user data. `defineProperty` always creates an own key.
 */
export class SafeRecord {
  /**
   * Sets `out[key] = value` as an own enumerable property, even when `key` is `"__proto__"`.
   *
   * @param out - The object to write into; it is mutated.
   * @param key - The property name, taken as is.
   * @param value - The value to store.
   * @returns Nothing.
   */
  static set(out: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  }
}
