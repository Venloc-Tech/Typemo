import { ObjectId } from "mongodb";
import { BsonGuards } from "../bson-guards.ts";
import { CastSupport } from "./cast-support.ts";

/** A 24-character hex string, the only string form of an ObjectId that is accepted. */
const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/**
 * BSON ObjectId. Accepts an `ObjectId` (of any copy of `bson`, recognized by its tag) and a
 * 24-character hex string (safe list: "24 hex → ObjectId"). No 12-character strings (the bson
 * constructor would take them as raw bytes), no `Uint8Array`, no numbers, no `{ _id }` objects,
 * no `toString()` objects (Mongoose's class-with-toString path).
 */
export class ObjectIdCaster {
  /** The expected type in the vocabulary of error messages. */
  static readonly expected = "ObjectId";

  /**
   * Accepts an `ObjectId` or a 24-character hex string.
   *
   * @param value - The user input.
   * @param path - Dotted path of the value, used in error messages.
   * @returns The ObjectId (a new one when parsed from a string).
   * @throws {CastError} When the input is neither, or the string is not 24 hex characters.
   */
  static cast(value: unknown, path = ""): ObjectId {
    if (BsonGuards.isObjectId(value)) return value;
    if (typeof value !== "string") {
      return CastSupport.reject(path, value, ObjectIdCaster.expected, "an ObjectId or a 24-character hex string");
    }
    if (!OBJECT_ID_HEX.test(value)) {
      return CastSupport.fail(path, value, ObjectIdCaster.expected, "format", "not a 24-character hex string");
    }
    return ObjectId.createFromHexString(value.toLowerCase());
  }

  /**
   * Returns the ObjectId as the driver value.
   *
   * @param value - The hydrated ObjectId.
   * @returns The same ObjectId.
   */
  static encode(value: ObjectId): ObjectId {
    return value;
  }
}
