import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { expectHover, TypeProbe } from "@venloc/typemo-test-kit";
import { type BsonScalarKey, BsonTypeTable } from "../../../src/index.ts";

/* What the IDE shows for the public types of the table and the casters. */

/* The casters are internal: the probe imports them from `src/internal.ts`. */
const INTERNAL = resolve(import.meta.dir, "../../../src/internal.ts");
const IMPORTS = `
import type { Binary, Decimal128, ObjectId, Timestamp, UUID } from "mongodb";
import {
  ArrayCaster, BsonOptions, type BsonScalarForms, Int32Caster, type JsonValue, type LeanValue, MapCaster,
  NullableCaster, type PlainValue, StringCaster, SubdocumentCaster, UnionCaster, type Vector, VectorCaster,
} from "${INTERNAL}";
`;

/** The hover text of `Int64String`; built so the linter does not read it as a template placeholder. */
const INT64_STRING = ["`$", "{bigint}`"].join("");

describe("one table: the runtime `forms` text of every row is what the compiler derives", () => {
  const probe = TypeProbe.shared().check(IMPORTS);
  for (const key of Object.keys(BsonTypeTable.scalars) as BsonScalarKey[]) {
    test(key, () => {
      const { forms } = BsonTypeTable.scalars[key];
      const expand = (form: string): string => probe.expandType(`BsonScalarForms["${key}"]["${form}"]`);
      expect({
        hydrated: expand("hydrated"),
        lean: expand("lean"),
        json: expand("json"),
        plain: expand("plain"),
      }).toEqual({ ...forms });
    });
  }
});

describe("hover: LeanValue / JsonValue / PlainValue", () => {
  test("JsonValue of the BSON scalars", () => {
    expectHover(`${IMPORTS}
type J = JsonValue<{ id: ObjectId; n: bigint; d: Decimal128; at: Date; u: UUID; b: Binary; v: Vector; t: Timestamp; re: RegExp }>;
//   ^?`).toBe(
      /* bigint → decimal string type, a vector → number[] */
      `type J = { id: string; n: ${INT64_STRING}; d: string; at: string; u: string; b: string; v: number[]; t: TimestampJson; re: string; }`,
    );
  });

  test("PlainValue of the BSON scalars: MongoDB types as strings, native types kept", () => {
    expectHover(`${IMPORTS}
type P = PlainValue<{ id: ObjectId; n: bigint; d: Decimal128; at: Date; u: UUID; b: Binary; v: Vector; t: Timestamp; re: RegExp; m: Map<string, bigint> }>;
//   ^?`).toBe(
      `type P = { id: string; n: ${INT64_STRING}; d: string; at: Date; u: string; b: Uint8Array<ArrayBuffer>; v: number[]; t: TimestampJson; re: RegExp; m: Map<string, ${INT64_STRING}>; }`,
    );
  });

  test("JsonValue keeps literals, nullability and optionality; drops methods", () => {
    expectHover(`${IMPORTS}
class Entity { kind!: "a" | "b"; note?: string; parent!: ObjectId | null; label(): string { return ""; } }
type J = JsonValue<Entity>;
//   ^?`).toBe('type J = { kind: "a" | "b"; note?: string; parent: string | null; }');
  });

  test("LeanValue: Map becomes a record, scalars keep their type, arrays and nesting are mapped", () => {
    expectHover(`${IMPORTS}
type L = LeanValue<{ scores: Map<string, bigint>; tags: string[]; at: Date; nested: { m: Map<string, Date> } }>;
//   ^?`).toBe(
      "type L = { scores: { [key: string]: bigint; }; tags: string[]; at: Date; nested: { m: { [key: string]: Date; }; }; }",
    );
  });

  test("an opaque value outside the table has no lean/json form (never)", () => {
    expectHover(`${IMPORTS}
import type { Long } from "mongodb";
type J = JsonValue<Long>;
//   ^?`).toBe("type J = never");
  });
});

describe("hover: casters", () => {
  test("NullableCaster, ArrayCaster, MapCaster output types", () => {
    expectHover(`${IMPORTS}
const caster = MapCaster.of(ArrayCaster.of(NullableCaster.of(Int32Caster)));
//    ^?`).toBe("const caster: ValueCaster<Map<string, (number | null)[]>>");
  });

  test("SubdocumentCaster: fields are optional (casting does not decide `required`)", () => {
    expectHover(`${IMPORTS}
const address = SubdocumentCaster.of({ city: StringCaster, zip: NullableCaster.of(StringCaster) });
const value = address.cast({});
//    ^?`).toBe(
      "const value: SubdocumentOutput<{ readonly city: typeof StringCaster; readonly zip: ValueCaster<string | null>; }>",
    );
  });

  test("UnionCaster.byGuard infers the union of its members", () => {
    expectHover(`${IMPORTS}
const union = UnionCaster.byGuard(
  UnionCaster.member("text", (v) => typeof v === "string", StringCaster),
  UnionCaster.member("count", (v) => typeof v === "number", Int32Caster),
);
const value = union.cast("x");
//    ^?`).toBe("const value: string | number");
  });

  test("VectorCaster produces a Vector (a Binary marked as a vector)", () => {
    expectHover(`${IMPORTS}
const vector = VectorCaster.of({ dtype: "float32", dimensions: 3 }).cast([1, 2, 3]);
//    ^?`).toBe("const vector: Vector");
  });

  test("BsonOptions.apply keeps the other options and fixes the BSON ones as literal types", () => {
    const code = `${IMPORTS}
const options = BsonOptions.apply({ appName: "x" });
//    ^?
const flag = options.useBigInt64;
//    ^?`;
    expectHover(code, { marker: 0 }).toBe(
      "const options: Omit<{ appName: string; }, keyof RequiredBsonOptions> & RequiredBsonOptions",
    );
    expectHover(code, { marker: 1 }).toBe("const flag: true");
  });
});
