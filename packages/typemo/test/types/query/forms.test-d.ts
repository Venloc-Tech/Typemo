/*
 * The forms of a document, decided by explicit markers only (never `readonly`), scalars through the one BSON
 * type table.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { Decimal128, ObjectId } from "mongodb";
import type { User } from "../../../../test-kit/fixtures/dense-graph/entities.ts";
import type {
  CreateInput,
  DataFields,
  IdOf,
  Lean,
  PlainJson,
  Ref,
  Replacement,
  UpdateInput,
} from "../../../src/index.ts";
import type { Article, Badge, Member } from "../../fixtures/query/query-entities.ts";

type L = Lean<Member>;
expectTypeOf<L["_id"]>().toEqualTypeOf<ObjectId>();
expectTypeOf<L["role"]>().toEqualTypeOf<"user" | "editor" | "admin">();
expectTypeOf<L["visits"]>().toEqualTypeOf<bigint | undefined>();
expectTypeOf<L["balance"]>().toEqualTypeOf<Decimal128 | undefined>();
expectTypeOf<L["badges"]>().toEqualTypeOf<{ [key: string]: Lean<Badge> } | undefined>();
expectTypeOf<L["bestFriend"]>().toEqualTypeOf<Ref<Member> | null | undefined>(); // a ref stays a ref (populate)
expectTypeOf<IdOf<Member>>().toEqualTypeOf<ObjectId>();

// virtuals and methods are not data (explicit markers: Computed, VirtualValue, VirtualRef)
type UserData = keyof DataFields<User>;
expectTypeOf<
  "displayName" | "initials" | "greet" | "commentsByUser" | "postCount" extends UserData ? true : false
>().toEqualTypeOf<false>();
expectTypeOf<"notes" extends keyof Lean<Article> ? true : false>().toEqualTypeOf<false>();

// create input: Defaulted and `?` optional, markers gone, a Map field takes a record too
const create: CreateInput<Member> = { name: "n", email: "e", tags: [], counters: { a: 1 }, badges: new Map() };
expectTypeOf(create).toMatchTypeOf<CreateInput<Member>>();
// @ts-expect-error a required field is missing
const missing: CreateInput<Member> = { name: "n", tags: [] };
const virtual: CreateInput<Article> = {
  title: "t",
  author: null as never,
  revisions: [],
  blocks: [],
  tags: [],
  publishedAt: null,
  // @ts-expect-error a virtual is not input
  notes: [],
};

// update input: no immutable, no _id
type U = keyof UpdateInput<Member>;
expectTypeOf<"email" | "_id" extends U ? true : false>().toEqualTypeOf<false>();
expectTypeOf<"_id" extends keyof Replacement<Article> ? true : false>().toEqualTypeOf<false>();

// JSON: int64 as a decimal string (not a JSON number), ObjectId as a string (the JsonValue rows)
expectTypeOf<PlainJson<Member>["visits"]>().toEqualTypeOf<`${bigint}` | undefined>();
expectTypeOf<PlainJson<Member>["_id"]>().toEqualTypeOf<string>();
export const unused = [missing, virtual];
