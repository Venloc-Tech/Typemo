# Populate: references between collections

Read this before declaring a reference (`Ref<T>`), loading related documents (`.populate`, `$populate`) or typing a function that receives a document with loaded references. MongoDB has no joins: a post stores `author` as an `_id`; `populate` reads the related documents after the main query and puts them in place of the ids. Typemo also changes the **type** of the result: the compiler knows `author` is now a user (or `null`), not an id.

## Minimal working example

```ts
import { Entity, Prop, Schema, Types, type Ref, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  // `ref` is a function returning the class; `Ref<User>` must agree with it
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}

declare const client: TypemoClient;
const Users = client.connection.model(User); // every referenced model must be obtained on the same connection
const Posts = client.connection.model(Post);

const post = await Posts.findOne({ title: "Hello" }).populate("author").orFail().plain();
console.log(post.author?.name); // `?.`: the author may have been deleted, then the field is null
```

Rules in one place:

- A reference field = `@Prop(() => Types.ObjectId, { ref: () => Model })` + the type `Ref<Model>`. The pair is checked by the compiler.
- A reference array = `@Prop(() => [Types.ObjectId], { ref: () => Tag }) tags!: Ref<Tag>[]`.
- A reference to a model with its own `_id` type: `Ref<Country, string>` with `@Prop(() => String, { ref: () => Country })` (see "References to EntityWithId").
- Only `ref`, `refPath` (field holding the model name) or `refModel` (function) per field; two at once is a `ConfigurationError`.
- Writing a reference accepts an `ObjectId`, its 24-hex string, or a document (it becomes its `_id`). Existence is NOT checked (no foreign keys).
- One path = one extra query to the target model, however many documents were read (ids go into one `$in`). Populate reads the target as a normal read: its policies (tenant, soft delete, Hidden) apply.

## Query populate: all forms

```ts
import { Entity, Prop, Schema, Types, Virtual, type Ref, type TypemoClient, type VirtualRef } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String) email?: string;
}
@Schema({ collection: "tags" })
class Tag extends Entity {
  @Prop(() => String, { required: true }) label!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
  @Prop(() => [Types.ObjectId], { ref: () => Tag }) tags!: Ref<Tag>[];
  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post" }) comments?: VirtualRef<Comment>;
}
@Schema({ collection: "comments" })
class Comment extends Entity {
  @Prop(() => String, { required: true }) text!: string;
  @Prop(() => Types.ObjectId, { ref: () => Post, required: true }) post!: Ref<Post>;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}

declare const client: TypemoClient;
const Posts = client.connection.model(Post);
const Comments = client.connection.model(Comment);

// path string, list (mix of strings and objects), object with options
const a = await Posts.find().populate("author").plain();
const b = await Posts.find().populate(["author", { path: "tags", select: { label: 1 } }]).plain();
const c = await Posts.find().populate({ path: "author", select: { name: 1 } }).plain();

// nested: dotted path or the `populate` option (use the option when the inner step needs its own options)
const d = await Comments.find().populate("post.author").plain();
const e = await Comments.find()
  .populate({ path: "post", populate: { path: "author", select: { name: 1 } } })
  .plain();

// virtual (inverse side): always an array after populate (empty when nothing found)
const f = await Posts.find().populate("comments").plain();
console.log(a.length, b.length, c.length, d.length, e.length, f[0]?.comments.length);
```

Result shape: a single reference becomes the document or `null` (deleted / hidden by soft delete / filtered by `match`); in an array the missing element disappears, the others keep their order; a map value without a document stays in the map as `null`; a field absent from the document stays absent. `.plain()` and `.lean()` give plain objects (`_id` is a string in plain, an `ObjectId` in lean); without them you get hydrated documents.

Populate also works on `findById`, cursors and `findOneAndUpdate`. Aggregations have no `.populate`: use `$lookup` there.

## Options of the object form

| Option | Meaning |
|---|---|
| `path` | required; dotted path; `reviewers.$*` for values of a `Map` of refs |
| `select` | projection of the target: `{ name: 1 }` or `{ email: 0 }`; no mixing; `_id` stays unless `_id: 0`; the result type narrows with it |
| `match` | filter of the target (typed by the target); a function `(doc) => filter` runs one query per source document |
| `options` | `{ sort, limit, skip }`, reference arrays and virtuals only; `limit`/`skip` apply **per source document** |
| `perDocumentLimit` | same as `options.limit` (give only one of the two) |
| `populate` | nested populate for the loaded documents (string, object or list) |
| `justOne` | force one document / a list; not for map values and counts |
| `retainNullValues` | array of refs: keep `null` in the position of a missing document; cannot combine with `sort`; not for virtuals |
| `required` | a dangling reference throws `DocumentNotFoundError` and `null` disappears from the type |
| `clone` | give each owner its own copy (by default one shared object per target id) |
| `transform` | `(doc, id) => value` replaces each loaded value; the field type follows |

```ts
import { Entity, Prop, Schema, Types, Virtual, type Ref, type TypemoClient, type VirtualRef } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
  @Virtual({ ref: () => Comment, localField: "_id", foreignField: "post" }) comments?: VirtualRef<Comment>;
}
@Schema({ collection: "comments" })
class Comment extends Entity {
  @Prop(() => String, { required: true }) text!: string;
  @Prop(() => Types.ObjectId, { ref: () => Post, required: true }) post!: Ref<Post>;
}

declare const client: TypemoClient;
const Posts = client.connection.model(Post);

// at most 2 comments per post, newest text first
const posts = await Posts.find()
  .populate({ path: "comments", options: { sort: { text: -1 }, limit: 2 } })
  .plain();

// `required: true`: no `| null`, a dangling author throws DocumentNotFoundError
const strict = await Posts.findOne({ title: "Hello" })
  .populate({ path: "author", required: true })
  .orFail()
  .plain();
console.log(posts.length, strict.author.name);

// only the author's name as a string
const names = await Posts.find()
  .populate({ path: "author", transform: (user, id) => user?.name ?? String(id) })
  .plain();
console.log(names.map((p) => p.author));
```

Calling `.populate` twice for the same path **replaces** the earlier call (last wins). The same path twice inside one list is an error. Unknown paths and unknown options are errors, never silently skipped.

## A virtual with a count

Declare `@Virtual({ ref: () => Comment, localField: "_id", foreignField: "post", count: true }) commentCount?: VirtualRef<Comment, false, true>;` and `.populate("commentCount")`: the database counts instead of loading and the field is a number. `select` and `justOne` are forbidden on it.

## Refs inside embedded data, maps, polymorphic refs

- Through an array of subdocuments or a nested object: a plain dotted path, `attachments.uploader`. One query for all elements.
- Values of a `Map` of references: `reviewers.$*`. A bare `reviewers` is an error (`"reviewers" is a Map: its values are "reviewers.$*"`). Values without a document stay as `null`; the loaded map is read-only (`get` works, `set` does not compile).
- `refPath` (the model name lives in a sibling field) and `refModel` (a function) give a union type after populate; narrow it before reading fields. Nothing below a polymorphic reference can be populated (`populate "target.author": "target" is a polymorphic reference (refPath/refModel); nothing below it can be populated`).
- Chains through virtuals: `populate("posts.comments.author")`; each step is one more query. If the chain is long or computes something, use an aggregation with `$lookup`.

## References to EntityWithId

```ts
import { EntityWithId, Entity, Prop, Schema, Types, type Ref, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "countries" })
class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "cities" })
class City extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  // the first argument of @Prop is the _id type of the target, Ref gets it as the second argument
  @Prop(() => String, { ref: () => Country }) country?: Ref<Country, string>;
}
@Schema({ collection: "sessions" })
class Session extends EntityWithId(() => Types.UUID) {
  @Prop(() => String, { required: true }) user!: string;
}
@Schema({ collection: "logs" })
class Log extends Entity {
  @Prop(() => [Types.UUID], { ref: () => Session }) sessions!: Ref<Session, Types.UUID>[];
}

declare const client: TypemoClient;
const Cities = client.connection.model(City);
const paris = await Cities.findOne({ name: "Paris" }).populate("country").orFail().plain();
console.log(paris.country?.name, typeof Log);
```

`populate` finds the target by the stored string/number/UUID exactly like by an `ObjectId`.

## Populate on a loaded document

Only hydrated documents have the methods (not `.lean()` / `.plain()` results). Prefer `.populate` in the query; use `$populate` when the document already exists and the relation is needed on one branch.

```ts
import { Entity, Prop, Schema, Types, type Ref, type TypemoClient } from "@venloc/typemo";
import { ObjectId } from "mongodb";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}

declare const client: TypemoClient;
const Posts = client.connection.model(Post);

const post = await Posts.findOne({ title: "Hello" }).orFail();
const loaded = await post.$populate({ path: "author", select: { name: 1 } }); // same object, new TYPE: use `loaded`
console.log(loaded.author?.name);
console.log(post.$populated("author") instanceof ObjectId); // original id; `undefined` when not loaded; returns unknown
const back = post.$depopulate("author"); // ids again (no argument = all paths); the type goes back to Ref<User>
console.log(back.author instanceof ObjectId);
```

- `$populate` accepts the same argument as `.populate` (path, object, list). Repeating a loaded path re-reads it and replaces the previous value (including its `select`). A path **below** an already loaded one is a compile error (`"author" is populated already: $depopulate("author") first`): use the `populate` option or `$depopulate` first.
- `$save` writes ids, never nested copies; `$getChanges()` does not count the loading as a change.
- Assigning to a **loaded** field `post.author = bob` accepts a document; a field typed `Ref<User>` does not accept a document by direct assignment, use `post.$set("author", doc)` (document or id; lean documents too).
- `$toPlain()` / `$toJSON()` serialise loaded documents as plain objects too; load with `select` so the client gets only what it should see.
- Do not call `$populate` in a loop over a list: one query per document. Load in the query.

## Typing: HydratedDocWith, AnyPopulationDoc, isPopulated, isPresent

A document with loaded paths is `HydratedDocWith<Post, { author: HydratedDoc<User> | null }>` (what the IDE shows). It is NOT assignable to a parameter typed `HydratedDoc<Post>` (and the other way round: a bare post is not assignable to a loaded one).

```ts
import {
  type AnyPopulationDoc, Entity, Prop, Schema, Types, type HydratedDoc, type Ref, type TypemoClient,
  isPopulated, isPresent,
} from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}

declare const client: TypemoClient;
const Posts = client.connection.model(Post);

// 1. The function needs the loaded shape: derive the type from the loader (cannot drift from the query)
const loadPost = (title: string) => Posts.findOne({ title }).populate("author").orFail();
type LoadedPost = Awaited<ReturnType<typeof loadPost>>;
export const subject = (post: LoadedPost) => `${post.title} by ${isPresent(post.author) ? post.author.name : "anon"}`;

// 2. The function accepts a post in ANY state: AnyPopulationDoc + isPopulated (checks the real state at runtime)
export const footer = (post: AnyPopulationDoc<Post>): string =>
  isPopulated(post, "author") ? `by ${post.author?.name ?? "anon"}` : "";

// 3. Another code may have loaded it: require it and get the narrowed type (returns the SAME document)
export const signature = async (post: HydratedDoc<Post>) => {
  await post.$populate("author");
  return post.$assertPopulated("author").author?.name; // throws QueryError if it is not loaded; use the RETURN value
};

console.log(subject(await loadPost("Hello")), footer(await loadPost("Hello")), typeof signature);
```

- `isPopulated(doc, path)` takes only a parameter typed `AnyPopulationDoc<T>`; for a plain `HydratedDoc<T>` the path is `never` (compile error).
- `$assertPopulated` also takes a list or `{ path, select, populate }`; an empty result and a dangling single ref (`null`) count as loaded. It does not remove `null`.
- `isPresent(x)` removes `null | undefined` for any form; pass it to `.filter(isPresent)` on arrays loaded with `retainNullValues`.
- To drop `null` from the type because a missing reference is a data error, use the populate option `required: true`. The `required` of `@Prop` does NOT change the loaded type (it only demands the id in the post).
- `AnyPopulationDoc` does not accept documents loaded with a `select` that removed required fields, with `transform`, or with `justOne` over an array; type those parameters with the query result type (option 1).

## Common mistakes

Bad (forgotten populate, or the variable of the old type):

```ts
// @errors: 2339
import { Entity, Prop, Schema, Types, type Ref, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}
declare const client: TypemoClient;
const Posts = client.connection.model(Post);

const post = await Posts.findOne({}).orFail().plain();
console.log(post.author.name);
```

`Property 'name' does not exist on type 'string'` (a plain id is a string). Good: `.populate("author")` in the query, or use the value returned by `$populate` / `$assertPopulated` (the type of the original variable does not change: `Property 'name' does not exist on type 'Ref<User>'`).

Bad (the loaded single ref is possibly null):

```ts
// @errors: 18047
import { Entity, Prop, Schema, Types, type Ref, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => Types.ObjectId, { ref: () => User, required: true }) author!: Ref<User>;
}
declare const client: TypemoClient;
const Posts = client.connection.model(Post);

const post = await Posts.findOne({}).populate("author").orFail().plain();
console.log(post.author.name);
```

`TS18047: 'post.author' is possibly 'null'`. Good: `post.author?.name`, `isPresent(post.author)`, or `{ path: "author", required: true }`.

Bad (path is not a reference):

```ts
// @errors: 2345
import { Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}
declare const client: TypemoClient;
const Posts = client.connection.model(Post);

Posts.find().populate("title");
```

`TS2345 ... "Invalid populate path \"title\": \"title\" is not a reference"`; at runtime (a path built from data) `QueryError: populate "title": "title" is neither a reference nor an embedded document`. Good: use a field with `ref` or a virtual. Other runtime texts: `populate "nope": "nope" is not a field of Post`, `populate: the path "author" is given twice`, `populate "author": unknown option "foo"`, `populate "author": a single reference holds one document; options sort apply to reference arrays only`, `populate "tags": retainNullValues keeps positions, sort reorders: they cannot be combined`, `populate "comments": "options.limit" and "perDocumentLimit" are the same per-document limit; give one`.

Bad: bare `Posts.find().populate("reviewers")` for a `Map` of refs. Good: `populate("reviewers.$*")`.
Bad: filtering main documents by a related field with populate (it runs after the read), or computing sums over related documents. Good: aggregation with `$lookup` (file 07). Bad: populate only to check existence; use `exists`. Bad: mutating a shared populated document and being surprised another owner changed: default is one shared object per target id; use `clone: true`.

## Self-check

- Every reference field has `ref: () => Model` AND the type `Ref<Model>` (or `Ref<Model, IdType>`), and the target model is obtained on the same connection.
- Every use of a populated single reference handles `null` (`?.`, `isPresent`) or the populate has `required: true`.
- Functions that take documents with loaded relations are typed from the loader (`Awaited<ReturnType<...>>`) or as `AnyPopulationDoc<T>` + `isPopulated`, never as `HydratedDoc<T>`.
- `limit`/`skip` are understood as per source document; `sort`/`limit` are used on arrays and virtuals only.
- Lists and chains use populate in the query, not `$populate` in a loop; heavy computation over relations uses `$lookup`.
