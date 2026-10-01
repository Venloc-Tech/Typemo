# 01 Setup: install, tsconfig, client, connection

Read this first when starting a project, creating the client, or debugging "nothing is saved / process hangs / wrong database".

## Minimal working setup

```bash
bun add @venloc/typemo mongodb bson
bun add -d typescript @types/bun
```

`mongodb` (driver, `^7.6.0`) and `bson` (`^7.3.3`) are peer dependencies: install them explicitly. `reflect-metadata` comes with the core; never write `import "reflect-metadata"`. Typemo supports only the latest MongoDB, driver, Bun and TypeScript 6.

`tsconfig.json` for the core (legacy decorators):

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "experimentalDecorators": true,
    "noEmit": true,
    "types": ["bun"]
  },
  "include": ["src"]
}
```

Only `experimentalDecorators` is required for the core. `emitDecoratorMetadata` and `allowImportingTsExtensions` are not needed. The three strict flags are recommended: without them you lose part of the type checks.

Bun reads `tsconfig.json` from the directory you run the command in. Run `bun run ...` from the package/project folder that owns the tsconfig.

First script:

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
await client.connection.init(); // create collections and indexes (nothing is created automatically)
console.log(await Accounts.countDocuments());
await client.close();
```

## Legacy vs TC39 decorators

One choice per project, made by the compiler flag:

| Project | Package for `@Schema`, `@Prop`, ... | `experimentalDecorators` |
|---|---|---|
| Legacy (NestJS, TypeORM, class-validator in the project) | `@venloc/typemo` | `true` |
| TC39 (standard decorators) | `@venloc/typemo-decorators` | absent or `false` |

```bash
bun add @venloc/typemo @venloc/typemo-decorators mongodb bson
```

```typescript
// TC39 project: decorators come from the adapter, everything else from the core
import { Entity } from "@venloc/typemo";
import { Prop, Schema } from "@venloc/typemo-decorators";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true })
  name!: string;
}
```

`Entity`, `EntityWithId`, `Types`, `Ref`, `Hidden`, `Defaulted`, `Spec`, `TypemoClient` stay in `@venloc/typemo`. The field type is always a function (`() => String`): Typemo never reads `design:type`.

## Creating the client

```ts
import { TypemoClient } from "@venloc/typemo";

// Connected client: the usual choice. One per process, exported from one file.
export const client = await TypemoClient.connect("mongodb://localhost:27017/app", {
  name: "main",
  timeoutMS: 30_000,
});
```

```ts
import { TypemoClient } from "@venloc/typemo";

// Client that must exist before the app is ready to connect (e.g. exported from a module).
export const lazyClient = new TypemoClient("mongodb://localhost:27017", {
  dbName: "app",
  readyTimeoutMS: 5_000,
});

export const start = async (): Promise<void> => {
  await lazyClient.connect(); // repeated calls are safe
  await lazyClient.ready(0); // 0 = wait without limit
};
```

Rules:
- The first argument must start with `mongodb://` or `mongodb+srv://`.
- There is no global client. Create it once; every new client opens a new pool. Never create a client per request.
- Until `connect()` is called, model operations wait (they are not lost), but not longer than the operation's own `timeoutMS` or `readyTimeoutMS` (default 10000).
- If `connect()` fails, state returns to `idle`, and `connect()` can be called again.
- After `close()` the client cannot be reopened; operations throw `ConnectionError`.

### Options (`TypemoClientOptions` = driver options + these)

| Option | Type | Default | Meaning |
|---|---|---|---|
| `dbName` | `string` | database of the URI, else `test` | Default database for `client.connection` / `client.db()`. Conflict with the URI database throws. |
| `name` | `string` | `default` | Client name in events and error texts. |
| `timeoutMS` | `number` | none | Client-side operation deadline (non-negative integer). Replaces `socketTimeoutMS`, `waitQueueTimeoutMS`, `wtimeoutMS` (these three are rejected). |
| `readyTimeoutMS` | `number` | `10000` | How long an operation waits for connect when it has no `timeoutMS`. `0` = forever. |
| `validateReads` | `boolean \| "development"` | `false` | Strict read: every read document is checked against the schema, mismatch is `CastError`. `"development"` = on unless `NODE_ENV=production`. |
| `keysetSecret` | `string \| Uint8Array \| (string \| Uint8Array)[]` | off | HMAC-SHA256 key (at least 32 bytes) that signs keyset pagination tokens (`nextCursor`). A list allows key rotation. |

BSON options (`useBigInt64`, `promoteLongs`, ...) are set by Typemo; repeating its value is allowed, changing it throws `ConfigurationError: options: BSON options conflict with Typemo`. All other `MongoClientOptions` (`maxPoolSize`, `serverSelectionTimeoutMS`, ...) pass through to the driver.

The merged result is readable and frozen: `client.options.dbName`, `.name`, `.readyTimeoutMS`, `.validateReads`.

## Connection, models, databases

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;
}

declare const client: TypemoClient;

const connection = client.connection; // default database; same as client.db()
const Accounts = connection.model(Account); // same object on every call for one class + connection
console.log(Accounts === client.db().model(Account)); // true

const archive = client.db("app_archive"); // same client and pool, another database
await archive.model(Account).create({ title: "Old" }); // not visible from the "app" database
// connection.useDb("app_archive") is the same as client.db("app_archive")

await client.transaction(async () => {
  // one transaction may span several databases of one client (replica set only)
  await Accounts.create({ title: "Live" });
  await archive.model(Account).create({ title: "Copy" });
});
```

- `connection.model(Class)` compiles the schema on the first call: schema errors surface there, not at the first write.
- A model of the same class on another database is a different model with its own data.
- `connection.models` lists registered models (`readonly Model<object>[]`).

## `connection.init()` at start

Typemo creates nothing in the database on its own: not collections, not indexes. `unique` is not enforced until the index exists. Call `init()` at application start or in a deploy step, after all models are registered:

```ts
import { SyncError, TypemoClient } from "@venloc/typemo";

declare const client: TypemoClient;

try {
  const report = await client.connection.init();
  console.log(report.inSync, report.created); // true ["collection accounts", "index accounts.title_1"]
} catch (error) {
  if (error instanceof SyncError) {
    console.log(error.operation, error.failures.map((failure) => failure.name));
  }
  throw error;
}
```

`init()` only creates what is missing; it never drops or changes anything. A returned report always has `failed: false`; any failed step becomes a `SyncError` (all other steps still run). To replace a differently declared index use `connection.syncAll()`.

## State, readiness, close

```ts
import { TypemoClient } from "@venloc/typemo";

declare const client: TypemoClient;

console.log(client.state); // "idle" | "connecting" | "connected" | "unavailable" | "closed"
const stop = client.onStateChange((state) => console.log("db:", state)); // only changes, not the initial state
if (client.supportsTransactions === false) {
  throw new Error("replica set required"); // false = standalone mongod, undefined = never connected
}
stop();
await client.close(); // closes the pool; a second close does nothing
```

Scripts: declare the client with `await using` so it closes even on a throw:

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

{
  await using client = await TypemoClient.connect("mongodb://localhost:27017/app");
  console.log(await client.connection.model(Account).countDocuments());
}
```

Transactions, change streams, and writes to models with audit need a replica set (a one-node replica set is enough for development).

## Common mistakes

Bad: the process does not exit after the script finished.
```ts
import { TypemoClient } from "@venloc/typemo";

const leaky = await TypemoClient.connect("mongodb://localhost:27017/app");
console.log(leaky.state);
```
Good: `await client.close()` at the end, or `await using client = ...`.

Bad: data ends up in database `test`. Neither `dbName` nor a database in the URI was given. Good: `mongodb://localhost:27017/app` or `{ dbName: "app" }`.

Bad: `new TypemoClient("localhost:27017")`.
```text
ConfigurationError: TypemoClient: the first argument is a connection string (mongodb:// or mongodb+srv://)
```
Good: `new TypemoClient("mongodb://localhost:27017/app")`.

Bad: `dbName: "other"` with a URI ending in `/app`.
```text
ConfigurationError: TypemoClient: dbName "other" conflicts with the database "app" of the connection string
```
Good: give the database once, or the same name in both.

Bad: `{ socketTimeoutMS: 5000 }` (also `waitQueueTimeoutMS`, `wtimeoutMS`, also as `?waitQueueTimeoutMS=5` in the URI).
```text
ConfigurationError: TypemoClient: socketTimeoutMS is not supported; use timeoutMS (client-side operation timeout)
```
Good: `{ timeoutMS: 5000 }`.

Bad: `new TypemoClient(uri)` and never calling `connect()`.
```text
TimeoutError: TypemoClient "default" is not connected after 100 ms: call connect() (operations issued before connect() wait for it)
```
Good: call `await client.connect()` at start, or use `TypemoClient.connect(uri)`.

Bad: using a closed client.
```text
ConnectionError: TypemoClient "main" is closed; create a new client
```
Good: create a new client; do not close it before the last operation finished.

Bad: server unreachable. `TypemoClient.connect` throws `ConnectionError: no server available: connect ECONNREFUSED 127.0.0.1:1` only after `serverSelectionTimeoutMS` (default 30 s). Good: fix the address; lower `serverSelectionTimeoutMS` for fast failure. `ConnectionError.failure` is `closed`, `server-selection`, `network` or `authentication`.

Bad: legacy project (`experimentalDecorators: true`) importing decorators from `@venloc/typemo-decorators`.
```text
ConfigurationError: @Prop from "@venloc/typemo-decorators" is a TC39 decorator, but it was applied as a legacy decorator (experimentalDecorators is on). Use "@venloc/typemo" in a legacy project; the two packages cannot be mixed
```
Good: legacy flag on -> import from `@venloc/typemo`; flag off -> `@venloc/typemo-decorators`. The reverse mix gives the mirrored text (`... is a legacy decorator, but it was applied as a TC39 decorator (experimentalDecorators is off). Use "@venloc/typemo-decorators" ...`).

Bad: `connection.model(NotAClass)`.
```text
ConfigurationError: connection.model: an entity class (@Schema)
```
Good: pass a class decorated with `@Schema`.

Bad: unique violation never fires because `init()` was not called. Good: call `connection.init()` once at startup.

## Self-check

- tsconfig has `experimentalDecorators` (legacy) or not (TC39), and the import matches.
- `mongodb` and `bson` are installed next to the core.
- One client per process, created at startup, closed at shutdown.
- Database is named explicitly (URI or `dbName`).
- `connection.init()` runs at startup after models are registered.
- Timeouts use `timeoutMS`; no `socketTimeoutMS`, `waitQueueTimeoutMS`, `wtimeoutMS`.
- Transactions are only used when `client.supportsTransactions` is `true`.
