# Gotchas: Bad -> Good with the exact error texts

Things that surprise people (and agents) coming from Mongoose or from loose TypeScript. Each item: what you wrote, what Typemo says, what to write. Error texts are copied from real runs; `[code]` at the end is the reason code.

Every example below assumes a client and an entity; where a block needs them, they are declared in the block.

## Filters and reads

### 1. Empty filter on a write

Bad: `updateOne({})`, `deleteMany({})`, a filter built from optional parts that came out empty.

```text
StrictModeError: deleteMany with an empty filter would affect every document; pass a filter, or Filters.all() to mean every document on purpose [empty-filter]
```

An empty literal `{}` does not even compile (TS2345, TS2769 for updates). Also applies to `findOneAndUpdate`, `findOneAndReplace`, `deleteOne`, `updateMany`, and `deleteMany` inside `bulkWrite`.

```ts
import { Entity, Filters, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
}
declare const client: TypemoClient;
declare const owner: string | undefined;
const Accounts = client.connection.model(Account);

if (owner !== undefined) await Accounts.deleteMany({ owner }); // check before the call
await Accounts.deleteMany(Filters.all()); // "everything" on purpose, visible in review
```

### 2. `undefined` is never a value

Bad: `Accounts.deleteMany({ owner })` with `owner` possibly `undefined`; `create({ nickname: maybe })`.

```text
QueryError: filter: undefined at "owner" (use $exists: false / $unset; undefined is never a value)
QueryError: update: undefined at "$set.nickname" (use $exists: false / $unset; undefined is never a value)
```

Good: build the object without the key: `...(maybe === undefined ? {} : { nickname: maybe })`; to clear a field use `$unset` (optional field) or `$set: { field: null }` (nullable field).

### 3. A string where a number is expected is a CastError (no silent cast)

Bad: `Posts.create({ views: "42" })`, `find({ price: "30" })`, a query-string value passed on as is.

```text
CastError: Cast to number failed at path "price" for "30" (string): expected a number [type]
```

Good: parse at the application boundary (`Number(req.query.price)` after checking it) and pass a number. The same applies to ids: `Cast to ObjectId failed at path "_id" for "abc" (string): not a 24-character hex string [format]`; use `new Types.ObjectId(hex)` or pass a valid hex string. `Long` fields take `bigint` or a decimal-integer string, not a fractional or unsafe number.

### 4. A typo in a field name is an error, not "zero results"

```text
StrictModeError: filter: "nope" is not a field of Account [unknown-path]
StrictModeError: $set: "nope" is not a field of Account [unknown-path]
StrictModeError: sort: "nope" is not a field of Post [unknown-path]
StrictModeError: projection: "nope" is not a field of User [unknown-path]
CastError: Cast to Post failed at path "pubished" for true (boolean): not a field of Post [unknown-key]
```

Good: fix the name. There is no way to turn this off (no `strict: false`); fields stored by other apps are described in the class or kept untouched (guide "unknown fields").

### 5. `{ field: null }` on a non-nullable field

```text
CastError: Cast to Date failed at path "released" for null: null is not a value of this path (it is not nullable); an absent field is { $exists: false } [null]
```

Good: for "field is absent" write `{ released: { $exists: false } }`. `null` is only a value on `nullable: true` fields; on those, `{ nickname: null }` also matches documents where the field is absent, add `$exists: true` to match real nulls only.

### 6. Required + nullable is not "optional"

Bad: `@Prop(() => String, { required: true, nullable: true }) phone!: string | null` and `create({})`.

```text
ValidationError: Validation failed: "phone": the field is required [required]
```

`required` means the key must be present; `nullable` only allows the value `null`. Good: pass `phone: null` explicitly, or drop `required` if the field may be absent.

### 7. Array fields default to `[]`; `required` is how you demand them

A document created without `tags` gets `tags: []` and no error. Good: declare `required: true` if the caller must supply it; add `validate` for "non-empty". A string instead of an array is a CastError (`tags: "gift"`), wrap it yourself: `["gift"]`.

### 8. `for await` over a query, `batchSize(0)`, a reused cursor

```text
QueryError: find(): a query is not iterable with "for await"; iterate its cursor instead: for await (const doc of Model.find(filter).cursor())
QueryError: batchSize must be a positive integer, got 0 (number) (the driver reads 0 as "the server default"; leave batchSize out for the default)
QueryError: the cursor is closed (close() or a left for-await); open a new one
```

```ts
import { Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Number, { required: true }) number!: number;
}
declare const client: TypemoClient;
const Orders = client.connection.model(Order);

for await (const order of Orders.find().sort({ number: 1 }).plain().cursor()) {
  console.log(order.number); // always sort an export explicitly
}
```

### 9. A write builder runs once

```text
QueryError: updateOne: this operation was already executed; build a new one, or run it again deliberately with exec({ force: true }) (a write runs once per builder)
```

Bad: `const q = Accounts.updateOne(...); await q; await q;`. Good: build it again, or `q.exec({ force: true })` when repeating is intended. Reads are lenient: a second `await` of a read returns the same result without a new request.

### 10. `findOneAndUpdate` returns the document AFTER the change

Mongoose returned the old one. Good: `{ returnDocument: "before" }` when you need the old value. There is no `new`/`returnOriginal` option.

### 11. Projection mixes inclusion and exclusion; strings instead of objects

```text
QueryError: projection: cannot mix inclusion (title) and exclusion (body); the server refuses it
```

Good: `select({ title: 1 })` or `select({ body: 0 })`, never both. `select("a -b")` and `sort("-age")` do not exist: use objects.

## Types and documents

### 12. `this: HydratedDoc<T>` in a document hook

Document hooks also run on subdocuments of the class, which have no `$save` or `$getChanges`.

```text
@Pre("document.save"): a document hook may also run on a subdocument of the class; declare this as HydratedDoc<Entity> | Subdocument<Entity>, or narrow with if (this.$isRoot())
```

```ts
import { Entity, type HookThis, Pre, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;

  @Pre("document.save")
  stamp(this: HookThis<"document.save", Account>): void {
    if (this.$isNew()) this.title = this.title.trim();
    if (this.$isRoot()) this.$getChanges(); // root-only methods after narrowing
  }
}
```

`this: Account` compiles but has no `$isNew` (`TS2339`). Document hooks do not fire for `updateOne`/`deleteOne` (those are `query.*` events); load the document and call `$save`/`$updateOne`/`$deleteOne`. A change made in `@Post("document.save")` is not written.

### 13. Hidden fields are not on the document type unless selected

```ts
// @errors: 2339
import { Entity, type Hidden, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
declare const client: TypemoClient;
const Users = client.connection.model(User);

const user = await Users.findOne({ name: "x" }).orFail();
user.passwordHash; // Property 'passwordHash' does not exist on type 'HydratedDoc<User>'
const withHash = await Users.findOne({ name: "x" }).select({ "+passwordHash": true }).orFail();
const hash: string | undefined = withHash.passwordHash; // opted in explicitly
```

`hidden: true` and `Hidden<T>` must come as a pair (the decorator fails to compile otherwise, TS1240). `.plain()` / `$toPlain()` leave hidden fields out even when loaded, unless `{ hidden: true }` is passed. `"+name"` on a field that is not hidden: `StrictModeError: projection: "+name" adds a Hidden field back, and "name" is not Hidden; select it without the "+" [not-hidden]`.

### 14. A populated single reference may be `null`

```ts
// @errors: 18047
import { Entity, Prop, Schema, type Ref, type TypemoClient, Types } from "@venloc/typemo";

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

const post = await Posts.findOne({}).populate("author").orFail();
console.log(post.author.name); // 'post.author' is possibly 'null' (the user may have been deleted)
```

Good: `post.author?.name`, or `populate({ path: "author", required: true })` to make a missing target an error (`DocumentNotFoundError: populate "editor": no document for the reference ... (required: true)`). `$assertPopulated` narrows its RETURN value, not the variable: `const loaded = post.$assertPopulated("author")`.

### 15. Array and subdocument assignment around the methods

`tags[0] = "x"` and `tags.length = 0` do not compile on a hydrated document. If types are bypassed, `$save` throws:

```text
DirectWriteError: "tags" was changed around its methods: position 0 was assigned directly (use set(0, value))
DirectWriteError: "address" was changed around its methods: the field was replaced by assignment; use $set("address", value) or the container's methods
```

Good: `tags.push(...)`, `tags.set(0, v)`, `tags.splice(...)`, `tags.clear()`, `tags.replace([...])`; `lines.pull(sub)` for subdocuments. A partially loaded array (projection) refuses whole-array writes: `PartialArrayError: "tags" was loaded partially (projection); a $set of the whole array would overwrite the elements that were not loaded`.

### 16. Saving would drop stored fields the schema does not know

```text
UnknownFieldsError: the save would drop fields the schema does not know from stored data: "lines.1" (oldPrice); migrate the data or the schema, or pass { dropUnknownFields: true } to $save()/bulkSave() to accept the loss
```

Good: describe the fields, migrate the data, or pass the option knowingly. Never add it to silence the error.

### 17. Stale version

```text
VersionError: Ledger: no document at version 0 (it was changed or deleted since it was read); modified: balance
QueryError: Order: this save needs the version "__v", but the document was read without it (a projection left it out); select it, or read the document again — the check is never skipped silently
```

Good: re-read and redo the change (or use an atomic `$inc`); do not project away `__v` on documents you will `$save` under `optimisticConcurrency`.

## Writes

### 18. A replacement and immutable fields, `_id`, operators

```text
StrictModeError: a replacement of Account changes the immutable field "region"; the document was not replaced. Carry the stored value [immutable]
StrictModeError: a replacement of Pinned without the immutable field "code" would drop it from the stored document; the document was not replaced. Include the stored value, or update the other fields with $set [immutable]
StrictModeError: a replacement of Account carries "_id": a replacement keeps the stored _id and cannot change it; leave "_id" out and select the document by _id in the filter [immutable]
QueryError: replacement: "$set" — a replacement has no operators
```

Good: carry every immutable field with its stored value, never pass `_id` or `createdAt`/`__v`, and use `updateOne` with `$set` when you only change some fields (a replacement writes exactly what you pass; other fields vanish). The same family: `StrictModeError: $set.email: "email" is immutable; it is written only when the document is created ($setOnInsert on upsert) [immutable]`.

### 19. One path under two operators; empty update; non-operator keys

```text
QueryError: update: "balance" is changed by $inc and $set (server code 40)
QueryError: update: an empty update changes nothing
QueryError: update: "note" is not an update operator (write { $set: { … } })
```

Good: one operator per path; check for emptiness before calling; always `{ $set: { ... } }`. The positional `$` needs a condition on the array in the filter (`QueryError: $set: "lines.$.qty" uses the positional $ of the array "lines", but the filter has no condition on "lines"; ...`); use `$[]` or `$[id]` with `arrayFilters` otherwise.

### 20. `$inc` with `min`/`max`, upsert, `bulkWrite`

```text
ValidationError: Validation failed: "balance": $inc -100 on 12 gives -88, below the minimum 0; nothing was written [min]
ValidationError: Validation failed: "balance": $inc on a field with min/max cannot be guarded in bulkWrite (...); use updateOne/updateMany [min]
```

Good: guarded `$inc` goes through `updateOne`/`updateMany` (not `bulkWrite`, not upsert).

### 21. `unique` on an optional field

```text
ConfigurationError: Account.passport: "unique" on a field that is not required — every document without it is indexed as null and the second one fails (E11000); add required: true, sparse: true or use a partial @Index
```

`unique` on a `nullable` field is refused too (use a partial `@Index`). Duplicates surface as `DuplicateKeyError: duplicate key on email_1: { email: "..." } (code 11000 DuplicateKey)`.

### 22. `bulkWrite` / `insertMany` report every failure

```text
BulkWriteError: Account.insertMany: 1 write(s) failed (first at index 1: duplicate key on title_1 (code 11000 DuplicateKey))
```

A list is validated and hooked per operation; after an error part of the batch may be written. Inspect the error, do not assume all-or-nothing outside a transaction.

## Policies and security

### 23. No tenant in scope, or a query built outside the scope

```text
StrictModeError: Order.find: Order is scoped by tenant ("tenantId") and the operation has no tenant; run it inside PolicyContext.run({ tenant }, …) or add .policy({ tenant }) to the query (cross-tenant work: .policy({ allTenants: true })) [tenant]
ConfigurationError: Order: the tenant field "tenantId" must be marked @Tenant() (declare it @Prop(...) @Tenant() tenantId!: TenantField<T>)
ConfigurationError: NoOpt: @Tenant() on "tenantId", but the schema has no tenant policy — add tenant: true (or { field }) to @Schema
```

```ts
import { Entity, PolicyContext, Prop, Schema, Tenant, type TenantField, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}
declare const client: TypemoClient;
const Orders = client.connection.model(Order);

// the scope is taken when the query is BUILT, so build it inside
await PolicyContext.run({ tenant: "acme" }, async () => Orders.find().plain());
```

Also: `estimatedDocumentCount` is refused on tenant-scoped and soft-delete models (use `countDocuments`); `$set` of the tenant field is refused; an empty tenant (`""`, `null`) is refused.

### 24. Client data in a filter, update or projection

`untrusted` checks keys only (operators, `+path`); it is not value validation. Wrap EVERY piece of client data, then validate type, shape and range yourself.

```ts
import { Entity, Prop, Schema, type TypemoClient, untrusted } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
declare const client: TypemoClient;
declare const body: { name: string; fields: { readonly name?: 1 } };
const Users = client.connection.model(User);

await Users.find({ name: untrusted(body.name) }).plain();
await Users.find().select(untrusted(body.fields, "projection")).plain();
```

```text
StrictModeError: untrusted value: "$ne" at "title.$ne" — an operator inside data from outside (query selector injection); validate the input and build the filter yourself [sanitize]
StrictModeError: untrusted value: "+passwordHash" at "+passwordHash" — a "+path" key inside data from outside would select a Hidden field; ... [sanitize]
```

### 25. Extensions and plugins are sealed by the first model

```text
ConfigurationError: extension "late": extensions are fixed once a schema is compiled (Account was); call client.use() before the first model
ConfigurationError: plugin "late": the global plugins are fixed once a schema is compiled (Account was); register plugins before the first model
```

Good: register extensions and plugins (`client.use`, `Typemo.use`, `Typemo.plugin`, `connection` plugins) before the first `connection.model(...)`.

## Transactions and aggregation

### 26. A document loaded OUTSIDE `client.transaction` and changed inside

The function is retried on transient errors; the object keeps the value from the first attempt, so `balance - 10` applies twice (80 instead of 90).

```ts
import { Entity, type Defaulted, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
}
declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

// Good: read inside, or better an atomic $inc
await client.transaction(async () => {
  await Accounts.updateOne({ title: "Main" }, { $inc: { balance: -10 } });
});
```

Also: transactions need a replica set (`ConfigurationError: TypemoClient "default": transaction(): transactions need a replica set or a sharded cluster; this server is a standalone mongod. ...`); they do not nest (`ConfigurationError: transaction(): transactions do not nest (already inside a transaction of this client)`); operations of a model of ANOTHER client inside throw `ConfigurationError: Account.countDocuments: called inside a transaction of another client; ... pass session(null) ...`; do not set `readConcern`, `readPreference` or `timeoutMS` on operations inside (`StrictModeError: Order.find: readConcern "majority" inside a transaction — the transaction's own settings apply (set them on transaction()) [transaction-option]`); await operations on one session one after another (`the session is in use by ...`).

### 27. `$merge` with `fn.add` doubles totals on a re-run

`merge` does not know which rows were already counted; a recompute of ALL source rows added onto the stored value gives 240 instead of 120 and no error.

```ts
import { Entity, EntityWithId, fn, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) status!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) placedAt!: Date;
}
@Schema({ collection: "monthly_revenue" })
class MonthlyRevenue extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) revenue!: number;
}
declare const client: TypemoClient;
const Orders = client.connection.model(Order);

// full recompute -> replace, not add
const recompute = Orders.aggregate((p) =>
  p
    .match({ status: "paid" })
    .group((f) => ({ _id: fn.dateToString({ date: f.placedAt, format: "%Y-%m" }), revenue: fn.sum(f.total) }))
    .merge({ into: MonthlyRevenue, whenMatched: "replace" }),
);
```

Use `fn.add` in `whenMatched` only when the pipeline feeds ONLY new rows. After `out`/`merge` the pipeline has ended and returns `[]`; the target needs the same `_id` type (`EntityWithId`). Plans: `Orders.aggregate(Pipeline.from(Order)...)` for the model's collection, `connection.aggregate`/`client.aggregate` for database-level plans (`ConfigurationError: client.aggregate: the plan reads the collection "orders"; run it with the model's aggregate()`).

### 28. `init()` / `syncIndexes()` and existing indexes or collections

```text
SyncError: connection.init() of "app": 1 failure(s) — collection "accounts": Account: 1 index operation(s) failed: create title_1: index "title_1" exists on the server with other keys or options; init() never drops or changes an index — run syncIndexes()/s...
CollectionOptionsError: collection "ledger": exists with options MongoDB cannot change (capped): drop the collection and create it again
```

Good: fix the collection or the schema (`init()` never drops or changes anything; `syncIndexes()` is the deliberate tool). Nothing is created implicitly: call `await connection.init()` once at startup. A capped/timeseries model on a missing collection throws on first write until it is created.

### 29. Keyset pagination needs required, non-nullable sort fields and a signed token

```text
ConfigurationError: keysetPage: sort "rating" of Post must be required and not nullable (a missing value cannot be a position)
KeysetTokenError: keysetPage: invalid cursor — it is not signed (the client signs its tokens: keysetSecret)
```

Good: sort by required fields (end with `_id`); set `keysetSecret` (at least 32 bytes) on the client when tokens travel through clients.

## Self-check

- Did you guard every write filter (no `{}`, no `undefined`) and use `Filters.all()` only deliberately?
- Are numbers and ids real numbers/ObjectIds at the boundary, not strings?
- Is client data wrapped in `untrusted(...)` AND validated?
- Do hooks declare `this: HookThis<...>`, not `HydratedDoc`?
- Do transactions read documents inside and prefer `$inc` over read-modify-write?
- Are plugins/extensions registered before the first model, and is `connection.init()` called once at startup?
