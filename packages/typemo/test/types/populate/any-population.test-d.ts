/*
 * `AnyPopulationDoc<T>` (R61, finding 80): a hydrated document in ANY population state. A plain `HydratedDoc<T>`
 * and every populated document of `T` (arrays, Maps, virtuals, nested populate) are assignable to it; a reference
 * reads as `Ref<M> | AnyPopulationDoc<M> | null` and is narrowed by `isPopulated(doc, path)`.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { ObjectId } from "mongodb";
import {
  type AnyPopulationDoc,
  type HydratedDoc,
  isPopulated,
  type ModelOperations,
  type PartlyPopulatedDoc,
  type Ref,
} from "../../../src/index.ts";
import type { Company, Order, Person, Post, Product, Tag } from "../../fixtures/populate/populate-entities.ts";

declare const People: ModelOperations<Person>;
declare const Posts: ModelOperations<Post>;
declare const Orders: ModelOperations<Order>;
declare const id: ObjectId;

/** A function over a post in any population state. */
declare const takePost: (post: AnyPopulationDoc<Post>) => void;
/** A function over a person in any population state. */
declare const takePerson: (person: AnyPopulationDoc<Person>) => void;
/** A function over an order in any population state. */
declare const takeOrder: (order: AnyPopulationDoc<Order>) => void;

/* ---- assignability: plain and populated ---- */
declare const plainPost: HydratedDoc<Post>;
takePost(plainPost);
takePost(await Posts.findById(id).orFail());
takePost(await Posts.findById(id).populate("author").orFail());
takePost(await Posts.findById(id).populate("tags").orFail()); /* an array of references */
takePost(await Posts.findById(id).populate(["author", "tags", "comments"]).orFail()); /* a virtual too */
takePost(await Posts.findById(id).populate({ path: "author", populate: "friends" }).orFail()); /* nested */
takePost(
  await Posts.findById(id)
    .populate({ path: "author", populate: { path: "company" } })
    .orFail(),
); /* Hidden out */
takePost(await Posts.findById(id).populate("author.posts").orFail()); /* nested virtual */

declare const plainPerson: HydratedDoc<Person>;
takePerson(plainPerson);
takePerson(await People.findById(id).populate(["company", "mentor", "friends", "tagsByTopic.$*"]).orFail());
takePerson(await People.findById(id).populate(["posts", "topPost", "postCount"]).orFail()); /* virtuals */
takePerson(await People.findById(id).populate({ path: "friends", retainNullValues: true }).orFail());
takePerson(await (await People.findById(id).orFail()).$populate("company"));

takeOrder(await Orders.findById(id).orFail());
takeOrder(await Orders.findById(id).populate(["customer", "lines.product", "extras.$*", "notes.$*.author"]).orFail());
takeOrder(await Orders.findById(id).populate("shipping.carrier").orFail()); /* inside a nested object */

const selected = await Posts.findById(id)
  .populate({ path: "author", select: { name: 1 } })
  .orFail();
// @ts-expect-error — a populate with `select` leaves fields out: not a whole post
takePost(selected);
// @ts-expect-error — a document of another model is not a post
takePost(plainPerson);

/* ---- the field types ---- */
declare const post: AnyPopulationDoc<Post>;
expectTypeOf(post.author).toEqualTypeOf<Ref<Person> | AnyPopulationDoc<Person> | null>();
expectTypeOf(post.tags).toEqualTypeOf<readonly (Ref<Tag> | AnyPopulationDoc<Tag> | null)[]>();
expectTypeOf(post.title).toEqualTypeOf<string>();
expectTypeOf(post.$save()).resolves.toEqualTypeOf<AnyPopulationDoc<Post>>();
expectTypeOf(post.$toPlain()).toEqualTypeOf<Record<string, unknown>>();
expectTypeOf(post._id).toEqualTypeOf<HydratedDoc<Post>["_id"]>();
// @ts-expect-error — the author may be an id: `.name` needs `isPopulated` first
post.author.name;
// @ts-expect-error — the form is read-only: it does not know what the field holds
post.title = "x";
// @ts-expect-error — `$set` depends on the population state: not in this form
post.$set("title", "x");

declare const person: AnyPopulationDoc<Person>;
expectTypeOf(person.tagsByTopic).toEqualTypeOf<
  ReadonlyMap<string, Ref<Tag> | AnyPopulationDoc<Tag> | null> | undefined
>();
expectTypeOf(person.greet()).toEqualTypeOf<string>(); /* the class's own methods */

declare const company: AnyPopulationDoc<Company>;
expectTypeOf(company.secret).toEqualTypeOf<string | undefined>(); /* Hidden: optional */

declare const order: AnyPopulationDoc<Order>;
expectTypeOf(order.lines[0]?.product).toEqualTypeOf<
  Ref<Product> | AnyPopulationDoc<Product> | null | undefined
>(); /* a reference inside an array of subdocuments */

/* ---- narrowing with isPopulated ---- */
if (isPopulated(post, "author")) {
  expectTypeOf(post).toEqualTypeOf<PartlyPopulatedDoc<Post, "author">>();
  expectTypeOf(post.author).toEqualTypeOf<AnyPopulationDoc<Person> | null>();
  expectTypeOf(post.author?.name).toEqualTypeOf<string | undefined>();
  if (post.author !== null && isPopulated(post.author, "friends")) {
    expectTypeOf(post.author.friends).toEqualTypeOf<readonly (AnyPopulationDoc<Person> | null)[]>();
  }
}
if (isPopulated(post, "tags")) expectTypeOf(post.tags).toEqualTypeOf<readonly (AnyPopulationDoc<Tag> | null)[]>();
if (isPopulated(post, "comments")) expectTypeOf(post.comments[0]?.body).toEqualTypeOf<string | undefined>();
if (isPopulated(person, "company")) expectTypeOf(person.company).toEqualTypeOf<AnyPopulationDoc<Company> | null>();
if (isPopulated(person, "tagsByTopic")) {
  expectTypeOf(person.tagsByTopic).toEqualTypeOf<ReadonlyMap<string, AnyPopulationDoc<Tag> | null>>();
}
if (isPopulated(person, "topPost")) expectTypeOf(person.topPost).toEqualTypeOf<AnyPopulationDoc<Post> | null>();
if (isPopulated(person, "postCount")) expectTypeOf(person.postCount).toEqualTypeOf<number>();
if (isPopulated(person, "company") && isPopulated(person, "mentor")) {
  expectTypeOf(person).toEqualTypeOf<PartlyPopulatedDoc<Person, "company" | "mentor">>();
}

// @ts-expect-error — "title" is not a reference: nothing to populate
isPopulated(post, "title");
// @ts-expect-error — "writer" is not a field of Post
isPopulated(post, "writer");
// @ts-expect-error — a plain HydratedDoc says its references are ids: widen it to AnyPopulationDoc first
isPopulated(plainPost, "author");
