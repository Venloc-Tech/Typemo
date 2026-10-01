# Commands and checks

Every root script, what it checks, when to run it, how to run on two MongoDB versions, and the Bun specifics. Run **one heavy command at a time**; never several in parallel. Anything that can last over 2 minutes gets a timeout or goes to the background. A full check before a report is: `typecheck`, `test:types`, `lint`, `check:any`, `check:tsdoc`, `build`, `test`, `test:dist`, and `test:perf` when hot paths changed, run one by one.

## A typical change cycle

```bash
# 1. the package you changed: its tests, from the package folder (Bun reads that tsconfig.json)
cd packages/typemo && bun test test/runtime/query
# 2. the whole workspace type check (incremental)
cd ../.. && bun run typecheck
# 3. the type tests (compiled, not run)
bun run test:types
# 4. lint ONLY your own files, then format them
bunx biome check --write packages/typemo/src/query/count-query.ts
```

## Root scripts

| Command | What it does | Run when |
|---|---|---|
| `bun run typecheck` | `scripts/clean-dist.ts` (removes orphaned `.typecheck` declarations of deleted sources, which `grep` would otherwise find as live code) then `tsc -b` over `packages/typemo`, `decorators`, `test-kit` and the three integrations | any source change |
| `bun run test:types` | `tsc -p tsconfig.test.json` (all `packages/*/test`, `integrations/*/test`, demo, scripts), then the dist-consumer suite project, then the decorators project, strict project and shared TC39 project | any type or test change |
| `bun run lint` | `biome check .` over the repository | before a report; on the whole repo it may also show other people's files: judge only yours |
| `bun run format` | `biome format --write .` over EVERYTHING. Do not use it: format only your own files with `bunx biome check --write <files>` | never on the whole tree |
| `bun run check:any` | no `any` in the public API of every export entry of every package (test-kit `NoAnyInPublicApi`); `bun run check:any <entry.ts>` for one entry | public types changed |
| `bun run check:tsdoc` | compiles every ```ts block inside an `@example` of the public TSDoc the way a reader would paste it; `--full` prints whole messages, `--list` lists every block with its verdict. A block marked ```ts fragment is only parsed. Known gap: an `@example` that has a line starting with a decorator is skipped | public TSDoc or API changed |
| `bun run check:skills` | compiles every ```ts block of `skills/**/*.md` (own file per block; `// @errors: <codes>` marks a block that must fail exactly with these codes); reports `file:line`. Usage `bun scripts/check-skills.ts [file.md \| dir]` | skills changed |
| `bun run build` | builds `dist/` (`.js` + `.d.ts`, ESM) of `@venloc/typemo`, `typemo-decorators`, `typemo-opentelemetry`, `typemo-sentry`, `typemo-nestjs`; removes `dist` first; decorators and integrations compile against the BUILT core declarations; copies the agent skills into the packages that ship them. `bun scripts/build.ts packages/typemo` builds one package | before `test:dist` and a release check |
| `bun run test` | `bun run --filter '*' test`: the `test` script of every workspace package. In `packages/typemo` it excludes `test/guards/perf/**` | after a change |
| `bun run test:dist` | builds, packs the packages into a plain consumer project, compiles against them, compares hovers and errors with those of the sources, runs a smoke on a real MongoDB under Node. `--skip-build` reuses `dist`. Not part of `test` | any export or build change; before a report |
| `bun run test:decorators` | the shared decorators suite twice: under legacy decorators and under TC39 (`packages/decorators/test/shared/legacy` and `.../tc39`) | decorators or the schema decorators changed |
| `bun run test:hover` | `bun test hover/ shape/` | path filters; when it finds nothing from the root, run `bun test hover/ shape/` inside `packages/typemo` (Bun takes the cwd tsconfig) |
| `bun run test:perf` | the perf guards of the core (`packages/typemo/test/guards/perf/`) and then those of `integrations/opentelemetry` | hot paths changed (hydration, serialization, populate, the operation pipeline, cursor, instrumentation) |
| `bun run typecheck:timing [label]` | `tsc -b --extendedDiagnostics` of the workspace; appends a row to a CSV in a local working folder | after a change of the type layer; growth over 15% is reported |
| `bun run typecheck:budget [label]` | the compile budget on `packages/test-kit/fixtures/dense-graph`: each scenario compiled by a fresh `tsc` (median of `RUNS`, default 3): user-code time over the baseline at most 0.5 s, instantiations at most 1 000 000, at most 10 000 per query chain, memory at most 400 MB, zero TS2589/TS2590, largest path union at most 5 000; `NO_RECORD=1` does not append a CSV row; exit 1 over budget | after type changes |
| `bun run forms:table [--check]` | regenerates (or only checks) the table of value forms from the one BSON-to-TS table; the target file is a local working file | the BSON type table changed |
| `bun run bench`, `bench:quick`, `bench:standard` | benchmarks of Typemo against Mongoose and the raw driver (`packages/bench`) | only when asked |
| `bun run clean:dist` | the orphan cleaner alone | rarely |
| `bun run release:dry`, `release` | `scripts/publish.ts` (dry run, real publish) | maintainers only, only when asked |
| `bun run research:graph`, `research:questions` | maintainers' local analysis scripts; they read and write local working files that a clone does not have | do not run |

Not root scripts, run with `bun scripts/<name>.ts`:

| Script | Use |
|---|---|
| `docs-check.ts [--types] [--full] <page.mdx \| dir>` | compiles the twoslash blocks of docs pages, checks the front matter, MDX pitfalls and relative links (details in `03-docs-and-discrepancies.md`) |
| `code-unchanged.ts` | proves a comment-only change did not touch the code: compares every changed TS file with `HEAD` after both are re-printed without comments (titles of `describe/test/it` ignored); exit 1 lists the files whose code differs |
| `ported-report.ts` | the report of the ported tests and their inconsistencies (needs the local list of divergences) |
| `history-coverage.ts [--table]` | maintainers' check of pitfall coverage; it reads a local file that a clone does not have |
| `trace-hotspots.ts <tsconfig> [top]` | `tsc --generateTrace` and the heaviest checker events by exclusive time |
| `arrows-to-methods.ts [--dry] [glob]` | codemod: arrow-function class fields to methods |
| `port/find-mongoose-tests.ts <word>...` | search a local Mongoose checkout for tests to port |

## What to run for which change

| Change | Run (one at a time) |
|---|---|
| Source of the core, no public type change | package tests of the touched area, `typecheck`, `lint` on your files |
| Public types, TSDoc or exports | the above, plus `test:types`, `check:any`, `check:tsdoc`, the public-exports test, `typecheck:timing`; `typecheck:budget` for the type engine |
| Hot path | the above, plus `test:perf` with the `[perf]` numbers in the report |
| Build, exports map, a new package | `build`, `test:dist` |
| Decorators | `test:decorators`, the decorators package tests, `test:types` (its projects) |
| An integration | its package tests (`cd integrations/<name> && bun test`), `typecheck`, `test:types`, `build`, `test:dist`, and its perf guard when it has one |
| A docs page | `bun scripts/docs-check.ts --types --full <page>` |
| A skill | `bun run check:skills` |
| Only comments | `bun scripts/code-unchanged.ts` proves the code did not change |

How to read a result: a command is green only when its exit code is 0 and its output says so; `tsc` prints nothing on success. A run cut by a timeout is not green. When something fails, quote the failing test names and the first error in the report; do not summarize as "some tests fail".

## Which MongoDB

Tests run on a replica set of one node started by `mongodb-memory-server` (`MongoHarness` in test-kit): one `mongod` per `bun test` process, a database unique per test file. The versions are pinned in `VERSIONS.md`:

| Channel | Version | How to select |
|---|---|---|
| upcoming (default) | MongoDB 9.0 | nothing; if it cannot start on the platform, the harness falls back to stable and says so loudly (never silently): `MongoHarness.getStatus()` reports `fellBackToStable` |
| stable | MongoDB 8.3 | `TYPEMO_MONGO=stable` |

```bash
cd packages/typemo
bun test                                # MongoDB 9.0 (upcoming)
TYPEMO_MONGO=stable bun test            # MongoDB 8.3 (stable)
TYPEMO_MONGO=stable bun run test:perf   # the same variable works for the perf guards
```

Verify a feature or fix on the newest version first; run the stable one when behavior may differ by server version (index options, transactions, change streams, views, aggregation operators), and say which version each result comes from. The memory server downloads the `mongod` binary on first use (about 100-150 MB); that is expected for tests, but any other large download needs the maintainers' agreement.

## Bun specifics (verified)

- **Bun takes `tsconfig.json` from the directory it is started in.** So tests of a package run from the package folder (`bun run test` at the root uses `--filter '*'`). The decorator mode (`experimentalDecorators`) is set in each package's `tsconfig`.
- **Bun takes `paths` from the tsconfig nearest to the importing file.** Workspace packages resolve to their SOURCES through `paths` in `tsconfig.base.json`; their `package.json` `exports` point to the built `dist`, which only `test:dist` reads. Two copies of the core (sources and dist) keep two metadata registries ("not a schema").
- **The root `bunfig.toml` limits `bun test` to the `packages` folder.** Packages that start a database (typemo, test-kit, the integrations) have their own `bunfig.toml` with `preload = ["./test/setup.ts"]` that stops the shared `mongod` after the run.
- In Bun 1.4.0 `TracingChannel` has no `hasSubscribers`: do not count on `diagnostics_channel` as a "free when nobody subscribes" mechanism.
- `bun run test` of `packages/typemo` excludes `test/guards/perf/**` with `--path-ignore-patterns`. Run them with `bun run test:perf` or `bun test test/guards/perf`.
- Bun does not type-check, so run `typecheck` and `test:types` as well.
- JSON in scripts and shells: `jq` or `bun -e`. Long scripts: Bun/TypeScript files in `scripts/`. No Python.

## Common mistakes

Bad: `bun test` at the repository root.
Good: `cd packages/typemo && bun test <path>`, or `bun run test` at the root (it runs each package from its own folder).

Bad: `bun run format` or `bunx biome format --write .` on the tree: it rewrites other people's files.
Good: `bunx biome check --write <your files>`.

Bad: raising a perf-guard threshold because the machine is loaded.
Good: report the failure with the `[perf]` numbers; rerun when the machine is quiet; a threshold changes only by the maintainers' decision.

Bad: reporting "all green" after running `bun run test` only.
Good: list which commands ran with real results; the ones not run are "not verified".

Bad: running `typecheck`, `test` and `test:dist` together to save time.
Good: one at a time (they contend for CPU and memory and produce flaky timing).

Bad: stale types after deleting a source, with a plain `tsc -b`.
Good: `bun run typecheck` cleans orphaned `.typecheck` output first.

## Self-check

- [ ] I ran the commands from the package folder where Bun needs the cwd tsconfig.
- [ ] Heavy commands ran one at a time, with a timeout if they can take over 2 minutes.
- [ ] I know which MongoDB each result came from (9.0 default, 8.3 with `TYPEMO_MONGO=stable`).
- [ ] Hot path changed: `test:perf` ran and its `[perf]` numbers are in the report. Types changed: `typecheck:timing` growth is reported.
- [ ] I formatted only my own files.
- [ ] The report says which checks were not run.
