# @venloc/typemo

**A strictly typed ODM for MongoDB, written from scratch in TypeScript.** A schema is a class with decorators, and the class is the type: filters, updates, projections, `populate`, aggregation pipelines, results and errors are all typed from it — inferred from the implementation, not glued on top of an untyped runtime. Typemo replaces Mongoose; the transport is the official `mongodb` driver.

**Strict by default.** A wrong field name, a value of the wrong type, an empty filter on a write, an operator object coming from a client, a schema option nobody reads — each is a compile error or a clear error at run time, never silent behaviour.

```bash
bun add @venloc/typemo mongodb bson
```

## A first model

```ts
import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => Number, { required: true, min: 0 }) balance!: number;
  @Prop(() => [String]) tags!: string[];
}

const client = await TypemoClient.connect("mongodb://localhost:27017/app?replicaSet=rs0");
await client.connection.init(); // creates what is missing: collections and indexes
const Accounts = client.connection.model(Account);

await Accounts.create({ email: "ann@example.com", balance: 100 });

const rich = await Accounts.find({ balance: { $gt: 50 } }).select({ email: 1 }).lean();
//    ^? { _id: ObjectId; email: string }[]

await Accounts.updateOne({ email: "ann@example.com" }, { $inc: { balance: -10 } });
```

## What is in the box

- **Schemas** — `@Schema`, `@Prop`, `Entity` / `EntityWithId` (any `_id` type), nested classes and subdocument arrays, Maps, indexes and search indexes, discriminators (the base model reads as a union narrowed by the key), virtuals, timestamps and versions, `Hidden` / `Immutable` / `Defaulted` field markers, `sensitive` values.
- **Reading** — typed filters and projections, `.lean()` / `.plain()` / hydrated documents with one predictable type each, keyset pagination (signed tokens), cursors, response masks, contracts that pin the shape of a result.
- **Writing** — typed update operators and update pipelines, bulk writes, upserts; values are cast to the schema and validated before anything is sent.
- **Documents** — tracked changes (`$getChanges`), typed arrays / subdocument arrays / Maps that save the minimal update, validation in schema order.
- **Populate** — typed `populate`, `null` for a dangling reference in the type, `HydratedDocWith<Post, { author: … }>`, `isPopulated` / `isPresent` guards.
- **Aggregation** — a typed pipeline builder with `fn.*` expressions; every stage knows its row type; `$out` / `$merge` into a model; database-level pipelines; typed views and materialized results.
- **Transactions** — `client.transaction(fn)` with an implicit session and retries; `client.currentTransaction()`.
- **Hooks, plugins, extensions** — document and operation hooks, plugins with typed statics, schema extensions (`ext`).
- **Policies** — multi-tenancy (`@Tenant()`), soft delete, audit trail, untrusted input (`untrusted()`), strict reads (`validateReads`).
- **Collections** — `init()` / `syncAll()` with a report, collection options (capped, time series, clustered, validators), index sync.
- **Errors** — one hierarchy (`CastError`, `ValidationError`, `StrictModeError`, `DuplicateKeyError`, `SyncError`, …) and `ErrorClassifier` for mapping them; server text is shortened and sensitive values are masked.
- **Testing** — `@venloc/typemo/testing` (`defineFactory`).

## Requirements

- TypeScript 6 with `experimentalDecorators: true` (`emitDecoratorMetadata` and `import "reflect-metadata"` are not needed). Standard (TC39) decorators: [`@venloc/typemo-decorators`](https://www.npmjs.com/package/@venloc/typemo-decorators).
- `mongodb` 7.6 and `bson` 7.3 (peer dependencies). Tested on MongoDB 8.3 and 9.0, with Bun and Node.
- A replica set (one member is enough) for transactions, change streams and audited models.

## Related packages

| Package | What it adds |
| --- | --- |
| [`@venloc/typemo-decorators`](https://www.npmjs.com/package/@venloc/typemo-decorators) | standard (TC39) decorators |
| [`@venloc/typemo-nestjs`](https://www.npmjs.com/package/@venloc/typemo-nestjs) | NestJS module |
| [`@venloc/typemo-opentelemetry`](https://www.npmjs.com/package/@venloc/typemo-opentelemetry) | OpenTelemetry spans and metrics |
| [`@venloc/typemo-sentry`](https://www.npmjs.com/package/@venloc/typemo-sentry) | Sentry error context and breadcrumbs |

## For AI coding agents

This package ships an agent skill in `skills/typemo/` (`SKILL.md` plus topic references with checked examples). Point your agent at `node_modules/@venloc/typemo/skills/typemo/SKILL.md`.

## Links

- Repository and issues: https://github.com/Venloc-Tech/typemo
- License: MIT
