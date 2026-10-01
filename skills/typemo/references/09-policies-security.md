# Policies and security

Read this before touching multi-tenancy, deletion, audit, data coming from HTTP, secret fields, or the client's safety options. A **policy** is a rule the model applies to every operation by itself; the author of a query cannot forget it or switch it off. Policies are checked before the request goes to the network: an operation a policy cannot make safe is not sent, and you get a `StrictModeError` with a `reason`. There are no "soft" modes: no option allows an unknown path or an empty filter "just here". For something outside the rules use `client.unsafeDriver()` (visible in review).

## Tenant: the minimal example

`@Schema({ tenant: true })` plus exactly one field marked `@Tenant()` with the type `TenantField<T>`. Values come from a scope opened with `PolicyContext.run` (the tenant is taken **when the query is built**).

```ts
import { Entity, PolicyContext, Prop, Schema, Tenant, type TenantField, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "orders", tenant: true })
class Order extends Entity {
  @Prop(() => String) @Tenant() tenantId!: TenantField<string>;
  @Prop(() => String, { required: true }) number!: string;
}

declare const client: TypemoClient;
const Orders = client.connection.model(Order);

// one scope per request: the tenant comes from the verified token, never from the request body
export const handle = (orgId: string, userId: string) =>
  PolicyContext.run({ tenant: orgId, actor: userId }, async () => {
    await Orders.create({ number: "A-1" }); // tenantId is written by the model
    return Orders.find().sort({ number: 1 }).plain(); // the filter {tenantId} is added to every read, update, delete, aggregation
  });

// one operation outside a scope
export const one = (tenant: string) => Orders.countDocuments().policy({ tenant });
// a write takes the policy in its options
export const make = (tenant: string) => Orders.create({ number: "A-2" }, { policy: { tenant } });
// deliberate cross-tenant work (reports); watch() has no .policy(): use PolicyContext.run({ allTenants: true }, ...)
export const all = () => Orders.find().policy({ allTenants: true }).plain();
console.log(handle, one, make, all);
```

Facts:

- Aggregations get the tenant condition first; `$lookup` / `$unionWith` / `$graphLookup` join only the same tenant if the joined class has a policy too; `$out` / `$merge` into a tenant collection are forbidden; populate follows the target's policy.
- `watch()` of a tenant model without `allTenants: true` is forbidden; `estimatedDocumentCount()` is forbidden (use `countDocuments()`).
- Writing the tenant field to move a document is refused: `StrictModeError: Order.updateOne: $set of the tenant field ("tenantId") would move the document to another tenant or lose it [tenant]`.
- A scope lives in one process. A queue job must carry `PolicyContext.current()` values in the message and open `PolicyContext.run` again in the worker.
- A query built OUTSIDE the scope and awaited inside has no tenant. Build it inside `run`.
- Tenant values are cast by the field type (`TenantField<string>` with `5` -> `CastError`).

Errors you will meet:

```text
StrictModeError: Order.find: Order is scoped by tenant ("tenantId") and the operation has no tenant; run it inside PolicyContext.run({ tenant }, …) or add .policy({ tenant }) to the query (cross-tenant work: .policy({ allTenants: true })) [tenant]
ConfigurationError: NoMark: the tenant field "tenantId" must be marked @Tenant() (declare it @Prop(...) @Tenant() tenantId!: TenantField<T>)
ConfigurationError: NoOpt: @Tenant() on "tenantId", but the schema has no tenant policy — add tenant: true (or { field }) to @Schema
```

## Soft delete

`@Schema({ softDelete: true })` and a nullable `deletedAt`. `deleteOne` / `deleteMany` mark; reads, counts, updates, populate all skip marked documents.

```ts
import { Entity, Prop, Schema, SoftDelete, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "posts", softDelete: true })
class Article extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}

declare const client: TypemoClient;
const Articles = client.connection.model(Article);

await Articles.deleteOne({ title: "Two" }); // marks deletedAt
const trash = await Articles.find().policy({ onlyDeleted: true }).plain();
const everything = await Articles.find().policy({ includeDeleted: true }).plain();
await SoftDelete.restore(Articles, { title: "Two" }); // undo
const purged = await SoftDelete.purge(Articles, { title: "Two" }); // really delete (works on marked documents)
console.log(trash.length, everything.length, purged.deletedCount);
```

- `estimatedDocumentCount` throws `StrictModeError: Post.estimatedDocumentCount: the collection's metadata counts soft-deleted documents too; use countDocuments() (or includeDeleted: true to count them all) [soft-delete]`.
- A deleted document keeps its unique value: a new one hits `DuplicateKeyError`. The model warns at creation: make unique indexes partial by `partialFilterExpression: { deletedAt: { $type: "null" } }` (exactly `$type: "null"`; inserts always write `null`).

## Audit

`@Schema({ audit: true })`: every write leaves a row in `<collection>_audit` (operation, actor, filter/update/documents) in the same transaction as the write. The actor comes from `PolicyContext.run({ actor })` or `.policy({ actor })`; without it the row has no actor. Values of fields with `sensitive` are masked in the row (the document in your app is unchanged).

```ts
import { Entity, PolicyContext, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "transfers", audit: true })
class Transfer extends Entity {
  @Prop(() => String, { required: true }) from!: string;
  @Prop(() => Number, { required: true }) amount!: number;
  @Prop(() => String, { sensitive: "mask" }) card?: string; // "?" in the audit row
}

declare const client: TypemoClient;
const Transfers = client.connection.model(Transfer);

await PolicyContext.run({ actor: "user-7" }, () => Transfers.create({ from: "A", amount: 100 }));
const trail = client.unsafeDriver().db("app").collection("transfers_audit");
console.log((await trail.find({ actor: "user-7" }).toArray()).map((entry) => entry.operation));
```

- A failed audit write fails the operation: `AuditError: Payment.create: the audit entry could not be written; the transaction is aborted with this error, the write is rolled back` (`cause` has the reason, `applied: false`).
- An audited write needs a transaction, so it needs a replica set; on a standalone `mongod`: `ConfigurationError: Order.create: the model is audited (@Schema({ audit })); an audited write outside a transaction runs in its own transaction ... Run MongoDB as a replica set (a single-member one is enough).` Inside your transaction the write and the row join it.

## Untrusted input and operator injection

Data from an HTTP body / query string / parsed JSON may carry operators (`{"name":{"$ne":""}}`). Wrap **every** piece of client data before it enters a filter, update or projection: `untrusted(value, place)` with `place` = `"filter"` (default) | `"update"` | `"projection"` (changes only the wording of the error). It looks only at keys (a string `"; drop"` passes: validate type, shape and range yourself).

```ts
import { Entity, Prop, Schema, StrictModeError, untrusted, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}
declare const client: TypemoClient;
const Users = client.connection.model(User);

export const search = async (body: { name: string }) => {
  try {
    return await Users.find({ name: untrusted(body.name) }).plain(); // wrap the piece, not just one field of many
  } catch (error) {
    if (error instanceof StrictModeError && error.reason === "sanitize") return []; // e.g. 400 for the client
    throw error;
  }
};

export const listFields = (fields: { name: 1 }) => Users.find().select(untrusted(fields, "projection")).plain();
export const patch = (body: { name?: string }) => untrusted(body, "update"); // throws on { "$set": ... }
console.log(search, listFields, patch);
```

Runtime texts: `untrusted value: "$ne" at "name.$ne" — an operator inside data from outside (query selector injection); validate the input and build the filter yourself [sanitize]` (update: `... would change what the update does (update operator injection) ...`; projection: `... would turn the projection into a computed expression ...`); a `+passwordHash` key from outside: `untrusted value: "+passwordHash" at "+passwordHash" — a "+path" key inside data from outside would select a Hidden field; validate the input and build the projection yourself [sanitize]`. A bad place: `QueryError: untrusted(value, place): place must be "filter", "update" or "projection", got string "nope"`. `Untrusted.check(value)` checks without returning. Without `untrusted`, `{ name: body.name }` with an object inside is sent as is.

Always on, with no option to relax: unknown or top-level operators, mixed operators and fields, `$where` and server-side JavaScript are rejected with reason `sanitize`.

## Hidden, sensitive, masks

- `@Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>` (the `Hidden<T>` type is mandatory; compile error TS1240 otherwise). Hidden fields are not read by default; absent from `.plain()`, `$toPlain()`, `$toJSON()`, from the type of the result and from aggregation rows. Read explicitly: `.select({ "+passwordHash": true })`, `$toPlain({ hidden: true })`, `Pipeline.from(Model, { include: ["passwordHash"] })`. Filtering by a hidden field works.
- `sensitive: "mask"` (value becomes `?` in audit, events, errors), `"hide"` (`[hidden]`), `Mask.email()` / `Mask.phone()` / `Mask.card()` / `Mask.initials()` / `Mask.bucket([18, 35, 60])`, or `{ mask: (value) => value.slice(-4) }`. Hidden fields are sensitive as well. Applies to audit rows, instrumentation events (`client.instrument({ sensitive: "show" | "mask" | "hide" })`), and error messages (`Cast to string failed at path "resetToken" for "[hidden]" (string)`; `duplicate key on passport_1: { passport: "?" }`).
- **Response masks** for output: `.plain().mask({ email: Mask.email(), "cards.number": Mask.card(), "notes.$*": "mask", name: (n) => ... })`, `doc.$toPlain({ mask })`, `doc.$toJSON({ mask })`, aggregation `.plain().mask(...)`, cursors mask each row. `.mask` works only after `.plain()` or `.lean()` (never on a hydrated doc: it could be saved). A path not in the result row is `StrictModeError: mask: "nope" matched nothing in the rows ... [unknown-path]`.

```ts
import { Entity, Mask, Prop, Schema, type Hidden, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
  @Prop(() => String, { sensitive: Mask.email() }) email?: string;
  @Prop(() => String, { sensitive: "hide" }) resetToken?: string;
}
declare const client: TypemoClient;
const Users = client.connection.model(User);

export const signIn = async (name: string) =>
  Users.findOne({ name }).select({ "+passwordHash": true }).lean(); // the only place that reads the hash
export const profile = (name: string) => Users.findOne({ name }).plain().orFail(); // no hash in type or data
export const support = () => Users.find().plain().mask({ email: Mask.email() });
console.log(signIn, profile, support);
```

## Strictness that is always on

- **Strict paths**: an unknown field in a filter, update, projection or sort is `StrictModeError` with `reason: "unknown-path"` and `path` (`filter.nope`, `filter.$or.0.nope`, `$set.nope`, `projection.nope`, `sort.nope`); text `filter: "nope" is not a field of User [unknown-path]`. A `+nope` projection key too (`projection.+nope`).
- **Empty filter in a write** (`updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `replaceOne`, `findOneAnd*`, also inside `bulkWrite`): `deleteMany with an empty filter would affect every document; pass a filter, or Filters.all() to mean every document on purpose [empty-filter]`. A literal `{}` does not compile for the `updateOne`/`updateMany`/`deleteOne`/`deleteMany`/`replaceOne` calls. "All" on purpose is `Filters.all()`.
- `QueryError` (not `StrictModeError`; no `reason`) for: `undefined` as a value (`filter: undefined at "name" (use $exists: false / $unset; undefined is never a value)`), an empty `$and`/`$or`/`$nor` (`filter: $or must be a non-empty array (at "$or")`), an empty update (`update: an empty update changes nothing`), `limit` <= 0 or non-integer (`limit must be a positive integer, got 0 (number)`), `skip` < 0.
- `StrictModeError.reason` values: `unknown-path`, `not-hidden`, `undefined`, `empty-filter`, `empty-logical`, `empty-update`, `immutable`, `limit`, `sanitize`, `tenant`, `soft-delete`, `transaction-option`, `concurrent-session`. Branch on `reason`, not on the text. Catch both `StrictModeError` and `QueryError` when you map client input errors.

## Client safety options

```ts
import { TypemoClient } from "@venloc/typemo";

export const client = await TypemoClient.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017/app", {
  // reads are checked against the schema (data written by scripts, old versions): CastError on a mismatch.
  // "development" = on everywhere except NODE_ENV=production (and on when NODE_ENV is unset!)
  validateReads: "development",
  // signs keyset pagination tokens (HMAC-SHA256); at least 32 bytes; a list rotates keys: the first signs, any verifies
  keysetSecret: [process.env.KEYSET_SECRET_NEW ?? "", process.env.KEYSET_SECRET_OLD ?? ""].filter(Boolean),
});
// one query: Accounts.findOne(...).validateReads(true).plain()
```

- `validateReads` mismatch: `Cast to number failed at path "balance" for "12" (string): the stored value does not match the schema of Account (a document read from the database, checked by validateReads) [type]`. A bad value: `ConfigurationError: TypemoClient: validateReads must be true, false or "development", got "yes"`.
- Without `keysetSecret` a keyset token is readable and editable by the client (a tampered token only moves the position, the query filter still applies). With it: `KeysetTokenError: keysetPage: invalid cursor — it is not signed (the client signs its tokens: keysetSecret)`, `... the signature is not valid`, `... it is signed, but this client has no keysetSecret`. A short key: `ConfigurationError: TypemoClient: keysetSecret[0] is 3 bytes; an HMAC key needs at least 32`. Read the key from the environment, never from source.

## Common mistakes

- Bad: `Orders.find()` outside `PolicyContext.run` on a tenant model (`... the operation has no tenant ... [tenant]`). Good: open the scope per request from verified data; build the query inside it.
- Bad: tenant from the request body. Good: from the verified token.
- Bad: `Users.find({ name: body.name })` with client data. Good: `untrusted(body.name)`.
- Bad: `Users.deleteMany({})` or a filter assembled empty from missing client fields. Good: validate; `Filters.all()` only on purpose.
- Bad: `Model.updateOne({ _id }, { $set: { tenantId } })`. Good: never write the tenant field.
- Bad: reading `passwordHash` everywhere with `+passwordHash`. Good: only in the sign-in function.
- Bad: `.mask()` on a hydrated query (`TS2684 ... mask() masks rows: call .lean() or .plain() first`). Good: `.plain().mask(...)`.
- Bad: `@Prop(() => String, { hidden: true }) x?: string` (TS1240). Good: `Hidden<string>`.

## Self-check

- Every tenant model request runs inside `PolicyContext.run({ tenant })` built from verified data; cross-tenant code says `allTenants: true` explicitly.
- Every piece of client data entering a filter, update or projection passes `untrusted(value, place)`; its type, shape and range are validated separately.
- Hidden / sensitive fields are declared, and secrets are read only where needed; responses use `.plain()` with masks where partial data is shown.
- Production client has `NODE_ENV=production` (or `validateReads: false` deliberately) and a `keysetSecret` when tokens must not be forged.
- Audited models run on a replica set; soft-delete models use partial unique indexes.
