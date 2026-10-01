/* Type tests of the markers and the spec → value mapping. */
import type { AssertEqual, AssertNotEqual, Expect } from "@venloc/typemo-test-kit";
import type { Binary, Decimal128, ObjectId, UUID } from "mongodb";
import type {
  Computed,
  DataKeys,
  Defaulted,
  Entity,
  Hidden,
  Immutable,
  KeysOfType,
  MapSpec,
  Mixed,
  Ref,
  SchemaPaths,
  SpecValue,
  TimestampFields,
  Types,
  Unbranded,
  UnionSpec,
  Vector,
  VectorSpec,
  VersionFields,
  VirtualRef,
  VirtualValue,
} from "../../../src/index.ts";

enum Color {
  Red = "red",
}

// Markers never apply to null/undefined and are removed one level deep (no recursion, unlike the old wrapper).
export type MarkerForms = [
  Expect<
    AssertEqual<Defaulted<string | null>, (string & import("../../../src/types/markers.ts").DefaultedMarker) | null>
  >,
  Expect<AssertEqual<Unbranded<Defaulted<Immutable<Hidden<number>>>>, number>>,
  Expect<AssertEqual<Unbranded<Defaulted<Color>>, Color>>, // enum members survive (intersection inference)
  Expect<AssertEqual<Unbranded<Defaulted<"a" | "b">>, "a" | "b">>,
  Expect<AssertEqual<Unbranded<Defaulted<string[]>>, string[]>>,
  Expect<AssertEqual<Unbranded<Ref<Entity>>, Ref<Entity>>>, // a Ref is part of the value's meaning
  Expect<AssertEqual<Unbranded<Computed<string> | null>, string | null>>,
];

// Every T is assignable to its marked form and back (markers are optional phantom members).
export const assignable: Defaulted<number> = 5;
export const back: number = assignable;
export const refId: Ref<Entity> = {} as ObjectId;

// Spec → field type (the hydrated form of the BSON type table).
export type SpecValues = [
  Expect<AssertEqual<SpecValue<StringConstructor>, string>>,
  Expect<AssertEqual<SpecValue<NumberConstructor>, number>>,
  Expect<AssertEqual<SpecValue<typeof Types.Double>, number>>,
  Expect<AssertEqual<SpecValue<typeof Types.Int32>, number>>,
  Expect<AssertEqual<SpecValue<BigIntConstructor>, bigint>>,
  Expect<AssertEqual<SpecValue<typeof Types.Decimal128>, Decimal128>>,
  Expect<AssertEqual<SpecValue<typeof Types.ObjectId>, ObjectId>>,
  Expect<AssertEqual<SpecValue<typeof Types.UUID>, UUID>>,
  Expect<AssertEqual<SpecValue<typeof Types.Binary>, Binary>>,
  Expect<AssertEqual<SpecValue<VectorSpec>, Vector>>,
  Expect<AssertEqual<SpecValue<readonly [readonly [NumberConstructor]]>, number[][]>>,
  Expect<AssertEqual<SpecValue<MapSpec<readonly [StringConstructor]>>, Map<string, string[]>>>,
  Expect<AssertEqual<SpecValue<UnionSpec<readonly [StringConstructor, DateConstructor]>>, string | Date>>,
  Expect<AssertEqual<SpecValue<SetConstructor>, never>>,
];

// Paths of the class-level checks: data keys only (no methods, no virtuals).
class Sample {
  name!: string;
  tags!: { label: string }[];
  when!: Date;
  friend!: Ref<Sample>;
  full!: Computed<string>;
  value!: VirtualValue<number>;
  posts!: VirtualRef<Sample>;
  greet(): string {
    return "";
  }
}
export type Paths = [
  Expect<AssertEqual<DataKeys<Sample>, "name" | "tags" | "when" | "friend">>,
  Expect<AssertEqual<SchemaPaths<Sample>, "name" | "tags" | "tags.label" | "when" | "friend">>,
  Expect<AssertEqual<KeysOfType<Sample, Date>, "when">>,
];

// Base classes: the service fields are visible to the type, statics kept, no `any`.
type Stamped = InstanceType<Mixed<typeof Entity, TimestampFields & VersionFields>>;
export type BaseClassFields = [
  Expect<AssertEqual<Stamped["createdAt"], Defaulted<Immutable<Date>>>>,
  Expect<AssertEqual<Stamped["__v"], Defaulted<number>>>,
  Expect<AssertEqual<Stamped["_id"], Defaulted<Immutable<ObjectId>>>>,
  Expect<AssertNotEqual<Stamped["_id"], ObjectId>>,
];
