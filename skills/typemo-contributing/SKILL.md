---
name: typemo-contributing
description: Use when working in the Typemo repository itself, that is changing packages/typemo, packages/decorators, packages/test-kit, packages/bench, integrations/* (nestjs, opentelemetry, sentry), docs/, tests or scripts/. Gives the project rules at once - ask before deciding, no Python, no commits without permission, code style (classes, const arrows, static helper classes, no any), every kind of test, one heavy command at a time, the root commands (typecheck, test:types, lint, check:any, check:tsdoc, check:skills, build, test, test:dist, test:perf, docs-check), how to write and verify docs pages, how to report a discrepancy, and a map of the code. For using Typemo in an application read the `typemo` skill instead; this one is for people and agents that DEVELOP Typemo. Repository only, never shipped in a package.
---

# Developing Typemo

Typemo is a from-scratch TypeScript ODM for MongoDB, a full Mongoose replacement. Types are inferred from the implementation; transport is the official `mongodb` driver (peer dependency with `bson`); schemas are classes with decorators (core `@venloc/typemo` = legacy decorators, `@venloc/typemo-decorators` = TC39 adapter; all options live in the core); strictness is absolute (an error instead of silent behavior, no loosening switches); only the latest versions (MongoDB, driver, bson, Bun, TypeScript 6), no backward compatibility. Read `CLAUDE.md` fully before working: it is binding.

## Task to file

| Task | Read |
|---|---|
| Write or change source, write any test, hover/shape/type tests, ported Mongoose tests, guards, perf and compile budget, the order of work for a feature | `references/01-code-and-tests.md` |
| Run or interpret a root command, which command for which change, MongoDB 9.0 / 8.3 runs, Bun specifics | `references/02-commands-and-checks.md` |
| Write or change a docs page (code in `snippets/` files shown by `<Snippet />`, permanent heading ids `[#id]` and their registry), verify it on a real database, report a discrepancy | `references/03-docs-and-discrepancies.md` |
| Find where something lives (core folders, integrations, test-kit, bench) | `references/04-architecture-map.md` |

## Rules that never bend

1. **The person you work with decides, you execute.** If something is unclear, ask; do not fill gaps with guesses. A new idea (option, marker, approach) is proposed with a reason and waits for the answer; never added silently. A choice that was left to you is announced with the reason.
2. Do not revisit decisions the maintainers already made. If one gets in the way, describe the problem and offer options.
3. **Never stay silent like Mongoose**: a failing test, a contradiction in the docs, strange server behavior, a blown compile budget, your own mistake: report it plainly (what is done, what is not, what is not verified).
4. **No Python in any form** (no `python`, `pip`, `uv` and the like, not even `--version`). JSON: `jq` or `bun -e`. Scripts: Bun/TypeScript in `scripts/`.
5. **No `git commit`, `git push`, no new branch** without explicit permission, given for that one commit. Read-only git is fine.
6. **One heavy command at a time** (`tsc -b`, `bun test` of a package, `docs-check`, `test:dist`, `test:perf`, benchmarks). Never several in parallel. Anything over 2 minutes: a timeout or the background.
7. **Touch only what your task needs.** Scratch files (probes, notes) go to a temporary directory outside the repository. Format only your own files: `bunx biome check --write <files>`, never `bun run format`.
8. **A failing test is information, not a nuisance.** Never tune the expectation to the actual result. Find the reason (Typemo bug / deliberate divergence from Mongoose / server behavior / the test relied on legacy), report it, decide with the maintainers. Never raise a perf-guard threshold.
9. Core purity: no vendor code or vendor dependency in `@venloc/typemo`. An integration that lacks something gets a **general** mechanism in the core (event, hook, option, `ext` point), in its own commit or clearly separated in the report, with a note on who else it helps. An integration never changes core policies (tenant, soft delete, strict, sanitize, Hidden, `sensitive`).
10. Reply to the person in the language they use; keep it short and honest. Code, identifiers, commits and code comments are in English. Comments explain why, not what; a Mongoose pitfall is cited as `// Mongoose gh-12345`.

## Code style (details in references/01)

- ES classes only; no prototype tricks, no constructor functions. Functions outside classes are `const` arrows; class members are ordinary methods (a callback field that needs a bound `this` stays an arrow, with a comment saying why).
- Helpers are grouped in one static class per topic, one class per file (`index-helpers.ts` with `export class IndexHelpers { static ... }`); no swarm of tiny files. Files `kebab-case.ts`, classes and types `PascalCase`, `UPPER_SNAKE` only for true constants.
- ESM, imports with `.ts`, `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`.
- No `any` in the public API (`unknown`); each internal `any` has a justifying comment; checked by `bun run check:any`.
- User input is never mutated; no global patches of foreign prototypes; errors only from the Typemo hierarchy with `cause` (a masked copy when the original holds `sensitive`/`Hidden` data).
- TSDoc on everything public; every public `@example` compiles (`bun run check:tsdoc`). Shipped strings and public TSDoc carry no internal ids: `test/guards/no-decision-ids.test.ts`.

## Tests (every feature gets all kinds, written together with the code)

Runtime on a real MongoDB (memory server, replica set; 9.0 and stable 8.3) / types (`expectTypeOf`, `@ts-expect-error` with a note) / hover (TS language service quick info) / shape (compiler type against the real database result) / options and edge cases (`null` vs absent, empty, bounds, errors, transactions) / ported Mongoose tests (header `// ported from mongoose test/x.test.js:123 "title"`, listed in `packages/typemo/test/ported/INDEX.md`) / own regressions of known pitfalls. Reuse helpers from `packages/test-kit`; a new helper goes there, not copied into a test.

## Commands (root, details in references/02)

`bun run typecheck` / `test:types` / `lint` / `check:any` / `check:tsdoc` / `check:skills` / `build` / `test` / `test:dist` / `test:decorators` / `test:hover` / `test:perf` / `typecheck:timing` / `typecheck:budget`; docs: `bun scripts/docs-check.ts --types --full <page.mdx>`. Tests of a package run from its folder (Bun reads the `tsconfig.json` of the cwd). Stable server run: `TYPEMO_MONGO=stable bun test`.

## Discrepancies

A bug in the code, a wrong TSDoc, a confusing error text, a docs contradiction you cannot fix inside your task: open a GitHub issue (reproduction, what you verified and on which MongoDB, expected, actual), or put it in the report to the person you work with. On the docs page, describe the real behavior honestly; no silent workaround. Details in references/03.

## Self-check before saying "done"

- [ ] I asked where something was unclear and did not decide for others; my own choices are written down and announced.
- [ ] No Python, no commit, no files outside my task; scratch files are outside the repository.
- [ ] Style: classes, `const` arrows, static helper class, no `any`, no input mutation, errors from the hierarchy.
- [ ] All test kinds exist for the change; no test was bent to pass; the guards pass (`test-integrity`, `no-decision-ids`).
- [ ] The relevant root commands ran one at a time and I report their real results (or that I did not run them).
- [ ] Hot paths changed: `bun run test:perf` ran and the `[perf]` numbers are in the report. Types changed: `typecheck:timing` growth over 15% is reported.
- [ ] Docs pages: `docs-check --types` is `ok`; every result and error text comes from a run or a test; code lives in `snippets/` files with English comments; no published heading id changed, new ids are in `docs/ru/v1/anchors.json`.
- [ ] The report lists what is not verified.
