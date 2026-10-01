# 05 Documents: the hydrated document, collections, validation, serialization

Read this when you load a document, change it in memory and `$save` it, or pass it on. A hydrated document is what `find`, `findOne`, `create`, `insertOne`, `Model.new` return. It tracks changes and has `$`-methods. `.lean()` and `.plain()` rows are not documents (see 03-reading.md).

## Minimal working example

```ts
import { Entity, Prop, Schema, TypemoClient, Versioned } from "@venloc/typemo";

@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
}

@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 0 }) qty!: number;
}

@Schema({ collection: "orders" })
class Order extends Versioned(Entity) {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => Address) address?: Address;
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);

const order = Orders.new({ customer: "alice", tags: ["gift"], lines: [{ sku: "A1", qty: 2 }] }); // not saved yet
await order.$save(); // insert
order.customer = "bob"; // scalar: plain assignment
order.tags.push("express"); // arrays: methods only
order.lines[0]!.qty = 5; // subdocument field: plain assignment
await order.$save(); // sends only the changed paths ($set customer, lines.0.qty; $push tags)
console.log(order.$isNew(), order.$isModified());
```

`$save()` is a no-op without changes (no command is sent, same document returned). Inside `client.transaction(...)` it joins the transaction automatically.

## Methods of the document

| Method | Does | Notes |
|---|---|---|
| `$save(opts?)` | insert if new, else update changed paths; returns `this` | `opts`: `session`, `timeoutMS`, `dropUnknownFields`, `policy`. Casts, then validates, then writes |
| `$set(path, value)` | assign by path with immediate cast | `"address.city"`, `"tags.0"`, `"fees.delivery"`; the only way to replace a whole array, Map or subdocument; chainable |
| `$get(path)` | read by path (applies the field `get`) | unknown path: `QueryError: $get: "nope" is not a path of Order`; absent value is `undefined` |
| `$isNew()` | not yet inserted | `Model.new` gives `true`; read documents `false` |
| `$isRoot()` | `true` for a model document, `false` for a subdocument | useful in shared document hooks |
| `$isModified(path?)` | changed since load/last save (path and below) | |
| `$markModified(path)` | force a path into the next `$save` | for in-place changes Typemo cannot see (bytes inside `Binary`) |
| `$getChanges()` | the update the next `$save` would send, `{}` when none | operators by class field names; may contain `$problems` |
| `$validate()` | validate the whole document, writes nothing | collects every issue into one `ValidationError` |
| `$deleteOne(opts?)` | delete by `_id`; returns `DeleteResult` | goes through hooks and policies (soft delete) |
| `$updateOne(update, opts?)` | operator update of this document by `_id`; unsaved in-memory edits are not saved | not for new documents: `QueryError: updateOne: the Order document is new; $save() it first` |
| `$populate(...)`, `$depopulate`, `$populated`, `$assertPopulated` | relations (see the populate reference) | |
| `$is(Class)` | narrows a discriminator document to a child class | class outside the hierarchy: `QueryError: $is: Customer is not Order or one of its discriminators ...` |
| `$session(s?)`, `$locals()` | the document's session; free-form object not persisted or serialized | |
| `$toObject`, `$toPlain`, `$toJSON` | serialization forms (below) | |

Everything on a document is prefixed `$`, so it never clashes with field names. Model-level helpers: `Model.new(data)`, `Model.validate(data)` (cast + validate untrusted data, returns the cast value), `Model.castObject(data)`, `Model.hydrate(dbShapedData)` (treated as existing; `$save` afterwards updates, so hydrate only data that is in the database).

## Arrays, subdocument arrays, Maps

```ts
import { Entity, Prop, Schema, Spec, TypemoClient } from "@venloc/typemo";

@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 0 }) qty!: number;
}

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => Spec.map(Number)) fees?: Map<string, number>;
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);

const order = await Orders.create({ tags: ["a", "b", "c"], lines: [{ sku: "A1", qty: 2 }, { sku: "B2", qty: 1 }], fees: { delivery: 5 } });

order.tags.push("d"); // $push
order.tags.pull("a"); // $pullAll
order.tags.set(1, "B"); // $set "tags.1" (index must exist)
order.tags.addToSet("z");
order.lines.push({ sku: "C3", qty: 1 }); // plain object, _id is created
order.lines[1]!.qty = 9; // $set "lines.1.qty"
const first = order.lines[0]!;
console.log(order.lines.id(first._id)?.sku); // find by _id
order.lines.pull(first._id); // $pull by _id; returns the removed elements
order.fees?.set("gift", 3); // $set "fees.gift"
order.fees?.delete("delivery"); // $unset "fees.delivery"
console.log(order.$getChanges());
await order.$save();

const copy = [...order.tags]; // plain copy; also order.tags.$toObject()
console.log(copy.length);
```

- `StrictArray<T>` reads like an array but is written by methods only: `push`, `unshift`, `addToSet`, `pull`, `pop`, `shift`, `set(index, value)`, `splice`, `sort`, `reverse`, `clear`, `replace`. `SubdocumentArray<T>` adds `create`, `id(id)`, `pull(id)`. `TypedMap<V>` has `set`, `delete`, `clear` (keys: non-empty, no `.`, no leading `$`, not `__proto__`).
- Methods cast values immediately. If several different operations hit one array before a save, Typemo falls back to `$set` of the whole array (`{ $set: { tags: [...] } }`), which overwrites another client's concurrent edit of that array. Prefer one kind of operation per array per save.
- `tags[0] = "x"`, `tags.length = 0` and `order.tags = [...]` do not compile (`TS2542`, `TS2740`).
- Position-based changes (`set`, `splice`, `sort`, `reverse`, `pop`, `shift`) bump `__v` on `Versioned` models; with `@Schema({ optimisticConcurrency: true })` every saved change checks the version (`VersionError: Ledger: no document at version 0 (it was changed or deleted since it was read); modified: balance`). Retry on `VersionError` by re-reading and re-applying, with a bounded number of attempts.
- A partially loaded array (`select({ tags: { $slice: 2 } })`) allows only `push`, `unshift`, `addToSet`, `pull`; others throw at `$save`: `PartialArrayError: "tags" was loaded partially (projection); a $set of the whole array would overwrite the elements that were not loaded`.

## Subdocuments and nested objects

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) street?: string;
}

@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
}

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => Address) address?: Address;
  @Prop(() => [Line]) lines!: Line[];
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);

const order = await Orders.create({ address: { city: "Oslo" }, lines: [{ sku: "A1" }] });
order.address!.city = "Rome"; // field of a nested object: assignment, path "address.city" is written
order.$set("address", { city: "Paris" }); // replace the whole object
const line = order.lines[0]!;
console.log(line.$fullPath(), line.$index(), line.$isRoot(), line.$isNew(), line.$isModified());
console.log(Object.is(line.$ownerDocument(), order), Object.is(line.$parentArray(), order.lines)); // $parent() is the nearest owner
```

- Assigning a whole subdocument, array or Map (`order.address = { ... }`) does not compile, and in untyped code `$save` throws `DirectWriteError: "address" was changed around its methods: the field was replaced by assignment; use $set("address", value) or the container's methods`. `$getChanges()` reports it under `$problems` instead of throwing.
- Subdocument path and index are computed at call time, so they stay right after `unshift`/`splice`.

## Validation and the cast rule

```ts
import { CastError, Entity, Prop, Schema, TypemoClient, ValidationError, type Defaulted } from "@venloc/typemo";

@Schema({ collection: "products" })
class Product extends Entity {
  @Prop(() => String, { required: true, validate: (value) => value !== "bad" || "the name is taken" }) name!: string;
  @Prop(() => Number, { max: 10, default: 1 }) size!: Defaulted<number>;
}

declare const client: TypemoClient;
const Products = client.connection.model(Product);

export const check = async (body: unknown) => {
  try {
    const value = await Products.validate(body); // cast + validate data without a document
    return { ok: true as const, product: await Products.create(value) };
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false as const, problems: error.issues.map((issue) => [issue.path.join("."), issue.reason]) };
    throw error;
  }
};

const product = Products.new({ name: "bad", size: 99 });
try {
  await product.$validate(); // all issues at once, in schema field order
} catch (error) {
  if (error instanceof ValidationError) console.log(error.issues.map((issue) => [issue.path.join("."), issue.reason, issue.message]));
}
(product as { size: unknown }).size = "abc"; // untyped assignment
try {
  await product.$save();
} catch (error) {
  console.log(error instanceof CastError); // cast happens first, before any validation
}
```

The cast rule: a value must be castable to the field type, and Typemo is strict (`"4"` is not turned into a number).
- Methods (`Model.new`, `create`, `$set`, array and Map methods) cast immediately and throw `CastError: Cast to number failed at path "lines.0.qty" for "abc" (string): expected a number [type]`.
- Plain assignment (`doc.size = "abc"`) is cast later, at the nearest `$validate()` or `$save()`; it throws `CastError` before any validation and nothing is written. Use `$set` for values from outside to fail on the right line.
- Rules (`required`, `min`, `max`, `enum`, `validate`, ...) are checked at `$validate`/`$save`: `ValidationError: Validation failed: "name": the name is taken [validator]; "size": must be at most 10 [max]`. `issues[i]` has `path` (segments), `reason` (`required`, `min`, `max`, `enum`, `validator`, `cast`, ...), `message`, `value`. Async validators are awaited.
- `Model.validate(data)` does not throw `CastError`: an uncastable value becomes an issue with reason `cast` (`"size": Cast to number failed ... [type] [cast]`).
- `$validate` does not check versions or unique indexes: `VersionError` and `DuplicateKeyError` come from `$save`. You do not need `$validate` before `$save`.

## Serialization forms

| Method | `_id` / `Date` / `bigint` / Decimal128 | `Map` | Hidden fields | Use for |
|---|---|---|---|---|
| `$toObject(opts?)` | `ObjectId` / `Date` / `bigint` / `Decimal128` (driver values) | `Map` | included by default (`hidden: true`) | internal data; do not `JSON.stringify` |
| `$toPlain(opts?)` | string / `Date` / `` `${bigint}` `` / string | `Map` | excluded (`hidden: false`) | data leaving the app |
| `$toJSON(opts?)` | string / ISO string / string / string | plain object | excluded | `JSON.stringify(doc)` and `res.json(doc)` call this |

```ts
import { Entity, Prop, Schema, TypemoClient, type Hidden } from "@venloc/typemo";

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => String, { hidden: true }) note?: Hidden<string>;

  get title(): string {
    return `Order of ${this.customer}`;
  }
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);

const order = await Orders.findOne({ customer: "alice" }).select({ "+note": true }).orFail();
const plain = order.$toPlain(); // no note
const internal = order.$toPlain({ hidden: true }); // note included
const withVirtuals = order.$toPlain({ virtuals: true }); // getters (Computed) included
const masked = order.$toPlain({ mask: { customer: "mask" } }); // "?" instead of the value
const custom = order.$toJSON({ transform: (json) => ({ id: json._id, customer: json.customer }) });
console.log(plain.customer, internal.note, withVirtuals.title, masked.customer, custom.id, JSON.stringify(order));
```

Options (`ToObjectOptions`, per call, no schema-level defaults): `getters` (apply field `get`), `virtuals`, `hidden`, `mask`, `transform`. `console.log(doc)` / `util.inspect` print the class name and data like `$toObject` without internals; Hidden fields are never printed, even when loaded.

## Unknown fields in stored data

Stored fields that the schema does not know survive normal edits (exact-path writes). A save that rewrites a whole subdocument that has such fields (after `reverse`, `sort`, `splice`, `clear`, `replace`, `$set` of the subdocument) is refused:

```text
UnknownFieldsError: the save would drop fields the schema does not know from stored data: "lines.1" (oldPrice); migrate the data or the schema, or pass { dropUnknownFields: true } to $save()/bulkSave() to accept the loss
```

`unknownFieldsOf(doc)` lists them; `isUnknownFieldsError(error)` narrows the error (`error.fields`); `$save({ dropUnknownFields: true })` accepts the loss deliberately.

## Common mistakes

Bad: `order.tags = ["express"]` (TS2740). Good: `order.$set("tags", ["express"])`, `order.tags.replace([...])`, or `push`/`pull`.

Bad: writing around the methods (`Array.prototype.push.call(order.tags, "x")`).
```text
DirectWriteError: "tags" was changed around its methods: its length is 4 instead of 3 (use push(), pop(), splice(), clear() or replace())
```
Good: collection methods.

Bad: `await order.$save()` after `await order.$deleteOne()`.
```text
QueryError: save: the document of Order was deleted
```
Good: create a new document with `Model.new`. If another client deleted it: `DocumentNotFoundError: Order.save: the document is no longer in the collection (deleted since it was read, or out of the scope of the operation's policies); nothing was written`.

Bad: `order.$set("_id", ...)` on an existing document.
```text
StrictModeError: $set: "_id" of Order is immutable once the document exists [immutable]
```
Good: `_id` and `Immutable<T>` fields are write-once.

Bad: `order.$set("nope", 1)` in untyped code: `CastError: Cast to Order failed at path "nope" for 1 (number): not a field of Order [unknown-key]`. Good: only declared paths.

Bad: modifying a lean or plain row and expecting `$save` (TS2339). Good: read the hydrated document.

Bad: sending a hydrated document with `JSON.stringify` and expecting Hidden fields or `bigint` to be handled by you. Good: `$toJSON()` (Hidden stripped, ids as strings) or `.plain()` on the query.

Bad: reading `order.customer` and expecting the field `get` to run. Good: `$get("customer")` or `$toPlain({ getters: true })`.

## Self-check

- Scalars by assignment, containers by methods, whole containers by `$set`/`replace`.
- Values from outside go through `Model.validate` or `$set`, so failures point at the right line.
- Concurrent writers of arrays: use `Versioned`, `optimisticConcurrency` and a bounded retry on `VersionError`; or use `updateOne` operators (04-writing.md).
- Documents leave the app only through `$toJSON`/`$toPlain` (Hidden fields stay stripped).
- No `$save` on lean/plain rows or on deleted documents.
