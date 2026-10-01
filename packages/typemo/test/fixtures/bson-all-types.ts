/*
 * Shared fixture of the BSON caster tests: one caster and one input covering every row of BsonTypeTable that
 * has a caster (MinKey/MaxKey have none; they are inserted raw where needed). Used by the runtime
 * round-trip, the shape tests and the hover tests (`ALL_TYPES_HYDRATED_SOURCE` is the same type as
 * text, for the TypeProbe).
 */
import { Binary, Timestamp } from "mongodb";
import {
  ArrayCaster,
  BigIntCaster,
  BinaryCaster,
  BooleanCaster,
  type CastOutput,
  DateCaster,
  Decimal128Caster,
  DoubleCaster,
  Int32Caster,
  MapCaster,
  NullableCaster,
  NumberCaster,
  ObjectIdCaster,
  RegExpCaster,
  StringCaster,
  SubdocumentCaster,
  TimestampCaster,
  UuidCaster,
  VectorCaster,
} from "../../src/internal.ts";

/** A subdocument caster with one path per BSON type that has a caster. */
export const AllTypesCaster = SubdocumentCaster.of({
  _id: ObjectIdCaster,
  str: StringCaster,
  num: NumberCaster,
  dbl: DoubleCaster,
  i32: Int32Caster,
  i64: BigIntCaster,
  dec: Decimal128Caster,
  bool: BooleanCaster,
  date: DateCaster,
  bin: BinaryCaster,
  uuid: UuidCaster,
  vec: VectorCaster.of({ dtype: "float32", dimensions: 3 }),
  re: RegExpCaster,
  ts: TimestampCaster,
  nil: NullableCaster.of(StringCaster),
  list: ArrayCaster.of(Int32Caster),
  nested: SubdocumentCaster.of({ label: StringCaster, at: DateCaster }),
  map: MapCaster.of(BigIntCaster),
});

/**
 * The hydrated form of `AllTypesCaster`, with every path present.
 *
 * @example
 * const value: AllTypesHydrated["i64"] = 1n; // int64 is hydrated as `bigint`
 */
export type AllTypesHydrated = Required<CastOutput<typeof AllTypesCaster>>;

/** Field → `$type` alias the stored value must have (proves the wire type, not only the JS value). */
export const ALL_TYPES_ALIASES = {
  _id: "objectId",
  str: "string",
  num: "double",
  dbl: "double",
  i32: "int",
  i64: "long",
  dec: "decimal",
  bool: "bool",
  date: "date",
  bin: "binData",
  uuid: "binData",
  vec: "binData",
  re: "regex",
  ts: "timestamp",
  nil: "null",
  list: "array",
  nested: "object",
  map: "object",
} as const satisfies Record<keyof AllTypesHydrated, string>;

/**
 * User input in the forms the casters accept, including safe-list conversions (strings → values).
 *
 * @returns a fresh input object, one entry per path of `AllTypesCaster`
 */
export const allTypesInput = (): Record<keyof AllTypesHydrated, unknown> => ({
  _id: "5f8d0d55b54764421b7156c3",
  str: "typemo",
  num: 1.25,
  /* integral on purpose: DoubleCaster.encode must still store a double */
  dbl: 5,
  i32: 42,
  i64: 9_223_372_036_854_775_807n,
  dec: "19.99",
  bool: true,
  date: "2026-01-01T00:00:00.000Z",
  bin: new Binary(new Uint8Array([1, 2, 3])),
  uuid: "0f8fad5b-d9cb-469f-a165-70867728950e",
  vec: [0.5, -1, 2.25],
  re: /a.b/im,
  ts: new Timestamp({ t: 1_700_000_000, i: 7 }),
  nil: null,
  list: [1, 2, 3],
  nested: { label: "x", at: new Date("2026-02-03T04:05:06.007Z") },
  map: new Map([
    ["small", 1n],
    ["big", -(2n ** 63n)],
  ]),
});

/** The hydrated type as source text, for TypeProbe snippets (kept equal to `AllTypesHydrated` by a type test). */
export const ALL_TYPES_HYDRATED_SOURCE = `
import type { Binary, Decimal128, ObjectId, Timestamp, UUID } from "mongodb";
import type { JsonValue, LeanValue, PlainValue, Vector } from "@venloc/typemo";
export interface Hydrated {
  _id: ObjectId;
  str: string;
  num: number;
  dbl: number;
  i32: number;
  i64: bigint;
  dec: Decimal128;
  bool: boolean;
  date: Date;
  bin: Binary;
  uuid: UUID;
  vec: Vector;
  re: RegExp;
  ts: Timestamp;
  nil: string | null;
  list: number[];
  nested: { label?: string; at?: Date };
  map: Map<string, bigint>;
}
export type Lean = LeanValue<Hydrated>;
export type Json = JsonValue<Hydrated>;
export type Plain = PlainValue<Hydrated>;
`;
