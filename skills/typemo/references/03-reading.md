# 03 Reading: find, filters, projections, result forms, cursors, contracts

Read this when writing any query that reads documents. Reads never mutate; for writes see 04-writing.md, for the hydrated document see 05-documents.md.

## Minimal working example

```ts
import { Entity, Prop, Schema, TypemoClient, type Hidden } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}

declare const client: TypemoClient;
const Users = client.connection.model(User);

const adults = await Users.find({ age: { $gte: 18 } }).sort({ name: 1 }).limit(20); // HydratedDoc<User>[]
const ann = await Users.findOne({ name: "Ann" }).orFail(); // HydratedDoc<User>, throws if missing
const byId = await Users.findById("6abcddec50864200b93c7fea").plain(); // string ids are cast; plain row or null
const taken = (await Users.exists({ name: "Ann" })) !== null; // { _id } | null
const total = await Users.countDocuments({ age: { $gte: 18 } }); // number
console.log(adults.length, ann.name, byId?.name, taken, total);
```

## Methods on the model

| Call | `await` gives | Notes |
|---|---|---|
| `find(filter?)` | array of rows (empty array, never `null`) | no filter / `{}` = everything (allowed only for reads) |
| `findOne(filter?)` | row or `null` | without `sort` "first" is arbitrary |
| `findById(id)` | row or `null` | `id`: the `_id` type or its string; bad string is `CastError`, `null`/`undefined` is `QueryError: findById: an id is required` |
| `exists(filter)` | `{ _id } \| null` | filter is required; reads only `_id` |
| `countDocuments(filter?)` | `number` | `.limit(n)` / `.skip(n)` allowed ("99+" counters) |
| `estimatedDocumentCount()` | `number` | from metadata; refuses soft-delete, tenant and discriminator models (`StrictModeError ... use countDocuments()`) |
| `distinct(path, filter?)` | distinct values (array fields: distinct elements) | |
| `keysetPage({ sort, limit, after?, filter?, lean? })` | `{ items, nextCursor, hasMore }` | see Keyset |

The query is a builder: immutable (each method returns a new builder), lazy (nothing is sent until `await`, `.then`, `.exec()`, `.cursor()`), and it is a `Promise` of the result. An executed builder caches its result; use `.exec({ force: true })` for fresh data. `for await (const x of query)` on the builder itself throws `QueryError: find(): a query is not iterable with "for await"; iterate its cursor instead: for await (const doc of Model.find(filter).cursor())`.

## Result forms

| Form | How | Type of a row | `_id` | `bigint` / Decimal128 / Date | Methods | Use for |
|---|---|---|---|---|---|---|
| Hydrated | no suffix | `HydratedDoc<User>` (or `HydratedDocWith<User, { extra fields }>` when a Hidden field was selected or a relation populated) | `ObjectId` | `bigint` / `Decimal128` / `Date` | `$save`, `$set`, change tracking | read then modify and `$save` |
| Lean | `.lean()` | plain data, driver values | `ObjectId` | `bigint` / `Decimal128` / `Date`; Maps are plain objects | none | internal computation, max speed; never send to clients (`JSON.stringify` cannot serialize `bigint`) |
| Plain | `.plain()` | JS data for leaving the app | `string` | `` `${bigint}` `` / string / `Date`; `Map` stays `Map` | none | API responses, queues; Hidden fields stripped |

```ts
import { Entity, Prop, Schema, TypemoClient, type Hidden, type Selected } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => BigInt, { required: true }) balance!: bigint;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

const lean = await Accounts.findOne({ owner: "ann" }).lean().orFail();
const leanBalance: bigint = lean.balance;

const plain = await Accounts.findOne({ owner: "ann" }).plain().orFail();
const plainId: string = plain._id;
const plainBalance: `${bigint}` = plain.balance;

// Hidden field: select it with "+", and still opt in to expose it in plain form.
const withPin = await Accounts.findOne({ owner: "ann" }).select({ "+pin": true }).plain({ hidden: true }).orFail();
const pin: string | undefined = withPin.pin;

// Plain row type written by hand; .expect checks it against the real result
type Row = Selected<Account, "owner" | "balance">;
const rows = await Accounts.find().select({ owner: 1, balance: 1 }).plain().expect<Row>();
console.log(leanBalance, plainId, plainBalance, pin, rows.length);
```

- Same shapes from a document: `$toObject()` (driver values), `$toPlain()`, `$toJSON()` (see 05-documents.md).
- `.plain()` options: only `{ hidden: true }`; any other key is `QueryError`. A Hidden field needs both steps: `+field` in `select`, and `{ hidden: true }` in `.plain(...)`.
- `.lean()` returns whatever was read, including a Hidden field you selected with `+`.
- After `.lean()`/`.plain()` there is no `$save`: `lean.$save` is `TS2339`. Read the hydrated document to modify it.
- `Selected<Entity, Fields, Overrides?>` is the plain row; `SelectedLean` is the lean row; `SelectedJson` is the `$toJSON()` row. `"-_id"` removes `_id` from the shape.

## orFail

```ts
import { DocumentNotFoundError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

declare const client: TypemoClient;
const Users = client.connection.model(User);

export const getUser = async (name: string) => {
  try {
    return await Users.findOne({ name }).plain().orFail(); // row, no null check needed
  } catch (error) {
    if (error instanceof DocumentNotFoundError) throw new Error(`${error.model} not found`);
    throw error;
  }
};
```

- Message: `DocumentNotFoundError: User.findOne: no document matched the filter (orFail)`; the filter is intentionally not in the error. On `find` an empty list also throws; on `.cursor()` it does not.
- Without `.orFail()`, `findOne`/`findById` give `| null` and the compiler forces the check.

## Filters

```ts
import { Entity, Prop, Schema, TypemoClient, untrusted } from "@venloc/typemo";

@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true }) price!: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Date) released?: Date;
}

declare const client: TypemoClient;
const Products = client.connection.model(Product);

await Products.find({ price: { $gte: 20, $lt: 300 }, tags: "usb" }); // several keys = AND; array field matches any element
await Products.find({ $or: [{ price: { $lt: 30 } }, { name: { $in: ["Mouse", "Monitor"] } }] });
await Products.find({ released: { $exists: false } }); // absent; { released: null } does not compile (field is not nullable)
await Products.find({ name: { $regex: "^m", $options: "i" } });
await Products.find({ _id: "6abcddec50864200b93c7fea" }); // string form of ObjectId/UUID is accepted
await Products.find().where("price").gte(20).lt(300).where({ tags: "usb" }); // build by parts, results typed

// Filter from outside: never pass the body as a filter. Pick fields yourself or mark it untrusted.
export const search = (text: string | undefined, minPrice: number | undefined) => {
  let query = Products.find().sort({ name: 1 });
  if (text !== undefined) query = query.where({ name: { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } });
  if (minPrice !== undefined) query = query.where({ price: { $gte: minPrice } });
  return query.plain();
};
export const guarded = (body: unknown) => Products.find({ name: untrusted(body, "filter") as string });
```

- Filters are checked twice: by the compiler and at runtime before sending. Values must have the field's type (`"30"` for a number is a compile error and `CastError`).
- Operators exist per type (`$regex` only for strings); misuse is `StrictModeError: $regex applies to strings only (at "price.$regex") [sanitize]`.
- Nested and array paths use dots: `"variants.sku"`; conditions that must hit the same element use `$elemMatch`.
- `{ field: null }` matches both `null` and absent (server semantics); `$exists: false` is absent only.
- `where({ ... })` merges (AND); one key twice in `sort`/`select` is an error (`sort: "age" is sorted twice`, `projection: "name" is selected twice`).
- Empty filters are fine in reads. Writes refuse them: use `Filters.all()` (see 04-writing.md).

## select and projections

```ts
import { Entity, Prop, Schema, TypemoClient, untrusted, type Hidden, type Projection } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}

declare const client: TypemoClient;
const Users = client.connection.model(User);

const a = await Users.find().select({ name: 1, age: 1 }).plain(); // inclusion: row is { _id, name, age? }
const b = await Users.find().select({ tags: 0 }).plain(); // exclusion
const c = await Users.find().select({ name: 1, _id: 0 }).plain(); // without _id
const d = await Users.find().select({ "+passwordHash": true }).lean(); // add a Hidden field to the normal set
const e = await Users.find().select({ name: 1 }).select({ age: 1 }).plain(); // calls accumulate
const f = await Users.find().select({ tags: { $slice: 2 } }).plain(); // array projections: $slice, $elemMatch

const wide: Projection<User> = { name: 1, age: 1 }; // declared dynamic projection: wide, optional-field result type
const g = await Users.find().select(wide).plain();
export const fromClient = (fields: Record<string, 0 | 1>) =>
  Users.find().select(untrusted(fields, "projection")).plain(); // rejects "+hidden" keys from outside
console.log(a, b, c, d, e, f, g, fromClient);
```

- The result type narrows to the selected fields plus `_id`; reading an unselected field is a compile error.
- Inclusion and exclusion cannot be mixed: compile error and `QueryError: projection: cannot mix inclusion (title) and exclusion (body); the server refuses it`.
- `+field` is only for Hidden fields: `StrictModeError: projection: "+name" adds a Hidden field back, and "name" is not Hidden; select it without the "+" [not-hidden]`; unknown name: `projection: "nope" is not a field of User [unknown-path]`.
- A Hidden field read by `+` still does not reach `.plain()` / `$toPlain()` without `{ hidden: true }`.

## sort, limit, skip

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
}

declare const client: TypemoClient;
const Users = client.connection.model(User);

const page = await Users.find().sort({ age: -1, name: 1 }).skip(40).limit(20).plain(); // object or [["age", -1]] pairs
console.log(page.length);
```

- `limit(n)`: positive integer; `limit(0)` is `QueryError: limit must be a positive integer, got 0 (number)`. `skip(n)`: integer >= 0. Both and `cursor()` exist only on `find` (`findOne().skip(1)` is `TS2345`: `skip() applies to find()`).
- Always sort when you page: without `sort` the order is not defined. Large offsets are slow: use keyset pagination.

## Keyset pagination

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "posts" })
class Post extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) views!: number;
}

declare const client: TypemoClient;
const Posts = client.connection.model(Post);

const first = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 20 });
const second = await Posts.keysetPage({ sort: [["views", "desc"]], limit: 20, after: first.nextCursor });
console.log(first.items.length, first.hasMore, second.nextCursor); // nextCursor is null on the last page
```

- `_id` is appended as the last sort key automatically. Sort keys must be required, non-nullable fields (optional/nullable is a compile error). `after` must come from the same sort; a foreign token is `KeysetTokenError`.
- `filter` applies to every page (a token grants no access beyond it). Option `lean: true` returns lean rows.
- Signing tokens: client option `keysetSecret` (see 01-setup.md).

## Cursors for large results

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);

for await (const order of Orders.find().sort({ number: 1 }).plain().cursor()) {
  if (order.number > 100) break; // leaving the loop closes the cursor; next() afterwards is QueryError
}

const cursor = Orders.find().plain().cursor(); // QueryCursor<row>: next(), toArray(), map(), eachAsync(), close()
const first = await cursor.next(); // row or null
await cursor.close();
console.log(first);
```

## Contracts: expect, parse, Selected

- `.expect<Shape>()` (lean/plain only, free at runtime): exact match of the row to `Shape` at compile time. Reports `missing`, `extra`, `mismatch`; an extra field is always an error.
- `.parse(standardSchema)` (lean/plain only): validates each row at runtime (Zod/Valibot/any Standard Schema), result is the schema output; failure is one `ValidationError` for the query (`Validation failed: "1.name": row 1: name is too short [schema]`).
- `Contract.check<Shape>()(value)`: the same exact check for any value (for example `$toJSON()` against `SelectedJson<...>`).
- On a hydrated query `.expect`/`.parse` do not compile (`QueryError: parse() validates rows: call .lean() or .plain() before .parse(schema)`).

## mask and textScore

```ts
import { Entity, Index, Mask, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Index({ title: "text", body: "text" })
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => String) title?: string;
  @Prop(() => String) body?: string;
}

declare const client: TypemoClient;
const Customers = client.connection.model(Customer);

const masked = await Customers.find().plain().mask({ email: Mask.email(), name: (value) => `${value[0]}...` });
const found = await Customers.find({ $text: { $search: "typed queries" } }).textScore("score", { sort: true }).limit(5).plain();
console.log(masked[0]?.email, found[0]?.score); // score: number
```

- `.mask({ path: preset | "mask" | fn })` is the last step, lean/plain only (a hydrated document with masked values could be saved). A path that is not in the rows is `StrictModeError: mask: "emial" is not a path of Customer's rows, so it would mask nothing ...`. `null`/`undefined` become `"?"`. Array paths walk elements (`"cards.number"`), Map values use `"notes.$*"`.
- `.textScore(name = "score", { sort? })` needs `$text` in the filter and a text index (`ServerError: query requires text score metadata ...` otherwise). The score only sorts from best (`-1`).

## Other builder options

`.session(s)`, `.policy({ ... })`, `.hint`, `.collation`, `.comment`, `.timeoutMS`, `.batchSize` (find), `.readPreference`, `.readConcern`, `.allowDiskUse` (find), `.explain()`, `.populate(...)` (see the populate reference). `validateReads` is a client option that checks documents against the schema on read.

## Common mistakes

Bad: `Products.find({ nope: 1 })` (TS2345) or from untyped input.
```text
StrictModeError: filter: "nope" is not a field of Product [unknown-path]
```
Good: use real field names; the server would silently return `[]`.

Bad: `Products.find({ price: "30" })` (TS2322).
```text
CastError: Cast to number failed at path "price" for "30" (string): expected a number [type]
```
Good: convert the value first.

Bad: `Products.find({ price: params.minPrice })` where it may be `undefined` (TS2379).
```text
QueryError: filter: undefined at "price" (use $exists: false / $unset; undefined is never a value)
```
Good: add the condition only when the value exists (`query.where(...)`).

Bad: `Users.findById("abc")`.
```text
CastError: Cast to ObjectId failed at path "_id" for "abc" (string): not a 24-character hex string [format]
```
Good: catch `CastError` at the boundary and answer 400.

Bad: `Users.find().select({ name: 1, tags: 0 })` (TS2345). Good: pick one form.

Bad: returning `.lean()` rows to an API client (`bigint`/`ObjectId`). Good: `.plain()`.

Bad: `lean.$save()` (TS2339). Good: read the hydrated document, or use an update method (04-writing.md).

Bad: spreading client JSON into a filter or projection. Good: build it yourself, or wrap with `untrusted(value, "filter" | "projection")`.

## Self-check

- `findOne`/`findById` results are checked for `null` or end with `.orFail()`.
- Lists have `sort` plus `limit`; long lists use `keysetPage` or `.cursor()`.
- Anything leaving the app is `.plain()` (or `$toJSON()`), never lean or a document; Hidden fields are exposed only with `{ hidden: true }`.
- Filters come from typed code, not from request bodies; ids from URLs go straight into `findById` and `CastError` is handled.
- Projections do not mix inclusion and exclusion; `+field` only for Hidden fields.
