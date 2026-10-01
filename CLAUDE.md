# Typemo: rules for every agent

This file is binding for every agent that works in this repository: the main session, subagents and workflow agents. **Read it fully before starting and treat it as the baseline.** If a task or a prompt contradicts this file, stop and ask the user.

The condensed working guide for contributors (commands, test kinds, documentation rules, code map) is the skill [skills/typemo-contributing](skills/typemo-contributing/SKILL.md).

---

## 1. Who decides

**The user decides. The agent executes.**

- If something is unclear, **ask**. Do not invent requirements or fill important gaps with guesses.
- If you have an idea (an improvement, another approach, a new type marker, a new option), **propose it with reasons** and wait for the decision. Do not introduce it silently.
- **Do not stay silent, like Mongoose does.** A failing test, a contradiction in the documentation, odd server behaviour, an exceeded compile budget, your own mistake — report all of it directly.
- When a decision is left to you, take it and **tell the user explicitly** what you chose and why.
- Do not revisit decisions the user has made. If a decision gets in the way, describe the problem and propose options.
- Talk to the user in Russian, briefly and honestly: what is done, what is not, what is not verified. Code, names, commits and code comments are in English.

## 2. What Typemo is

**Typemo** is an ODM for MongoDB in TypeScript, a complete replacement for Mongoose, written **from scratch**.

- **Native types**: they are inferred from the implementation, not glued on top of a foreign runtime.
- **Transport**: the official `mongodb` driver (a peer dependency, together with `bson`). We do not write our own protocol.
- **Strictness by default is absolute.** An error instead of silent behaviour. No relaxations: neither by options nor by modes.
- **Schemas** are described only with classes and decorators:
  - the core `@venloc/typemo` works with **legacy decorators** (`experimentalDecorators`). The core stores its metadata itself (`reflect-metadata/no-conflict`, a dependency of the core); `design:type` is not read, so users need neither `emitDecoratorMetadata` nor `import "reflect-metadata"`;
  - the separate package `@venloc/typemo-decorators` provides TC39 decorators;
  - every option and setting lives in the core.
- **Versions**: only the latest MongoDB, `mongodb` driver, `bson`, Bun, TypeScript 6. No backward compatibility. Anything that exists only for old versions is legacy and is not carried over.
- **A hydrated document** uses its own strictly typed collections: arrays, subdocuments, subdocument arrays, Maps. `lean`, `$toObject`, `$toPlain` and `$toJSON` return plain arrays and objects.

**Integrations** (OpenTelemetry, Sentry, NestJS and any future ones):
- the core `@venloc/typemo` has no vendor code and no vendor dependencies; every integration is a separate package in `integrations/`;
- if an integration needs something the core lacks, the core gets a **general mechanism** (an event, a hook, an option, an extension point), not a special case for a product; the report says who else benefits from it;
- such core changes go in a separate commit or are called out explicitly in the report;
- the performance guard is mandatory: without subscribers and without an integration the core is not slower than before;
- an integration cannot change the core's policies (tenant, soft delete, strict, sanitize, `Hidden`, `sensitive`); it may intervene in an operation only through hooks.

**Priority of sources of truth:**
1. The behaviour of a real MongoDB server, verified by a test.
2. The `mongodb` driver: its code and `.d.ts`.
3. Mongoose is a catalogue of known pitfalls and conventions, not a specification.

## 3. Code style (mandatory)

- **ES classes only.** No prototype legacy: no `Foo.prototype.x = …`, no `util.inherits`, no constructor functions, no calls "without `new`".
- **Functions outside classes are `const` arrows**: `const castDate = (value: unknown): Date => { … }`. **Class members are ordinary methods** (`static castDate(value: unknown): Date { … }`), not arrow fields. Exception: an instance field passed as a callback (it needs a bound `this`) stays an arrow, with a comment saying why.
- **Helpers are grouped into a static class by topic.** One class per file. Example: eight index helpers become one `export class IndexHelpers { static … }` in `index-helpers.ts`, not eight one-function files. Do not litter the tree with tiny files.
- **When a plain `function` is needed** (for `this`), `this` is **always typed**: `function (this: HydratedDoc<User>, …)`.
- **ESM, strict TS:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, imports with `.ts`.
- **No `any` in the public API.** Unknown is `unknown`. Every `any` inside the implementation is justified by a comment. A test checks that public types have no `any` (`bun run check:any`).
- **User input is never mutated.** Type casting, normalisation and option merging are pure functions.
- No global patches of foreign prototypes (`ObjectId.prototype` and the like).
- Files in `kebab-case.ts`, classes and types in `PascalCase`, `UPPER_SNAKE` constants only for real constants.
- Comments explain *why*, not *what*; inside code they are `/* */`. A reference to a Mongoose pitfall: `// Mongoose gh-12345`.
- Errors only from Typemo's own hierarchy, with `cause` set to the original. Exception: if the original contains sensitive data (`sensitive`, `Hidden`), `cause` holds a masked copy and the original is available only inside the core.
- TSDoc on everything public; every public `@example` compiles (`bun run check:tsdoc`).

## 4. Tests (mandatory, written together with the code)

Every feature needs every kind of test:
1. **Runtime tests on a real MongoDB** (`mongodb-memory-server`, a replica set; the versions are in `VERSIONS.md`). Run on MongoDB 9.0 and on the stable 8.3 (`TYPEMO_MONGO=stable`).
2. **Type tests:**
   - positive: `expectTypeOf` or the test-kit helpers;
   - negative: `// @ts-expect-error` with a note of what must fail.
3. **Hover tests:** through the TypeScript compiler / language service API, check what the IDE shows (quick info) and the type of an expression.
4. **Shape tests:** the type computed by the compiler is compared with the shape of a real result from the database.
5. **Tests of every option and edge case:** `null` vs a missing field, empty values, boundaries, errors, transactions, replica set.
6. **Ported Mongoose tests:** rewritten in Typemo's syntax **keeping their logic**, with the source in the header (`// ported from mongoose test/document.test.js:1234 "..."`) and listed in `packages/typemo/test/ported/INDEX.md`.
7. **Own tests**, including regressions of known Mongoose pitfalls.

**If a test fails, especially a ported one:**
- **Do not** bend the expectation to the actual result.
- Find out why: a Typemo bug, a deliberate divergence from Mongoose (we do not repeat Mongoose's bugs), different server behaviour, or a test that relied on legacy.
- Report it and decide together with the user.

**Helpers** are reused from `packages/test-kit`. If you need a new one, add it to test-kit instead of copying it into a test.

**Test guards:** every `as unknown as` / `as any` in a test has a reason comment on the same line or the line before; no decision numbers in code, comments, TSDoc or error texts.

**Compiler budget.** Measure `tsc` time on the type tests after changes to the type layer (`bun run typecheck:timing`, `bun run typecheck:budget`). Growth over 15% must be reported.

**Performance guards** (`packages/typemo/test/guards/perf/`) are not part of `bun run test`. Run them with `bun run test:perf` after changes to hot paths. Report the measured `[perf]` numbers. If a guard fails, report it; never raise the threshold.

## 5. Working process

- **Before a big decision** (API, format, a new dependency) — ask the user.
- **Report after every task:** what is done, what is not, what is not verified, which tests and how many, compiler time, decisions taken on your own, divergences from Mongoose, questions.
- **Git:**
  - **do not commit or push without the user's explicit permission**;
  - permission for one commit does not extend to the next;
  - create branches only when told to.
- **Do not use Python. At all.** Any call of `python`, `python3`, `pip`, `pipx`, `uv` is forbidden, **including `--version`** and one-liners, and including inside a compound shell command. For JSON use `jq` or `bun -e`. Scripts are written in Bun/TypeScript in `scripts/`.
- **Use Bun** as the package manager and runner for everything (`bun install`, `bun run`, `bun test`, `bun publish`).
- **Format only your own files.** Run `biome check --write` on the files of your task, not on all of `src`.
- **Long commands** (more than 2 minutes) — in the background or with a timeout. **One heavy command at a time** (one test run or one docs check).
- **Do not touch** other agents' working files outside your task.

## 6. Repository structure

```
packages/
  typemo/            @venloc/typemo — the core + legacy decorators
  decorators/        @venloc/typemo-decorators — TC39 decorators (an adapter to the core)
  test-kit/          @venloc/typemo-test-kit — private: database harness, fixtures, type / hover / shape harnesses
  bench/             benchmarks: Typemo vs Mongoose vs the driver
integrations/        integrations, one package each; vendor dependencies only in their own package.json
  opentelemetry/     @venloc/typemo-opentelemetry
  sentry/            @venloc/typemo-sentry
  nestjs/            @venloc/typemo-nestjs
docs/                user documentation: docs/<language>/<version>/… (docs/ru/v1); every example is checked by scripts/docs-check.ts
skills/              agent skills: typemo and typemo-nestjs (shipped inside the packages), typemo-contributing
scripts/             Bun scripts: build, publish, docs-check, check-any, check-tsdoc, check-skills, test-dist, timing, …
VERSIONS.md          pinned versions and the date they were checked
LICENSE              MIT (copied into each package by the build)
```

Main commands: `bun run build`, `bun run test`, `bun run test:types`, `bun run test:dist`, `bun run test:decorators`, `bun run test:perf`, `bun run typecheck`, `bun run lint`, `bun run check:any`, `bun run check:tsdoc`, `bun run check:skills`, `bun scripts/docs-check.ts --types <page>`, `bun run release:dry` / `bun run release`.

## 7. Bun specifics (verified)

- **Bun takes `tsconfig.json` from the directory it is started in.** That is why a package's tests are run from the package folder (`bun run test` at the root runs `--filter '*'`). The decorator mode is set in each package's own `tsconfig`.
- **Bun takes `paths` from the tsconfig nearest to the importing file.** The workspace packages resolve to their sources through `paths`; their `exports` point at `dist`, which only `bun run test:dist` reads. Two copies of the core (sources and dist) keep two metadata registries ("not a schema").
- **`bunfig.toml` limits `bun test` to `packages`**, so that tests of reference sources are not picked up.
- In Bun 1.4.0 `TracingChannel` has no `hasSubscribers`: do not rely on `diagnostics_channel` as a mechanism that is "free without subscribers".
- `bun run test` of the `typemo` package excludes `test/guards/perf/**` with `--path-ignore-patterns`. Run them separately with `bun run test:perf` or `bun test test/guards/perf`.
