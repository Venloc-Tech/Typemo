import { describe, expect, test } from "bun:test";
import { Binary, ObjectId, UUID } from "mongodb";
import {
  ArrayCaster,
  BinaryCaster,
  BsonTypeTable,
  DateCaster,
  Int32Caster,
  MapCaster,
  NullableCaster,
  StringCaster,
  SubdocumentCaster,
  UnionCaster,
  UuidCaster,
  VectorCaster,
} from "../../../src/internal.ts";

/*
 * User input is never mutated and never aliased by the result. Inputs are deep-frozen: a write attempt throws in
 * strict mode (ESM), so "passes" means "no write".
 */

/** Freezes `value` and everything reachable from it (typed-array views excepted). */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !ArrayBuffer.isView(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
};

describe("casters do not mutate or alias their input", () => {
  test("subdocument with nested array and nullable fields", () => {
    const caster = SubdocumentCaster.of({
      name: StringCaster,
      tags: ArrayCaster.of(StringCaster),
      profile: SubdocumentCaster.of({ age: NullableCaster.of(Int32Caster), at: DateCaster }),
    });
    const input = deepFreeze({ name: "a", tags: ["x"], profile: { age: null, at: "2020-01-02T03:04:05Z" } });
    const snapshot = structuredClone(input);
    const result = caster.cast(input);
    expect(input).toEqual(snapshot);
    expect(result.tags).not.toBe(input.tags);
    expect(result.profile).not.toBe(input.profile);
    result.tags?.push("y");
    expect(input.tags).toEqual(["x"]);
  });

  test("Map values and frozen arrays in a Map", () => {
    const input = new Map([["a", deepFreeze([1, 2])]]);
    const result = MapCaster.of(ArrayCaster.of(Int32Caster)).cast(input);
    expect(result.get("a")).not.toBe(input.get("a"));
    expect(input.get("a")).toEqual([1, 2]);
  });

  test("Date, Binary, UUID and vector results are copies", () => {
    const date = new Date(0);
    expect(DateCaster.cast(date)).not.toBe(date);
    const bin = new Binary(new Uint8Array([1, 2]));
    const castBin = BinaryCaster.cast(bin);
    castBin.buffer[0] = 9;
    expect(bin.buffer[0]).toBe(1);
    const bytes = new Uint8Array([1, 2]);
    BinaryCaster.cast(bytes).buffer[0] = 9;
    expect(bytes[0]).toBe(1);
    const uuid = new UUID("00000000-0000-0000-0000-000000000000");
    UuidCaster.cast(uuid).buffer[0] = 9;
    expect(uuid.buffer[0]).toBe(0);
    const lean = BsonTypeTable.toLean({ bin });
    lean.bin.buffer[1] = 9;
    expect(bin.buffer[1]).toBe(2);
    const vectorInput = deepFreeze([1, 2, 3]);
    VectorCaster.of({ dtype: "int8" }).cast(vectorInput);
    expect(vectorInput).toEqual([1, 2, 3]);
  });

  test("union and table conversions", () => {
    const union = UnionCaster.byDiscriminator("kind", {
      a: SubdocumentCaster.of({ kind: StringCaster, list: ArrayCaster.of(StringCaster) }),
    });
    const input = deepFreeze({ kind: "a", list: ["x"] });
    expect(union.cast(input).list).not.toBe(input.list);
    const hydrated = deepFreeze({ id: new ObjectId(), list: [1], nested: { s: "x" } });
    BsonTypeTable.toJson(hydrated);
    BsonTypeTable.toLean(hydrated);
    expect(hydrated.list).toEqual([1]);
  });
});
