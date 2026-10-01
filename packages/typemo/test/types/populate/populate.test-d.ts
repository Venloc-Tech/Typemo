/*
 * The result types of populate follow the runtime exactly (the shape tests compare them with real results):
 * hydrated populated documents are documents of their model, arrays and Maps of them are read-only, `transform`
 * types the field by its result, `match` may be a function of the document, embedded discriminator unions are
 * populated per member, `$populate`/`$depopulate` change the type.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId, UUID } from "mongodb";
import type { HydratedDoc, ModelOperations, PopulatedField, Ref } from "../../../src/index.ts";
import type {
  Activity,
  Canvas,
  Circle,
  Comment,
  Company,
  Device,
  Order,
  Person,
  Post,
  Product,
  Square,
  Tag,
} from "../../fixtures/populate/populate-entities.ts";

declare const People: ModelOperations<Person>;
declare const Posts: ModelOperations<Post>;
declare const Comments: ModelOperations<Comment>;
declare const Orders: ModelOperations<Order>;
declare const Activities: ModelOperations<Activity>;
declare const Canvases: ModelOperations<Canvas>;
declare const Devices: ModelOperations<Device>;

type CompanyLean = { _id: ObjectId; name: string; size?: number };

// ---- references: lean ---------------------------------------------------------------------------------
declare const ann: Awaited<ReturnType<typeof annLean>>;
const annLean = () => People.findOne().populate("company").orFail().lean();
expectTypeOf(ann.company).toEqualTypeOf<
  CompanyLean | null | undefined
>(); /* optional stays optional; null: the company is gone */
expectTypeOf(ann.friends).toEqualTypeOf<Ref<Person>[]>(); // not populated: ids (a Ref keeps its model)

declare const matched: Awaited<ReturnType<typeof matchedLean>>;
const matchedLean = () =>
  People.findOne()
    .populate({ path: "company", match: { size: { $gt: 1 } } })
    .orFail()
    .lean();
expectTypeOf(matched.company).toEqualTypeOf<CompanyLean | null | undefined>(); /* with match, | null */

declare const friends: Awaited<ReturnType<typeof friendsLean>>;
const friendsLean = () => People.findOne().populate({ path: "friends", retainNullValues: true }).orFail().lean();
expectTypeOf<(typeof friends.friends)[number]>().toEqualTypeOf<{
  name: string;
  age?: number;
  company?: Ref<Company>;
  mentor?: Ref<Person> | null;
  friends: Ref<Person>[];
  tagsByTopic?: { [key: string]: Ref<Tag> };
  _id: ObjectId;
} | null>();

declare const justOne: Awaited<ReturnType<typeof justOneLean>>;
const justOneLean = () => People.findOne().populate({ path: "friends", justOne: true }).orFail().lean();
expectTypeOf(justOne.friends).toEqualTypeOf<(typeof friends.friends)[number]>(); // one document or null

// ---- references: hydrated ---------------------------------------------------------------------------------
declare const annDoc: Awaited<ReturnType<typeof annHydrated>>;
const annHydrated = () => People.findOne().populate(["company", "friends"]).orFail();
expectTypeOf(annDoc.company).toEqualTypeOf<HydratedDoc<Company> | null | undefined>();
expectTypeOf<NonNullable<typeof annDoc.company>["$save"]>().toBeFunction(); // a document of the Company model
expectTypeOf(annDoc.friends).toEqualTypeOf<readonly HydratedDoc<Person>[]>(); // read-only array of documents
// @ts-expect-error — the populated array is a read-only view (PopulatedArray): no push
annDoc.friends.push(annDoc.friends[0]);
// $set of a populated field takes the stored ids
annDoc.$set("friends", [annDoc._id]);
// @ts-expect-error — not documents: $set takes ids
annDoc.$set("friends", annDoc.friends);

// ---- transform -------------------------------------------------------------------------------------
const transformed = People.findOne()
  .populate({ path: "company", transform: (company, id) => ({ name: company?.name ?? "?", id }) })
  .orFail()
  .lean();
expectTypeOf<Awaited<typeof transformed>["company"]>().toEqualTypeOf<{ name: string; id: ObjectId } | undefined>();
const transformedArray = People.findOne()
  .populate({ path: "friends", transform: (friend) => friend?.age ?? 0 })
  .orFail();
expectTypeOf<Awaited<typeof transformedArray>["friends"]>().toEqualTypeOf<readonly number[]>();
People.findOne().populate({
  path: "company",
  select: { name: 1 },
  transform: (company) => {
    expectTypeOf(company).toEqualTypeOf<{ _id: ObjectId; name: string } | null>(); // the select narrows the doc
    return 1;
  },
});
// @ts-expect-error — the document of the transform is the populated model's: no `title` on Company
People.findOne().populate({ path: "company", transform: (company) => company?.title });

// ---- match as a function ----------------------------------------------------------------------------
People.findOne().populate({
  path: "friends",
  match: (person) => {
    expectTypeOf(person.friends).toEqualTypeOf<Ref<Person>[]>(); // the lean document, ids
    return { name: { $ne: person.name } };
  },
});
// @ts-expect-error — the filter a match function returns is a filter of the populated model
People.findOne().populate({ path: "friends", match: () => ({ nmae: "x" }) });

// ---- virtuals -------------------------------------------------------------------------------------------
const virtuals = People.findOne().populate(["posts", "topPost", "postCount"]).orFail().lean();
type V = Awaited<typeof virtuals>;
expectTypeOf<V["posts"][number]["title"]>().toEqualTypeOf<string>();
expectTypeOf<V["topPost"]>().toMatchTypeOf<{ title: string } | null>();
expectTypeOf<V["postCount"]>().toEqualTypeOf<number>();
const virtualHydrated = People.findOne().populate("posts").orFail();
expectTypeOf<Awaited<typeof virtualHydrated>["posts"]>().toEqualTypeOf<readonly HydratedDoc<Post>[]>();
// @ts-expect-error — a count virtual takes no select
People.findOne().populate({ path: "postCount", select: { title: 1 } });
// @ts-expect-error — retainNullValues keeps positions of a reference array; a virtual has none
People.findOne().populate({ path: "posts", retainNullValues: true });

// ---- embedded, Maps, polymorphic --------------------------------------------------------------------------
const lines = Orders.findOne().populate("lines.product").orFail().lean();
expectTypeOf<Awaited<typeof lines>["lines"][number]["product"]>().toEqualTypeOf<{
  _id: ObjectId;
  name: string;
  price: number;
} | null>();
const extras = Orders.findOne().populate("extras.$*").orFail();
expectTypeOf<Awaited<typeof extras>["extras"]>().toEqualTypeOf<
  ReadonlyMap<string, HydratedDoc<Product> | null> | undefined
>();
const notes = Orders.findOne().populate("notes.$*.author").orFail().lean();
expectTypeOf<NonNullable<Awaited<typeof notes>["notes"]>[string]["author"]>().toMatchTypeOf<
  { name: string } | null | undefined
>();
const target = Activities.findOne().populate("target").orFail().lean();
expectTypeOf<Awaited<typeof target>["target"]>().toMatchTypeOf<{ title: string } | { body: string } | null>();
// @ts-expect-error — nothing below a polymorphic reference
Activities.findOne().populate("target.author");

// A reference of ONE member of an embedded discriminator union
const shapes = Canvases.findOne().populate("shapes.owner").orFail().lean();
type ShapeElement = Awaited<typeof shapes>["shapes"][number];
expectTypeOf<Extract<ShapeElement, { radius: number }>["owner"]>().toMatchTypeOf<{ name: string } | null | undefined>();
expectTypeOf<Extract<ShapeElement, { side: number }>>().toEqualTypeOf<{ kind: "square"; side: number }>();
declare const circle: Circle;
declare const square: Square;
void circle;
void square;

// UUID virtual
const readings = Devices.findOne().populate("readings").orFail().lean();
expectTypeOf<Awaited<typeof readings>["readings"][number]["serial"]>().toEqualTypeOf<UUID>();

// ---- nested ---------------------------------------------------------------------------------------------
const deep = Comments.findOne().populate("post.author.company").orFail();
expectTypeOf<
  NonNullable<NonNullable<NonNullable<Awaited<typeof deep>["post"]>["author"]>["company"]>["name"]
>().toEqualTypeOf<string>();

// ---- document methods -------------------------------------------------------------------------------------
declare const plain: HydratedDoc<Person>;
const populated = await plain.$populate("company");
expectTypeOf(populated.company).toEqualTypeOf<HydratedDoc<Company> | null | undefined>();
const back = populated.$depopulate("company");
expectTypeOf(back.company).toEqualTypeOf<Ref<Company> | undefined>();
/* A populated path populated again: no $depopulate needed, typed by the second call. */
const again = await populated.$populate({ path: "company", select: { name: 1 } });
expectTypeOf(again.company?.name).toEqualTypeOf<string | undefined>();
// @ts-expect-error — `size` is not selected by the second populate, which replaces the first
again.company?.size;
const mapAgain = await (await plain.$populate("tagsByTopic.$*")).$populate("tagsByTopic.$*");
expectTypeOf(mapAgain.tagsByTopic?.get("a")?.label).toEqualTypeOf<string | undefined>();
const mentor = await plain.$populate("mentor");
// @ts-expect-error — a path below a populated field: $depopulate it first (the message says so)
mentor.$populate("mentor.company");
// @ts-expect-error — a populated path is still checked: "name" is not a reference
again.$populate("name");
const withSelect = await plain.$populate({ path: "posts", select: { title: 1, author: 1 } });
expectTypeOf(withSelect.posts[0]?.title).toEqualTypeOf<string | undefined>();
type Box = PopulatedField<number, Ref<Tag>>;
expectTypeOf<Box>().not.toBeAny();
void Posts;

// ---- $populate with a list of paths -----------------------------------------------------------------------
declare const listed: Awaited<ReturnType<typeof listedRead>>;
const listedRead = async () => (await People.findOne().orFail()).$populate(["company", "friends"]);
expectTypeOf(listed.company).toEqualTypeOf<HydratedDoc<Company> | null | undefined>();
expectTypeOf(listed.friends).toEqualTypeOf<readonly HydratedDoc<Person>[]>();
declare const listedObjects: Awaited<ReturnType<typeof listedObjectsRead>>;
const listedObjectsRead = async () =>
  (await People.findOne().orFail()).$populate(["company", { path: "friends", select: { name: 1 } }]);
expectTypeOf(listedObjects.company).toEqualTypeOf<HydratedDoc<Company> | null | undefined>();
expectTypeOf(listedObjects.friends[0]?.name).toEqualTypeOf<string | undefined>();
const wrongInList = async () =>
  // @ts-expect-error — a path in the list that is not a reference
  (await People.findOne().orFail()).$populate(["company", "name"]);

export { wrongInList };
