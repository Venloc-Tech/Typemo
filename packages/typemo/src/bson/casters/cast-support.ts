import type { Binary } from "bson";
import { CastError, type CastReason } from "../../errors/cast-error.ts";

/** Internal helpers shared by the casters (not exported from the package). */
export class CastSupport {
  /**
   * Throws the `CastError`; typed `never` so a caster can `return CastSupport.fail(...)`.
   *
   * @param path - Dotted path of the value being cast (`""` for the root).
   * @param value - The rejected input.
   * @param expected - The expected type in the vocabulary of error messages.
   * @param reason - The machine-readable reason of the failure.
   * @param detail - Human-readable explanation.
   * @returns Never returns.
   * @throws {CastError} Always.
   */
  static fail(path: string, value: unknown, expected: string, reason: CastReason, detail: string): never {
    throw new CastError({ path, value, expected, reason, detail });
  }

  /**
   * Same as `fail`, keeping the original error (bson, `Intl`, …) as `cause`.
   *
   * @param path - Dotted path of the value being cast (`""` for the root).
   * @param value - The rejected input.
   * @param expected - The expected type in the vocabulary of error messages.
   * @param reason - The machine-readable reason of the failure.
   * @param detail - Human-readable explanation.
   * @param cause - The original error that made the cast fail.
   * @returns Never returns.
   * @throws {CastError} Always, with `cause` set.
   */
  static failWithCause(
    path: string,
    value: unknown,
    expected: string,
    reason: CastReason,
    detail: string,
    cause: unknown,
  ): never {
    throw new CastError({ path, value, expected, reason, detail, cause });
  }

  /**
   * The common tail of every scalar caster once the accepted inputs are exhausted: `undefined` and
   * `null` get their own reasons, everything else is a type error.
   *
   * @param path - Dotted path of the value being cast.
   * @param value - The rejected input.
   * @param expected - The expected type in the vocabulary of error messages.
   * @param accepted - Phrase listing what the caster accepts, used in the `type` error detail.
   * @returns Never returns.
   * @throws {CastError} With reason `undefined`, `null` or `type`.
   */
  static reject(path: string, value: unknown, expected: string, accepted: string): never {
    if (value === undefined) {
      return CastSupport.fail(path, value, expected, "undefined", "undefined is never a value; omit the field instead");
    }
    if (value === null) {
      return CastSupport.fail(path, value, expected, "null", "null is not allowed on a path that is not nullable");
    }
    return CastSupport.fail(path, value, expected, "type", `expected ${accepted}`);
  }

  /**
   * A detached copy of the bytes of a Binary. Not `binary.buffer.slice()`: with Node byte utils the
   * buffer is a `Buffer`, and `Buffer#slice` returns a view on the same memory.
   *
   * @param binary - The Binary to copy the bytes of.
   * @returns A new `Uint8Array` that shares no memory with the Binary.
   */
  static copyBytes(binary: Binary): Uint8Array {
    return Uint8Array.prototype.slice.call(binary.buffer, 0, binary.position);
  }

  /**
   * Dotted path of a child: `items` + `3` → `items.3`; the root path is `""`.
   *
   * @param path - The parent path (`""` for the root).
   * @param key - The property name or array index of the child.
   * @returns The child's dotted path.
   */
  static join(path: string, key: string | number): string {
    return path === "" ? String(key) : `${path}.${key}`;
  }
}
