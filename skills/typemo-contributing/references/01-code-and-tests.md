# Code style and tests

The rules of `CLAUDE.md` sections 3 and 4, condensed, plus where things live. Read this before you write or change source or any test.

## The code style, with a minimal example

```ts
// index-helpers.ts: ONE static class per topic, ONE class per file.
export class IndexHelpers {
  /** Why: the server reports an index under its generated name, so compare by keys. */
  static keyName(keys: Readonly<Record<string, 1 | -1>>): string {
    return Object.entries(keys)
      .map(([field, direction]) => `${field}_${direction}`)
      .join("_");
  }

  static sameKeys(left: Readonly<Record<string, 1 | -1>>, right: Readonly<Record<string, 1 | -1>>): boolean {
    return IndexHelpers.keyName(left) === IndexHelpers.keyName(right);
  }
}

// A function outside a class is a const arrow.
export const castDate = (value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  throw new TypeError("expected a valid Date");
};

// A callback field that needs a bound `this` stays an arrow, with the reason in a comment.
export class Subscription {
  /** An arrow field: it is passed as a listener, so `this` must stay bound. */
  readonly handle = (event: string): void => {
    this.seen.push(event);
  };

  private readonly seen: string[] = [];
}
```

Rules:

- **Only ES classes.** No `Foo.prototype.x = ...`, no `util.inherits`, no constructor functions, no calling a class without `new`.
- **Functions outside classes are `const` arrows. Class members are ordinary methods** (`static castDate(value: unknown): Date { ... }`), not arrow fields. The one exception is an instance field passed as a callback (bound `this`), with a comment.
- **Helpers are grouped in a static class per topic**, one class per file: about eight index functions become one `IndexHelpers` in `index-helpers.ts`, not eight files. Do not litter the tree with tiny files.
- A plain `function` only for `this`, and then `this` is typed: `function (this: HydratedDoc<User>, ...)`.
- ESM and strict TypeScript: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, imports with the `.ts` extension. `useDefineForClassFields` is `false` (Bun and tsc agree only with `false`).
- **No `any` in the public API**: unknown is `unknown`. Each `any` inside an implementation is justified by a comment. The ban is checked by `bun run check:any`.
- **User input is not mutated.** Casting, normalizing and merging options are pure functions.
- No global patches of foreign prototypes (`ObjectId.prototype` and the like).
- Names: files `kebab-case.ts`, classes and types `PascalCase`, `UPPER_SNAKE` only for real constants.
- Comments explain *why*, not *what*. A Mongoose pitfall reference: `// Mongoose gh-12345`.
- Errors come only from the Typemo hierarchy (`TypemoError` and subclasses in `packages/typemo/src/errors/`) with `cause` set to the original. Exception: if the original holds `sensitive` or `Hidden` data, `cause` is a masked copy and the original stays inside the core.
- TSDoc on every public member, with an `@example` that compiles (`bun run check:tsdoc`). Shipped strings and public TSDoc carry no internal ids (the `R47` / `D8` style); guard: `packages/typemo/test/guards/no-decision-ids.test.ts`.
- The public API goes only through `packages/typemo/src/index.ts`; the export list is pinned by `packages/typemo/test/unit/api/public-exports.test.ts` (a change to it must be deliberate). Tests import internal classes from `src/internal.ts` (a pseudo entry that is not in the package `exports`); integrations never import it.

## Behavior rules every change must respect

- **Absolute strictness**: an error instead of silent behavior; no options or modes that loosen it. No `strict: false`, no soft casting (`"42"` is not a number; `undefined` is never a value; `null` only on a nullable path).
- **Source priority** when sources disagree: 1. the behavior of the real MongoDB server proven by a test; 2. the `mongodb` driver (code and `.d.ts`); 3. Mongoose, which is a catalogue of pitfalls and conventions, not a specification; its bugs are not repeated.
- **Integrations** (OpenTelemetry, Sentry, NestJS, any future one): the core has no vendor code and no vendor dependency; a missing capability becomes a general core mechanism (event, hook, option, `ext` point) in a separate commit or a clearly marked part of the report, naming who else it helps; without subscribers the core is not slower (perf guard); an integration never changes policies, it only intervenes through hooks.
- A new idea (option, marker, approach) is a proposal to the maintainers, never a silent change.

## The test kinds (all of them, written with the code)

| Kind | Where | What it proves | Helpers |
|---|---|---|---|
| Runtime on a real MongoDB | `packages/typemo/test/runtime/<area>/*.test.ts` | behavior on a server (replica set of one node from the memory server; versions in `VERSIONS.md`) | `MongoLifecycle.useMongo(prefix, BsonOptions.apply({}))` gives a database unique per file and clears collections after each test |
| Types, positive and negative | `packages/typemo/test/types/<area>/*.test-d.ts` (compiled by `bun run test:types`, not run) | `expectTypeOf(...)`; every negative case is `// @ts-expect-error <what exactly must fail>` | `expect-type`, assertion types of test-kit (`AssertEqual`, `AssertNotAny`, `AssertHasKey`, ...) |
| Hover | `packages/typemo/test/hover/<area>/*.test.ts` | the quick info of the TS language service equals the expected text; compile errors are readable | `expectHover(code, { dir })` with a marker `// ^?`, `expectTypeError(code)`, `expectNoTypeErrors` |
| Shape (type vs runtime) | `packages/typemo/test/shape/<area>/*.test.ts` | the type the compiler computes equals the shape of the real result from the database | `expectShapeMatches`, `ShapeCompare`, `RuntimeShape`, `TypeShape` |
| Options and edge cases | next to the runtime tests | `null` against absent, empty values, bounds, errors, transactions, replica set | `FailPointHelpers` (server fail points), `CommandRecorder` (which commands were sent), `ExplainHelpers`, `DbSnapshot` |
| Ported Mongoose tests | `packages/typemo/test/ported/<area>/*.test.ts` | the logic of a Mongoose test, rewritten to Typemo syntax | `PortedTest.header(...)`, registry `ported/INDEX.md` |
| Own regressions | `packages/typemo/test/regressions/<area>/` | a known Mongoose pitfall stays fixed | name the pitfall (`gh-12345`) in the test title |
| Guards | `packages/typemo/test/guards/**` | repository-wide rules (below) | test-kit guards |
| Unit | `packages/typemo/test/unit/**` | pure functions and internals | `src/internal.ts` imports |

Integration packages follow the same layout under `integrations/<name>/test/` (`runtime`, `types`, `hover`, `e2e`, `ported`, `fixtures`, `support`). Decorator package tests live in `packages/decorators/test/` (`package`, `strict`, `shared` with a legacy and a TC39 run of the same suite).

Fixtures live in `packages/typemo/test/fixtures/<area>/` (entities, seeds, query lists); share them instead of redefining entities in each test. A **new helper goes to `packages/test-kit`** (exported from its `src/index.ts`), not copied into a test.

Bun does not type-check: a wrong option name in a test runs and fails later, at schema compile. That is why a green `bun test` is not enough, run `typecheck` and `test:types` too.

### Ported Mongoose tests

Mongoose is not shipped in this repository. The contributor fetches the sources (github.com/Automattic/mongoose) and searches its `test/` folder for the topic of the feature; never read the Mongoose tests in bulk. `scripts/port/find-mongoose-tests.ts <word> [<word>]` greps a local checkout for `it(...)` titles (see the header of the script for the path it expects).

- File `packages/typemo/test/ported/<area>/<name>.test.ts`; the first line cites the source: `// ported from mongoose test/model.test.js:7761 "saves new documents"`. Keep the logic and the order of checks; rewrite only the syntax (`it` to `test`, `assert` to `expect`, callbacks to `async/await`, database helpers from test-kit).
- One row per test in `packages/typemo/test/ported/INDEX.md` (source, our file, status): `pass`, `divergence: <where it is described>`, or `n/a: legacy` with the reason in the cell (the test relies on callbacks, `count`, `remove` and the like).
- **A failing port is never bent.** Find out whether it is a Typemo bug, a deliberate divergence (Mongoose bugs are not repeated), different server behavior, or a test that relied on legacy; report it and decide with the maintainers. A deliberate divergence is described in the report or the pull request and marked in `INDEX.md`.
- `bun scripts/ported-report.ts` checks `INDEX.md` for consistency; it also reads a local list of divergences, so on a fresh clone it may stop on that missing file. That is not a failure of your port.

### When any test fails

Do not bend the expectation to the actual result. Reasons to separate: a Typemo bug; a deliberate divergence from Mongoose; the server behaves otherwise (check on 9.0 and 8.3); the test relied on legacy. Write down which one it is, with the failing test name and the first error, and tell the maintainers.

## Guards

| Guard | File | Rule |
|---|---|---|
| Test integrity | `packages/typemo/test/guards/test-integrity.test.ts` | `test.todo/skip/only/failing` (also `it.*`, `describe.*`, `*.skipIf/todoIf/if`) are not committed: the guard accepts one only when its title names a tracked open question; every `as any` and `as unknown as` in a test has a reason comment on the same line or the line before |
| No decision ids | `packages/typemo/test/guards/no-decision-ids.test.ts` | no internal ids (`R47`, `D8`, `H123`) and no "open question" in shipped strings and the public TSDoc |
| Public exports | `packages/typemo/test/unit/api/public-exports.test.ts` | the export list is a snapshot |
| `.d.ts` consumer | `packages/typemo/test/guards/dts-consumer.test.ts` | builds the declarations as published and compiles consumer code against them with `skipLibCheck: false` |
| Value forms table | `packages/typemo/test/guards/value-forms-doc.test.ts` | the generated table of value forms is current (`bun run forms:table` regenerates it; it reads and writes a local working file that is not in a fresh clone) |
| No `any` in the public API | `bun run check:any` | every export entry of every package |
| TSDoc examples | `bun run check:tsdoc` | every ```ts block of an `@example` of the public TSDoc compiles (known gap: a block whose `@example` has a line starting with a decorator is silently skipped) |
| Perf guards | `packages/typemo/test/guards/perf/**` (not in `bun run test`) | time and memory against lean reads or the raw driver, generous thresholds, `[perf]` lines |

## Perf guards and the compile budget

- `bun run test:perf` runs when hot paths changed (hydration, serialization, populate, the operation pipeline, the cursor, instrumentation) and before the report of such a change. The measured `[perf]` numbers go into the report. A failing guard is reported, never fixed by raising the threshold.
- Without subscribers and without an integration the core is not slower than it was (the instrumentation perf guard).
- **Compile budget**: measure `tsc` after a change of the type layer with `bun run typecheck:timing [label]`; growth over 15% is reported. `bun run typecheck:budget` checks the budget on the dense-graph project: user-code time over the baseline at most 0.5 s, instantiations at most 1 000 000 (scenario `all`), at most 10 000 instantiations per query chain, memory at most 400 MB, zero TS2589/TS2590, the largest enumerated path union at most 5 000 members. Both scripts append a row to a CSV in a local working folder; with `NO_RECORD=1` the budget script does not.

## Adding a feature: the order of work

1. Read the code of the area (`packages/typemo/src/<folder>`, see `04-architecture-map.md`), its existing tests, and the docs pages that describe it (`docs/ru/v1/<section>/` and `reference/<section>/`). A feature that does not fit the existing design is a question or a proposal to the maintainers (an issue), not a silent change.
2. Collect the known Mongoose pitfalls of the area (Mongoose issues and tests by topic) and decide how each is covered by a test.
3. Write the types first when the feature is type-visible: the type test (positive and `@ts-expect-error` negative), then the hover test of the message the user will read.
4. Write the runtime test on the real database, then the implementation. Include the edge cases: `null` against absent, empty, bounds, errors, transaction, the replica set.
5. Add the shape test when the result type depends on the new code.
6. Search the Mongoose tests for the same topic, port the relevant ones, list them in `ported/INDEX.md`. A failing port is reported, never bent.
7. Run, one at a time: package tests (9.0, and `TYPEMO_MONGO=stable` when server behavior may differ), `typecheck`, `test:types`, `lint` on your files, `check:any`, `check:tsdoc`; `test:perf` for hot paths; `typecheck:timing` for type changes.
8. Write the TSDoc of every new public member (it is what the IDE shows; its `@example` compiles; no internal ids) and update the docs page and the skills if the public behavior changed (see `03-docs-and-discrepancies.md`).
9. Report: done, not done, not verified, test counts, `tsc` timing, choices you made yourself, divergences from Mongoose, open questions.

## Self-check

- [ ] Classes only, `const` arrows outside classes, helpers in one static class per file, typed `this`.
- [ ] No `any` in public types; internal `any` justified; no input mutated; errors from the hierarchy with `cause`.
- [ ] Each kind of test exists for the feature: runtime, types (positive and negative), hover, shape, options and edge cases; ported tests are listed in `INDEX.md`.
- [ ] No expectation was changed to fit a failing result; divergences are written down and reported.
- [ ] New helpers are in test-kit; fixtures are shared.
- [ ] `test-integrity` and `no-decision-ids` pass; perf and `tsc` timing are measured when the change touches them.
