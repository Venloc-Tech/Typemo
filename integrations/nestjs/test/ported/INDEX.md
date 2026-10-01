# Ported tests of `@venloc/typemo-nestjs`

## 1. nestjs/mongoose

Source: `references/nestjs-mongoose` (`nestjs/mongoose` 12.0.0, commit `4eb727c`, cloned 2026-10-01). Only the e2e tests exist there (`tests/e2e/*.spec.ts`); the module files have no unit specs.

| Source | Test | Ported to | Status |
|---|---|---|---|
| `tests/e2e/mongoose.spec.ts:24` | should return created document | `nestjs-mongoose-e2e.test.ts` | passes |
| `tests/e2e/mongoose.spec.ts:36` | should populate array of kittens | `nestjs-mongoose-e2e.test.ts` | passes (`populate("kitten")`, `ParseIdPipe` instead of a raw string id) |
| `tests/e2e/mongoose-lazy-connection.spec.ts:24` | should return created document (lazy) | `nestjs-mongoose-e2e.test.ts` | passes |
| `tests/e2e/discriminator.spec.ts:69` | should return click-link document (forFeature) | `nestjs-mongoose-e2e.test.ts` (two orders of the list) | passes; the key is `__t` with the class's literal value |
| `tests/e2e/discriminator.spec.ts:82` | should return sign-up document (forFeature) | same | passes |
| `tests/e2e/discriminator.spec.ts:95` | document ($path) should not be created | same | **divergence**: the original answers 500 (strict mode drops `testing`, then an unhandled `ValidationError`); Typemo refuses the unknown field itself (`CastError`), `TypemoExceptionFilter` answers 400 with `path: "testing"` |
| `tests/e2e/discriminator.spec.ts` (forFeatureAsync case) | the same three tests with `forFeatureAsync` | — | not ported: there is no `forFeatureAsync` (decision R64) |
| `tests/e2e/schema.factory.spec.ts`, `schema-definitions.factory.spec.ts`, `virtual.factory.spec.ts` | `@Prop`/`@Schema`/`SchemaFactory` of nestjs/mongoose | — | not ported: Typemo has its own schema decorators, tested in the core |

Also covered from the module code of nestjs/mongoose (no spec there): the retries of `handleRetry` (`retryAttempts` = tries, `retryDelay`, the final error through `connectionErrorFactory`), `lazyConnection`, `onConnectionCreate`, `connectionFactory`, `forRootAsync` with `useFactory`/`useClass`/`useExisting`, the connection closed in `onApplicationShutdown`, `ParseObjectIdPipe`/`IsObjectIdPipe` — see `test/runtime/connection.test.ts` and `test/e2e/http.test.ts`.

## 2. The wrapper's scenarios (`references/typed-mongoose-wrapper/packages/nestjs/test`, 42 tests)

| Wrapper test | Where in this package | Note |
|---|---|---|
| `module.test` forRoot connects; connection injectable; model works | `runtime/connection.test.ts` "forRoot connects…" | |
| `module.test` forRoot with a connectionName: no default connection | `runtime/connection.test.ts` "with a name…" | client `name` |
| `module.test` forRootAsync useFactory + inject / useClass / useExisting / connectionName | `runtime/connection.test.ts` forRootAsync | |
| `module.test` connectionFactory, onConnectionCreate, connectionErrorFactory not used on success | `runtime/connection.test.ts` "onClientCreate runs once…" | `clientFactory`, `onClientCreate` |
| `module.test` unreachable server rejects after the retries with connectionErrorFactory's error | `runtime/connection.test.ts` "an unreachable server…" | `onClientCreate` once (the client is reused) |
| `module.test` plain token and typed token give the same model | `runtime/models.test.ts` "the same entity in two modules…" | one token (no Mongoose token) |
| `module.test` a global plugin in connectionFactory | `runtime/models.test.ts` statics (`@Plugin`) | plugins of a connection: `onClientCreate` (documented) |
| `module.test` collection name on @Schema | `runtime/models.test.ts` "the collection name…" | |
| `lazy-connection.test` (4) | `runtime/connection.test.ts` lazyConnection (3) + `onClientCreate` | fixed: `onClientCreate` is called also when lazy |
| `discriminator.test` (4) | `runtime/models.test.ts` discriminators | |
| `connections.test` same entity on two connections | `runtime/connection.test.ts` "two clients…", `runtime/models.test.ts` `{ db }` | |
| `app.test` (7: POST, typed filter, ParseObjectIdPipe 400, transaction + populate, rollback, injected values, @Static) | `e2e/http.test.ts`, `ported/nestjs-mongoose-e2e.test.ts`, `runtime/models.test.ts` statics | statics through `{ entity, statics }` |
| `transactions.test` (5) | `runtime/transactional.test.ts` | the session is implicit: "a write without the session" and `startSession` do not apply |
| `exception-filter.test` (4) | `e2e/http.test.ts` errors, `runtime/filter-and-interceptor.test.ts` | |
| `entity-pipe.test` (4) | `e2e/http.test.ts` ValidateBodyPipe | unknown fields: 422 by default, `dropUnknown`; strings are not converted to numbers (the core casts strictly) |
| `for-root-async-types.test`, `for-root-async-class.test` (7) | `types/nestjs-api.test-d.ts`, `runtime/connection.test.ts` | all three forms are checked at run time too |
| `testing.test` (4) | `runtime/testing-helpers.test.ts` | one token per model |
| `types.test` (3) | `types/nestjs-api.test-d.ts`, `hover/nestjs-hover.test.ts` | |
| `views.test` (4) | `runtime/models.test.ts` views, `types/nestjs-api.test-d.ts` | creation by `sync` (no `ensure` per view) |
| `health.test` (2) | — | not done (decision R64) |
| `demo.test` | `runtime/demo.test.ts` | |
