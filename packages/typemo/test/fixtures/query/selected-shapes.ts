/*
 * The hand-written contracts (`Selected` — plain, `SelectedLean` — lean, `SelectedJson` — JSON) of
 * the shape tests and the queries whose REAL results they must describe, written once: the runtime test runs the
 * queries, the type probe reads the contracts from this module. Each query also carries `.expect<Contract>()` (or
 * `Contract.check`): the compiler proves the contract equals the result type, the shape test proves the result type
 * equals what the server returns.
 */
import { Contract, type Selected, type SelectedJson, type SelectedLean } from "../../../src/index.ts";
import type { Company, Person, Post, Signup } from "../populate/populate-entities.ts";
import type { PopulateModels } from "../populate/populate-seed.ts";
import { P } from "../populate/populate-seed.ts";

/* lean (SelectedLean) */

/**
 * A person card in lean form.
 *
 * @example
 * const card: PersonCardLean = { _id, name: "Ann", age: 30 };
 */
export type PersonCardLean = SelectedLean<Person, "name" | "age">;
/**
 * A person without `_id`, with a reference array and a Map, in lean form.
 *
 * @example
 * type Keys = keyof PersonNoIdLean; // "name" | "friends" | "tagsByTopic"
 */
export type PersonNoIdLean = SelectedLean<Person, "name" | "friends" | "tagsByTopic" | "-_id">;
/**
 * A post with its author and the author's company populated two levels deep, in lean form.
 *
 * @example
 * type Company = NonNullable<PostWithAuthorLean["author"]>["company"];
 */
export type PostWithAuthorLean = SelectedLean<
  Post,
  "title" | "author",
  {
    author: SelectedLean<Person, "name" | "company", { company: SelectedLean<Company, "name" | "-_id"> | null }> | null;
  }
>;
/**
 * A person with the populate virtual `posts`, in lean form.
 *
 * @example
 * type Posts = PersonWithPostsLean["posts"];
 */
export type PersonWithPostsLean = SelectedLean<
  Person,
  "name" | "posts",
  { posts: SelectedLean<Post, "title" | "author">[] }
>;
/**
 * A root-discriminator row with its discriminator key, in lean form.
 *
 * @example
 * type Key = SignupRowLean["__t"];
 */
export type SignupRowLean = SelectedLean<Signup, "label" | "user" | "__t">;

/* plain (Selected) */

/**
 * A person card in plain form.
 *
 * @example
 * const card: PersonCard = { _id, name: "Ann", age: 30 };
 */
export type PersonCard = Selected<Person, "name" | "age">;
/**
 * A person without `_id`, with a reference array and a Map, in plain form.
 *
 * @example
 * type Keys = keyof PersonNoId; // "name" | "friends" | "tagsByTopic"
 */
export type PersonNoId = Selected<Person, "name" | "friends" | "tagsByTopic" | "-_id">;
/**
 * A post with its author and the author's company populated two levels deep, in plain form.
 *
 * @example
 * type Company = NonNullable<PostWithAuthor["author"]>["company"];
 */
export type PostWithAuthor = Selected<
  Post,
  "title" | "author",
  { author: Selected<Person, "name" | "company", { company: Selected<Company, "name" | "-_id"> | null }> | null }
>;
/**
 * A person with the populate virtual `posts`, in plain form.
 *
 * @example
 * type Posts = PersonWithPosts["posts"];
 */
export type PersonWithPosts = Selected<Person, "name" | "posts", { posts: Selected<Post, "title" | "author">[] }>;
/**
 * A root-discriminator row with its discriminator key, in plain form.
 *
 * @example
 * type Key = SignupRow["__t"];
 */
export type SignupRow = Selected<Signup, "label" | "user" | "__t">;
/**
 * A person with its reference fields (not populated), in plain form.
 *
 * @example
 * type Company = PersonPlain["company"];
 */
export type PersonPlain = Selected<Person, "name" | "age" | "company" | "mentor" | "friends" | "tagsByTopic">;

/* JSON (SelectedJson) */

/**
 * A person with its reference fields (not populated), in JSON form.
 *
 * @example
 * type Company = PersonJson["company"];
 */
export type PersonJson = SelectedJson<Person, "name" | "age" | "company" | "mentor" | "friends" | "tagsByTopic">;
/**
 * A post with its author and the author's company populated two levels deep, in JSON form.
 *
 * @example
 * type Company = NonNullable<PostJson["author"]>["company"];
 */
export type PostJson = SelectedJson<
  Post,
  "title" | "author",
  {
    author: SelectedJson<Person, "name" | "company", { company: SelectedJson<Company, "name" | "-_id"> | null }> | null;
  }
>;

/**
 * A post with its author and the author's company populated.
 *
 * @param m - the populate models
 * @returns the query
 */
const twoLevels = (m: PopulateModels) =>
  m.Posts.findById(P.p1)
    .select({ title: 1, author: 1 })
    .populate({
      path: "author",
      select: { name: 1, company: 1 },
      populate: { path: "company", select: { name: 1, _id: 0 } },
    })
    .orFail();

/**
 * A person with the `posts` populate virtual.
 *
 * @param m - the populate models
 * @returns the query
 */
const withPosts = (m: PopulateModels) =>
  m.People.findById(P.ann)
    .select({ name: 1 })
    .populate({ path: "posts", select: { title: 1, author: 1 } })
    .orFail();

/**
 * The queries whose real results the contracts above must describe.
 *
 * @param m - the populate models
 * @returns one lazy query per contract, keyed by name
 */
export const selectedShapes = (m: PopulateModels) => ({
  /* lean */
  card: () => m.People.findById(P.ann).select({ name: 1, age: 1 }).orFail().lean().expect<PersonCardLean>(),
  noId: () =>
    m.People.findById(P.ann)
      .select({ name: 1, friends: 1, tagsByTopic: 1, _id: 0 })
      .orFail()
      .lean()
      .expect<PersonNoIdLean>(),
  twoLevels: () => twoLevels(m).lean().expect<PostWithAuthorLean>(),
  virtual: () => withPosts(m).lean().expect<PersonWithPostsLean>(),
  discriminator: () =>
    m.Signups.findOne().select({ label: 1, user: 1, __t: 1 }).orFail().lean().expect<SignupRowLean>(),
  /* plain: the query without hydration, and $toPlain() of the hydrated document — the same contract */
  plainCard: () => m.People.findById(P.ann).select({ name: 1, age: 1 }).orFail().plain().expect<PersonCard>(),
  plainNoId: () =>
    m.People.findById(P.ann)
      .select({ name: 1, friends: 1, tagsByTopic: 1, _id: 0 })
      .orFail()
      .plain()
      .expect<PersonNoId>(),
  plainTwoLevels: () => twoLevels(m).plain().expect<PostWithAuthor>(),
  toPlainTwoLevels: async () => Contract.check<PostWithAuthor>()((await twoLevels(m)).$toPlain()),
  plainVirtual: () => withPosts(m).plain().expect<PersonWithPosts>(),
  toPlainVirtual: async () => Contract.check<PersonWithPosts>()((await withPosts(m)).$toPlain()),
  plainDiscriminator: () =>
    m.Signups.findOne().select({ label: 1, user: 1, __t: 1 }).orFail().plain().expect<SignupRow>(),
  plainPerson: () => m.People.findById(P.ann).orFail().plain().expect<PersonPlain>(),
  toPlainPerson: async () => Contract.check<PersonPlain>()((await m.People.findById(P.ann).orFail()).$toPlain()),
  /* JSON */
  json: async () => Contract.check<PersonJson>()((await m.People.findById(P.ann).orFail()).$toJSON()),
  jsonPopulated: async () => Contract.check<PostJson>()((await twoLevels(m)).$toJSON()),
});

/**
 * The queries object returned by `selectedShapes`.
 *
 * @example
 * type Row = Awaited<ReturnType<SelectedShapes["card"]>>;
 */
export type SelectedShapes = ReturnType<typeof selectedShapes>;
