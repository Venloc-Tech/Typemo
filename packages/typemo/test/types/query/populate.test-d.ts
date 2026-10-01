/*
 * Populate paths checked segment by segment (depth 7), hints up to depth 3; object and list forms checked per
 * element (select, match, options, nested populate — no `any`); `| null` after `match`.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import { Articles, CommentModel, Members, PostModel, UserModel } from "./setup.ts";

// ---- positive ---------------------------------------------------------------------------------------
const single = Members.findOne().populate("bestFriend").orFail().lean();
type Single = Awaited<typeof single>;
expectTypeOf<NonNullable<Single["bestFriend"]>["name"]>().toEqualTypeOf<string>();
expectTypeOf<null extends Single["bestFriend"] ? true : false>().toEqualTypeOf<true>(); // the field is nullable

const matched = Articles.findOne()
  .populate({ path: "author", match: { age: { $gt: 18 } }, select: { name: 1 } })
  .orFail()
  .lean();
// A single ref populated with `match` may be null.
expectTypeOf<Awaited<typeof matched>["author"]>().toEqualTypeOf<{ _id: ObjectId; name: string } | null>();

const list = Members.findOne()
  .populate({ path: "favorites", select: { title: 1 }, options: { sort: { views: -1 }, limit: 2 } })
  .orFail()
  .lean();
expectTypeOf<Awaited<typeof list>["favorites"]>().toEqualTypeOf<{ _id: ObjectId; title: string }[] | undefined>();

const virtual = Articles.findOne().populate("notes").orFail().lean();
expectTypeOf<Awaited<typeof virtual>["notes"][number]["body"]>().toEqualTypeOf<string>();

const deep = UserModel.find().populate("posts.comments.author.posts.comments.author.bestFriend").lean();
type Deep = Awaited<typeof deep>[number];
expectTypeOf<
  NonNullable<
    NonNullable<
      NonNullable<
        NonNullable<Deep["posts"][number]["comments"][number]["author"]>["posts"][number]["comments"][number]["author"]
      >["bestFriend"]
    >
  >["name"]
>().toEqualTypeOf<string>();

const nested = PostModel.findOne()
  .populate({ path: "comments", select: { body: 1, author: 1 }, populate: { path: "author", select: { name: 1 } } })
  .orFail()
  .lean();
expectTypeOf<Awaited<typeof nested>["comments"][number]["author"]>().toEqualTypeOf<{
  _id: ObjectId;
  name: string;
} | null>();

const arrayForm = PostModel.find()
  .populate(["author", { path: "comments", select: { body: 1 } }])
  .lean();
expectTypeOf<Awaited<typeof arrayForm>[number]["comments"][number]>().toEqualTypeOf<{ _id: ObjectId; body: string }>();

const maps = CommentModel.find().populate("mentions.$*").lean();
expectTypeOf<NonNullable<Awaited<typeof maps>[number]["mentions"][string]>["name"]>().toEqualTypeOf<string>();

const counted = UserModel.find().populate("postCount").lean();
expectTypeOf<Awaited<typeof counted>[number]["postCount"]>().toEqualTypeOf<number>();

const hydrated = PostModel.findOne().populate("author").orFail();
expectTypeOf<NonNullable<Awaited<typeof hydrated>["author"]>["greet"]>().toEqualTypeOf<() => string>(); // a document of the class

// ---- negative ---------------------------------------------------------------------------------------
// @ts-expect-error unknown field in a populate path
Members.find().populate("bestFrend");
// @ts-expect-error not a reference
Members.find().populate("name");
// @ts-expect-error deeper than the 7-level ceiling
UserModel.find().populate("posts.comments.author.posts.comments.author.posts.comments");
// @ts-expect-error a typo in `match` (the wrapper's `match: Record<string, unknown>` let it through)
Articles.find().populate({ path: "author", match: { nmae: "x" } });
// @ts-expect-error a wrong value type in `match`
Articles.find().populate({ path: "author", match: { age: "x" } });
// @ts-expect-error a typo in the target's select
Articles.find().populate({ path: "author", select: { nmae: 1 } });
// @ts-expect-error an unknown populate option
Articles.find().populate({ path: "author", selct: { name: 1 } });
// @ts-expect-error a bad element of the list form (the wrapper typed elements with `any`)
PostModel.find().populate(["author", { path: "comments", select: { bdy: 1 } }]);
// @ts-expect-error a bad nested populate path
PostModel.find().populate({ path: "comments", populate: { path: "autor" } });
// @ts-expect-error options sort by a path of another model
Members.find().populate({ path: "favorites", options: { sort: { name: 1 } } });
