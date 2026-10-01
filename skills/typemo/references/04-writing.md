# 04 Writing: create, update, replace, delete, upsert, bulk

Read this when writing code that inserts, changes or deletes documents through the model. For changing a loaded document with `$save` see 05-documents.md.

## Minimal working example

```ts
import { Entity, Prop, Schema, TypemoClient, type Defaulted } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => String) note?: string;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

const account = await Accounts.create({ title: "Main", owner: "alice" }); // hydrated document, balance 0
const result = await Accounts.updateOne({ title: "Main" }, { $inc: { balance: 10 }, $push: { tags: "vip" } });
console.log(account.balance, result.matchedCount, result.modifiedCount);
const removed = await Accounts.deleteOne({ title: "Main" }).orFail();
console.log(removed.deletedCount);
```

Every write is validated before anything is sent: values are cast to schema types, unknown fields rejected, constraints (`min`, `enum`, `validate`, ...) checked, `immutable` enforced. Errors name the method you called (`Account.create`), not the internal one.

## Method overview

| Method | Returns on `await` | Notes |
|---|---|---|
| `create(doc)` / `create([docs])` | hydrated document / array | list is one ordered write; validation error in the list writes nothing |
| `insertOne(doc, opts?)` | hydrated document | same path as `create` with one document |
| `insertMany(docs, { ordered? })` | array of hydrated documents | `ordered: true` (default) stops at the first error; empty list returns `[]` |
| `updateOne(filter, update, opts?)` | `UpdateResult` | first match |
| `updateMany(filter, update, opts?)` | `UpdateResult` | all matches |
| `replaceOne(filter, replacement, { upsert? })` | `UpdateResult` | whole document replaced |
| `findOneAndUpdate(filter, update, opts?)` | document after the change or `null` | query builder: `.select`, `.lean`, `.plain`, `.orFail` |
| `findByIdAndUpdate(id, update, opts?)` | same | object operators only (no pipeline) |
| `findOneAndReplace(filter, replacement, opts?)` | document or `null` | |
| `deleteOne(filter)` / `deleteMany(filter)` | `DeleteResult` (`deletedCount`) | soft delete models mark instead of removing |
| `findOneAndDelete(filter)` / `findByIdAndDelete(id)` | the deleted document or `null` | |
| `bulkWrite(ops, { ordered? })` | `BulkWriteResult` | mixed operations in one request |
| `bulkSave(documents)` | `BulkWriteResult \| undefined` | saves loaded/new documents; `undefined` if nothing changed |

`updateOne`/`updateMany`/`replaceOne`/`deleteOne`/`deleteMany` return a write builder: nothing is sent until `await`. It supports `.orFail()` (no match becomes `DocumentNotFoundError`), `.session()`, `.policy()`, `.hint()`, `.collation()`, `.comment()`, `.timeoutMS()`, `.writeConcern()`, `.exec({ force })`. A builder runs once: a second `await` of the same object is `QueryError: updateOne: this operation was already executed; build a new one, or run it again deliberately with exec({ force: true }) (a write runs once per builder)`.

`create`/`insertOne`/`insertMany`/`bulkWrite` take `WriteOptions` (`session`, `timeoutMS`, `comment`, `writeConcern`, `policy`). There is no `timestamps` option: `createdAt`/`updatedAt` come from `Timestamped(...)` and move on every write.

## Create and insert

```ts
import { BulkWriteError, DuplicateKeyError, Entity, Prop, Schema, TypemoClient, type CreateInput } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

const draft: CreateInput<Account> = { title: "Main", owner: "alice" }; // Defaulted, optional, array and Tenant fields can be omitted
const one = await Accounts.create(draft);
const many = await Accounts.insertMany(
  [{ title: "A", owner: "bob" }, { title: "B", owner: "bob" }],
  { ordered: false }, // keep going on errors; failures are collected into BulkWriteError
);

try {
  await Accounts.insertOne({ _id: "6abcfa53381ada4ddb42f67b", title: "Main", owner: "x" }); // string _id is cast
} catch (error) {
  if (error instanceof DuplicateKeyError) console.log("title already exists");
  if (error instanceof BulkWriteError) console.log(error.ordered, error.writeErrors.map((failure) => failure.index), error.result.insertedCount);
}
console.log(one._id, many.length);
```

- A single document with a duplicate key throws `DuplicateKeyError: duplicate key on title_1: { title: "Main" } (code 11000 DuplicateKey)`. A list throws `BulkWriteError: Account.create: 1 write(s) failed (first at index 1: duplicate key on title_1 (code 11000 DuplicateKey))`; documents before the failing one stay written in ordered mode.
- Unique errors exist only when the index exists: call `connection.init()` at start.
- `ordered: false`: Typemo validation failures and server failures are all in one `BulkWriteError` (`writeErrors[i].index`, `.error.name`), the rest is inserted. In ordered mode a Typemo validation failure stops the whole insert with `ValidationError`.
- `Model.new(data)` builds an unsaved document (see 05-documents.md).

## Update operators

```ts
import { Entity, Prop, Schema, TypemoClient, ValidationError, type Defaulted, type Update, type UpdateInput } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Number]) scores!: number[];
  @Prop(() => String) nickname?: string;
  @Prop(() => Date) lastLogin?: Date;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

await Accounts.updateOne({ title: "Main" }, { $set: { owner: "bob" }, $unset: { nickname: "" } });
await Accounts.updateOne({ title: "Main" }, { $inc: { balance: 5 }, $currentDate: { lastLogin: true } });
await Accounts.updateOne({ title: "Main" }, { $push: { scores: { $each: [9, 1], $position: 1, $sort: -1, $slice: 3 } } });
await Accounts.updateOne({ title: "Main" }, { $addToSet: { tags: { $each: ["a", "c"] } } });
await Accounts.updateOne({ title: "Main" }, { $pull: { tags: "a" } });

const topUp = (amount: number): Update<Account> => ({ $inc: { balance: amount } }); // build here, apply there
const patch: UpdateInput<Account> = { owner: "carol" }; // writable top-level fields, no _id, no immutable fields
await Accounts.updateOne({ title: "Main" }, topUp(10));
await Accounts.updateOne({ title: "Main" }, { $set: patch });

try {
  await Accounts.updateOne({ title: "Main" }, { $inc: { balance: -1000 } });
} catch (error) {
  if (error instanceof ValidationError) console.log("insufficient balance");
}
```

- Operators: `$set`, `$setOnInsert`, `$unset`, `$inc`, `$mul`, `$min`, `$max`, `$currentDate`, `$rename`, `$push` (with `$each`, `$position`, `$sort`, `$slice`), `$addToSet`, `$pull`, `$pullAll`, `$pop`, `$bit`. An operator on a field of the wrong type does not compile (`TS2769`/`TS2353`) and at runtime is `StrictModeError: $inc does not apply to this field (at "$inc.owner") [sanitize]`.
- `$inc`/`$mul` on a field with `min`/`max` are guarded atomically: `ValidationError: Validation failed: "balance": $inc -1000 on 10 gives -990, below the minimum 0; nothing was written [min]`. This guard is not available in `bulkWrite` and with `upsert` (use `updateOne`/`updateMany`, no upsert).
- `$unset` only on optional fields; required ones are rejected (`the field is required; $unset would remove it`). `$rename` source and target must be optional and of one type.
- A path under two operators is `QueryError: update: "balance" is changed by $inc and $set (server code 40)`. An empty update (`{}`, `$set: {}`) is `QueryError: update: operator "$set" is empty`.
- Immutable fields and `_id` are not allowed in `$set` (compile error and `StrictModeError ... is immutable ... [immutable]`).
- A pushed element is validated whole: `Validation failed: "lines.+0.qty": the field is required [required]`.
- Map keys are paths: `{ $set: { "counters.visits": 2 } }`; nested fields `"shipTo.city"`.
- `updateOne` with no match is not an error (`matchedCount: 0`); add `.orFail()` to make it `DocumentNotFoundError: Account.updateOne: no document matched the filter (orFail)`.

### Array elements: positional paths and arrayFilters

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 1 }) qty!: number;
}

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [Line]) lines!: Line[];
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);

await Orders.updateOne({ customer: "ann" }, { $inc: { "lines.$[].qty": 1 } }); // every element
await Orders.updateOne({ customer: "ann" }, { $set: { "lines.$[l].qty": 5 } }, { arrayFilters: [{ "l.sku": "y" }] }); // matching elements
await Orders.updateOne({ customer: "ann", "lines.sku": "y" }, { $set: { "lines.$.qty": 2 } }); // first element found by the filter
```

- Each `$[id]` needs its own `arrayFilters` entry and vice versa: `QueryError: arrayFilters: no filter for the identifier "l" of the update` / `arrayFilters: the filter for "l" is not used by the update (the server refuses it)`. `arrayFilters` is not allowed with a pipeline.
- Positional `$` needs a condition on that array in the filter, otherwise `QueryError: $set: "lines.$.qty" uses the positional $ of the array "lines", but the filter has no condition on "lines"; ...`.

## Update pipelines (value computed from other fields)

```ts
import { Entity, Prop, Schema, TypemoClient, fn, type Defaulted } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
  @Prop(() => String) note?: string;
  @Prop(() => String) nickname?: string;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

await Accounts.updateOne({ title: "Main" }, (p) => p.set((f) => ({ note: fn.concat(f.owner, "/", f.title) })));
await Accounts.updateMany({ owner: "alice" }, (p) => p.set((f) => ({ balance: fn.multiply(f.balance, 2) })).unset("nickname"));
```

- Pass a function `(p) => ...` instead of an operator object; never an array of stages (`QueryError: update: an update pipeline is built with the pipeline builder: updateOne(filter, (p) => p.set({ … })), not passed as an array`). Stages allowed: `set`/`addFields`, `unset`, `project`, `replaceWith`, `replaceRoot`. Stages run in order; each sees the previous result. At least one stage is required.
- Constraints are checked on the computed value: `Validation failed: "balance": the update pipeline computes -40; the value must be at least 0; nothing was written [min]`. If a stage reads a field changed by an earlier stage, constraints cannot be checked: compute both in one stage.
- `$project`, `replaceWith`, `replaceRoot` rewrite the whole document and must carry immutable fields and `createdAt` unchanged (`StrictModeError: ... would change or drop the immutable fields ... [immutable]`); `.unset` of a required field is rejected.
- `findByIdAndUpdate` takes only operator objects; use `findOneAndUpdate({ _id }, pipeline)` for a pipeline.

## Replace

```ts
import { Entity, Prop, Schema, TypemoClient, type Immutable, type Replacement } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { immutable: true }) region?: Immutable<string>;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

const fresh: Replacement<Account> = { title: "Main", owner: "carol", region: "eu" }; // no _id, createdAt, updatedAt, __v
await Accounts.replaceOne({ title: "Main" }, fresh);
const before = await Accounts.findOneAndReplace({ title: "Main" }, fresh, { returnDocument: "before" }).plain();
console.log(before?.owner);
```

- Fields missing from the replacement are removed (unlike an update). Immutable fields must be carried with their stored value (`StrictModeError: a replacement of Account changes the immutable field "region"; the document was not replaced. Carry the stored value [immutable]`).
- `_id` in a replacement is always an error, even equal to the stored one: select the document by `_id` in the filter. Service fields: `a replacement of Account carries the service field "createdAt": the core keeps createdAt/__v and bumps updatedAt itself; leave it out [immutable]`.
- Operators in a replacement: `QueryError: replacement: "$set" — a replacement has no operators`.

## Upsert, findOneAnd*, returnDocument

```ts
import { Entity, Prop, Schema, TypemoClient, type Defaulted } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { default: 0 }) balance!: Defaulted<number>;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

const upserted = await Accounts.updateOne(
  { title: "Fresh" },
  { $set: { owner: "ivan" }, $setOnInsert: { balance: 100 } },
  { upsert: true },
);
console.log(upserted.upsertedCount, upserted.upsertedId);

const after = await Accounts.findOneAndUpdate({ title: "Main" }, { $inc: { balance: 1 } }).orFail(); // document AFTER by default
const before = await Accounts.findOneAndUpdate({ title: "Main" }, { $inc: { balance: 1 } }, { returnDocument: "before" }).plain();
const owner = await Accounts.findOneAndUpdate({ title: "Main" }, { $set: { owner: "dave" } }).select({ owner: 1 }).plain();
const raw = await Accounts.findOneAndUpdate({ title: "New" }, { $set: { owner: "x" } }, { upsert: true }).includeResultMetadata();
console.log(after.balance, before?.balance, owner?.owner, raw.lastErrorObject?.updatedExisting);
```

- `upsert: true` builds the new document from filter equalities, `$set` and `$setOnInsert`; required fields must be reachable that way: `Validation failed: "owner": upsert would create a document without the required field "owner"; give it in the filter (an equality), in $set or in $setOnInsert [required]`. Defaults are applied on the insert.
- `findOneAnd*` return the document after the change by default (the driver's default is before; here it is `"after"`). Result is `HydratedDoc | null`; chain `.select/.lean/.plain/.orFail`.
- Results: `UpdateResult { acknowledged, matchedCount, modifiedCount, upsertedCount, upsertedId }`, `DeleteResult { acknowledged, deletedCount }`, `BulkWriteResult { insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount, insertedIds, upsertedIds }`.

## Delete

```ts
import { Entity, Filters, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

const one = await Accounts.deleteOne({ owner: "bob" }).orFail(); // DeleteResult
const many = await Accounts.deleteMany({ owner: "carol" });
const gone = await Accounts.findOneAndDelete({ owner: "dave" }).plain(); // the removed document or null
await Accounts.deleteMany(Filters.all()); // deliberately everything
console.log(one.deletedCount, many.deletedCount, gone);
```

## Empty filters

`updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany` and every `findOneAnd*` refuse an empty filter: `{}` does not compile (`TS2345`, property `"filter error"`), and at runtime (also inside `bulkWrite`):

```text
StrictModeError: updateMany with an empty filter would affect every document; pass a filter, or Filters.all() to mean every document on purpose [empty-filter]
StrictModeError: deleteOne with an empty filter would change or remove an arbitrary document; pass a filter, or Filters.all() to mean every document on purpose [empty-filter]
```

`Filters.all()` is the explicit "every document" (`{ _id: { $exists: true } }`); `Filters.all<User>()` is typed as `Filter<User>`. A filter typed `Filter<User>` or a `Record<string, unknown>` compiles even if empty at runtime: the runtime check still catches it. Reads (`find({})`) allow empty filters.

## bulkWrite and bulkSave

```ts
import { BulkWriteError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String) note?: string;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

try {
  const result = await Accounts.bulkWrite([
    { insertOne: { document: { title: "Bulk", owner: "gina" } } },
    { updateOne: { filter: { title: "Main" }, update: { $set: { note: "bulk" } } } },
    { deleteOne: { filter: { title: "Old" } } },
  ]);
  console.log(result.insertedCount, result.matchedCount, result.deletedCount, Object.keys(result.insertedIds));
} catch (error) {
  if (error instanceof BulkWriteError) console.log(error.writeErrors.map((failure) => [failure.index, failure.code]));
}

const existing = await Accounts.findOne({ title: "Main" }).orFail();
existing.owner = "hank";
const fresh = Accounts.new({ title: "BulkSaved", owner: "hank" });
await Accounts.bulkSave([existing, fresh]); // one ordered write for documents already in memory
```

- Each operation object has exactly one key of: `insertOne { document }`, `updateOne`/`updateMany { filter, update, upsert?, arrayFilters?, hint? }`, `replaceOne { filter, replacement, upsert?, hint? }`, `deleteOne`/`deleteMany { filter, hint? }`. Anything else: `QueryError: bulkWrite[0]: one of insertOne, updateOne, updateMany, replaceOne, deleteOne, deleteMany (got foo)`.
- Ordered by default: stops at the first server error; `BulkWriteError.result` shows what was written. `$inc`/`$mul` on a field with `min`/`max` is not accepted in `bulkWrite`: `ValidationError: ... cannot be guarded in bulkWrite ...; use updateOne/updateMany [min]`.

## Common mistakes

Bad: unfiltered write.
```ts
// @errors: 2345
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
}

declare const client: TypemoClient;
await client.connection.model(Account).deleteOne({});
```
Good: `deleteOne({ owner })` or `deleteMany(Filters.all())`.

Bad: `$inc` on a string field (`updateOne(f, { $inc: { owner: 1 } })`, `TS2769`; at runtime `StrictModeError: $inc does not apply to this field (at "$inc.owner") [sanitize]`). Good: use an operator that fits the field type.

Bad: `{ $set: { shipTo: { city: "Rome" } } }` to change one nested field (it replaces the object and fails on missing required fields). Good: `{ $set: { "shipTo.city": "Rome" } }`.

Bad: expecting `updateOne` to fail when nothing matches. Good: `.orFail()`.

Bad: `{ field: undefined }` anywhere in input.
```text
CastError: Cast to string | null failed at path "nickname" for undefined: undefined is never a value; omit the field instead [undefined]
```
Good: omit the key, or use `$unset`/`null` (when nullable).

Bad: unknown field in a create/update: `CastError: Cast to Account failed at path "zzz" for 1 (number): not a field of Account [unknown-key]`, `StrictModeError: $set: "nope" is not a field of Account [unknown-path]`. Good: only declared fields.

Bad: `Accounts.create({ title: 5 as never })` from untyped input: `CastError: Cast to string failed at path "title" for 5 (number): expected a string [type]`. Good: validate or cast at the boundary, catch `CastError`/`ValidationError` as a 400.

## Self-check

- Every update/delete has a real filter (or `Filters.all()` on purpose).
- Business-critical counters use `$inc`/`$mul` (guarded by `min`/`max`), not read-modify-write.
- `unique` rules exist in the database (`connection.init()` ran); `DuplicateKeyError`/`BulkWriteError` are handled.
- "Not found" is handled with `.orFail()` or the result counts.
- Replacements carry immutable fields and omit `_id`/service fields; partial changes use operators.
- No `undefined` in input; pipelines are functions, not arrays of stages.
