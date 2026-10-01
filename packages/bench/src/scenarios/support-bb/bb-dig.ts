/*
 * Reads fields of results whose static type differs per contestant (Mongoose documents are untyped here,
 * lean and hydrated shapes differ) with one set of accessors, so every contestant is normalised by the
 * SAME code before its checksum is taken.
 */

/**
 * A read-only record.
 *
 * @example
 * ```ts
 * const rec: Rec = { a: 1 };
 * ```
 */
type Rec = Readonly<Record<string, unknown>>;

/** Uniform accessors over the results of every contestant. */
export class Dig {
  /**
   * The value as a record.
   *
   * @param value - Any value.
   * @returns The value when it is an object, otherwise an empty record.
   */
  static rec(value: unknown): Rec {
    return typeof value === "object" && value !== null ? (value as Rec) : {};
  }

  /**
   * A field of a record or a Map.
   *
   * @param value - A record, a document or a Map.
   * @param key - The field.
   * @returns The value.
   */
  static get(value: unknown, key: string): unknown {
    if (value instanceof Map) return value.get(key);
    /* Mongoose documents expose paths through getters: reading the key works for both forms. */
    return Dig.rec(value)[key];
  }

  /**
   * A field as text.
   *
   * @param value - A record, a document or a Map.
   * @param key - The field.
   * @returns The text, or `-` for a missing value.
   */
  static str(value: unknown, key: string): string {
    const found = Dig.get(value, key);
    return found === undefined || found === null ? "-" : String(found);
  }

  /**
   * A field as a number.
   *
   * @param value - A record, a document or a Map.
   * @param key - The field.
   * @returns The number, or `NaN` when the field is not a number.
   */
  static num(value: unknown, key: string): number {
    const found = Dig.get(value, key);
    return typeof found === "number" ? found : Number.NaN;
  }

  /**
   * A field as a list.
   *
   * @param value - A record, a document or a Map; the list itself when `key` is omitted.
   * @param key - The field.
   * @returns The list, or an empty list when the field is not an array.
   */
  static list(value: unknown, key?: string): readonly unknown[] {
    const found = key === undefined ? value : Dig.get(value, key);
    return Array.isArray(found) ? found : [];
  }

  /**
   * Entries of a Map, a Mongoose Map or a record (lean forms), sorted by key.
   *
   * @param value - The owner of the field.
   * @param key - The field that holds the map.
   * @returns The sorted entries.
   */
  static entries(value: unknown, key: string): readonly [string, unknown][] {
    const found = Dig.get(value, key);
    const entries: [string, unknown][] =
      found instanceof Map ? [...(found as Map<string, unknown>).entries()] : Object.entries(Dig.rec(found));
    return entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /**
   * The id of a document, as text.
   *
   * @param value - A document, or an id.
   * @returns The hex text of an `ObjectId`, or the value as text.
   */
  static id(value: unknown): string {
    const id = Dig.get(value, "_id") ?? value;
    const hex = (id as { toHexString?: () => string } | null)?.toHexString;
    return typeof hex === "function" ? hex.call(id) : String(id);
  }
}
