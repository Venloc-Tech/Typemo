/*
 * Result fingerprints for verification: every contestant's result is reduced to a list of strings, and the
 * list to an FNV-1a hash. Order-sensitive by default (the scenarios sort their reads); `unordered` sorts
 * first for results whose order the operation does not define.
 */

/** FNV-1a offset basis. */
const FNV_OFFSET = 0x811c9dc5;
/** FNV-1a prime. */
const FNV_PRIME = 0x01000193;

/** Fingerprints of scenario results. */
export class BbChecksum {
  /**
   * FNV-1a (32 bit) over the strings, separated so ["ab","c"] and ["a","bc"] differ.
   *
   * @param parts - The strings.
   * @returns `<count>:<hash>`.
   */
  static of(parts: Iterable<string>): string {
    let hash = FNV_OFFSET;
    let n = 0;
    for (const part of parts) {
      for (let i = 0; i < part.length; i++) {
        hash ^= part.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
      }
      hash ^= 0x1f;
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
      n++;
    }
    return `${n}:${hash.toString(16).padStart(8, "0")}`;
  }

  /**
   * Order-insensitive checksum: the strings are sorted first.
   *
   * @param parts - The strings.
   * @returns `<count>:<hash>`.
   */
  static unordered(parts: Iterable<string>): string {
    return BbChecksum.of([...parts].sort());
  }

  /**
   * Canonical text of a plain value: keys sorted, ObjectId as hex, Date as ISO, Map as a sorted record.
   *
   * @param value - Any value.
   * @returns The canonical text.
   */
  static canonical(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toPrecision(12);
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value !== "object") return JSON.stringify(value);
    if (value instanceof Date) return value.toISOString();
    const hex = (value as { toHexString?: () => string }).toHexString;
    if (typeof hex === "function") return hex.call(value);
    /* Mongoose documents/subdocuments/arrays carry circular parent links: compare their plain form. */
    const toObject = (value as { toObject?: (options?: object) => unknown }).toObject;
    if (typeof toObject === "function" && !(value instanceof Map))
      return BbChecksum.canonical(toObject.call(value, { depopulate: false, flattenMaps: true }));
    if (Array.isArray(value)) return `[${value.map(BbChecksum.canonical).join(",")}]`;
    const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
    return `{${entries
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}:${BbChecksum.canonical(v)}`)
      .join(",")}}`;
  }

  /**
   * Checksum of rows (order-sensitive), each row canonicalised.
   *
   * @param rows - The rows.
   * @returns `<count>:<hash>`.
   */
  static rows(rows: readonly unknown[]): string {
    return BbChecksum.of(rows.map(BbChecksum.canonical));
  }
}
