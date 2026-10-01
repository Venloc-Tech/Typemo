# Transactions, hooks, plugins, extensions

Read this before opening a transaction, writing `@Pre` / `@Post` / `@PostError`, a plugin, or a custom schema option (`ext`). Transactions need a replica set (a one-member one is enough); on a standalone `mongod` `client.transaction` throws at once: `ConfigurationError: TypemoClient "default": transaction(): transactions need a replica set or a sharded cluster; this server is a standalone mongod. Run MongoDB as a replica set (a single-member one is enough).`

## Transactions: the minimal example

```ts
import { Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
}

declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

// no session is passed anywhere: model operations inside the callback join the transaction (implicit session)
export const transfer = (from: string, to: string, amount: number) =>
  client.transaction(async () => {
    const source = await Accounts.findOne({ title: from }).orFail(); // read INSIDE the callback
    if (source.balance < amount) throw new Error("insufficient funds"); // any throw rolls everything back
    await Accounts.updateOne({ title: from }, { $inc: { balance: -amount } }); // atomic $inc, not "set to a computed value"
    await Accounts.updateOne({ title: to }, { $inc: { balance: amount } });
    return source.balance - amount;
  });

console.log(await transfer("Main", "Savings", 30));
```

Rules:

- The callback may run **several times**: the driver re-runs it from the start on a transient transaction error. Inside it do only database work; send emails / call payment APIs **after** `transaction` returns (or write an outbox row in the same transaction).
- **The "document loaded outside" trap**: a document read before the transaction and changed inside it gets the change applied again on every retry (balance 100, subtract 10 twice, saves 80 instead of 90). Read documents inside the callback and change numbers with `$inc`.
- Operations run one after another inside a transaction (no parallel `Promise.all` on the same session). Populate queries inside run sequentially too.
- Transactions do not nest: `ConfigurationError: transaction(): transactions do not nest (already inside a transaction of this client)`. Factor shared work into a function that does not call `transaction`.
- A model of **another client** cannot join: `ConfigurationError: Account.countDocuments: called inside a transaction of another client; its model cannot join that transaction — pass session(null) (or { session: null }) to run it outside explicitly`.
- Transaction-level settings go to `transaction(fn, options)`; an operation inside with its own `readConcern`, `writeConcern`, `readPreference` (other than primary) or `timeoutMS` gets `StrictModeError` with reason `transaction-option`.
- An error thrown by a hook inside the callback rolls the whole transaction back (an error in `@Post` too: the caller gets the hook's own error, not `PostHookError`).
- Raw driver calls do not join: pass `scope.session` yourself.

```ts
import { TypemoClient } from "@venloc/typemo";

declare const client: TypemoClient;
const raw = client.unsafeDriver().db("app").collection("accounts");

const total = await client.transaction(
  async (scope) => {
    console.log(scope.attempt, scope.session.inTransaction()); // attempt: 1 on the first run, 2 on the first retry
    await raw.insertOne({ title: "Raw", balance: 1 }, { session: scope.session }); // rolls back with the transaction
    return raw.countDocuments({}, { session: scope.session });
  },
  { readConcern: "snapshot", writeConcern: { w: "majority" }, timeoutMS: 5_000 }, // timeoutMS covers all retries
);
console.log(total);

// a wrapper that may be called inside or outside a transaction decides by currentTransaction()
export const inTransaction = <R>(work: () => Promise<R>): Promise<R> =>
  client.currentTransaction() !== undefined ? work() : client.transaction(work);

// run one operation OUTSIDE the current transaction on purpose (e.g. an audit row that must survive a rollback)
// await Audit.create({ ... }, { session: null });  /  query.session(null)
```

A timeout throws `TimeoutError` (`kind: "transaction"` for the transaction's `timeoutMS`, `"operation"` for one operation's). Check `client.supportsTransactions` at start-up to fail early.

## Manual sessions

Only when the commit decision is made by something outside the callback. Otherwise use `client.transaction`.

```ts
import { Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

const session = await client.startSession();
try {
  session.startTransaction();
  const main = await Accounts.findOne({ title: "Main" }).session(session).orFail(); // the document remembers the session
  main.balance = main.balance - 10;
  await main.$save(); // writes in the same transaction
  await Accounts.updateOne({ title: "Savings" }, { $inc: { balance: 10 } }).session(session);
  await Accounts.create({ title: "Extra", balance: 5 }, { session }); // writes take { session }
  await session.commitTransaction();
} catch (error) {
  if (session.inTransaction()) await session.abortTransaction();
  throw error;
} finally {
  await session.endSession(); // always
}
```

Forgetting the session on one operation writes it OUTSIDE the transaction and it is not rolled back. No parallel operations on one session.

## Document hooks (`document.*`)

Events: `document.save` (every way to insert: `create`, `insertOne`, `insertMany`, `$save`, `bulkSave`, insert inside `bulkWrite`; also runs for an unchanged document), `document.validate`, `document.init` (hydration; not for lean/plain), `document.updateOne` (`$updateOne`), `document.deleteOne` (`$deleteOne`). A hook declared on a class also runs on every subdocument of that class, so `this` is `HydratedDoc<T> | Subdocument<T>` and `$isRoot()` narrows to the root document. Declare `this` as `HookThis<"document.save", Account>`.

```ts
import { Entity, Post, PostError, Pre, Prop, Schema, type HookThis } from "@venloc/typemo";

@Schema()
class Line {
  @Prop(() => String, { required: true }) note!: string;

  @Post("document.save")
  logLine(this: HookThis<"document.save", Line>): void {
    console.log(`line ${this.note} saved, root: ${this.$isRoot()}`); // false for a subdocument
  }
}

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, minLength: 3 }) title!: string;
  @Prop(() => [Line]) lines!: Line[];

  // change values in @Pre (a change in @Post is not written)
  @Pre("document.save")
  normalize(this: HookThis<"document.save", Account>): void {
    this.title = this.title.trim();
    if (this.$isRoot()) console.log(this.$getChanges()); // root-only methods after the narrowing
  }

  @Post("document.save")
  saved(this: HookThis<"document.save", Account>): void {
    console.log("saved", this.title);
  }

  @PostError("document.save")
  failed(this: HookThis<"document.save", Account>, error: unknown): void {
    console.error("not saved", error); // log and return: do not throw a new error here
  }
}
console.log(typeof Account);
```

Order and errors:

- Hooks of one event and phase run strictly one after another (async ones are awaited): base class first, then the class in declaration order, then plugins. `@Post` runs in the same order as `@Pre` (not reversed). All `@Pre`, the operation, all `@Post`. For subdocuments: root pre, subdocument pre, subdocument post, root post.
- An error in `@Pre` cancels the operation (the database is not touched), and `@PostError` runs. `@PostError` runs only for an error of the operation or of `@Pre`, never for an error thrown by `@Post`.
- An error in `@Post` of a write outside a transaction becomes `PostHookError` with `applied: true` (the write HAPPENED, do not retry), `operation`, `result`, and the hook's error in `cause`. For reads the hook's error is thrown as is. Inside a transaction the write rolls back and you get the hook's own error.
- An error thrown by `@PostError` replaces the original; the original stays in `cause`.
- `updateOne`/`deleteOne` on the model fire `query.*`, NOT `document.*`. To run document hooks load the document and call `$save` / `$updateOne` / `$deleteOne`.
- `insertMany([])` and `bulkWrite([])` still run their `@Pre` and `@Post`.

## Operation hooks (`query.*`, `model.*`, `aggregate`)

Events: `query.find`, `query.findOne` (also `findById`, `exists`), `query.countDocuments`, `query.estimatedDocumentCount`, `query.distinct`, `query.updateOne`, `query.updateMany`, `query.replaceOne`, `query.deleteOne`, `query.deleteMany`, `query.findOneAndUpdate` (also `findByIdAndUpdate`), `query.findOneAndReplace`, `query.findOneAndDelete`, `model.insertMany`, `model.bulkWrite`, `aggregate`. There is no operation event for `insertOne` (use `document.save`). `this` is `OperationHookContext<T, Event>`: it shows what will be sent (`filter`, `update`, `model`, `operation`, `session`, `inTransaction`, `policy`, `operationId`, `bulkIndex`).

```ts
import { type Defaulted, Entity, Post, Pre, Prop, Schema, type OperationHookContext } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Boolean, { default: false }) archived!: Defaulted<boolean>;
  @Prop(() => Number, { default: 0 }) revision!: Defaulted<number>;

  // modify(): only in @Pre; keys depend on the event (find: where/select/sort; updateMany: where/update)
  @Pre("query.find")
  onlyActive(this: OperationHookContext<Account, "query.find">): void {
    this.modify({ where: { archived: false } });
  }

  @Pre("query.updateMany")
  bump(this: OperationHookContext<Account, "query.updateMany">): void {
    this.modify({ update: { $inc: { revision: 1 } } });
  }

  // skip(result): do not send the operation, return this result (only in @Pre; not for one operation of a bulkWrite)
  @Pre("query.deleteMany")
  dryRun(this: OperationHookContext<Account, "query.deleteMany">): void {
    this.skip({ acknowledged: true, deletedCount: 0 });
  }

  // inside bulkWrite the result is a BulkOperationResult whose counters are null
  @Post("query.deleteMany")
  logDeleted(this: OperationHookContext<Account, "query.deleteMany">, result: { readonly deletedCount: number | null }): void {
    console.log(`deleted: ${result.deletedCount}, bulk index: ${this.bulkIndex}`); // bulkIndex is undefined outside bulkWrite
  }
}
console.log(typeof Account);
```

- A modified operation passes all policies again: a hook cannot leave the tenant or lift soft delete. After `modify`, `this.filter` still shows the old value in the same hook; the next hook sees the new one.
- Inside `bulkWrite` each operation (`updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`) fires its `query.*` hooks with `this.bulkIndex` = position in the list; `modify` changes that one operation; a pre-hook of `model.bulkWrite` can skip the whole batch. Order: insert documents' `@Pre` with validation, operation `@Pre` by list order, `model.bulkWrite` `@Pre`, the request, then `@Post` of `model.bulkWrite`, then of operations and documents. A failed batch ends with `@Post` for operations the server applied and `@PostError` for the rest.
- Operation hooks belong to the **model** class. `@Pre("query.find")` in a class used only as a subdocument never runs, and nothing warns. Put it on the model class.

## Plugins

A plugin is an object `{ name, apply(builder, options), statics? }`. `builder` has `target`, `fieldKeys`, `addHook(phase, event, fn)`, `addField(name, () => Type)`, `enablePolicy("softDelete", true)`. Registration levels, applied in this order: global `Typemo.plugin(p)`, connection `connection.plugins.use(p)`, model `@Plugin(p, options)`. Global and connection registries close at the first compiled model: register at the very start of the process.

```ts
import { Entity, Plugin, Prop, Schema, Typemo, TypemoClient, type Model, type SchemaPlugin } from "@venloc/typemo";

const statics = {
  async byTitle(this: Model<Account>, title: string): Promise<number> {
    return this.countDocuments({ title });
  },
};

export const tools: SchemaPlugin<undefined, typeof statics> = {
  name: "tools", // unique
  apply: (builder) => {
    builder.addHook("post", "query.find", function () {
      console.log(`read a list of ${builder.target.name}`);
    });
  },
  statics, // methods of the model; a name clashing with a Model method is an error
};

export const noted: SchemaPlugin<{ readonly field: string }> = {
  name: "noted",
  apply: (builder, options) => {
    builder.addField(options.field, () => String);
  },
};

@Plugin(tools)
@Plugin(noted, { field: "note" })
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
}

Typemo.plugin(tools); // every client, every model; call before the first model (here only to show the call)
declare const client: TypemoClient;
client.connection.plugins.use(noted, { field: "note" }); // every model of this connection
const Accounts = client.connection.model(Account);
console.log(await Accounts.statics(tools).byTitle("Main")); // typed access to the plugin's statics
```

- The same plugin at two levels with equal options applies once (at its first place); with different options: `ConfigurationError: Account: plugin "stamped" is registered twice (connection and model) with different options`. Two different plugins with one name: `ConfigurationError: Account: two different plugins are named "both"`. A plugin that is not an object with a name: `ConfigurationError: a plugin is an object { name, apply(builder, options) }`.
- Too late: `ConfigurationError: plugin "late": the global plugins are fixed once a schema is compiled (Account was); register plugins before the first model` (for a connection: "the connection plugins").

## Extensions: custom keys in `ext`

Add your own option to `@Prop` / `@Schema` with a type declaration (compile time) AND a registration (run time). Both are needed; register before the first model (`Typemo.use` for every client, `client.use` for one).

```ts
import { Entity, Prop, Schema, Typemo, type Defaulted, type TypemoExtension } from "@venloc/typemo";

declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string; readonly format?: (value: V) => string };
  }
  interface SchemaExtensions {
    label?: { readonly title: string };
  }
}

export const label: TypemoExtension<"label"> = {
  name: "label",
  validateProp: (value, field) => {
    const text = (value as { text?: unknown }).text;
    if (typeof text !== "string" || text === "") throw new TypeError(`text must be a non-empty string (${field.kind})`);
  },
  validateSchema: (value) => {
    if (typeof (value as { title?: unknown }).title !== "string") throw new TypeError("title must be a string");
  },
};
Typemo.use(label);

@Schema({ collection: "accounts", ext: { label: { title: "Accounts" } } })
class Account extends Entity {
  @Prop(() => String, { required: true, ext: { label: { text: "Title" } } }) title!: string;
  @Prop(() => Number, { default: 0, ext: { label: { text: "Balance", format: (v) => v.toFixed(2) } } }) balance!: Defaulted<number>;
}
console.log(typeof Account); // read back: model.schema.ext, model.schema.extOf("title")
```

Errors: `ConfigurationError: Account: ext "label" is not a registered extension; register it before the first model with client.use() (for the models of one client) or Typemo.use() (for every client)`; late: `extension "late": extensions are fixed once a schema is compiled (Account was); call client.use() before the first model`; a key on `@Schema` without `validateSchema`: `Bad2: extension "label" has no schema options (used on a schema)`. An extension must not change core policies (tenant, soft delete, strict, sanitize, Hidden): it reads options and may add hooks.

## Common mistakes

- Bad: `Accounts.updateOne(...)` and expecting `@Pre("document.save")`. Good: load the document and `$save()`, or hook `query.updateOne`.
- Bad: `@Post("document.save")` that changes `this` and expects it to be written. Good: change in `@Pre`.
- Bad: `this: HydratedDoc<Account>` in a document hook. Compile error: `@Pre("document.save"): a document hook may also run on a subdocument of the class; declare this as HydratedDoc<Entity> | Subdocument<Entity>, or narrow with if (this.$isRoot())`. Good: `HookThis<"document.save", Account>` and `$isRoot()`.
- Bad: `this: Account` then `this.$isNew()`: `TS2339: Property '$isNew' does not exist on type 'Account'`. Good: `HookThis`.
- Bad: `this.modify(...)` / `this.skip(...)` in `@Post`: `QueryError: Account.find: modify() is only for pre hooks (the operation already ran)`. Bad: `modify({ update })` for `find`: `QueryError: Account.find: modify(): "update" does not apply to find`.
- Bad: retrying `create` after a `PostHookError` (the document is stored; look at `error.applied`). Good: catch inside `@Post`, or run in a transaction.
- Bad: side effects, or a document loaded earlier, inside a transaction callback. Bad: forgetting `{ session }` in a manual session.

## Self-check

- Transaction callbacks read their documents inside, change numbers with `$inc`, and have no side effects other than database work.
- No `Promise.all` of writes inside one transaction; no nested `transaction`; raw driver calls get `scope.session`.
- Hooks use `HookThis` / `OperationHookContext`, change data only in `@Pre`, never throw from `@PostError`.
- Plugins and extensions are registered before the first model; extensions have both the `declare module` type and `Typemo.use` / `client.use`.
