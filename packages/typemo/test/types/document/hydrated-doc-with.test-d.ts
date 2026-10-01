/*
 * The two names of a hydrated document: `HydratedDoc<T>` is the default read of `T` (no `Hidden` fields; what
 * reads, `new()` and `create()` give), `HydratedDocWith<T, P>` a document whose fields `P` differ from it
 * (populated paths, `+hidden` fields, narrowed fields). The second argument lists the fields as they read; the
 * document behind it (inputs, immutability, `Hidden`, the serializations, `$depopulate`) is rebuilt from the class.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type {
  AnyPopulationDoc,
  HydratedDoc,
  HydratedDocWith,
  Model,
  ModelOperations,
  Projected,
  Ref,
} from "../../../src/index.ts";
import { isPopulated } from "../../../src/index.ts";
import type { Order } from "../../fixtures/document/document-entities.ts";
import type { Company, Person, Post } from "../../fixtures/populate/populate-entities.ts";

declare const Orders: Model<Order>;
declare const Posts: ModelOperations<Post>;
declare const People: ModelOperations<Person>;
declare const Companies: ModelOperations<Company>;

// ---- the default read is HydratedDoc<T>: a parameter of that type takes it ------------------------------------
declare const read: Awaited<ReturnType<typeof readCompany>>;
const readCompany = () => Companies.findOne().orFail();
expectTypeOf(read).toEqualTypeOf<HydratedDoc<Company>>();
const takesCompany = (company: HydratedDoc<Company>): string => company.name;
takesCompany(read);
// @ts-expect-error — `secret` is Hidden: not part of the default read
read.secret;
declare const CompanyModel: Model<Company>;
expectTypeOf(CompanyModel.new({ name: "a" })).toEqualTypeOf<HydratedDoc<Company>>();

// ---- +hidden: the field is listed, the serializations keep it only on request ---------------------------------
declare const withSecret: Awaited<ReturnType<typeof readSecret>>;
const readSecret = () => Companies.findOne().select({ "+secret": true }).orFail();
expectTypeOf(withSecret).toEqualTypeOf<HydratedDocWith<Company, { secret?: string }>>();
expectTypeOf(withSecret.secret).toEqualTypeOf<string | undefined>();
expectTypeOf(withSecret.$toPlain({ hidden: true }).secret).toEqualTypeOf<string | undefined>();
// @ts-expect-error — Hidden fields are out of $toPlain() without { hidden: true }
withSecret.$toPlain().secret;
withSecret.$set("secret", "s");

// ---- projections name the class -------------------------------------------------------------------------------
declare const picked: Awaited<ReturnType<typeof readPicked>>;
const readPicked = () => Companies.findOne().select({ name: 1 }).orFail();
expectTypeOf(picked).toEqualTypeOf<HydratedDoc<Projected<Company, "name" | "_id">>>();
// @ts-expect-error — not selected
picked.size;
declare const fields: Record<string, 0 | 1>;
declare const dynamic: Awaited<ReturnType<typeof readDynamic>>;
const readDynamic = () => Companies.findOne().select(fields).orFail();
expectTypeOf(dynamic).toEqualTypeOf<HydratedDoc<Partial<Company>>>();
expectTypeOf(dynamic._id).toEqualTypeOf<import("mongodb").ObjectId | undefined>();

// ---- populate: the populated paths are the second argument ------------------------------------------------------
declare const post: Awaited<ReturnType<typeof readPost>>;
const readPost = () => Posts.findOne().populate("author").orFail();
expectTypeOf(post).toEqualTypeOf<HydratedDocWith<Post, { author: HydratedDoc<Person> | null }>>();
expectTypeOf(post.author).toEqualTypeOf<HydratedDoc<Person> | null>();
// $set of a populated path takes what is stored (the id) or a document
declare const personId: Ref<Person>;
post.$set("author", personId);
// @ts-expect-error — `_id` is immutable: an update of a populated document may not set it either
void post.$updateOne({ $set: { _id: personId } });
// $depopulate gives back the default read
expectTypeOf(post.$depopulate()).toEqualTypeOf<HydratedDoc<Post>>();
expectTypeOf(post.$depopulate("author").author).toEqualTypeOf<Ref<Person>>();
// $populate of a plain document gives the same type as the query
declare const plainPost: HydratedDoc<Post>;
const populated = async () => plainPost.$populate("author");
expectTypeOf<Awaited<ReturnType<typeof populated>>>().toEqualTypeOf<typeof post>();
// a populated document is a document in any population state
const anyState = (doc: AnyPopulationDoc<Post>): boolean => isPopulated(doc, "author");
anyState(post);
anyState(plainPost);
// the forms of a populated document: the author as a plain document
expectTypeOf(post.$toPlain().author?._id).toEqualTypeOf<string | undefined>();
// a populated document is not the default read (its author is no id)
// @ts-expect-error — HydratedDocWith<Post, { author: … }> is not HydratedDoc<Post>
const asPlain: HydratedDoc<Post> = post;
void asPlain;

// ---- narrowing by where: the narrowed field is listed ---------------------------------------------------------
declare const paid: Awaited<ReturnType<typeof readPaid>>;
const readPaid = () => Orders.findOne().where("status").in(["paid"]).orFail();
expectTypeOf(paid.status).toEqualTypeOf<"paid">();
expectTypeOf(paid).toEqualTypeOf<HydratedDocWith<Order, { status: "paid" }>>();

void People;
