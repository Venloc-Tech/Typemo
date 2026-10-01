/*
 * The types of the typed collections — the hydrated field mapping, the strict array (index/length writes do not
 * compile), subdocument arrays (`id()` by the `_id` type), Maps, subdocuments — positive and negative. Every
 * `@ts-expect-error` says what must fail.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { Decimal128, ObjectId } from "mongodb";
import type {
  HydratedField,
  HydratedFields,
  ObjectDoc,
  Plain,
  Ref,
  StrictArray,
  Subdocument,
  SubdocumentArray,
  TypedMap,
} from "../../../src/index.ts";
import type {
  Address,
  Badge,
  Circle,
  Doc,
  FullName,
  Owner,
  Point,
  Revision,
  Seat,
  Square,
} from "../../fixtures/collections/collection-entities.ts";

declare const doc: HydratedFields<Doc>;
declare const tags: StrictArray<string>;
declare const revisions: SubdocumentArray<Revision>;
declare const points: SubdocumentArray<Point>;
declare const seats: SubdocumentArray<Seat>;
declare const scores: TypedMap<number>;
declare const badges: TypedMap<Subdocument<Badge>>;
declare const address: Subdocument<Address>;
declare const id: ObjectId;

// ---- the hydrated field mapping (declared type → collection) ---------------------------------------
expectTypeOf(doc.tags).toEqualTypeOf<StrictArray<string> | undefined>();
expectTypeOf(doc.owners).toEqualTypeOf<StrictArray<Ref<Owner>> | undefined>();
expectTypeOf(doc.prices).toEqualTypeOf<StrictArray<Decimal128> | undefined>();
expectTypeOf(doc.matrix).toEqualTypeOf<StrictArray<StrictArray<number>> | undefined>();
expectTypeOf(doc.maybe).toEqualTypeOf<StrictArray<string> | null | undefined>();
expectTypeOf(doc.revisions).toEqualTypeOf<SubdocumentArray<Revision> | undefined>();
expectTypeOf(doc.shapes).toEqualTypeOf<SubdocumentArray<Circle | Square> | undefined>();
expectTypeOf(doc.grid).toEqualTypeOf<StrictArray<SubdocumentArray<Point>> | undefined>();
expectTypeOf(doc.address).toEqualTypeOf<Subdocument<Address> | undefined>();
expectTypeOf(doc.fullName).toEqualTypeOf<Subdocument<FullName> | undefined>();
expectTypeOf(doc.scores).toEqualTypeOf<TypedMap<number> | undefined>();
expectTypeOf(doc.badges).toEqualTypeOf<TypedMap<Subdocument<Badge>> | undefined>();
expectTypeOf(doc.series).toEqualTypeOf<TypedMap<StrictArray<number>> | undefined>();
// A field read has no markers (the IDE shows `ObjectId`); it stays assignable to the declared type.
expectTypeOf(doc._id).toEqualTypeOf<ObjectId>();
expectTypeOf(doc._id).toExtend<Doc["_id"]>();
expectTypeOf<HydratedField<string>>().toEqualTypeOf<string>();
expectTypeOf<HydratedField<Date | null>>().toEqualTypeOf<Date | null>();

// ---- StrictArray: reading as a ReadonlyArray, writing through methods ---------------------------
expectTypeOf(tags[0]).toEqualTypeOf<string | undefined>();
expectTypeOf(tags.map((tag) => tag.length)).toEqualTypeOf<number[]>();
expectTypeOf([...tags]).toEqualTypeOf<string[]>();
expectTypeOf(tags.push("a", "b")).toEqualTypeOf<number>();
expectTypeOf(tags.pull("a")).toEqualTypeOf<string[]>();
expectTypeOf(tags.addToSet("a")).toEqualTypeOf<string[]>();
expectTypeOf(tags.pop()).toEqualTypeOf<string | undefined>();
expectTypeOf(tags.set(0, "x").clear().replace(["y"])).toEqualTypeOf<StrictArray<string>>();
expectTypeOf(tags.sort().reverse()).toEqualTypeOf<StrictArray<string>>();
expectTypeOf(tags.$toObject()).toEqualTypeOf<string[]>();
expectTypeOf(tags.$toPlain()).toEqualTypeOf<string[]>(); /* the plain form */
// @ts-expect-error TS2353: a collection's $toPlain has no `virtuals` (it would change the shape the type knows)
tags.$toPlain({ virtuals: true });
const readonlyView: readonly string[] = tags;
void readonlyView;
// @ts-expect-error TS2542: the index signature is readonly — write with set(0, "x")
tags[0] = "x";
// @ts-expect-error TS2540: `length` is read-only — use clear() / splice()
tags.length = 0;
// @ts-expect-error TS2339: `fill` is not tracked, so it does not exist
tags.fill("x");
// @ts-expect-error TS2339: `copyWithin` is not tracked, so it does not exist
tags.copyWithin(0, 1);
// @ts-expect-error TS2345: a number is not an element of StrictArray<string>
tags.push(5);
// @ts-expect-error TS2345: set() takes an element of the array's type
tags.set(0, 5);
// @ts-expect-error TS2322: a StrictArray is not a mutable string[] (use $toObject() or a spread)
const mutable: string[] = tags;
void mutable;

// nested arrays take plain arrays as input
doc.matrix?.push([1, 2]);
doc.matrix?.[0]?.set(0, 1);
// @ts-expect-error TS2322: an inner array of strings is not an element of StrictArray<StrictArray<number>>
doc.matrix?.push(["x"]);
expectTypeOf(doc.matrix?.$toObject()).toEqualTypeOf<number[][] | undefined>();
// refs take ids
doc.owners?.push(id);

// ---- SubdocumentArray -----------------------------------------------------------------------------
expectTypeOf(revisions[0]).toEqualTypeOf<Subdocument<Revision> | undefined>();
expectTypeOf(revisions.id(id)).toEqualTypeOf<Subdocument<Revision> | undefined>();
expectTypeOf(seats.id(5)).toEqualTypeOf<Subdocument<Seat> | undefined>();
expectTypeOf(revisions.create({ note: "a", lines: 1 })).toEqualTypeOf<Subdocument<Revision>>();
expectTypeOf(revisions.$toObject()).toEqualTypeOf<ObjectDoc<Revision>[]>();
expectTypeOf(revisions.$toPlain()).toEqualTypeOf<Plain<Revision, false>[]>(); /* Hidden fields out by default */
expectTypeOf(revisions.$toPlain({ hidden: true })).toEqualTypeOf<Plain<Revision>[]>();
revisions.push({ note: "a", lines: 1 }, revisions.create({ note: "b", lines: 2 }));
revisions.pull(id);
revisions.pull(revisions.create({ note: "c", lines: 3 }));
// @ts-expect-error TS2684: id() needs elements with `_id` (Point has none)
points.id(id);
// @ts-expect-error TS2345: the id of Seat is a number, not an ObjectId
seats.id(id);
// The string form of an ObjectId id is accepted (cast by the element schema at run time).
revisions.id("650000000000000000000001");
revisions.pull("650000000000000000000001");
// @ts-expect-error TS2345: the id of Revision is an ObjectId or its hex string, not a number
revisions.id(650);
// @ts-expect-error TS2322: `note` of Revision is a string
revisions.push({ note: 5, lines: 1 });
// @ts-expect-error TS2353: an unknown field in the create input
revisions.create({ note: "a", lines: 1, nope: true });
// @ts-expect-error TS2542: no index writes in a subdocument array either
revisions[0] = revisions.create({ note: "a", lines: 1 });

// ---- Subdocument ------------------------------------------------------------------------------------
const first = revisions[0];
if (first !== undefined) {
  expectTypeOf(first.note).toEqualTypeOf<string>();
  expectTypeOf(first.tags).toEqualTypeOf<StrictArray<string> | undefined>();
  expectTypeOf(first.summary()).toEqualTypeOf<string>();
  expectTypeOf(first.$index()).toEqualTypeOf<number>();
  expectTypeOf(first.$fullPath()).toEqualTypeOf<string | undefined>();
  expectTypeOf(first.$parentArray()).toEqualTypeOf<SubdocumentArray<Revision> | undefined>();
  expectTypeOf(first.$toObject()).toEqualTypeOf<ObjectDoc<Revision>>();
  expectTypeOf(first.$toPlain()).toEqualTypeOf<Plain<Revision, false>>();
  first.note = "x";
  first.$set("tags", ["a"]);
  // @ts-expect-error TS2345: `$set` checks the key
  first.$set("nope", 1);
  // @ts-expect-error TS2345: `$set` checks the value by the field type
  first.$set("lines", "many");
  // @ts-expect-error TS2322: a plain array is not the field's StrictArray — use $set("tags", [...])
  first.tags = ["a"];
}
expectTypeOf(address.city).toEqualTypeOf<string>();
expectTypeOf(address.lines).toEqualTypeOf<StrictArray<string> | undefined>();
expectTypeOf<ObjectDoc<Revision>>().toEqualTypeOf<{
  note: string;
  lines: number;
  tags?: string[];
  comment?: string;
  _id: ObjectId;
}>();
// A subdocument assigns to its class type (read-only use of data).
const asAddress: { readonly city: string } = address;
void asAddress;

// ---- TypedMap -----------------------------------------------------------------------------------------
expectTypeOf(scores.get("a")).toEqualTypeOf<number | undefined>();
expectTypeOf(scores.set("a", 1)).toEqualTypeOf<TypedMap<number>>();
expectTypeOf(scores.$toObject()).toEqualTypeOf<Map<string, number>>();
expectTypeOf(scores.$toPlain()).toEqualTypeOf<Map<string, number>>(); /* a Map stays a Map in the plain form */
expectTypeOf(badges.get("gold")?.title).toEqualTypeOf<string | undefined>();
badges.set("silver", { title: "Silver" });
doc.series?.set("b", [1, 2]);
const readonlyMap: ReadonlyMap<string, number> = scores;
void readonlyMap;
// @ts-expect-error TS2345: the value type is number
scores.set("a", "x");
// @ts-expect-error TS2345: a subdocument value is checked like create input
badges.set("x", { title: 1 });
