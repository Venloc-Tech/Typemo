/*
 * Object projections (no string DSL), no include/exclude mixing, Hidden<T> left out by default and added with
 * `+field`, $slice/$elemMatch; sort as an object or pairs, 1/-1 only.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import { type Projection, untrusted } from "../../../src/index.ts";
import type { Member } from "../../fixtures/query/query-entities.ts";
import { Articles, Members } from "./setup.ts";

// ---- positive: the result follows the projection ----------------------------------------------------
const byDefault = Members.find().lean();
type Default = Awaited<typeof byDefault>[number];
expectTypeOf<"passwordHash" extends keyof Default ? true : false>().toEqualTypeOf<false>();
expectTypeOf<"secretNote" extends keyof NonNullable<Default["profile"]> ? true : false>().toEqualTypeOf<false>();

const plus = Members.find().select({ "+passwordHash": true }).lean();
expectTypeOf<Awaited<typeof plus>[number]["passwordHash"]>().toEqualTypeOf<string | undefined>();

const included = Members.findOne().select({ name: 1, tags: 1, _id: 0 }).orFail().lean();
expectTypeOf<Awaited<typeof included>>().toEqualTypeOf<{ name: string; tags: string[] }>();

const dotted = Members.findOne().select({ "profile.address.city": 1 }).orFail().lean();
expectTypeOf<Awaited<typeof dotted>>().toEqualTypeOf<{ _id: ObjectId; profile?: { address?: { city: string } } }>();

const idOnly = Members.findOne().select({ _id: 1 }).orFail().lean();
expectTypeOf<Awaited<typeof idOnly>>().toEqualTypeOf<{ _id: ObjectId }>();

const excluded = Members.findOne().select({ profile: 0, counters: 0 }).orFail().lean();
expectTypeOf<
  "profile" | "counters" | "passwordHash" extends keyof Awaited<typeof excluded> ? true : false
>().toEqualTypeOf<false>();

const merged = Members.findOne().select({ name: 1 }).select({ age: 1 }).orFail().lean();
expectTypeOf<Awaited<typeof merged>>().toEqualTypeOf<{ _id: ObjectId; name: string; age?: number }>();

const sliced = Members.findOne()
  .select({ tags: { $slice: 2 } })
  .orFail()
  .lean();
expectTypeOf<Awaited<typeof sliced>["name"]>().toEqualTypeOf<string>();
const elem = Articles.findOne()
  .select({ revisions: { $elemMatch: { lines: { $gt: 1 } } } })
  .orFail()
  .lean();
expectTypeOf<keyof Awaited<typeof elem>>().toEqualTypeOf<"_id" | "revisions">();

const scored = Articles.find({ $text: { $search: "x" } })
  .textScore("relevance", { sort: true })
  .lean();
expectTypeOf<Awaited<typeof scored>[number]["relevance"]>().toEqualTypeOf<number>();

Members.find().sort({ age: -1, "profile.address.city": 1, _id: 1 });
Members.find().sort([
  ["age", -1],
  ["name", 1],
]);

// ---- negative ---------------------------------------------------------------------------------------
// @ts-expect-error inclusion mixed with exclusion (the server refuses it, code 31254)
Members.find().select({ name: 1, age: 0 });
// @ts-expect-error an unknown field
Members.find().select({ nmae: 1 });
// @ts-expect-error `+field` only on Hidden fields
Members.find().select({ "+name": true });
// @ts-expect-error `+field` takes only true
Members.find().select({ "+passwordHash": false });
// @ts-expect-error $slice on a non-array
Members.find().select({ name: { $slice: 1 } });
// @ts-expect-error no string DSL
Members.find().select("name -age");
// A flag that is not a literal is a projection of unknown shape: accepted, every field optional (see below).
const computedFlag = Members.findOne()
  .select({ name: Math.random() > 0.5 })
  .orFail()
  .lean();
expectTypeOf<Awaited<typeof computedFlag>["name"]>().toEqualTypeOf<string | undefined>();
// Words are sort directions too (normalized to 1 / -1)
Members.find().sort({ age: "asc", name: "descending" });
Members.find().sort([["age", "desc"]]);
// @ts-expect-error a sort direction is 1, -1, "asc", "desc", "ascending" or "descending" ("up" is none of them)
Members.find().sort({ age: "up" });
// @ts-expect-error sort by an unknown path
Members.find().sort({ nmae: 1 });
// @ts-expect-error no string sort DSL
Members.find().sort("-age");

// ---- projections of unknown shape: a declared Projection<T>, a dynamic Record ---------------------------
// Accepted like select(any): every field optional (which fields come back is not known); a dynamic projection's
// paths and mode are checked when the query runs.
declare const declared: Projection<Member>;
const fromDeclared = Members.findOne().select(declared).orFail().lean();
expectTypeOf<Awaited<typeof fromDeclared>["name"]>().toEqualTypeOf<string | undefined>();
expectTypeOf<Awaited<typeof fromDeclared>["_id"]>().toEqualTypeOf<ObjectId | undefined>();
// A declared projection may add a Hidden field with `+path`: it is in the (optional) result.
expectTypeOf<Awaited<typeof fromDeclared>["passwordHash"]>().toEqualTypeOf<string | undefined>();
declare const fields: Record<string, 1>;
const fromRecord = Members.findOne().select(fields).orFail().lean();
expectTypeOf<Awaited<typeof fromRecord>["age"]>().toEqualTypeOf<number | undefined>();
const fromUntrusted = Members.find().select(untrusted(fields, "projection")).lean();
expectTypeOf<Awaited<typeof fromUntrusted>[number]["name"]>().toEqualTypeOf<string | undefined>();
declare const flags: Record<string, 0 | 1 | boolean>;
Members.find().select(flags);
// @ts-expect-error a projection of unknown shape may leave `name` out: it is optional, not a string
export const requiredName: string = ({} as Awaited<typeof fromRecord>).name;
// @ts-expect-error a literal still has its keys checked (an unknown field)
Members.find().select({ ...declared, nope: 1 });
