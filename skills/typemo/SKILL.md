---
name: typemo
description: Use for ANY code that imports or should use `@venloc/typemo` (and `@venloc/typemo-decorators`), the strictly typed MongoDB ODM that replaces Mongoose. Triggers - defining models (`@Schema`, `@Prop`, `Entity`), connecting (`TypemoClient`), queries, `create`/`update`/`delete`/`bulkWrite`, hydrated documents and `$save`, `populate`, aggregation pipelines, transactions, hooks and plugins, policies (tenant, soft delete, audit, `untrusted`), errors (`StrictModeError`, `CastError`, `ValidationError`), collections, indexes and `connection.init()`, testing with a real MongoDB, production setup, porting from Mongoose, or any question about how Typemo behaves. Read this file first, then only the reference files the task needs. For NestJS projects also read the typemo-nestjs skill.
---

# Typemo

Typemo is a strictly typed ODM for MongoDB written from scratch to replace Mongoose. Schemas are classes with decorators; types are inferred from them. Transport is the official `mongodb` driver (peer dependency, with `bson`).
Strict by default and not switchable: where Mongoose silently casts, drops or skips, Typemo throws a typed error (`CastError`, `StrictModeError`, `ValidationError`, `QueryError`, `ConfigurationError`, ...). Only the latest MongoDB, driver, Bun and TypeScript are supported; there is no legacy mode.
Never copy Mongoose habits from memory: the API differs (`connection.model(Entity)`, no `new Schema`, no `Mixed`, no `strict: false`, no callbacks/`next`). When unsure, read `references/14-not-supported.md`.

## Task -> file (read only what you need; each file is self-contained)

| Task | File |
|---|---|
| Install, tsconfig, create the client, connect, close, `connection.init()`, legacy vs TC39 decorators | `references/01-setup.md` |
| Define a model: `@Schema`, `@Prop`, types, arrays, Map, nested, references, defaults, required/nullable, virtuals, `Hidden`, indexes on fields, discriminators | `references/02-models.md` |
| Read data: `find`, `findOne`, `findById`, filters, projection, sort, pagination, keyset, cursors, `lean`/`plain`, counts, masks | `references/03-reading.md` |
| Write data: `create`, `insertMany`, `updateOne/Many`, update operators, pipeline updates, `replaceOne`, `findOneAnd*`, `deleteOne/Many`, `bulkWrite`, empty filters | `references/04-writing.md` |
| Hydrated documents: `$save`, `$set`, change tracking, subdocuments, typed arrays and Map, `$toPlain`/`$toJSON`, versions, unknown fields | `references/05-documents.md` |
| `populate`, `$populate`, `VirtualRef`, `Ref`, `isPopulated`, `$assertPopulated`, populate options | `references/06-populate.md` |
| Aggregation: `aggregate`, stages, `fn.*`, `$lookup`, `$merge`/`$out`, windows, facets, database-level plans, materialized views | `references/07-aggregation.md` |
| `client.transaction`, sessions, hooks (`@Pre`, `@Post`, `@PostError`), plugins, extensions, `Typemo.instrument` events | `references/08-transactions-hooks-plugins.md` |
| Policies and security: tenant, soft delete, audit, `PolicyContext`, `untrusted`, `Filters.all()`, strict paths, masks, `sensitive` | `references/09-policies-security.md` |
| Error classes, reason codes, how to catch and map them | `references/10-errors.md` |
| Collections, views, capped/timeseries, `init()`, `syncIndexes()`, `ensureCollection`, migrations of structure | `references/11-collections-sync.md` |
| Tests on a real MongoDB (`@venloc/typemo/testing`), type tests, production checklist, observability | `references/12-testing-production.md` |
| Surprising behaviour with the exact error texts (Bad -> Good) | `references/13-gotchas.md` |
| A Mongoose feature is missing: what to write instead | `references/14-not-supported.md` |
| NestJS (`TypemoModule`, `@Transactional`, pipes) | the `typemo-nestjs` skill |

## Core rules

1. Get models from the connection: `client.connection.model(Entity)` (or `client.db().model(Entity)`); a model belongs to a connection, there is no global model. Calling it twice returns the same model.
2. Every field is `@Prop(() => Type, { ...options })` with an explicit type thunk; a class field without `@Prop` is not in the schema. Extend `Entity` (ObjectId `_id`) or `EntityWithId(() => Type)`.
3. Use the marker types that go with field options: `Defaulted<T>` for `default`, `Immutable<T>`, `Hidden<T>` (with `hidden: true`, always a pair), `Ref<T>`, `TenantField<T>`, `Computed<T>`. The compiler checks that option and type agree.
4. `required` means "the key must be present"; `nullable` means "`null` is allowed". `undefined` is never a value: build objects without the key, clear with `$unset` or `null`.
5. No implicit casts: `"42"` for a number is `CastError`. Convert at the boundary, then pass real types.
6. Unknown field names in filters, updates, sorts and projections are errors (`StrictModeError ... [unknown-path]`). Fix the name; there is no way to relax it.
7. A write filter must name what it affects. `{}` does not compile; an empty filter built at runtime throws. "All documents" is written `Filters.all()`, on purpose.
8. Wrap every piece of client-supplied data placed in a filter, update or projection with `untrusted(value, place)`, then also validate type and range. `untrusted` checks operator keys only.
9. Tenant, soft delete and audit are policies in `@Schema` options (`tenant: true`, `softDelete`, `audit`), applied to every operation including aggregation. Mark the tenant field `@Tenant()` and run code in `PolicyContext.run({ tenant }, fn)`; build queries inside that scope.
10. Nothing is created implicitly: call `await client.connection.init()` once at startup to create collections and indexes. It never drops or changes anything; a mismatch is `SyncError`.
11. Reads return hydrated documents by default; use `.lean()` or `.plain()` for data you only send out. Hidden fields are absent from types and data until selected with `+path`.
12. Mutate documents only through their methods: `$save`, `$set`, `tags.push(...)`, `lines.pull(sub)`. Index assignment and `length = 0` on typed arrays do not compile.
13. Inside `client.transaction(fn)` read documents inside the function and prefer atomic `$inc`; `fn` can run more than once. Model operations join the transaction by themselves (no `{ session }`).
14. Document hooks declare `this: HookThis<"document.save", Entity>` (never `HydratedDoc`); query hooks declare `this: OperationHookContext<Entity, "query.find">` and change the operation with `this.modify(...)`/`this.skip(...)`.
15. Register plugins and extensions (`client.use`, `Typemo.use`, `Typemo.plugin`) before the first model; later is `ConfigurationError`.
16. Iterate large results with `.cursor()`, not `for await` over the query; `batchSize` and `limit` are positive integers.
17. Import errors and types from `@venloc/typemo` only; never from `mongodb`/`bson` when Typemo exports the same (`Types.ObjectId`). Never use `unsafeDriver()` without telling the user why.

## Self-check before you finish

- Does every model come from `connection.model(...)` and have `required`/`nullable`/`Defaulted` stated on purpose?
- No `any`, no `as never` to silence a Typemo type error (fix the cause; the types are the contract).
- Filters: no `{}`, no `undefined` values, no client data without `untrusted`.
- Numbers and ids are cast at the boundary; no string selects or sorts; no Mongoose-only options.
- Startup calls `connection.init()`; tests run on a real MongoDB, not a mock.
- Code in transactions is safe to run twice; hooks use the typed `this`.
- Run the project's `tsc` (strict flags on) and its tests; read errors literally, they name the fix.
