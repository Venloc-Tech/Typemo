# Testing and production

Read this before writing tests for an application that uses Typemo, before the first deploy, or when adding monitoring. Typemo's rule for tests: **a real MongoDB, never mocks of the model**. Typemo's strictness (casts, policies, indexes, transactions, audit) lives in the server round trip; a mock proves nothing. Transactions, change streams and audit need a replica set, so tests run on a one-node replica set.

## Minimal working test (bun)

```ts
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { Entity, Filters, Prop, Schema, TypemoClient } from "@venloc/typemo";
import { defineFactory } from "@venloc/typemo/testing";

interface TestMongo {
  readonly uri: string;
  stop(): Promise<void>;
}
declare const startTestMongo: () => Promise<TestMongo>; // the helper below, from "./test-mongo.ts"

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

let mongo: TestMongo;
let client: TypemoClient;

beforeAll(async () => {
  mongo = await startTestMongo(); // one-node replica set: transactions, audit and change streams work
  client = await TypemoClient.connect(mongo.uri, { dbName: "bank-test", validateReads: true });
  client.connection.model(Account);
  await client.connection.init(); // creates indexes: without it a uniqueness test passes with no index
});

beforeEach(async () => {
  await client.connection.model(Account).deleteMany(Filters.all()); // "all" on purpose: an empty {} is refused
});

afterAll(async () => {
  await client.close(); // otherwise the process does not exit
  await mongo.stop();
});

const accountFactory = () => defineFactory(client.connection.model(Account), (n) => ({ title: `Account ${n}`, balance: 100 }));

test("a duplicate title is refused by the index", async () => {
  const accounts = accountFactory();
  await accounts.create({ title: "Main" });
  await expect(accounts.create({ title: "Main" })).rejects.toThrow("duplicate key");
});
```

The helper (needs the dev dependency `mongodb-memory-server`; `MONGOMS_VERSION` picks the server version):

```ts
// test-mongo.ts
import { MongoMemoryReplSet } from "mongodb-memory-server";

export interface TestMongo {
  readonly uri: string;
  stop(): Promise<void>;
}

export const startTestMongo = async (): Promise<TestMongo> => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return { uri: replSet.getUri(), stop: async () => void (await replSet.stop()) };
};
```

Rules for tests:

- One client per test file (or per suite), a **different `dbName` per test file** when files run in parallel; close the client in `afterAll`.
- Clean between tests with `Model.deleteMany(Filters.all())` (or drop the test database). A literal `{}` in a write does not compile, and `deleteMany(JSON.parse("{}"))` throws `StrictModeError ... [empty-filter]`.
- Create indexes with `await connection.init()` (or `Model.syncIndexes()`) in `beforeAll`: indexes are not created on connect.
- Prefer the newest MongoDB you ship against; the project itself tests on the upcoming branch with `mongodb-memory-server` replica set.
- Set `validateReads: true` in test clients: it catches documents whose stored shape differs from the schema.
- Test the error paths, not only the happy path: assert the class (`DuplicateKeyError`, `StrictModeError` with `reason`, `CastError` with `reason`), not the message text.

## Factories (`@venloc/typemo/testing`)

`defineFactory(model, (n) => defaults)` builds typed test data; `n` is a counter (1, 2, ...) so unique fields never collide. Renaming a model field breaks the factory at compile time.

```ts
import { Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";
import { defineFactory } from "@venloc/typemo/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}

declare const client: TypemoClient;
const accounts = defineFactory(client.connection.model(Account), (n) => ({ title: `Account ${n}`, balance: 100 }));

const draft = accounts.build({ balance: 5 }); // data only, nothing saved
const vip = accounts.build((n) => ({ title: `VIP ${n}` })); // an override may be a function of the counter
const rich = await accounts.create({ balance: 1_000_000 }); // saved through model.create, returns the document
const three = await accounts.createMany(3, (n) => ({ balance: n * 10 })); // saved one by one
const drafts = accounts.buildMany(2);
accounts.reset(); // the counter starts from 1 again
console.log(draft, vip, rich, three, drafts);
```

An override replaces a field entirely (nested objects are not merged). A bad count: `TypemoError: defineFactory: count must be a non-negative integer, got -1`.

## Index and plan assertions

```ts
import { Entity, Prop, Schema, type TypemoClient } from "@venloc/typemo";
import { expectCollScan, expectIndexScan, explainIndexUsage, IndexUsageError } from "@venloc/typemo/testing";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
declare const client: TypemoClient;
const Accounts = client.connection.model(Account);

// fail the test when a hot query stops using its index
await expectIndexScan(Accounts.find({ title: "Account 1" }), { index: "title_1", maxDocsExamined: 1 });
// a covered query: only index fields, no `_id`
await expectIndexScan(Accounts.find({ title: { $gte: "A" } }).select({ title: 1, _id: 0 }), { covered: true });
await expectCollScan(Accounts.find({ balance: 100 })); // assert that a query scans (e.g. documents the missing index)
const usage = await explainIndexUsage(Accounts.find({ balance: 100 }));
try {
  await expectIndexScan(Accounts.find({ balance: 100 }));
} catch (error) {
  if (error instanceof IndexUsageError) console.log(error.usage.stages, usage.stages); // e.g. ["COLLSCAN"]
}
```

`findById` and `find` by a unique field read the document, so they are not "covered" (`it is not covered by the index (it fetches documents)`): use `select` of index fields only. Indexes must exist (`init`/`syncIndexes`) or the query is a `COLLSCAN`.

## Type tests for your own models

Use `// @ts-expect-error` with the reason, and a type-equality helper. They only count if `tsc` includes the test file.

```ts
// @errors: 2344
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <_T extends true>(): void => {};

assertType<Equal<{ a: number }, { a: number }>>(); // compiles
assertType<Equal<{ a: number }, { a: string }>>(); // the type test itself must fail to compile
```

For example `assertType<Equal<(typeof rows)[number]["title"], string>>()` pins the type of a `select`ed `plain()` row. A `// @ts-expect-error` that no longer errors is itself an error (`Unused '@ts-expect-error' directive`): delete it.

## Production checklist

```ts
import { TypemoClient } from "@venloc/typemo";

// db/client.ts
export const client = await TypemoClient.connect(process.env.MONGODB_URI ?? "", {
  name: "main",
  dbName: "app", // explicit: without a name in the URI the database is "test"
  readyTimeoutMS: 5_000, // how long an operation waits for the connection (default 10 000; 0 = forever)
  timeoutMS: 15_000, // ONE client-side deadline per operation (replaces socket/waitQueue/wtimeout; those options are rejected)
  validateReads: "development", // checks reads against the schema everywhere except NODE_ENV=production
  keysetSecret: process.env.KEYSET_SECRET ?? "", // >= 32 bytes; signs pagination tokens
});

export const bootstrap = async () => {
  if (client.supportsTransactions === false) throw new Error("MongoDB must run as a replica set"); // fail early
  await client.connection.init(); // collections with options, indexes, views; throws SyncError on a mismatch
};

// shutdown: let in-flight work finish, then close; otherwise the process hangs
export const shutdown = async () => {
  await client.close();
};
```

1. **Register every model, then `await connection.init()` at start** and refuse to start on `SyncError`. Roll index changes out as a deploy step: `syncAll({ dryRun: true })`, then `syncAll()` (it drops extra indexes).
2. **Replica set** in production and in tests (transactions, audit, change streams); check `client.supportsTransactions`.
3. **Timeouts**: set `timeoutMS` (one deadline per operation) and `readyTimeoutMS`; transactions have their own `timeoutMS` option; a `TimeoutError` maps to 503.
4. **`NODE_ENV=production`** is required for `validateReads: "development"` to switch off. When `NODE_ENV` is unset reads are checked (cost). Use `true` / `false` explicitly if you want something else.
5. **`keysetSecret`** from the secret store (>= 32 bytes; a list rotates keys) if clients get pagination tokens.
6. **Close the client** on shutdown (`await client.close()`), or `await using client = await TypemoClient.connect(...)` in scripts; create **one** client per process, not per request.
7. **Error boundary** and policy scopes: file 10 and file 09 (`PolicyContext.run` per request).
8. Secrets: connection string and keys from the environment, never from source or the repo.
9. Do not use `client.unsafeDriver()` for ordinary work: it bypasses policies and types. Raw writes inside a transaction need `{ session: scope.session }`.

## Observability

The core emits events; adapters are separate packages (`@venloc/typemo-opentelemetry`, `@venloc/typemo-sentry`) and each is registered **once** per target (twice gives duplicate spans). Without subscribers the core does no event work.

```ts
import { TypemoClient } from "@venloc/typemo";

declare const client: TypemoClient;

// your own subscriber: handle() receives events of every operation
const subscription = client.instrument({
  sensitive: "mask", // values in summaries are "?" by default; "hide" -> "[hidden]"; "show" only on purpose
  handle: (event) => {
    if (event.type === "operation.end" && event.durationMS > 100) {
      console.warn(`slow: ${event.model ?? event.database}.${event.operation} ${Math.round(event.durationMS)} ms`);
    }
    if (event.type === "operation.error") console.error(event.operation, event.classification.kind, event.failedStep);
    if (event.type === "transaction.retry") console.warn(`transaction ${event.transactionId} retry, attempt ${event.attempt}`);
  },
});
subscription.unsubscribe();
// driver command and pool events need the client option monitorCommands: true:
// client.instrument({ driverCommands: true, poolEvents: true, handle }) -> ConfigurationError without it:
// TypemoClient "default": driver command events need the client option monitorCommands: true
```

OpenTelemetry and Sentry (each needs its own SDK set up first):

```typescript
import * as Sentry from "@sentry/node";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { TypemoClient } from "@venloc/typemo";
import { TypemoOpenTelemetry } from "@venloc/typemo-opentelemetry";
import { TypemoSentry } from "@venloc/typemo-sentry";

declare const client: TypemoClient;

// spans nest only when a context manager is registered (otherwise spans have no parent)
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
// ... register your tracer provider with trace.setGlobalTracerProvider(...) before instrumenting
console.log(typeof trace);

TypemoOpenTelemetry.instrument(client, {
  sensitive: "mask", // db.query.text keeps the query shape with "?" instead of values
  includeTenant: false, // typemo.tenant only with true
  stepSpans: false, // true: spans for steps (cast, validate, populate, ...)
  commandSpans: false, // true: spans of driver commands; REQUIRES monitorCommands: true on the client
  poolMetrics: false, // true: connection pool metrics; db.client.operation.duration is always recorded
});

Sentry.init({ dsn: process.env.SENTRY_DSN ?? "" });
TypemoSentry.instrument(client, {
  captureErrors: true, // every operation error goes to captureException (no filtering by kind: use beforeSend)
  breadcrumbs: true, // one breadcrumb per operation end/error
  sensitive: "mask", // CastError / ValidationError / DuplicateKeyError values are "?"
  includeTenant: false, // tag typemo.tenant on errors only with true; breadcrumbs never carry it
});
```

- Spans: `Typemo.<operation> (<Model>)` (CLIENT) with `Typemo.transaction` as the parent of operations in it; `db.query.summary`, `error.type` on failures; `Typemo.step ...` children with `stepSpans`.
- Sentry events carry tags `typemo.error_class`, `typemo.classification`, `typemo.operation`, `typemo.model` and a `typemo` context (`database`, `failedStep`, `serverCode`, `retryable`, `transient`); the message is already masked. A `ValidationError` thrown by a `pre('save')`-type hook before the operation does not reach Sentry; `create`/`$save`/`bulkSave` validation does.
- An adapter cannot change core policies (tenant, soft delete, strict, sanitize, Hidden, `sensitive`); schema `sensitive` marks and `Hidden` fields stay masked even with `sensitive: "show"`.
- Custom integrations use the same `client.instrument` / `Typemo.instrument` events; a handler that throws must not break the operation.

## Common mistakes

- Bad: tests with a mocked model, or on a standalone `mongod` (transactions: `ConfigurationError: ... transactions need a replica set or a sharded cluster; this server is a standalone mongod`). Good: `MongoMemoryReplSet` with one node.
- Bad: a uniqueness test that passes without an index (no `init`/`syncIndexes` in `beforeAll`). Good: create indexes first.
- Bad: `deleteMany({})` between tests. Good: `deleteMany(Filters.all())`.
- Bad: a test file that never closes the client (the runner hangs). Good: `afterAll(() => client.close())`.
- Bad: the same `dbName` for parallel test files (data of one file visible to another). Good: a name per file.
- Bad: forgetting that a missing database name in the URI means `test`: production data in the wrong database. Good: pass `dbName`.
- Bad: `NODE_ENV` unset in production with `validateReads: "development"` (every read is checked). Good: set `NODE_ENV=production`.
- Bad: registering the OpenTelemetry/Sentry adapter twice, or `commandSpans: true` without `monitorCommands: true` (`ConfigurationError`).
- Bad: a new `TypemoClient` per request. Good: one per process.

## Self-check

- Tests use a real replica-set MongoDB, create indexes in `beforeAll`, clean with `Filters.all()`, close the client, and assert error classes / `reason`.
- Test data comes from `defineFactory`; hot queries are pinned with `expectIndexScan`; model types have `assertType` / `@ts-expect-error` tests that `tsc` actually includes.
- The production client has `dbName`, `timeoutMS`, `readyTimeoutMS`, `NODE_ENV=production`, `keysetSecret` (if tokens are used), a start-up `init()` and a shutdown `close()`.
- Monitoring adapters are registered once, with `sensitive` left at `"mask"` and tenant export off unless needed.
