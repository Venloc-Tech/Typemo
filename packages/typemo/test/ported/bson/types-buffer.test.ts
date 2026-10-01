/*
 * Ported from mongoose test/types.buffer.test.js (subtype and cast) onto Typemo's BinaryCaster.
 * Mongoose hydrates Buffer paths as MongooseBuffer; Typemo hydrates binary as `Binary`.
 */
import { describe, expect, test } from "bun:test";
import { Binary } from "mongodb";
import { BinaryCaster, ConfigurationError } from "../../../src/internal.ts";
import { castFailure } from "./helpers.ts";

const bytes = (binary: Binary): Uint8Array => binary.buffer.subarray(0, binary.position);

describe("types.buffer", () => {
  // ported from mongoose test/types.buffer.test.js:394 "retains custom subtypes"
  test("retains custom subtypes — divergence: subtype 2 (deprecated) is refused; custom subtypes are kept", () => {
    expect(() => BinaryCaster.of({ subtype: 2 })).toThrow(ConfigurationError);
    expect(BinaryCaster.of({ subtype: 128 }).cast(new Uint8Array(0)).sub_type).toBe(128);
  });

  describe("subtype", () => {
    // ported from mongoose test/types.buffer.test.js:410 "default value"
    test("default value", () => {
      expect(BinaryCaster.cast(Buffer.from("hi")).sub_type).toBe(0);
    });

    // ported from mongoose test/types.buffer.test.js:447 "cast from number (gh-3764)"
    test("cast from number (gh-3764) — divergence: CastError", () => {
      // Mongoose: 9001 → a 1-byte buffer.
      expect(castFailure(() => BinaryCaster.cast(9001)).reason).toBe("type");
    });

    // ported from mongoose test/types.buffer.test.js:456 "cast from string"
    test("cast from string — divergence: CastError", () => {
      // Mongoose: 'hi' → UTF-8 bytes.
      expect(castFailure(() => BinaryCaster.cast("hi")).reason).toBe("type");
    });

    // ported from mongoose test/types.buffer.test.js:466 "cast from array"
    test("cast from array — divergence: CastError", () => {
      expect(castFailure(() => BinaryCaster.cast([195, 188, 98, 101, 114])).reason).toBe("type");
    });

    // ported from mongoose test/types.buffer.test.js:476 "cast from Binary"
    test("cast from Binary", () => {
      const result = BinaryCaster.cast(new Binary(Buffer.from([228, 189, 160, 229, 165, 189]), 0));
      expect(Buffer.from(bytes(result)).toString("utf8")).toBe("你好");
    });

    // ported from mongoose test/types.buffer.test.js:486 "cast from json (gh-6863)"
    test("cast from json (gh-6863) — divergence: CastError", () => {
      const json = { type: "Buffer", data: [103, 104, 45, 54, 56, 54, 51] };
      expect(castFailure(() => BinaryCaster.cast(json)).reason).toBe("type");
    });
  });
});
