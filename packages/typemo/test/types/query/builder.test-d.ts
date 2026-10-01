/*
 * The builder's result automaton, the full generic `then`, narrowing (exists removes only `undefined`), merge of
 * the same model only, operation-specific methods.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { Decimal128, ObjectId } from "mongodb";
import type { DeleteResult, ModifyResult, UpdateResult } from "../../../src/index.ts";
import type { Member } from "../../fixtures/query/query-entities.ts";
import { Articles, Members, Notes, PostModel } from "./setup.ts";

// ---- the result follows the chain -------------------------------------------------------------------
const many = Members.find().lean();
expectTypeOf<Awaited<typeof many>[number]["visits"]>().toEqualTypeOf<bigint | undefined>();
expectTypeOf<Awaited<typeof many>[number]["balance"]>().toEqualTypeOf<Decimal128 | undefined>();
expectTypeOf<Awaited<typeof many>[number]["counters"]>().toEqualTypeOf<{ [key: string]: number } | undefined>();
expectTypeOf<Awaited<typeof many>[number]["role"]>().toEqualTypeOf<"user" | "editor" | "admin">(); // marker gone

const one = Members.findOne().lean();
expectTypeOf<Awaited<typeof one>>().toMatchTypeOf<object | null>();
expectTypeOf<null extends Awaited<typeof one> ? true : false>().toEqualTypeOf<true>();
const found = Members.findOne().orFail().lean();
expectTypeOf<null extends Awaited<typeof found> ? true : false>().toEqualTypeOf<false>();

declare const memberId: ObjectId;
const hydrated = Members.findById(memberId).orFail();
// A HydratedDoc of the visible fields (the Hidden one left out)
type Hydrated = Awaited<typeof hydrated>;
expectTypeOf<"passwordHash" extends keyof Hydrated ? true : false>().toEqualTypeOf<false>();
expectTypeOf<ReturnType<Hydrated["$isNew"]>>().toEqualTypeOf<boolean>();
expectTypeOf<Hydrated["name"]>().toEqualTypeOf<Member["name"]>();

// ---- the standard generic then, Promise combinators, Awaited ----------------------------------
const names = Members.find()
  .lean()
  .then((members) => members.map((member) => member.name));
expectTypeOf(names).toEqualTypeOf<Promise<string[]>>();
const caught = Members.find()
  .lean()
  .catch(() => [] as const);
expectTypeOf<Awaited<typeof caught>>().toMatchTypeOf<readonly unknown[]>();
const both = Promise.all([Members.countDocuments(), Notes.find().lean()]);
expectTypeOf<Awaited<typeof both>[0]>().toEqualTypeOf<number>();
const chained = Members.findOne()
  .orFail()
  .then((member) => PostModel.find({ author: member._id }).lean());
expectTypeOf<Awaited<typeof chained>[number]["title"]>().toEqualTypeOf<string>();

// ---- narrowing: in/nin/ne/equals narrow finite fields, exists removes only undefined ----------
const narrowed = Members.find()
  .where("role")
  .in(["admin", "editor"])
  .where("age")
  .exists()
  .where("lastLogin")
  .exists()
  .lean();
type Narrowed = Awaited<typeof narrowed>[number];
expectTypeOf<Narrowed["role"]>().toEqualTypeOf<"admin" | "editor">();
expectTypeOf<Narrowed["age"]>().toEqualTypeOf<number>();
expectTypeOf<Narrowed["lastLogin"]>().toEqualTypeOf<Date | null>(); /* null exists (the old wrapper removed it) */
const notAdmin = Members.find().where("role").ne("admin").lean();
expectTypeOf<Awaited<typeof notAdmin>[number]["role"]>().toEqualTypeOf<"user" | "editor">();
const flag = Members.find().where("active").equals(true).lean();
expectTypeOf<Awaited<typeof flag>[number]["active"]>().toEqualTypeOf<true>();
const wide = Members.find().where("name").equals("Ann").lean(); // a string field does not narrow
expectTypeOf<Awaited<typeof wide>[number]["name"]>().toEqualTypeOf<string>();

// ---- find and modify, values, writes ----------------------------------------------------------
const after = Members.findOneAndUpdate({ name: "x" }, { $set: { age: 1 } }).lean();
expectTypeOf<null extends Awaited<typeof after> ? true : false>().toEqualTypeOf<true>();
const upsert = Members.findOneAndUpdate({ name: "x" }, { $setOnInsert: { email: "e" } }, { upsert: true }).lean();
expectTypeOf<null extends Awaited<typeof upsert> ? true : false>().toEqualTypeOf<false>(); // upsert + "after"
const upsertBefore = Members.findOneAndUpdate(
  { name: "x" },
  { $setOnInsert: { email: "e" } },
  { upsert: true, returnDocument: "before" },
).lean();
expectTypeOf<null extends Awaited<typeof upsertBefore> ? true : false>().toEqualTypeOf<true>();
const raw = Members.findOneAndDelete({ name: "x" }).lean().includeResultMetadata();
expectTypeOf<Awaited<typeof raw>>().toMatchTypeOf<ModifyResult<object, ObjectId>>();
expectTypeOf<NonNullable<Awaited<typeof raw>["lastErrorObject"]>["upserted"]>().toEqualTypeOf<ObjectId | undefined>();
expectTypeOf(Members.exists({ name: "x" })).resolves.toEqualTypeOf<{ _id: ObjectId } | null>();
expectTypeOf(Members.distinct("tags")).resolves.toEqualTypeOf<string[]>();
expectTypeOf(Members.distinct("lastLogin")).resolves.toEqualTypeOf<(Date | null)[]>();
expectTypeOf(Members.countDocuments({ age: 1 }).limit(10)).resolves.toEqualTypeOf<number>();
expectTypeOf(Members.updateMany({ age: 1 }, { $set: { age: 2 } }).orFail()).resolves.toEqualTypeOf<
  UpdateResult<ObjectId>
>();
expectTypeOf(Notes.deleteMany({ score: 1 })).resolves.toEqualTypeOf<DeleteResult>();

// ---- merge of the same model only -----------------------------------------------------
Members.find().merge(Members.find({ age: 1 }));
Members.find().merge({ name: "x" });
// @ts-expect-error a query of another model cannot be merged
Members.find().merge(Articles.find());

// ---- operation-specific methods ---------------------------------------------------------------------
Members.find().skip(1).limit(2).batchSize(10).allowDiskUse(true).cursor();
Members.findOne().explain("executionStats");
// @ts-expect-error skip applies to find()
Members.findOne().skip(1);
// @ts-expect-error limit applies to find()
Members.findOneAndUpdate({ name: "x" }, { $set: { age: 1 } }).limit(1);
// @ts-expect-error cursor applies to find()
Members.findOne().cursor();
// @ts-expect-error includeResultMetadata applies to findOneAnd*()
Members.find().includeResultMetadata();
// @ts-expect-error explain applies to find()/findOne()
Members.findOneAndDelete({ name: "x" }).explain();
// @ts-expect-error no maxTimeMS (timeoutMS only)
Members.find().maxTimeMS(10);
/* findById takes the entity's _id type or its string form */
Members.findById("0123456789abcdef01234567");
// @ts-expect-error an ObjectId _id takes no number
Members.findById(42);
