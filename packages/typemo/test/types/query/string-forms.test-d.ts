/*
 * The string forms of the plain form are accepted back wherever a value is: an `ObjectId` takes its hex string, a
 * `UUID` its string, an int64 its decimal string — in create, updates (numeric operators included), filters and
 * `findById*`. A `number` or `string` `_id` takes only its own type.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { Decimal128, ObjectId, UUID } from "mongodb";
import type {
  CompareOf,
  Entity,
  IdInputOf,
  InputOf,
  Int64String,
  Model,
  Ref,
  RefDocumentInput,
  StringInputOf,
  Vector,
} from "../../../src/index.ts";

/** An owner referenced by `Item.owner`. */
interface Owner extends Entity {
  name: string;
}

/** A model with an `ObjectId` `_id`, a reference, a `UUID` field, an int64 field, a decimal and a vector. */
interface Item extends Entity {
  owner?: Ref<Owner>;
  key?: UUID;
  count: bigint;
  price?: Decimal128;
  values?: Vector;
}

/** A model keyed by a `UUID`. */
interface ByUuid {
  _id: UUID;
  name?: string;
}

/** A model keyed by a number. */
interface ByNumber {
  _id: number;
  name?: string;
}

/** A model keyed by a string. */
interface ByString {
  _id: string;
  name?: string;
}

declare const Items: Model<Item>;
declare const Uuids: Model<ByUuid>;
declare const Numbers: Model<ByNumber>;
declare const Strings: Model<ByString>;
declare const hex: string;
declare const amount: Int64String;

/* ---- the helper types ---- */
expectTypeOf<StringInputOf<bigint>>().toEqualTypeOf<Int64String>();
expectTypeOf<StringInputOf<ObjectId>>().toEqualTypeOf<string>();
expectTypeOf<StringInputOf<UUID>>().toEqualTypeOf<string>();
expectTypeOf<StringInputOf<number>>().toEqualTypeOf<never>();
expectTypeOf<CompareOf<ObjectId>>().toEqualTypeOf<ObjectId | string>();
expectTypeOf<InputOf<Ref<Owner>>>().toEqualTypeOf<Ref<Owner> | string | RefDocumentInput<Ref<Owner>>>();
expectTypeOf<StringInputOf<Decimal128>>().toEqualTypeOf<string>();
expectTypeOf<InputOf<Decimal128>>().toEqualTypeOf<Decimal128 | string>();
expectTypeOf<InputOf<Vector>>().toEqualTypeOf<Vector | readonly number[]>();
expectTypeOf<IdInputOf<Item>>().toEqualTypeOf<ObjectId | string>();
expectTypeOf<IdInputOf<ByUuid>>().toEqualTypeOf<UUID | string>();
expectTypeOf<IdInputOf<ByNumber>>().toEqualTypeOf<number>();
expectTypeOf<IdInputOf<ByString>>().toEqualTypeOf<string>();

/* ---- findById and its siblings ---- */
Items.findById(hex);
Items.findByIdAndUpdate(hex, { $set: { count: 1n } });
Items.findByIdAndDelete(hex);
Uuids.findById("0f8fad5b-d9cb-469f-a165-70867728950e");
Numbers.findById(42);
Strings.findById("abc");
// @ts-expect-error a number `_id` takes no string
Numbers.findById("42");
// @ts-expect-error an ObjectId `_id` takes no number
Items.findById(42);

/* ---- create, filters, updates ---- */
Items.create({ owner: hex, key: "0f8fad5b-d9cb-469f-a165-70867728950e", count: "5" });
Items.find({ owner: hex, key: "0f8fad5b-d9cb-469f-a165-70867728950e", count: { $gte: "5" } });
Items.find({ _id: { $in: [hex] } });
Items.updateOne({ _id: hex }, { $set: { owner: hex } });
Items.updateOne({ _id: hex }, { $inc: { count: amount } });
Items.updateOne({ _id: hex }, { $mul: { count: "2" } });
Items.updateOne({ _id: hex }, { $min: { count: "3" }, $max: { owner: hex } });
// @ts-expect-error an int64 string is a decimal integer, not any string
Items.updateOne({ _id: hex }, { $inc: { count: hex } });

/* ---- a Decimal128 takes its decimal string, a Vector its numbers ---- */
Items.create({ count: 1n, price: "1.10", values: [1, 2, 3] });
Items.updateOne({ _id: hex }, { $set: { price: "2.50", values: [0.5] } });
Items.find({ price: "1.10" });
// @ts-expect-error a Decimal128 takes a string, not a number
Items.create({ count: 1n, price: 1.1 });
// @ts-expect-error a Vector takes numbers, not strings
Items.create({ count: 1n, values: ["1"] });

/* ---- a reference takes the referenced document (its `_id` is stored) ---- */
declare const owner: Owner;
declare const leanOwner: { readonly _id: ObjectId; readonly name: string };
Items.create({ count: 1n, owner });
Items.create({ count: 1n, owner: leanOwner });
Items.updateOne({ _id: hex }, { $set: { owner } });
// @ts-expect-error an object without `_id` is not a document of the reference
Items.create({ count: 1n, owner: { name: "x" } });
