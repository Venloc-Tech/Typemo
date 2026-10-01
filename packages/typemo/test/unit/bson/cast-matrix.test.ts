import { describe, expect, test } from "bun:test";
import { Binary, Decimal128, Double, Int32, Long, ObjectId, UUID } from "mongodb";
import {
  BigIntCaster,
  BinaryCaster,
  BooleanCaster,
  CastError,
  type CastReason,
  DateCaster,
  Decimal128Caster,
  DoubleCaster,
  Int32Caster,
  NumberCaster,
  ObjectIdCaster,
  StringCaster,
  UuidCaster,
  type ValueCaster,
} from "../../../src/internal.ts";

/*
 * The "type × input → result / error" matrix. Rows are the inputs measured on Mongoose's casters plus BSON
 * wrappers; each cell is either the hydrated result (`ok(...)`) or the `CastError.reason`. Where Mongoose
 * converted, the cell is an error: strict casting with only the safe list of conversions. Long takes a strictly
 * decimal integer string (`'42'`, `'2020'`); every other string is `format` for it.
 */

/** One cell of the matrix: the hydrated result or the expected `CastError.reason`. */
type Cell = { readonly ok: unknown } | CastReason;
/** A successful cell holding the expected hydrated `value`. */
const ok = (value: unknown): Cell => ({ ok: value });

const HEX = "5f8d0d55b54764421b7156c3";
const UUID_TEXT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ISO = "2020-01-02T03:04:05.678Z";

const COLUMNS: readonly [string, ValueCaster<unknown>][] = [
  ["String", StringCaster],
  ["Number", NumberCaster],
  ["Int32", Int32Caster],
  ["Double", DoubleCaster],
  ["Long", BigIntCaster],
  ["Decimal128", Decimal128Caster],
  ["Boolean", BooleanCaster],
  ["Date", DateCaster],
  ["ObjectId", ObjectIdCaster],
  ["UUID", UuidCaster],
  ["Binary", BinaryCaster],
];

/* Inputs are factories: every cell gets a fresh value, so no cell can leak state into another. */
//             input                                String      Number     Int32       Double     Long                Decimal128                               Boolean    Date                        ObjectId                                  UUID                       Binary
const ROWS: readonly [string, () => unknown, readonly Cell[]][] = [
  ["undefined", () => undefined, Array<Cell>(11).fill("undefined")],
  ["null", () => null, Array<Cell>(11).fill("null")],
  ["''", () => "", [ok(""), "type", "type", "type", "format", "format", "type", "format", "format", "format", "type"]],
  [
    "' '",
    () => " ",
    [ok(" "), "type", "type", "type", "format", "format", "type", "format", "format", "format", "type"],
  ],
  [
    "'42'",
    () => "42",
    [
      ok("42"),
      "type",
      "type",
      "type",
      ok(42n),
      ok(Decimal128.fromString("42")),
      "type",
      "format",
      "format",
      "format",
      "type",
    ],
  ],
  [
    "'1.5'",
    () => "1.5",
    [
      ok("1.5"),
      "type",
      "type",
      "type",
      "format",
      ok(Decimal128.fromString("1.5")),
      "type",
      "format",
      "format",
      "format",
      "type",
    ],
  ],
  [
    "'1e3'",
    () => "1e3",
    [
      ok("1e3"),
      "type",
      "type",
      "type",
      "format",
      ok(Decimal128.fromString("1e3")),
      "type",
      "format",
      "format",
      "format",
      "type",
    ],
  ],
  [
    "'0x10'",
    () => "0x10",
    [ok("0x10"), "type", "type", "type", "format", "format", "type", "format", "format", "format", "type"],
  ],
  [
    "'abc'",
    () => "abc",
    [ok("abc"), "type", "type", "type", "format", "format", "type", "format", "format", "format", "type"],
  ],
  [
    "'true'",
    () => "true",
    [ok("true"), "type", "type", "type", "format", "format", "type", "format", "format", "format", "type"],
  ],
  /* Decimal128 from a finite number (String(n)), Date from integer milliseconds. */
  [
    "42",
    () => 42,
    [
      "type",
      ok(42),
      ok(42),
      ok(42),
      ok(42n),
      ok(Decimal128.fromString("42")),
      "type",
      ok(new Date(42)),
      "type",
      "type",
      "type",
    ],
  ],
  [
    "1.5",
    () => 1.5,
    [
      "type",
      ok(1.5),
      "integer",
      ok(1.5),
      "integer",
      ok(Decimal128.fromString("1.5")),
      "type",
      "integer",
      "type",
      "type",
      "type",
    ],
  ],
  [
    "0",
    () => 0,
    [
      "type",
      ok(0),
      ok(0),
      ok(0),
      ok(0n),
      ok(Decimal128.fromString("0")),
      "type",
      ok(new Date(0)),
      "type",
      "type",
      "type",
    ],
  ],
  [
    "-0",
    () => -0,
    [
      "type",
      ok(-0),
      ok(0),
      ok(-0),
      ok(0n),
      ok(Decimal128.fromString("0")),
      "type",
      ok(new Date(0)),
      "type",
      "type",
      "type",
    ],
  ],
  [
    "NaN",
    () => Number.NaN,
    ["type", "finite", "finite", "finite", "finite", "finite", "type", "finite", "type", "type", "type"],
  ],
  [
    "Infinity",
    () => Number.POSITIVE_INFINITY,
    ["type", "finite", "finite", "finite", "finite", "finite", "type", "finite", "type", "type", "type"],
  ],
  [
    "2**31",
    () => 2 ** 31,
    [
      "type",
      ok(2 ** 31),
      "range",
      ok(2 ** 31),
      ok(2n ** 31n),
      ok(Decimal128.fromString("2147483648")),
      "type",
      ok(new Date(2 ** 31)),
      "type",
      "type",
      "type",
    ],
  ],
  [
    "-(2**31)",
    () => -(2 ** 31),
    [
      "type",
      ok(-(2 ** 31)),
      ok(-(2 ** 31)),
      ok(-(2 ** 31)),
      ok(-(2n ** 31n)),
      ok(Decimal128.fromString("-2147483648")),
      "type",
      ok(new Date(-(2 ** 31))),
      "type",
      "type",
      "type",
    ],
  ],
  [
    "2**53+2",
    () => 2 ** 53 + 2,
    [
      "type",
      ok(2 ** 53 + 2),
      "range",
      ok(2 ** 53 + 2),
      "precision",
      ok(Decimal128.fromString("9007199254740994")),
      "type",
      "range",
      "type",
      "type",
      "type",
    ],
  ],
  ["10n", () => 10n, ["type", "type", "type", "type", ok(10n), "type", "type", "type", "type", "type", "type"]],
  [
    "2n**63n",
    () => 2n ** 63n,
    ["type", "type", "type", "type", "range", "type", "type", "type", "type", "type", "type"],
  ],
  ["true", () => true, ["type", "type", "type", "type", "type", "type", ok(true), "type", "type", "type", "type"]],
  ["false", () => false, ["type", "type", "type", "type", "type", "type", ok(false), "type", "type", "type", "type"]],
  [
    "new Date(0)",
    () => new Date(0),
    ["type", "type", "type", "type", "type", "type", "type", ok(new Date(0)), "type", "type", "type"],
  ],
  [
    "Invalid Date",
    () => new Date(Number.NaN),
    ["type", "type", "type", "type", "type", "type", "type", "format", "type", "type", "type"],
  ],
  [
    "ISO date-time",
    () => ISO,
    [ok(ISO), "type", "type", "type", "format", "format", "type", ok(new Date(ISO)), "format", "format", "type"],
  ],
  [
    "'2020-01-02'",
    () => "2020-01-02",
    /* A calendar date is UTC midnight. */
    [
      ok("2020-01-02"),
      "type",
      "type",
      "type",
      "format",
      "format",
      "type",
      ok(new Date("2020-01-02T00:00:00.000Z")),
      "format",
      "format",
      "type",
    ],
  ],
  [
    "'2020'",
    () => "2020",
    [
      ok("2020"),
      "type",
      "type",
      "type",
      ok(2020n),
      ok(Decimal128.fromString("2020")),
      "type",
      "format",
      "format",
      "format",
      "type",
    ],
  ],
  [
    "ObjectId",
    () => new ObjectId(HEX),
    ["type", "type", "type", "type", "type", "type", "type", "type", ok(new ObjectId(HEX)), "type", "type"],
  ],
  [
    "24-hex",
    () => HEX,
    [ok(HEX), "type", "type", "type", "format", "format", "type", "format", ok(new ObjectId(HEX)), "format", "type"],
  ],
  [
    "24-HEX",
    () => HEX.toUpperCase(),
    [
      ok(HEX.toUpperCase()),
      "type",
      "type",
      "type",
      "format",
      "format",
      "type",
      "format",
      ok(new ObjectId(HEX)),
      "format",
      "type",
    ],
  ],
  [
    "12-char str",
    () => "abcdefghijkl",
    [ok("abcdefghijkl"), "type", "type", "type", "format", "format", "type", "format", "format", "format", "type"],
  ],
  [
    "Uint8Array(12)",
    () => new Uint8Array(12),
    [
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      ok(new Binary(new Uint8Array(12))),
    ],
  ],
  [
    "Binary(0)",
    () => new Binary(new Uint8Array([1, 2])),
    [
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      "type",
      "subtype",
      ok(new Binary(new Uint8Array([1, 2]))),
    ],
  ],
  [
    "UUID",
    () => new UUID(UUID_TEXT),
    ["type", "type", "type", "type", "type", "type", "type", "type", "type", ok(new UUID(UUID_TEXT)), "subtype"],
  ],
  [
    "uuid string",
    () => UUID_TEXT,
    [
      ok(UUID_TEXT),
      "type",
      "type",
      "type",
      "format",
      "format",
      "type",
      "format",
      "format",
      ok(new UUID(UUID_TEXT)),
      "type",
    ],
  ],
  [
    "uuid 32hex",
    () => UUID_TEXT.replaceAll("-", ""),
    [
      ok(UUID_TEXT.replaceAll("-", "")),
      "type",
      "type",
      "type",
      "format",
      "format",
      "type",
      "format",
      "format",
      "format",
      "type",
    ],
  ],
  [
    "Decimal128",
    () => Decimal128.fromString("1.5"),
    ["type", "type", "type", "type", "type", ok(Decimal128.fromString("1.5")), "type", "type", "type", "type", "type"],
  ],
  [
    "Long(5)",
    () => Long.fromNumber(5),
    ["type", "type", "type", "type", ok(5n), "type", "type", "type", "type", "type", "type"],
  ],
  [
    "Double(5)",
    () => new Double(5),
    ["type", "type", "type", ok(5), "type", "type", "type", "type", "type", "type", "type"],
  ],
  [
    "Int32(5)",
    () => new Int32(5),
    ["type", "type", ok(5), "type", "type", "type", "type", "type", "type", "type", "type"],
  ],
  ["[5]", () => [5], Array<Cell>(11).fill("type")],
  ["[]", () => [], Array<Cell>(11).fill("type")],
  ["{}", () => ({}), Array<Cell>(11).fill("type")],
  ["{ _id: ObjectId }", () => ({ _id: new ObjectId(HEX) }), Array<Cell>(11).fill("type")],
  ["/re/", () => /re/, Array<Cell>(11).fill("type")],
  ["valueOf object", () => ({ valueOf: () => 83 }), Array<Cell>(11).fill("type")],
  [
    "toString class",
    () =>
      new (class Id {
        toString(): string {
          return HEX;
        }
      })(),
    Array<Cell>(11).fill("type"),
  ],
  ["Symbol", () => Symbol("s"), Array<Cell>(11).fill("type")],
];

/** Asserts `actual` equals `expected`; primitives are compared with `Object.is`. */
const same = (actual: unknown, expected: unknown): void => {
  if (typeof expected !== "object" || expected === null) {
    /* Object.is: -0 and 0 are different cells of the matrix. */
    expect(Object.is(actual, expected)).toBe(true);
  } else {
    expect(actual).toEqual(expected);
  }
};

describe("cast matrix: type × input", () => {
  test("every row has one cell per caster", () => {
    for (const [name, , cells] of ROWS) expect([name, cells.length]).toEqual([name, COLUMNS.length]);
  });

  for (const [inputName, input, cells] of ROWS) {
    describe(inputName, () => {
      COLUMNS.forEach(([casterName, caster], column) => {
        const cell = cells[column] as Cell;
        const label = typeof cell === "string" ? `→ CastError(${cell})` : "→ ok";
        test(`${casterName} ${label}`, () => {
          if (typeof cell === "string") {
            let error: unknown;
            try {
              caster.cast(input(), "field");
            } catch (caught) {
              error = caught;
            }
            expect(error).toBeInstanceOf(CastError);
            const castError = error as CastError;
            expect(castError.reason).toBe(cell);
            expect(castError.path).toBe("field");
            expect(castError.expected).toBe(caster.expected);
          } else {
            same(caster.cast(input(), "field"), cell.ok);
          }
        });
      });
    });
  }
});
