import { describe, expect, test } from "bun:test";
import { Binary, Decimal128, Double, Long, ObjectId, Timestamp, UUID } from "mongodb";
import {
  BigIntCaster,
  BinaryCaster,
  CastError,
  type CastReason,
  ConfigurationError,
  DateCaster,
  Decimal128Caster,
  DoubleCaster,
  Int32Caster,
  NumberCaster,
  ObjectIdCaster,
  RegExpCaster,
  TimestampCaster,
  UuidCaster,
} from "../../../src/internal.ts";

/* Edge cases of the scalar casters beyond the matrix — boundaries, formats, copies. */

/** The `CastReason` that `run` throws, or "no error". */
const reasonOf = (run: () => unknown): CastReason | "no error" => {
  try {
    run();
  } catch (error) {
    if (error instanceof CastError) return error.reason;
    throw error;
  }
  return "no error";
};

describe("DateCaster: ISO 8601 calendar date (UTC midnight) or full date-time with a zone", () => {
  test.each([
    ["2020-01-02T03:04:05Z", "2020-01-02T03:04:05.000Z"],
    ["2020-01-02T03:04:05.6Z", "2020-01-02T03:04:05.600Z"],
    ["2020-01-02T03:04:05.67Z", "2020-01-02T03:04:05.670Z"],
    ["2020-01-02T03:04:05.678Z", "2020-01-02T03:04:05.678Z"],
    ["2020-01-02T03:04:05+02:30", "2020-01-02T00:34:05.000Z"],
    ["2020-01-02T03:04:05-05:00", "2020-01-02T08:04:05.000Z"],
    ["2020-02-29T00:00:00Z", "2020-02-29T00:00:00.000Z"],
    ["2000-02-29T00:00:00Z", "2000-02-29T00:00:00.000Z"],
    ["0099-06-01T00:00:00Z", "0099-06-01T00:00:00.000Z"],
    ["9999-12-31T23:59:59.999Z", "9999-12-31T23:59:59.999Z"],
    /* Date only → UTC midnight, whatever the process time zone. */
    ["2020-01-02", "2020-01-02T00:00:00.000Z"],
    ["2020-02-29", "2020-02-29T00:00:00.000Z"],
    ["0099-06-01", "0099-06-01T00:00:00.000Z"],
  ])("%s → %s", (input, iso) => {
    expect(DateCaster.cast(input).toISOString()).toBe(iso);
  });

  test.each([
    "2021-02-29", // date only, not a leap year
    "2020-04-31", // date only, no such day
    "2020-1-2", // date only, not zero-padded
    "20200102", // basic format is not accepted
    "2020-01", // year-month only
    "2020-01-02T03:04:05", // no zone: would depend on TZ
    "2020-01-02T03:04Z", // no seconds
    "2020-01-02 03:04:05Z", // space separator
    "2020-01-02t03:04:05z", // lower case
    "2020-01-02T03:04:05.1234Z", // sub-millisecond precision would be lost
    "2020-13-01T00:00:00Z",
    "2021-02-29T00:00:00Z", // not a leap year
    "1900-02-29T00:00:00Z", // century, not a leap year
    "2020-04-31T00:00:00Z",
    "2020-01-02T24:00:00Z",
    "2020-01-02T23:60:00Z",
    "2020-01-02T23:59:60Z", // leap seconds are not representable
    "2020-01-02T03:04:05+24:00",
    "+002020-01-02T03:04:05Z", // expanded years
    " 2020-01-02T03:04:05Z",
    "Thu Jan 01 1970 00:00:00 GMT+0000",
    "1700000000000",
  ])("%s → format", (input) => {
    expect(reasonOf(() => DateCaster.cast(input))).toBe("format");
  });

  test("the result is a copy of a Date input", () => {
    const input = new Date("2020-01-02T03:04:05.000Z");
    const result = DateCaster.cast(input);
    expect(result).not.toBe(input);
    expect(result.getTime()).toBe(input.getTime());
  });

  test("does not depend on the process time zone", () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const a = DateCaster.cast("2020-06-01T12:00:00Z").getTime();
      process.env.TZ = "Asia/Tokyo";
      const b = DateCaster.cast("2020-06-01T12:00:00Z").getTime();
      expect(a).toBe(b);
      expect(a).toBe(Date.UTC(2020, 5, 1, 12));
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe("Int32Caster / DoubleCaster / BigIntCaster boundaries", () => {
  test("Int32 accepts exactly [-2^31, 2^31 - 1] and encodes as Int32", () => {
    expect(Int32Caster.cast(-2_147_483_648)).toBe(-2_147_483_648);
    expect(Int32Caster.cast(2_147_483_647)).toBe(2_147_483_647);
    expect(reasonOf(() => Int32Caster.cast(2_147_483_648))).toBe("range");
    expect(reasonOf(() => Int32Caster.cast(-2_147_483_649))).toBe("range");
    expect(Int32Caster.encode(5)._bsontype).toBe("Int32");
  });

  test("Double encodes an integral value as Double (not int32 on the wire)", () => {
    const encoded = DoubleCaster.encode(5);
    expect(encoded._bsontype).toBe("Double");
    expect(encoded.value).toBe(5);
  });

  test("Long accepts exactly [-2^63, 2^63 - 1] from bigint and Long; safe integers from number", () => {
    expect(BigIntCaster.cast(2n ** 63n - 1n)).toBe(2n ** 63n - 1n);
    expect(BigIntCaster.cast(-(2n ** 63n))).toBe(-(2n ** 63n));
    expect(reasonOf(() => BigIntCaster.cast(2n ** 63n))).toBe("range");
    expect(reasonOf(() => BigIntCaster.cast(-(2n ** 63n) - 1n))).toBe("range");
    expect(BigIntCaster.cast(Long.fromBigInt(2n ** 63n - 1n))).toBe(2n ** 63n - 1n);
    expect(reasonOf(() => BigIntCaster.cast(Long.fromBigInt(2n ** 64n - 1n, true)))).toBe("range");
    expect(BigIntCaster.cast(Number.MAX_SAFE_INTEGER)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(reasonOf(() => BigIntCaster.cast(Number.MAX_SAFE_INTEGER + 1))).toBe("precision");
    expect(reasonOf(() => BigIntCaster.cast(true))).toBe("type");
  });

  /* The plain / JSON form of int64 (a decimal string) goes back in — only the canonical form. */
  test.each([
    ["42", 42n],
    ["0", 0n],
    ["-1", -1n],
    ["9007199254740993", 2n ** 53n + 1n],
    ["9223372036854775807", 2n ** 63n - 1n],
    ["-9223372036854775808", -(2n ** 63n)],
  ])("R25: Long accepts the decimal integer string %p", (input, expected) => {
    expect(BigIntCaster.cast(input)).toBe(expected);
  });

  test.each([
    ["1.5", "format"],
    ["1e3", "format"],
    [" 1", "format"],
    ["1 ", "format"],
    ["+1", "format"],
    ["0x10", "format"],
    ["0b1", "format"],
    ["01", "format"],
    ["-0", "format"],
    ["-", "format"],
    ["", "format"],
    ["1_000", "format"],
    ["\u0661", "format"], // an Arabic-Indic digit: not an ASCII decimal digit
    ["9223372036854775808", "range"],
    ["-9223372036854775809", "range"],
    ["99999999999999999999", "range"],
    ["1".repeat(40), "range"], // refused by its length (> 20 characters), never parsed
  ])("R25: Long refuses the string %p (%s)", (input, reason) => {
    expect(reasonOf(() => BigIntCaster.cast(input))).toBe(reason as CastReason);
  });
});

describe("Decimal128Caster", () => {
  test.each([
    "0",
    "-0",
    "+1.50",
    ".5",
    "5.",
    "1E+3",
    "1e-10",
    "NaN",
    "Infinity",
    "-Infinity",
    "123456789012345678901234567890.1234",
  ])("valid decimal string %s", (input) => {
    expect(Decimal128Caster.cast(input).toString()).toBe(Decimal128.fromString(input).toString());
  });

  test.each([" 1", "1 ", "0x10", "1_000", "1,5", "+Infinity", "inf", "nan", "1e", "--1", ""])(
    "invalid format %j",
    (input) => {
      expect(reasonOf(() => Decimal128Caster.cast(input))).toBe("format");
    },
  );

  test("more precision than Decimal128 holds is refused (with the bson error as cause), not rounded", () => {
    const input = "1.234567890123456789012345678901234567";
    let error: unknown;
    try {
      Decimal128Caster.cast(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CastError);
    expect((error as CastError).reason).toBe("precision");
    expect((error as CastError).cause).toBeInstanceOf(Error);
  });

  test("a finite number is taken by its shortest decimal form String(n); NaN/Infinity are refused", () => {
    expect(Decimal128Caster.cast(0.1).toString()).toBe("0.1");
    expect(Decimal128Caster.cast(19.99).toString()).toBe("19.99");
    expect(Decimal128Caster.cast(1e21).toString()).toBe("1E+21"); // String(1e21) is "1e+21"
    expect(Decimal128Caster.cast(-0).toString()).toBe("0");
    expect(reasonOf(() => Decimal128Caster.cast(Number.NaN))).toBe("finite");
    expect(reasonOf(() => Decimal128Caster.cast(Number.NEGATIVE_INFINITY))).toBe("finite");
    expect(Decimal128Caster.cast("NaN").toString()).toBe("NaN");
  });
});

describe("ObjectIdCaster", () => {
  test("an ObjectId passes as the same value; hex is normalized to lower case", () => {
    const id = new ObjectId();
    expect(ObjectIdCaster.cast(id)).toBe(id);
    expect(ObjectIdCaster.cast("5F8D0D55B54764421B7156C3").toHexString()).toBe("5f8d0d55b54764421b7156c3");
  });

  test("23/25 hex characters and non-hex are format errors; bytes and numbers are type errors", () => {
    expect(reasonOf(() => ObjectIdCaster.cast("5f8d0d55b54764421b7156c"))).toBe("format");
    expect(reasonOf(() => ObjectIdCaster.cast("5f8d0d55b54764421b7156c3a"))).toBe("format");
    expect(reasonOf(() => ObjectIdCaster.cast("zf8d0d55b54764421b7156c3"))).toBe("format");
    expect(reasonOf(() => ObjectIdCaster.cast(new Uint8Array(12)))).toBe("type");
    expect(reasonOf(() => ObjectIdCaster.cast(1_600_000_000))).toBe("type");
  });
});

describe("UuidCaster", () => {
  test("nil and max UUIDs are valid (RFC 9562), any case", () => {
    expect(UuidCaster.cast("00000000-0000-0000-0000-000000000000").toHexString()).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(UuidCaster.cast("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF").toHexString()).toBe(
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    );
  });

  test("a Binary subtype 4 of 16 bytes becomes a fresh UUID; other subtypes and sizes are refused", () => {
    const bytes = new UUID().buffer.slice();
    const result = UuidCaster.cast(new Binary(bytes, 4));
    expect(result).toBeInstanceOf(UUID);
    expect(result.buffer).toEqual(bytes);
    expect(reasonOf(() => UuidCaster.cast(new Binary(bytes, 3)))).toBe("subtype");
    expect(reasonOf(() => UuidCaster.cast(new Binary(new Uint8Array(15), 4)))).toBe("subtype");
  });

  test("braces, urn prefix and missing dashes are format errors", () => {
    for (const input of [
      "{0f8fad5b-d9cb-469f-a165-70867728950e}",
      "urn:uuid:0f8fad5b-d9cb-469f-a165-70867728950e",
      "0f8fad5b-d9cb-469f-a165-70867728950",
    ]) {
      expect(reasonOf(() => UuidCaster.cast(input))).toBe("format");
    }
  });

  test("a UUID input is copied, not shared", () => {
    const input = new UUID();
    const result = UuidCaster.cast(input);
    expect(result).not.toBe(input);
    expect(result.buffer).not.toBe(input.buffer);
    expect(result.equals(input)).toBe(true);
  });
});

describe("BinaryCaster", () => {
  test("of({ subtype }) accepts only that subtype and copies the bytes", () => {
    const md5 = BinaryCaster.of({ subtype: 5 });
    const input = new Binary(new Uint8Array([1, 2, 3]), 5);
    const result = md5.cast(input);
    expect(result.sub_type).toBe(5);
    expect(result.buffer).not.toBe(input.buffer);
    expect(Array.from(result.buffer.subarray(0, result.position))).toEqual([1, 2, 3]);
    expect(md5.cast(new Uint8Array([9])).sub_type).toBe(5);
    expect(reasonOf(() => md5.cast(new Binary(new Uint8Array([1]), 0)))).toBe("subtype");
    expect(md5.expected).toBe("Binary(subtype 5)");
  });

  test.each([2, 3, 4, 9, -1, 256, 1.5])("subtype %p is a ConfigurationError", (subtype) => {
    expect(() => BinaryCaster.of({ subtype })).toThrow(ConfigurationError);
  });

  test("strings, numbers, number[] and EJSON/Buffer-JSON objects are refused", () => {
    for (const input of [
      "hi",
      9001,
      [195, 188],
      { type: "Buffer", data: [1] },
      { $binary: { base64: "AQ==", subType: "00" } },
    ]) {
      expect(reasonOf(() => BinaryCaster.cast(input))).toBe("type");
    }
  });
});

describe("RegExpCaster: only flags that survive a BSON round trip", () => {
  test.each([/a/, /a/i, /a/m, /a/im])("%p passes as a fresh RegExp", (input) => {
    const result = RegExpCaster.cast(input);
    expect(result).not.toBe(input);
    expect(result.source).toBe(input.source);
    expect(result.flags).toBe(input.flags);
  });

  test.each([/a/g, /a/s, /a/u, /a/y, /a/d, /a/gi])("%p → flags", (input) => {
    expect(reasonOf(() => RegExpCaster.cast(input))).toBe("flags");
  });

  test("strings and BSONRegExp-like objects are refused", () => {
    expect(reasonOf(() => RegExpCaster.cast("a"))).toBe("type");
    expect(reasonOf(() => RegExpCaster.cast({ pattern: "a", options: "i" }))).toBe("type");
  });
});

describe("TimestampCaster", () => {
  test("only a Timestamp passes", () => {
    const ts = new Timestamp({ t: 1, i: 2 });
    expect(TimestampCaster.cast(ts)).toBe(ts);
    expect(reasonOf(() => TimestampCaster.cast(1))).toBe("type");
    expect(reasonOf(() => TimestampCaster.cast(Long.fromNumber(1)))).toBe("type");
    expect(reasonOf(() => TimestampCaster.cast(new Date()))).toBe("type");
  });
});

describe("NaN and ±Infinity are refused by Number, Double, Int32 and Long; Decimal128 keeps them", () => {
  const numeric: readonly [string, (value: unknown) => unknown][] = [
    ["Number", (v) => NumberCaster.cast(v)],
    ["Double", (v) => DoubleCaster.cast(v)],
    ["Int32", (v) => Int32Caster.cast(v)],
    ["Long", (v) => BigIntCaster.cast(v)],
  ];
  for (const [name, cast] of numeric) {
    test.each([Number.NaN, Infinity, -Infinity])(`${name}: %p → finite`, (value) => {
      expect(reasonOf(() => cast(value))).toBe("finite");
    });
  }

  test("Double: a Double wrapper holding NaN or Infinity is refused too", () => {
    expect(reasonOf(() => DoubleCaster.cast(new Double(Number.NaN)))).toBe("finite");
    expect(reasonOf(() => DoubleCaster.cast(new Double(-Infinity)))).toBe("finite");
  });

  test.each(["NaN", "Infinity", "-Infinity"])("Decimal128 keeps %s (the BSON type stores it)", (text) => {
    expect(Decimal128Caster.cast(text).toString()).toBe(text);
  });
});
