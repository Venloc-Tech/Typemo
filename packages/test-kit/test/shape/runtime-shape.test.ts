import { describe, expect, test } from "bun:test";
import { Binary, Decimal128, Double, Int32, Long, ObjectId, Timestamp, UUID } from "mongodb";
import { RuntimeShape } from "../../src/shape/runtime-shape.ts";
import { ShapeFormat } from "../../src/shape/shape.ts";

/* Tests `RuntimeShape`: shapes of real values. */

/**
 * Prints the runtime shape of a value.
 *
 * @param value - Any value.
 * @returns The printed shape.
 */
const print = (value: unknown): string => ShapeFormat.print(RuntimeShape.of(value));

describe("RuntimeShape", () => {
  test("scalars, dates and regexps", () => {
    expect(["s", 1, true, 1n, null, undefined, new Date(), /x/].map(print)).toEqual([
      "string",
      "number",
      "boolean",
      "bigint",
      "null",
      "undefined",
      "date",
      "regexp",
    ]);
  });

  test("BSON classes by _bsontype (UUID is a Binary at runtime)", () => {
    const values = [
      new ObjectId(),
      Decimal128.fromString("1.5"),
      Long.fromNumber(3),
      new Double(1.5),
      new Int32(2),
      new Timestamp({ t: 1, i: 1 }),
      new Binary(new Uint8Array([1])),
      new UUID(),
    ];
    expect(values.map(print)).toEqual([
      "ObjectId",
      "Decimal128",
      "Long",
      "Double",
      "Int32",
      "Timestamp",
      "Binary",
      "Binary",
    ]);
  });

  test("a foreign BSON copy is recognised without instanceof; ObjectID is normalised", () => {
    expect(print({ _bsontype: "ObjectID", id: new Uint8Array(12) })).toBe("ObjectId");
  });

  test("null vs undefined vs missing are three different things", () => {
    const shape = RuntimeShape.of({ a: null, b: undefined });
    expect(shape).toEqual({
      kind: "object",
      fields: {
        a: { shape: { kind: "scalar", name: "null" }, optional: false },
        b: { shape: { kind: "scalar", name: "undefined" }, optional: false },
      },
    });
    expect(shape.kind === "object" && "c" in shape.fields).toBe(false);
  });

  test("arrays: union of element shapes, deduplicated; [] has element never", () => {
    expect(print([1, 2, "a", null])).toBe("(number | string | null)[]");
    expect(print([])).toBe("never[]");
    expect(print([{ a: 1 }, { a: 2 }])).toBe("{ a: number }[]");
    expect(print([{ a: 1 }, { b: "x" }])).toBe("({ a: number } | { b: string })[]");
  });

  test("nested objects, class instances by own keys, Map/Buffer by name, cycles cut", () => {
    class Entity {
      name = "x";
      get upper(): string {
        return this.name.toUpperCase();
      }
    }
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(print({ profile: { city: "x", zip: null } })).toBe("{ profile: { city: string; zip: null } }");
    expect(print(new Entity())).toBe("{ name: string }");
    expect(print(new Map([["a", 1]]))).toBe("Map");
    expect(print(Buffer.from("x"))).toBe("Buffer");
    expect(print(cyclic)).toBe("{ self: unknown }");
  });
});
