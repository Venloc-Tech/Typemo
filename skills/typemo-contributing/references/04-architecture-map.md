# Architecture map

Where things live, so you can find the right file without a long search. For depth read the code of the folder and its tests, and the docs pages of the area (`docs/ru/v1/<section>/`). For structural questions (who calls this, what does it call) use a code graph or `grep` instead of reading many files. A map goes stale: when it disagrees with the tree, trust the tree and fix this file.

## Repository layout

```text
packages/
  typemo/        @venloc/typemo: the core (legacy decorators, reflect-metadata)
  decorators/    @venloc/typemo-decorators: TC39 decorators, an adapter to the core
  test-kit/      @venloc/typemo-test-kit (private): database, fixtures, type/hover/shape harnesses
  bench/         benchmarks of Typemo against Mongoose and the raw driver
integrations/    each integration is its own package; vendor dependencies only in its package.json
  nestjs/        @venloc/typemo-nestjs
  opentelemetry/ @venloc/typemo-opentelemetry
  sentry/        @venloc/typemo-sentry
docs/            user documentation: docs/<language>/<version>/... (ru/v1, en/v1)
skills/          agent skills: typemo, typemo-nestjs (shipped), typemo-contributing (repository only)
scripts/         Bun scripts (build, publish, docs-check, check-*, timing, budget, port)
VERSIONS.md      pinned versions and the date they were checked
```

Root files: `CLAUDE.md` (binding rules), `VERSIONS.md` (pinned versions), `tsconfig.base.json` (strict options and `paths` to the sources of every workspace package), `tsconfig.test.json` (what `test:types` compiles), `biome.json`.

## The public surface of the core

- `packages/typemo/src/index.ts`: the public API (`@venloc/typemo`); the list is a snapshot in `test/unit/api/public-exports.test.ts`. `@venloc/typemo/testing` is `src/testing/index.ts` (user test helpers: `defineFactory`, `explainIndexUsage`, `expectIndexScan`, `expectCollScan`; the import graph is guarded). `@venloc/typemo/adapters` is `src/adapters.ts` (for authors of decorator adapters). `src/internal.ts` is a pseudo entry for this monorepo's tests, guards and benchmarks (not in `exports`; integrations must never import it).
- `src/typemo.ts`: the `Typemo` object: process-wide global plugins, schema extensions and instrumentation subscribers. There is no global connection; clients are explicit.

## `packages/typemo/src` by folder

| Folder | What it holds |
|---|---|
| `bson/` | the value layer: BSON to TS type table (`bson-type-table.ts`, the one source of the forms table), `casters/` (one caster per type: string, number, int32, double, bigint, decimal128, boolean, date, timestamp, objectId, binary, regExp, array, map, subdocument, nullable), guards, driver BSON options (`BsonOptions`), opaque values |
| `schema/` | the schema: `decorators/` (`@Schema`, `@Prop`, `@Tenant`, virtuals, hooks, index decorators and their checks), `entity/` (`Entity`, `EntityWithId`, hydration support), `metadata/` (store and builder; the TC39 package feeds it through `adapters`), `compiler/` (class to `CompiledSchema` of path nodes), `options/` (prop, schema, index, virtual options), `indexes/`, `json-schema/` (generator), `naming/`, `extensions/` (the `ext` registry), `standard-schema/` |
| `types/` | the type-level engine: `filter.ts`, `update.ts`, `projection.ts`, `populate.ts`, `result.ts`, `selected.ts`, `paths.ts`, `schema-paths.ts`, `path-check.ts` (readable compile errors), `document-forms.ts`, `markers.ts`, `contract.ts`; the compile budget lives here |
| `connection/` | `TypemoClient` (connect, state, `ready`, transactions, `use`, `instrument`, `unsafeDriver`), `Connection` (a database: models, `init`, `syncAll`), options, session guard, `TransactionScope` / transaction context |
| `model/` | `Model` and its internals: reads (`document-reader`, `plain-reader`, `read-validator`), `aggregate-query`, `bulk-write`, `database-aggregate`, `model-indexes`, `pipeline-executor` |
| `query/` | query builders and planners: `query-builder`, `write-builder`, `parsed-query`, `plan`, `projection-planner`, `update-planner`, `populate-specs`, `response-mask` (`.mask()`), `model-operations` (the typed operation surface), count and option queries |
| `operation/` | the ONE execution pipeline for `run`, `cursor`, `explain`, `find`, bulk: `pipeline/` (context, `OperationStep`, standard pipeline, plan) and `steps/` (normalize, resolve paths, cast, policy, defaults, encode, validate, increment and replacement guards, filter codec), `executor/driver-executor.ts` (the only place that calls the driver) |
| `policies/` | strictness and data policies as pipeline steps: tenant, soft delete, audit, hidden, immutable, sanitize, limit, require-filter, empty-logical/update, strict-path, undefined, `PolicyContext`, `Filters`, `untrusted`, masks and `sensitive` masks, violations and policy errors |
| `document/` | the hydrated document: `document-layer` (`$`-methods), `change-tracker`, `delta`, `versioning`, `document-save`, validation, snapshot, serializer (`$toObject`, `$toJSON`, `$toPlain`), populated fields, `any-population-doc`; `collections/` has the strictly typed collections (arrays, subdocuments, subdocument arrays, `TypedMap`) with an array journal and update-ops |
| `populate/` | planner, executor, assigner, step; `document-populate`, `is-populated`, `is-present` |
| `aggregate/` | `Pipeline` builder and stage types, the typed expression language (`fn`, field proxy, expression compiler, scope tracker, operator factory, `ops/`), doc-shape and path types, update pipelines, view types |
| `hooks/` | hook registry, document, operation and bulk-unit hooks, hook events, errors and skip rules |
| `plugins/` | plugin registry (`@Plugin`, client and global plugins) |
| `collections/` | collection management: `CollectionManager`, `TypedView`, `Materialized`, `syncAll` / sync runner, index sync, `SyncError`, collection guard |
| `change-streams/` | `Model.watch`, typed change events, the model change stream |
| `cursor/` | `TypedCursor` |
| `pagination/` | keyset pagination |
| `instrumentation/` | the hub (subscribers, events), operation scope: how integrations observe operations |
| `errors/` | the Typemo error hierarchy (`TypemoError` and its subclasses), `ErrorClassifier`, error translator from driver errors, server error codes, duplicate-key text |
| `internal/` | tiny internal helpers (`safe-record.ts`) |

How the folders group into layers, bottom to top: values (`bson/`), schema (`schema/`), the type-level engine (`types/`, `aggregate/` types), execution (`connection/`, `model/`, `query/`, `operation/`, `cursor/`), documents and typed collections (`document/`), populate (`populate/`), and cross-cutting mechanisms (`hooks/`, `plugins/`, `policies/`, `collections/`, `change-streams/`, `pagination/`, `instrumentation/`, `testing/`).

## Tests of the core (`packages/typemo/test`)

`runtime/` (real database), `types/` (`*.test-d.ts`), `hover/`, `shape/`, `ported/` (+ `INDEX.md`), `regressions/` (+ `HISTORY-NOTES.md`), `unit/`, `guards/` (integrity, no-decision-ids, dts-consumer, value-forms-doc, perf, per area guards), `fixtures/` (entities, seeds, query lists per area; `dts-consumer/` for the declarations guard), `experiments/` (one-off benches, not run), `setup.ts` (stops the shared `mongod`). Colocated: `src/index.test.ts`, `src/legacy-decorators.test.ts`.

## `packages/test-kit` (private, `exports: ./src/index.ts`)

| Area | Exports |
|---|---|
| `db/` | `MongoHarness` (one `MongoMemoryReplSet` per process; `TYPEMO_MONGO` channel; status with fallback), `MongoLifecycle.useMongo`, `StandaloneMongo`, `DbSnapshot`, `AggregateRunner` |
| `hover/`, `types/` | `expectHover`, `expectTypeError`, `expectNoTypeErrors`, `TypeProbe`, `ProbeSource`, `HoverText`, `TypeCheckRunner`, `TsConfig`, `DeclarationBuild`, assertion types (`Expect`, `AssertEqual`, ...) in `type-kit.ts` |
| `shape/` | `expectShapeMatches`, `ShapeCompare`, `RuntimeShape`, `TypeShape` |
| `guards/` | `NoAnyInPublicApi`, `PublicExports`, `PublicTsdoc`, `Freeze` |
| `port/` | `PortedTest` (header and index row format) |
| `commands/`, `explain/`, `failpoints/`, `oracle/` | `CommandRecorder` (which commands were sent), `ExplainHelpers`, `FailPointHelpers` and `DuplicateKeyScenario`, `OracleHarness` (compare with Mongoose) |
| `fixtures/`, `decorators/`, `standard-schema/` | shared entities (`user`, `post`, `comment`, all-BSON-types), factories, decorator contract, Standard Schema kit |
| `fixtures/` (folder at the package root) | `dense-graph` (the compile budget project), `dist-consumer` (the `test:dist` project), `extensions` |

Dev dependencies of test-kit only: `mongodb-memory-server`, `mongoose` (comparison tests), `zod` (Standard Schema compatibility); the core depends on none of them.

## Decorators, integrations, bench

- `packages/decorators/src`: `class-decorators.ts`, `field-decorators.ts`, `hook-decorators.ts`, `tc39-metadata.ts`, `polyfill.ts` (`Symbol.metadata`). One decorator package per project (never mix); `@Prop` on a TC39 `accessor` is forbidden. Tests: `test/package`, `test/strict`, `test/shared/{legacy,tc39,scenarios}` (the same scenarios run twice).
- `integrations/nestjs/src` (read its files and the tests in `integrations/nestjs/test` before changing the package; the demo is `integrations/nestjs/demo`; docs: `docs/ru/v1/integrations/nestjs`): `typemo.module.ts` (`forRoot`, `forRootAsync`, `forFeature`, `view`, `materialized`), `typemo-core.module.ts` (a global module per client: client, default connection, registry, `TransactionalBinder`; sync on bootstrap, close on shutdown), `client-connector.ts` (options check, retries, lazy connection, factories), `client-lifecycle.ts`, `feature.ts` / `feature-registry.ts`, `tokens.ts`, `inject.ts`, `transactional.ts` + `transactional-binder.ts`, `policy-interceptor.ts` (+ `@AllTenants`), `typemo-exception-filter.ts`, `parse-id-pipe.ts`, `validate-body-pipe.ts`, `testing/` (`provideModelMock`, `provideClientMock`, `TypemoTestingModule`). Uses only the public core API. Tests: `test/{runtime,e2e,types,hover,ported,fixtures,support}`; a `demo/`. Pitfalls: `import type` breaks Nest DI, AsyncLocalStorage and interceptors (`next.handle()` inside `PolicyContext.run`), hook order of global modules, route metadata moved onto the `@Transactional` wrapper.
- `integrations/opentelemetry/src`: `typemo-open-telemetry.ts` (`TypemoOpenTelemetry.instrument(client)`: instrumentation events to spans and metrics), `pool-metrics.ts`, `semconv.ts`. Docs: `docs/ru/v1/observability`. Has its own perf guard (`test:perf`).
- `integrations/sentry/src`: `typemo-sentry.ts`, `sentry-subscriber.ts`, `breadcrumb-builder.ts`, `error-context.ts`; only `@sentry/core` API; tracing goes through OpenTelemetry, not here. Docs: `docs/ru/v1/observability`.
- Integration rule: the core never gets vendor code; a missing capability becomes a general mechanism of the core (event, hook, option, `ext` point). `client.currentTransaction()` and `TransactionScope.current()` were added for `@Transactional({ join: true })` this way, with tests and without effect for others.
- `packages/bench/src`: `adapters/` (Typemo, Mongoose, driver), `scenarios/`, `harness/`, `data/`, `report/`, `cli/main.ts`; profiles `quick` and `standard`; results in `packages/bench/results`. Run only when asked.

## Where to put a change

| You change | Look in |
|---|---|
| A new field option or decorator | `schema/options/`, `schema/decorators/`, then the compiler (`schema/compiler/`), the type table in `types/`, the decorators package if it has a TC39 form |
| A new BSON type or a cast rule | `bson/bson-type-table.ts`, `bson/casters/`, `types/document-forms.ts`, then `bun run forms:table` |
| A query operator or builder method | `types/filter.ts` or `types/update.ts`, `query/` (builder and planner), the pipeline steps in `operation/steps/` |
| A policy (strictness, tenant, soft delete, audit) | `policies/` plus its pipeline step; never a switch that loosens strictness |
| An aggregation stage or operator | `aggregate/pipeline/stage-*.ts`, `aggregate/expressions/ops/`, `aggregate/types/` |
| A document method | `document/document-layer.ts` and `document/document-types.ts`; tracking in `change-tracker.ts` and `delta.ts` |
| A new error | `errors/` (a subclass of `TypemoError`, the classifier, the translator), its docs page and the filter table in `typemo-nestjs` when HTTP is affected |
| An instrumentation event | `instrumentation/`; an integration reads it through the public API |
| A readable compile error | `types/path-check.ts` and the hover test of its text |

One operation travels: a `Model` call, then a builder in `query/`, then the pipeline in `operation/` (normalize, resolve paths, cast, policies, defaults, encode, validate), then the only driver call in `operation/executor/driver-executor.ts`, then hydration (`document/`) and populate (`populate/`), with hooks (`hooks/`) and instrumentation (`instrumentation/`) around it. `run`, `cursor`, `explain`, `find` and bulk share this one pipeline, so a policy added as a step applies to all of them.


## Self-check

- [ ] I found the folder from this map and confirmed it against the real tree before editing.
- [ ] Integration code imports only the public API of the core, never `src/internal.ts`.
- [ ] A change that needs core support for an integration is a general mechanism, separated in its own commit or in the report.
- [ ] A new file is in the folder of its topic; a new helper group is one static class in one file.
