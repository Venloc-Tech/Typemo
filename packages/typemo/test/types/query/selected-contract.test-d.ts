/*
 * `Selected` (plain) / `SelectedLean` / `SelectedJson` (the replacement of the old wrapper's `Populated`) and the
 * exact contract check — `.expect<Shape>()` on plain and lean queries and aggregations,
 * `Contract.check<Shape>()(value)` — types only.
 * Positive: the contract equals the result type. Negative (`@ts-expect-error`): missing, EXTRA and mismatched
 * fields, `null`, optionality, arrays, nested populated contracts and discriminator unions.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import {
  Contract,
  type ContractCheck,
  type Model,
  type ModelOperations,
  type Ref,
  type Selected,
  type SelectedJson,
  type SelectedLean,
} from "../../../src/index.ts";
import type {
  Canvas,
  Circle,
  Company,
  Event,
  Person,
  Post,
  Square,
  Tag,
} from "../../fixtures/populate/populate-entities.ts";

declare const People: ModelOperations<Person>;
declare const Posts: ModelOperations<Post>;
declare const Events: ModelOperations<Event>;
declare const Canvases: ModelOperations<Canvas>;
declare const PeopleModel: Model<Person>;

// ---- Selected: the plain form ---------------------------------------------------------------------
type PersonPlainCard = Selected<Person, "name" | "age">;
expectTypeOf<PersonPlainCard>().toEqualTypeOf<{ _id: string; name: string; age?: number }>();
// a reference not populated is its id as a string; a Map field stays a Map (of id strings); an array of id strings
expectTypeOf<Selected<Person, "name" | "company" | "tagsByTopic" | "friends" | "-_id">>().toEqualTypeOf<{
  name: string;
  company?: string;
  tagsByTopic?: Map<string, string>;
  friends: string[];
}>();
// a getter virtual may be named (`$toPlain({ virtuals: true })`); overrides are plain contracts too
expectTypeOf<Selected<Post, "title" | "author", { author: Selected<Person, "name" | "-_id"> }>>().toEqualTypeOf<{
  _id: string;
  title: string;
  author: { name: string };
}>();
// @ts-expect-error — the plain form is not the lean form: `_id` is a string, not an ObjectId
export const plainId: Selected<Person, "name"> = { _id: {} as ObjectId, name: "x" };

// ---- SelectedLean: the lean form ------------------------------------------------------------------------
type PersonCard = SelectedLean<Person, "name" | "age">;
expectTypeOf<PersonCard>().toEqualTypeOf<{ _id: ObjectId; name: string; age?: number }>();
// "-_id" leaves _id out; a reference not populated stays its id (`Ref<M>`: an ObjectId with a meaning, as in `Lean`)
expectTypeOf<SelectedLean<Person, "name" | "company" | "-_id">>().toEqualTypeOf<{
  name: string;
  company?: Ref<Company>;
}>();
// a Map field is a record in the lean form; an array of refs an array of ids
expectTypeOf<SelectedLean<Person, "tagsByTopic" | "friends" | "-_id">>().toEqualTypeOf<{
  tagsByTopic?: { [key: string]: Ref<Tag> };
  friends: Ref<Person>[];
}>();
// overrides: a populated reference (optional stays optional), an array of them, 2 levels deep, a populated virtual
type PostWithAuthor = SelectedLean<
  Post,
  "title" | "author",
  {
    author: SelectedLean<Person, "name" | "company", { company: SelectedLean<Company, "name" | "-_id"> | null }> | null;
  }
>;
expectTypeOf<PostWithAuthor>().toEqualTypeOf<{
  _id: ObjectId;
  title: string;
  author: { _id: ObjectId; name: string; company?: { name: string } | null } | null;
}>();
expectTypeOf<SelectedLean<Person, "posts" | "-_id", { posts: SelectedLean<Post, "title">[] }>>().toEqualTypeOf<{
  posts: { _id: ObjectId; title: string }[];
}>();
// @ts-expect-error — methods are not fields of a contract (the wrapper allowed them)
export type NoMethod = Selected<Person, "greet">;
// @ts-expect-error — `_id` is included by default (and "-_id" leaves it out): not a field to list
export type NoId = SelectedLean<Person, "_id">;
// @ts-expect-error — an override must be one of the selected fields
export type BadOverride = Selected<Person, "name", { company: Selected<Company, "name"> }>;
// a populate virtual without its override is a readable error in the contract itself
expectTypeOf<SelectedLean<Person, "posts" | "-_id">["posts"]>().toEqualTypeOf<{
  readonly "contract error": '"posts" is a populate virtual: give its populated form in Overrides';
}>();

// ---- SelectedJson: the toJSON form ----------------------------------------------------------------------
expectTypeOf<SelectedJson<Person, "name" | "company">>().toEqualTypeOf<{
  _id: string;
  name: string;
  company?: string;
}>();
expectTypeOf<
  SelectedJson<Post, "title" | "author", { author: SelectedJson<Person, "name" | "-_id"> }>
>().toEqualTypeOf<{
  _id: string;
  title: string;
  author: { name: string };
}>();

// ---- expect<Shape>() on plain queries ----------------------------------------------------------------
const plainCards = People.find().select({ name: 1, age: 1 }).plain().expect<PersonPlainCard>();
expectTypeOf<Awaited<typeof plainCards>>().toEqualTypeOf<{ _id: string; name: string; age?: number }[]>();
Posts.findOne()
  .select({ title: 1, author: 1 })
  .populate({ path: "author", select: { name: 1, _id: 0 } })
  .orFail()
  .plain()
  .expect<Selected<Post, "title" | "author", { author: Selected<Person, "name" | "-_id"> | null }>>();
// @ts-expect-error — a populated single reference may be null (the author is gone): the contract says so ({ mismatch: "author" })
Posts.findOne()
  .select({ title: 1, author: 1 })
  .populate({ path: "author", select: { name: 1, _id: 0 } })
  .orFail()
  .plain()
  .expect<Selected<Post, "title" | "author", { author: Selected<Person, "name" | "-_id"> }>>();
// Hidden: out by default, in with { hidden: true } (the query selected it with "+secret")
declare const Companies: ModelOperations<Company>;
Companies.findOne().select({ "+secret": true }).orFail().plain().expect<Selected<Company, "name" | "size">>();
Companies.findOne()
  .select({ "+secret": true })
  .orFail()
  .plain({ hidden: true })
  .expect<Selected<Company, "name" | "size" | "secret">>();
// @ts-expect-error — EXTRA: with { hidden: true } the selected Hidden field is part of the row ({ extra: "secret" })
Companies.findOne()
  .select({ "+secret": true })
  .orFail()
  .plain({ hidden: true })
  .expect<Selected<Company, "name" | "size">>();
// @ts-expect-error — the plain row is not the lean row: `_id` is a string ({ mismatch: "_id" })
People.find().select({ name: 1, age: 1 }).plain().expect<PersonCard>();
// @ts-expect-error — the lean row is not the plain row ({ mismatch: "_id" })
People.find().select({ name: 1, age: 1 }).lean().expect<PersonPlainCard>();
// @ts-expect-error — .plain() takes { hidden } only
People.find().plain({ virtuals: true });

// ---- expect<Shape>() on lean queries ---------------------------------------------------------------------
const cards = People.find().select({ name: 1, age: 1 }).lean().expect<PersonCard>();
expectTypeOf<Awaited<typeof cards>>().toEqualTypeOf<{ name: string; _id: ObjectId; age?: number }[]>();
People.findOne().select({ name: 1, age: 1 }).orFail().lean().expect<PersonCard>();
Posts.findOne()
  .select({ title: 1, author: 1 })
  .populate({
    path: "author",
    select: { name: 1, company: 1 },
    populate: { path: "company", select: { name: 1, _id: 0 } },
  })
  .orFail()
  .lean()
  .expect<PostWithAuthor>();
People.findOne().select({ name: 1, _id: 0 }).lean().expect<SelectedLean<Person, "name" | "-_id">>();
// @ts-expect-error — MISSING: the contract wants `email`-like field `company` the projection left out ({ missing: "company" })
People.find().select({ name: 1, age: 1 }).lean().expect<SelectedLean<Person, "name" | "age" | "company">>();
// @ts-expect-error — EXTRA: `age` is in the result, not in the contract ({ extra: "age" }) — an assignment would accept it
People.find().select({ name: 1, age: 1 }).lean().expect<SelectedLean<Person, "name">>();
// @ts-expect-error — MISMATCH: `name` is a string ({ mismatch: "name" })
People.find().select({ name: 1, age: 1 }).lean().expect<{ _id: ObjectId; name: number; age?: number }>();
// @ts-expect-error — optionality is part of the contract: `age` may be absent ({ mismatch: "age" })
People.find().select({ name: 1, age: 1 }).lean().expect<{ _id: ObjectId; name: string; age: number }>();
// @ts-expect-error — `null`: `mentor` is nullable in the result ({ mismatch: "mentor" })
People.find().select({ mentor: 1 }).lean().expect<{ _id: ObjectId; mentor?: ObjectId }>();
// @ts-expect-error — arrays: an element mismatch is reported at `friends[]`
People.find().select({ friends: 1 }).lean().expect<{ _id: ObjectId; friends: string[] }>();
// @ts-expect-error — nested: the populated author lacks `company` ({ missing: "author.company" })
Posts.find()
  .select({ author: 1 })
  .populate({ path: "author", select: { name: 1 } })
  .lean()
  .expect<{
    _id: ObjectId;
    author: { _id: ObjectId; name: string; company?: ObjectId };
  }>();
// @ts-expect-error — hydrated query: expect() checks rows (call .plain() or .lean() first)
People.find().select({ name: 1, age: 1 }).expect<PersonCard>();

// discriminator unions (an embedded union of subdocuments): each member needs its exact twin
type ShapeRow = { kind: "circle"; radius: number; owner?: ObjectId } | { kind: "square"; side: number };
Canvases.findOne().select({ shapes: 1, _id: 0 }).orFail().lean().expect<{ shapes: ShapeRow[] }>();
// @ts-expect-error — a union member without its twin (the square lacks `side`): { mismatch: "shapes[]" }
Canvases.findOne()
  .select({ shapes: 1, _id: 0 })
  .orFail()
  .lean()
  .expect<{ shapes: ({ kind: "circle"; radius: number; owner?: ObjectId } | { kind: "square" })[] }>();

// root discriminators: the base model's rows
Events.findOne().select({ label: 1 }).orFail().lean().expect<{ _id: ObjectId; label: string }>();

// ---- aggregate --------------------------------------------------------------------------------------------
PeopleModel.aggregate((p) => p.project({ name: 1, _id: 0 })).expect<{ name: string }>();
// @ts-expect-error — EXTRA in an aggregation row ({ extra: "name" })
PeopleModel.aggregate((p) => p.project({ name: 1, _id: 0 })).expect<Record<never, never>>();

// ---- Contract.check -----------------------------------------------------------------
declare const person: Awaited<ReturnType<typeof readPerson>>;
const readPerson = () => People.findOne().orFail();
type PersonJson = SelectedJson<Person, "name" | "age" | "company" | "mentor" | "friends" | "tagsByTopic">;
const json = Contract.check<PersonJson>()(person.$toJSON());
expectTypeOf(json).toEqualTypeOf<PersonJson>();
type PersonPlain = Selected<Person, "name" | "age" | "company" | "mentor" | "friends" | "tagsByTopic">;
const plain = Contract.check<PersonPlain>()(person.$toPlain());
expectTypeOf(plain).toEqualTypeOf<PersonPlain>();
// @ts-expect-error — EXTRA: the JSON form has more fields than the contract ({ extra: … })
Contract.check<SelectedJson<Person, "name">>()(person.$toJSON());
type PersonLean = SelectedLean<Person, "name" | "age" | "company" | "mentor" | "friends" | "tagsByTopic">;
// @ts-expect-error — lean form is not the JSON form: `_id` is an ObjectId there ({ mismatch: "_id" })
Contract.check<PersonLean>()(person.$toJSON());
// @ts-expect-error — the plain form is not the JSON form: a Map there, a record in JSON ({ mismatch: "tagsByTopic" })
Contract.check<PersonPlain>()(person.$toJSON());

// @ts-expect-error — the old name is gone (there is no alias)
export { Shape } from "../../../src/index.ts";

// ---- the report type itself ---------------------------------------------------------------------------
expectTypeOf<ContractCheck<{ a: string; b: number }, { a: string; b: number }>>().toEqualTypeOf<true>();
expectTypeOf<ContractCheck<{ a: string; x: 1 }, { a: number; c: 2 }>>().toEqualTypeOf<{
  readonly missing: "c";
  readonly extra: "x";
  readonly mismatch: "a";
}>();
expectTypeOf<ContractCheck<{ a?: string }, { a: string }>>().toEqualTypeOf<{ readonly mismatch: "a" }>();
expectTypeOf<ContractCheck<string | null, string>>().toEqualTypeOf<{ readonly mismatch: "(root)" }>();
expectTypeOf<ContractCheck<Circle | Square, Circle | Square>>().toEqualTypeOf<true>();
expectTypeOf<ContractCheck<{ a: readonly string[] }, { a: string[] }>>().toEqualTypeOf<true>(); // readonly is not data
