import type { Timestamp } from "bson";
import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/**
 * BSON timestamp (MongoDB's internal replication type; a `Date` is almost always what a schema
 * wants). Only a `Timestamp` passes: numbers and `Long`s are refused because bson's own
 * `Timestamp.fromNumber` "rarely matches user intent" (a deprecated API).
 */
export class TimestampCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "Timestamp";

  /**
   * Passes a `Timestamp` through.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The same `Timestamp`.
   * @throws {CastError} When the input is not a `Timestamp`.
   */
  static cast(value: unknown, path = ""): Timestamp {
    return BsonGuards.isTimestamp(value)
      ? value
      : CastSupport.reject(path, value, TimestampCaster.expected, "a Timestamp");
  }

  /**
   * Returns the `Timestamp` as the driver value.
   *
   * @param value - The hydrated `Timestamp`.
   * @returns The same `Timestamp`.
   */
  static encode(value: Timestamp): Timestamp {
    return value;
  }
}
