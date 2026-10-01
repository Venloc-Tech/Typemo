/*
 * Type tests of the BSON type table and casters. Compiled by `bun run test:types` (tsconfig.test.json) and inside
 * `bun test` by `type-tests.test.ts`.
 */
import type { AssertEqual, AssertNever, AssertNotAny, Expect, ExpectFalse } from "@venloc/typemo-test-kit";
import { expectTypeOf } from "expect-type";
import type { Binary, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from "mongodb";
import {
  ArrayCaster,
  BigIntCaster,
  BsonOptions,
  type BsonScalarForms,
  type BsonScalarKey,
  BsonTypeTable,
  type CastOutput,
  DateCaster,
  Decimal128Caster,
  Int32Caster,
  type IsPlainObject,
  type JsonValue,
  type LeanValue,
  MapCaster,
  NullableCaster,
  NumberCaster,
  ObjectIdCaster,
  type PlainValue,
  StringCaster,
  SubdocumentCaster,
  UnionCaster,
  UuidCaster,
  type ValueCaster,
  type Vector,
  VectorCaster,
} from "../../../src/internal.ts";
import type { AllTypesHydrated } from "../../fixtures/bson-all-types.ts";

// --- the table: every scalar row, its four forms (hydrated, lean, json, plain) --------------------------------------

export type ScalarForms = [
  Expect<AssertEqual<BsonScalarForms["objectId"]["json"], string>>,
  Expect<AssertEqual<BsonScalarForms["long"]["hydrated"], bigint>>,
  Expect<AssertEqual<BsonScalarForms["long"]["lean"], bigint>>,
  Expect<AssertEqual<BsonScalarForms["long"]["json"], `${bigint}`>> /* an exact decimal string, not a JSON number */,
  Expect<AssertEqual<BsonScalarForms["long"]["plain"], `${bigint}`>>,
  Expect<AssertEqual<BsonScalarForms["uuid"]["lean"], UUID>>,
  Expect<AssertEqual<BsonScalarForms["vector"]["lean"], Vector>>,
  Expect<AssertEqual<BsonScalarForms["vector"]["json"], number[]>> /* the values, not base64 */,
  Expect<AssertEqual<BsonScalarForms["vector"]["plain"], number[]>>,
  Expect<AssertEqual<BsonScalarForms["binary"]["plain"], Uint8Array<ArrayBuffer>>>,
  Expect<AssertEqual<BsonScalarForms["date"]["plain"], Date>>,
  Expect<AssertEqual<BsonScalarForms["regex"]["plain"], RegExp>>,
  Expect<AssertEqual<BsonScalarForms["objectId"]["plain"], string>>,
  Expect<AssertEqual<BsonScalarForms["regex"]["lean"], RegExp>>,
  Expect<AssertEqual<BsonScalarForms["timestamp"]["json"], { t: number; i: number }>>,
  Expect<AssertEqual<BsonScalarForms["null"]["json"], null>>,
  Expect<AssertEqual<BsonScalarKey, keyof typeof BsonTypeTable.scalars>>,
];

// With the enforced options the lean form of every scalar is its hydrated form.
type LeanIsHydrated = { [K in BsonScalarKey]: AssertEqual<BsonScalarForms[K]["lean"], BsonScalarForms[K]["hydrated"]> };
export type EveryRowLeanIsHydrated = Expect<AssertEqual<LeanIsHydrated[BsonScalarKey], true>>;

// --- LeanValue / JsonValue --------------------------------------------------------------------------

export type LeanCases = [
  Expect<AssertEqual<LeanValue<ObjectId>, ObjectId>>,
  Expect<AssertEqual<LeanValue<UUID>, UUID>>,
  Expect<AssertEqual<LeanValue<Binary>, Binary>>,
  Expect<AssertEqual<LeanValue<"a" | null>, "a" | null>>,
  Expect<AssertEqual<LeanValue<Map<string, bigint>>, { [key: string]: bigint }>>,
  Expect<AssertEqual<LeanValue<{ a: Map<string, Date>[] }>, { a: { [key: string]: Date }[] }>>,
  Expect<AssertEqual<LeanValue<{ readonly a?: string }>, { a?: string }>>,
  // Raw wrappers never appear in lean data with the enforced options.
  Expect<AssertNever<LeanValue<Long>>>,
  Expect<AssertNever<LeanValue<Int32>>>,
  Expect<AssertNever<LeanValue<Double>>>,
];

export type JsonCases = [
  Expect<AssertEqual<JsonValue<ObjectId>, string>>,
  Expect<AssertEqual<JsonValue<bigint>, `${bigint}`>> /* a decimal string, not a number */,
  Expect<AssertEqual<JsonValue<Vector>, number[]>> /* the values, not base64 */,
  Expect<AssertEqual<JsonValue<Binary>, string>>,
  Expect<AssertEqual<JsonValue<Decimal128>, string>>,
  Expect<AssertEqual<JsonValue<Date>, string>>,
  Expect<AssertEqual<JsonValue<UUID>, string>>,
  Expect<AssertEqual<JsonValue<Timestamp>, { t: number; i: number }>>,
  Expect<AssertEqual<JsonValue<MinKey>, { $minKey: 1 }>>,
  Expect<AssertEqual<JsonValue<MaxKey>, { $maxKey: 1 }>>,
  Expect<AssertEqual<JsonValue<1 | "x" | true | null>, 1 | "x" | true | null>>,
  Expect<AssertEqual<JsonValue<ObjectId | null>, string | null>>,
  Expect<AssertEqual<JsonValue<Map<string, ObjectId>>, { [key: string]: string }>>,
  Expect<
    AssertEqual<JsonValue<{ list: bigint[]; nested: { at?: Date } }>, { list: `${bigint}`[]; nested: { at?: string } }>
  >,
  Expect<AssertNever<JsonValue<() => void>>>,
  Expect<AssertNotAny<JsonValue<AllTypesHydrated>>>,
];

export type PlainCases = [
  Expect<AssertEqual<PlainValue<ObjectId>, string>>,
  Expect<AssertEqual<PlainValue<bigint>, `${bigint}`>>,
  Expect<AssertEqual<PlainValue<Decimal128>, string>>,
  Expect<AssertEqual<PlainValue<UUID>, string>>,
  Expect<AssertEqual<PlainValue<Date>, Date>>,
  Expect<AssertEqual<PlainValue<RegExp>, RegExp>>,
  Expect<AssertEqual<PlainValue<Binary>, Uint8Array<ArrayBuffer>>>,
  Expect<AssertEqual<PlainValue<Vector>, number[]>>,
  Expect<AssertEqual<PlainValue<Timestamp>, { t: number; i: number }>>,
  Expect<AssertEqual<PlainValue<MinKey>, { $minKey: 1 }>>,
  Expect<AssertEqual<PlainValue<MaxKey>, { $maxKey: 1 }>>,
  Expect<AssertEqual<PlainValue<1 | "x" | true | null>, 1 | "x" | true | null>>,
  Expect<AssertEqual<PlainValue<Map<string, ObjectId>>, Map<string, string>>>,
  Expect<
    AssertEqual<PlainValue<{ list: bigint[]; nested: { at?: Date } }>, { list: `${bigint}`[]; nested: { at?: Date } }>
  >,
  Expect<AssertEqual<PlainValue<unknown>, unknown>>,
  Expect<AssertNever<PlainValue<() => void>>>,
  Expect<AssertNever<PlainValue<Long>>>, // a raw wrapper has no row
  Expect<AssertNotAny<PlainValue<AllTypesHydrated>>>,
];

class WithMethods {
  name!: string;
  greet(): string {
    return this.name;
  }
}
export type MethodsAreNotData = Expect<AssertEqual<JsonValue<WithMethods>, { name: string }>>;

// --- OpaqueValue / IsPlainObject ------------------------------------------------

export type PlainObjectCases = [
  Expect<IsPlainObject<{ a: 1 }>>,
  Expect<IsPlainObject<WithMethods>>,
  ExpectFalse<IsPlainObject<UUID>>,
  ExpectFalse<IsPlainObject<Binary>>,
  ExpectFalse<IsPlainObject<Long>>,
  ExpectFalse<IsPlainObject<Timestamp>>,
  ExpectFalse<IsPlainObject<Decimal128>>,
  ExpectFalse<IsPlainObject<Map<string, number>>>,
  ExpectFalse<IsPlainObject<Date>>,
  ExpectFalse<IsPlainObject<string[]>>,
  ExpectFalse<IsPlainObject<() => void>>,
];

// --- casters --------------------------------------------------------------------------------------

expectTypeOf(StringCaster.cast("x")).toEqualTypeOf<string>();
expectTypeOf(BigIntCaster.cast(1)).toEqualTypeOf<bigint>();
expectTypeOf(Decimal128Caster.cast("1")).toEqualTypeOf<Decimal128>();
expectTypeOf(UuidCaster.cast("x")).toEqualTypeOf<UUID>();
expectTypeOf(DateCaster.cast("x")).toEqualTypeOf<Date>();
expectTypeOf(ObjectIdCaster.cast("x")).toEqualTypeOf<ObjectId>();
expectTypeOf(NullableCaster.of(Int32Caster).cast(1)).toEqualTypeOf<number | null>();
expectTypeOf(ArrayCaster.of(ObjectIdCaster).cast([])).toEqualTypeOf<ObjectId[]>();
expectTypeOf(MapCaster.of(DateCaster).cast(new Map())).toEqualTypeOf<Map<string, Date>>();
expectTypeOf(VectorCaster.of({ dtype: "int8" }).cast([1])).toEqualTypeOf<Vector>();

// A static caster class is itself a ValueCaster.
expectTypeOf(StringCaster).toExtend<ValueCaster<string>>();
expectTypeOf(Int32Caster).toExtend<ValueCaster<number>>();

const address = SubdocumentCaster.of({ city: StringCaster, zip: NullableCaster.of(StringCaster) });
expectTypeOf(address.cast({})).toEqualTypeOf<{ city?: string; zip?: string | null }>();

const union = UnionCaster.byGuard(
  UnionCaster.member("text", (v) => typeof v === "string", StringCaster, [(v) => v.length > 0 || "empty"]),
  UnionCaster.member("count", (v) => typeof v === "number", NumberCaster),
);
expectTypeOf(union.cast("x")).toEqualTypeOf<string | number>();

const shape = UnionCaster.byDiscriminator("kind", {
  circle: SubdocumentCaster.of({ kind: StringCaster, radius: NumberCaster }),
  square: SubdocumentCaster.of({ kind: StringCaster, side: NumberCaster }),
});
expectTypeOf(shape.cast({})).toEqualTypeOf<{ kind?: string; radius?: number } | { kind?: string; side?: number }>();

export type CastOutputOfClass = Expect<AssertEqual<CastOutput<typeof Int32Caster>, number>>;

// --- negative cases -------------------------------------------------------------------------------

// @ts-expect-error — `encode` of a string caster does not take a number (the hydrated type is enforced).
StringCaster.encode(5);

// @ts-expect-error — a nullable caster's output is `number | null`: not assignable to `number`.
export const notNull: number = NullableCaster.of(Int32Caster).cast(1);

// @ts-expect-error — casters produce `bigint` for int64, never `number`.
export const notNumber: number = BigIntCaster.cast(1n);

UnionCaster.byGuard(
  // @ts-expect-error — the validator of a string member receives a string: `toFixed` does not exist on it.
  UnionCaster.member("text", (v) => typeof v === "string", StringCaster, [(v) => v.toFixed() === "" || "x"]),
);

UnionCaster.byDiscriminator(
  "kind",
  { circle: SubdocumentCaster.of({ kind: StringCaster, radius: NumberCaster }) },
  // @ts-expect-error — validators are keyed by member name: "square" is not a member.
  { square: [() => true] },
);

// @ts-expect-error — only int8 / float32 / packedBit vectors exist.
VectorCaster.of({ dtype: "int4" });

// @ts-expect-error — the BSON options Typemo fixes cannot be set to another value (no relaxations).
BsonOptions.apply({ useBigInt64: false });

// @ts-expect-error — bsonRegExp is fixed to false (native RegExp reads).
BsonOptions.apply({ appName: "x", bsonRegExp: true });

// Positive: other options pass through; required values may be repeated.
expectTypeOf(BsonOptions.apply({ appName: "x", maxPoolSize: 5, bsonRegExp: false }).appName).toEqualTypeOf<string>();
expectTypeOf(BsonOptions.apply({}).useBigInt64).toEqualTypeOf<true>();

// @ts-expect-error — JsonValue of a Date is a string, not a Date.
export const jsonDate: JsonValue<{ at: Date }> = { at: new Date() };

// @ts-expect-error — PlainValue of an int64 is a decimal string, never a bigint (JSON.stringify would throw).
export const plainLong: PlainValue<{ n: bigint }> = { n: 1n };

declare const someBinary: Binary;
// @ts-expect-error — PlainValue of a vector is its values, not the Binary.
export const plainVector: PlainValue<{ v: Vector }> = { v: someBinary };

// @ts-expect-error — every row has four forms: a row without its plain form does not compile.
export type ThreeForms = import("../../../src/index.ts").BsonForms<string, string, string>;

// @ts-expect-error — LeanValue of a Map is a plain record, not a Map.
export const leanMap: LeanValue<{ m: Map<string, number> }> = { m: new Map<string, number>() };

// @ts-expect-error — row keys are closed: there is no "symbol" row (BSONSymbol is legacy).
BsonTypeTable.scalars.symbol;

// --- `Types` works as a value and as a type, and is the driver's class ------------------------

import type { Types } from "../../../src/internal.ts";

export type TypesAsTypes = [
  Expect<AssertEqual<Types.ObjectId, ObjectId>>,
  Expect<AssertEqual<Types.UUID, UUID>>,
  Expect<AssertEqual<Types.Decimal128, Decimal128>>,
  Expect<AssertEqual<Types.Long, Long>>,
];
