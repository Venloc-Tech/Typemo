import { BsonGuards } from "../bson/bson-guards.ts";

/**
 * The short message of a `DuplicateKeyError`: the index, the (already masked) key value and the code — never the
 * server's text, which repeats query plans and build identifiers (the full text is the error's `serverMessage`).
 * One place builds it, so the thrown error and its masked copy read alike.
 */
export class DuplicateKeyText {
  /**
   * Builds the message.
   *
   * @param index - The index that refused the write, when known.
   * @param keyValue - The duplicated values (already masked where needed), when the server reported them.
   * @param code - The server code.
   * @param codeName - The code name, when known.
   * @returns For example `duplicate key on title_1: { title: "Second" } (code 11000 DuplicateKey)`.
   */
  static of(
    index: string | undefined,
    keyValue: Readonly<Record<string, unknown>> | undefined,
    code: number | undefined,
    codeName: string | undefined,
  ): string {
    const on = index === undefined ? "" : ` on ${index}`;
    const value = keyValue === undefined ? "" : `: ${DuplicateKeyText.render(keyValue)}`;
    const named = code === undefined ? "" : ` (code ${code}${codeName === undefined ? "" : ` ${codeName}`})`;
    return `duplicate key${on}${value}${named}`;
  }

  /**
   * Renders a key value the way the server prints it: `{ a: 1, b: "x" }`.
   *
   * @param value - A value of the key document.
   * @returns The text.
   */
  static render(value: unknown): string {
    if (typeof value === "string") return JSON.stringify(value);
    if (BsonGuards.isPlainObject(value)) {
      return `{ ${Object.entries(value)
        .map(([key, item]) => `${key}: ${DuplicateKeyText.render(item)}`)
        .join(", ")} }`;
    }
    return String(value);
  }
}
