# Collections, indexes, views: init and sync

Read this before declaring indexes, special collections (capped, time series, clustered, collation, server validator), views, search indexes, or writing the application's start-up and deploy code. **Declaring an index or a collection option in the schema creates nothing by itself**: until `connection.init()` / `syncAll()` / `syncIndexes()` runs, the database has only `_id_` and a `unique: true` field accepts duplicates silently.

## Minimal working example: start-up

```ts
import { Entity, Index, Prop, Schema, SyncError, TypemoClient } from "@venloc/typemo";

@Index({ owner: 1, opened: -1 })
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) number!: string;
  @Prop(() => String, { index: true }) owner?: string;
  @Prop(() => Date) opened?: Date;
}

@Schema({ collection: "ledger", capped: { size: 65_536, max: 100 } })
class LedgerEntry extends Entity {
  @Prop(() => String, { required: true }) note!: string;
}

export const start = async (uri: string) => {
  const client = await TypemoClient.connect(uri, { name: "main" });
  const connection = client.connection;
  connection.model(Account); // register EVERY model (and view) before init
  connection.model(LedgerEntry);
  try {
    // creates what is missing (collections with their options, indexes, views); changes and drops nothing
    const report = await connection.init();
    console.log(report.created); // ["collection accounts", "index accounts.number_1", ...]
  } catch (error) {
    if (error instanceof SyncError) {
      for (const failure of error.failures) console.error(failure.kind, failure.name, failure.errors.map((e) => e.message));
    }
    throw error; // do not start with a database that does not match the schemas
  }
  return client;
};
```

## init vs syncAll vs model methods

| Call | Does | Use |
|---|---|---|
| `connection.init()` | creates missing collections, indexes, search indexes, views; changes/drops nothing; a mismatch is a failure (`SyncError`) | every application start |
| `connection.syncAll({ dryRun?, update? })` | brings the database to EXACT match: creates, modifies and **drops indexes that are not in the schema** | deploy script / CI; run `{ dryRun: true }` first |
| `Model.syncIndexes({ dryRun? })` | exact match of one model's indexes (also drops extras) | one model, tests |
| `Model.createIndexes()` | creates missing indexes only | |
| `Model.diffIndexes()` / `listIndexes()` | read the difference / what the server has | checks |
| `Model.createCollection()` | creates with the schema's options; `true` if created, `false` if it existed | |
| `Model.ensureCollection({ dryRun?, update? })` | creates, compares or updates (`collMod`) the options; returns `{ result: "created" \| "unchanged" \| "updated", differences }` | |
| `Model.diffSearchIndexes()` / `syncSearchIndexes()` | Atlas Search indexes (need Atlas Search) | |

Only classes registered with `connection.model(...)` (and views with `TypedView.define`) are looked at. A schema with `autoIndex: false` is skipped by the index steps of `init`/`syncAll`; `autoCreate: false` is skipped by the collection step (a schema with `autoCreate: false` and no indexes is skipped entirely). Direct `Model.syncIndexes()` ignores these two flags.

```ts
import { Entity, Prop, Schema, SyncError, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true, index: true }) owner!: string;
}

// scripts/deploy-database.ts
export const deploy = async (uri: string) => {
  const client = await TypemoClient.connect(uri, { name: "deploy" });
  try {
    const connection = client.connection;
    connection.model(Account);
    const plan = await connection.syncAll({ dryRun: true }); // writes nothing
    console.log(plan.created, plan.collections[0]?.indexes); // { toCreate, toDrop, toModify, dryRun }
    const report = await connection.syncAll(); // report.inSync is false when it changed something; a second call gives true
    console.log(report.failed, report.inSync); // `failed` is always false in a returned report: failure throws SyncError
  } catch (error) {
    if (error instanceof SyncError) console.error(error.failures.map((f) => [f.kind, f.name, f.errors.length]));
    throw error;
  } finally {
    await client.close();
  }
};
```

`SyncReport`: `collections[]` (`{ collection, model, options?, indexes?, searchIndexes?, errors }`), `views[]`, `inSync`, `created` (`"collection users"`, `"index users.email_1"`, `"search index users.default"`, `"view active_users"`), `failed`. `SyncError`: `operation` (`"connection.init" | "syncAll"`), `failures[]` (`{ kind: "collection" | "view", name, model, errors }`), `errors[]`, `report`. Model-level `syncIndexes`/`createIndexes` throw `IndexSyncError` (`failures[]` with `name`, `action`, `error`) unwrapped.

## Index declarations

```ts
import { Entity, Index, Prop, Schema } from "@venloc/typemo";

@Index({ title: "text", note: "text" }, { weights: { title: 5 }, name: "search" }) // text index
@Index({ email: 1 }, { unique: true, partialFilterExpression: { active: true }, name: "email_active" }) // unique for a part
@Schema({ collection: "accounts" })
class Contact extends Entity {
  @Prop(() => String, { index: true }) owner?: string; // single field
  @Prop(() => String, { unique: true }) code?: string;
  @Prop(() => String) email?: string;
  @Prop(() => Boolean) active?: boolean;
  @Prop(() => String) title?: string;
  @Prop(() => String) note?: string;
  @Prop(() => Date, { expires: 3600 }) lastSeen?: Date; // TTL index (expireAfterSeconds)
}
console.log(typeof Contact);
```

Soft-delete models: a unique index counts deleted documents too. Typemo hints at model creation to make it partial with `partialFilterExpression: { deletedAt: { $type: "null" } }`.

## Special collections: options exist only at creation

```ts
import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "recent_logs", capped: { size: 4096, max: 5 } }) // keeps the last 5
class Log extends Entity {
  @Prop(() => Number, { required: true }) n!: number;
}

@Schema({
  collection: "readings",
  timeseries: { timeField: "at", metaField: "sensor", granularity: "minutes", expireAfterSeconds: 3600 },
})
class Reading extends Entity {
  @Prop(() => Date, { required: true }) at!: Date;
  @Prop(() => String) sensor?: string;
  @Prop(() => Number) value?: number;
}

@Schema({ collection: "names", collation: { locale: "en", strength: 2 } }) // default collation: case-insensitive compare
class Named extends Entity {
  @Prop(() => String) name?: string;
}

@Schema({ collection: "checked", validator: true }) // the server validator is generated from the schema
class Checked extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { min: 0 }) age?: number;
}
console.log(typeof Log, typeof Reading, typeof Named, typeof Checked);
```

Also available: `clustered`, and the other `@Schema` collection options (see docs). Rules:

- `capped`, `timeseries`, `clustered`, `collation` can only be given at creation; an index or a first write would create a PLAIN collection and lose them. So a first write to a missing collection throws: `ConfigurationError: LedgerEntry.create: the collection "ledger" does not exist, and MongoDB would create it as a plain collection without the options of the schema that can only be given at creation (capped); create it first: await connection.init(), or await LedgerEntry.ensureCollection()`. Always run `connection.init()` at start.
- Mutable options (validator and others) are changed with `ensureCollection({ update: true })` (`collMod`); `ensureCollection({ dryRun: true })` shows `differences` (`[{ option, mutable, wanted, actual }]`). A `validator: true` collection created by a first write has no validator: call `ensureCollection({ update: true })`.
- A difference MongoDB cannot change (`capped`, `collation`, the kind of collection): `CollectionOptionsError` / `SyncError ... exists with options MongoDB cannot change (capped): drop the collection and create it again`. Typemo never drops a collection itself.
- `exists with other options (validator)` means a mutable difference: run with `update: true`.
- An index that exists with other keys/options: `init` fails with `SyncError` (`exists on the server with other keys or options`); inspect with `syncAll({ dryRun: true })`, apply `syncAll()` if dropping and recreating is acceptable.
- A text index is created once; a repeated `init()` gives `inSync: true, created: []`.

## Views and materialized results

`TypedView.define(connection, ViewClass, { on: SourceClass, pipeline })` declares a server view; its rows are the `ViewClass` fields (the pipeline is checked against the class: missing or mismatching fields do not compile). `connection.init()` / `syncAll()` create it; `view.ensure()` does it alone and returns `result: "created" | "unchanged" | "updated"`. Read it with `view.find(...)`, `countDocuments()`. Hidden fields of the source are removed by the stored pipeline's first stage.

```ts
import { Entity, EntityWithId, fn, Materialized, Prop, Schema, TypedView, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => Boolean, { required: true }) closed!: boolean;
}
@Schema({ collection: "open_accounts" })
class OpenAccount extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
@Schema({ collection: "owner_totals" })
class OwnerTotal extends EntityWithId(() => String) {
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Number, { required: true }) count!: number;
}

declare const client: TypemoClient;
const connection = client.connection;
connection.model(Account); // the source must be registered

// define each view ONCE, in its own module, and import it
export const openAccounts = TypedView.define(connection, OpenAccount, {
  on: Account,
  pipeline: (p) => p.match({ closed: false }).project({ owner: 1, balance: 1 }),
});

// a real collection filled by a pipeline; refresh() runs it ($merge or $out) when YOU call it
export const ownerTotals = Materialized.define(connection, OwnerTotal, {
  from: Account,
  pipeline: (p) => p.match({ closed: false }).group((f) => ({ _id: f.owner, total: fn.sum(f.balance), count: fn.sum(1) })),
});

await connection.init(); // creates the view
await ownerTotals.refresh(); // on a schedule (you call it); define({ ..., mode: "replace" }) also removes rows gone from the source
console.log(await openAccounts.find({ owner: "alice" }), await ownerTotals.model.find().lean());
```

- A changed view pipeline: `CollectionOptionsError: collection "open_accounts": the view exists with another definition (source or pipeline): run ensure({ update: true }) to change it` (`syncAll({ update: true })` does the same; the collation of a view cannot change: `drop()` and create).
- `ConfigurationError: view "open_accounts" is already defined on this connection with another definition`: define once. A view that does not exist yet: `the view "open_accounts" does not exist` (run `ensure` / `init`). A collection under the view's name: `exists as a collection, not a view: drop it or rename the view`.
- Materialized: default mode merges (rows of deleted sources stay as "dead" rows), `mode: "replace"` replaces; `on: "title"` (not `_id`) needs a unique index on exactly those fields: `ConfigurationError ... needs a unique index on exactly these fields` (run `model.syncIndexes()` first). The pipeline rows must contain every field of the result class (compile error otherwise; `_id` may be omitted).

## Search indexes (Atlas Search)

```ts
import { Entity, Prop, Schema, SearchIndex, type TypemoClient } from "@venloc/typemo";

@Schema({ collection: "articles" })
@SearchIndex({ name: "articles_text", definition: { mappings: { dynamic: true } } })
class Article extends Entity {
  @Prop(() => String, { required: true }) body!: string;
}
declare const client: TypemoClient;
const Articles = client.connection.model(Article);

const diff = await Articles.diffSearchIndexes(); // { toCreate, toUpdate, toDrop }
const plan = await Articles.syncSearchIndexes({ dryRun: true });
console.log(diff.toCreate, plan.toCreate);
```

Without Atlas Search the server answers `ServerError` code 31082 (`SearchNotEnabled`); `init`/`syncAll` fail with `SyncError` for a schema that declares a search index. One failed search index makes `init` and `syncAll` throw `SyncError` (reasons in `error.errors`, the full report in `error.report`). Do not declare `@SearchIndex` on models that also run where Atlas Search is absent.

## Common mistakes

- Bad: expecting `unique: true` to work without ever calling `init` / `syncAll` / `syncIndexes`: duplicates are written silently. Good: `await connection.init()` at start.
- Bad: first write to a collection that needs creation options (the `ConfigurationError` above). Good: `init()` first, or `Model.ensureCollection()`.
- Bad: running `syncAll()` in production start-up (it drops indexes that are not in the schema, e.g. ones another team created). Good: `init()` at start; `syncAll({ dryRun: true })` and then `syncAll()` as a deploy step.
- Bad: forgetting `connection.model(Account)` (not registered = ignored by init/syncAll; a view's source must be registered).
- Bad: swallowing `SyncError` and starting anyway. Good: log `failures`, exit.
- Bad: `Model.createCollection()` on a schema with `autoCreate: false` (it throws); Good: `ensureCollection()`.
- Bad: removing a field's index from the schema and expecting `init` to drop it. Good: `syncAll()`.

## Self-check

- The start-up code registers every model, then awaits `connection.init()` and refuses to start on `SyncError`.
- Collections with `capped` / `timeseries` / `clustered` / `collation` are created by `init` before any write.
- Index changes are rolled out with `syncAll({ dryRun: true })` then `syncAll()` in a deploy step; every view/materialized definition lives in one module.
- Unique indexes on soft-delete models are partial by `deletedAt: { $type: "null" }`.
