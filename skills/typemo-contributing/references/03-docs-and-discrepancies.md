# Docs pages and discrepancies

Read this to write or change a documentation page, to verify it on a real database, or to report something that does not behave as it should. This file is self-contained: it holds the rules for page types, language, format, components, links and verification.

## Where the docs live

- `docs/<language>/<version>/<section>/<page>.mdx`: `docs/ru/v1/...` is written first and verified; `docs/en/v1/...` holds translations of approved pages. The same page has the same path in every language. File names are English `kebab-case`.
- Every section folder has `index.mdx` (an overview: one or two phrases and `Cards`) and `meta.json` (`{ "title": "...", "pages": ["index", "page-a", ...] }`, the order of the side menu). **A new page is added to the `pages` list of its folder's `meta.json`** and, when it should be found from the overview, to a `Card` in the folder's `index.mdx`.
- Sections of `docs/ru/v1` (by task, not by code module): `getting-started`, `concepts`, `connection`, `schemas`, `queries`, `writes`, `documents`, `populate`, `aggregation`, `transactions`, `hooks`, `policies`, `collections`, `change-streams`, `errors`, `observability`, `integrations`, `extensions`, `testing`, `decorators-tc39`, `migration`, `recipes`, `appendix`, and `reference` (it repeats the sections: the guide `queries/...` has the reference `reference/query/...`). List the real folder (`ls docs/ru/v1`) before you add one.
- To copy the form, open a neighbour page of the same type: a guide such as `docs/ru/v1/queries/reading-data.mdx`, a reference such as `docs/ru/v1/reference/query/reading.mdx`.
- Docs text is Russian first. Never put internal ids, plan numbers or team words into a page.

## Two page types, never mixed

**Guide** (answers "how do I do X?", read top to bottom). The title is the reader's task, not an internal concept. Fixed order of parts; any may be skipped, none reordered:

1. intro: the first phrase says what and why; one paragraph; a link, not a lecture, for needed basics;
2. "what is assumed": one or two lines;
3. quick path: the most common case, minimal code (if there are three variants, show all side by side);
4. scenario sections: each one situation, the heading is an action; in order: when it arises, minimal self-contained code, what happened and why, variations;
5. how to choose: prose, one question the reader asks, signs, not a table;
6. when this is not needed;
7. common mistakes: the heading is the symptom; wrong code, the exact error text, the reason, the fix;
8. full example: one finished file;
9. a "migrating from Mongoose" callout, only the differences;
10. what next: links, each with one phrase of what is there.

**Reference** (answers "how exactly does this element work?", read selectively). Split by task groups, not by source files; each page describes its group completely. Page start: heading, a paragraph, the shared data model used by all examples, the element list. Each element, in the same order: heading (the exact name, `Model.find`, `.select`), 2-3 paragraphs of connected explanation, a short example with the result in a comment, Returns, Params, FullType (collapsed, exact signature), scenarios (subsections named by situations), Errors (exact text, compile-time and run-time), When it does not fit (with links to the replacement). Special cases get their own subsection: works not with all operations (say it in the first phrase and show the error), differs from what a MongoDB user expects, several calls of the same method (add up / replace / error), interaction with policies, filters, transactions, cache.

Skeletons (text in Russian for `docs/ru`):

```text
---
title: <the reader task>
description: "<one phrase, at most 160 characters>"
icon: <LucideName>
---
<first phrase: what and why> <paragraph>
## Что предполагается
## Быстрый путь
## <Scenario as an action> ... (each: situation, code, what happened and why)
## Как выбрать
## Когда это не нужно
## Частые ошибки          (### a symptom as the heading)
## Полный пример
<Callout type="migration"> ... </Callout>
## Что дальше             (<Cards><Card title href>one phrase</Card></Cards>)
```

Reference page: heading and paragraph, the shared data model and the data the results come from, then per element `## Model.find` (explanation, short example, `<Returns>`, `<Params>`, `<FullType>`, scenario subsections, `### Ошибки` with exact texts, when it does not fit), then "Остальные методы" for elements of other groups, "Когда не подходит", "Что дальше".

## Language and tone

- Address the reader as "you", present tense, active voice. The product is the actor ("the library does not turn `undefined` into an empty value silently").
- Explain **why**, concretely: what would break without the rule, which MongoDB oddity stands behind it, which reader mistake it prevents. "For safety" and "for consistency" are not reasons.
- One thought per paragraph, sentences joined with "because", "so", "otherwise", "for example". Introduce code with a phrase and explain it after. Lists only for equal, unrelated items; a table only to map homogeneous data (at most one per guide).
- Explain every term where it first appears; one concept is one word across the docs.
- Forbidden: openers ("In this article we will..."), empty praise (powerful, flexible, convenient, elegant), empty closers, officialese, vagueness ("etc.", "various"), unchecked promises ("always", "never", "guarantees").
- Callouts are three kinds only (`tip`, `warning`, `migration`), one or two per section, never the main information.
- Examples share ONE domain across a page (bank accounts, blog users, shop orders) and the model grows through the page. Reader code that is not in the product is marked `__verifyPassword__()`. No third-party framework in examples except on a page about that integration. Identifiers and secrets are visibly fake.
- Wrong code is shown only in an error context, with the exact error text and the right code beside it.
- Examples really run. A result is written as a comment `// → value` and comes from a run on a real server, never from memory.

## Anchors and links

- The first mention of every API element in every second-level section is a link to its reference anchor (``[`find`](../reference/query/reading.mdx#modelfind)``). In "when this is not needed", "how to choose", "common mistakes" and "what next" every named replacement is a link. No links inside code blocks or headings.
- Anchor = the heading lowercased, with `.`, `$`, `@` and brackets removed, spaces to `-`, Cyrillic kept: `## Model.find` is `#modelfind`, `## @Tenant` is `#tenant`. The text of a `Badge` in a heading does not enter the anchor.
- If you change a reference heading, search all docs for links to the old anchor: `grep -rn "#old-anchor" docs`.
- Links point to files that exist: check the target on disk and read the real heading from the file.

## Format (MDX)

- Front matter: `title` and `description` (one phrase, at most 160 characters; quote it if it has `: `), optional `icon` (a Lucide name in `PascalCase`). No `# H1` in the text: the title is the H1.
- MDX is stricter than Markdown. Outside code: no `{` `}` (a JS expression) and no `<` `>` (a JSX tag). Write `` `{ hidden: true }` `` and `` `Map<string, V>` `` as inline code and replace comparison signs with words. HTML comments do not work. Close tags (`<br />`). Leave a blank line after an opening component tag and before the closing one, or the Markdown inside is not parsed. No raw HTML (`<div>`, `<details>`, `<table>`).
- Components (global, no imports): `Callout` (`type` tip / warning / migration, optional `title`), `Steps`/`Step` (a `###` first inside each step), `Tabs`/`Tab` (`items`, `groupId`: `decorators` or `pm`), `FullType` (collapsed signature), `Params`/`Param` (`name`, `type`, `required`, `default`) and `Returns` (`type`), `TypeTable` (`type={{ "name": { description, type?, required?, default? } }}`), `Badge` (`variant` scope / requires), `Cards`/`Card` (`title`, `href`, one phrase), `Compare`, `ValueForms`, `Term`. Special code blocks: `package-install` (install tabs; the first line `-D` makes dev dependencies) and `tree` (a file tree, two spaces per level, a folder ends with `/`, `# comment`).
- Code blocks: always a language; `title="path/file.ts"` when the code lives in a project file; `// [!code ++]` and `// [!code --]` mark changes; `// [!code highlight]`, `focus`, `error`, `warning`. **Every ts block that uses the product API is a twoslash block** (the info string `ts twoslash`), so the build compiles it. The exception is a fragment that is not complete code (a signature in `FullType`, a partial model with `...`).
- Twoslash rules:
  - `// ---cut---` hides the setup above it. Imports, model and client are written in full; no `declare const` for what the reader would really declare.
  - `// ^?` under a one-line declaration prints the real type (two or three per block at most).
  - `// @errors: 2345 2322` declares the expected compile errors, codes separated by a space. A decorator-property error (a wrong `@Prop` option) has code `1240`, and its `// @errors:` line goes right after `// ---cut---`.
  - `// @filename: path` for several files.
  - `// @noErrors` is forbidden: put the real codes in `// @errors:`.
  - Twoslash proves types, never run-time results: every `// → value` comes from a run.

## Verify a page on a real MongoDB

Facts only from code and runs (order of trust: a run on a real server, compiler output, the source, the tests, comments only as a hint). Never copy an old error text: get the current one by running, or `grep -rn "<piece of text>" packages/typemo/test`. What you cannot verify, remove or list as not verified in the report.

Probe template: a scratch test file in a temporary directory OUTSIDE the repository (so use absolute imports; replace `<repo>` with the clone path):

```text
import { afterAll, test } from "bun:test";
import { MongoHarness } from "<repo>/packages/test-kit/src/index.ts";
import { Entity, Prop, Schema, TypemoClient } from "<repo>/packages/typemo/src/index.ts";
afterAll(() => MongoHarness.stop());
test("probe", async () => {
  await MongoHarness.ensureStarted();
  const client = await TypemoClient.connect(MongoHarness.getUri(), { dbName: "<own name>" });
  // the example from the page; console.log real results, classes and error texts
  await client.close();
});
```

Run: `cd packages/typemo && bun test --timeout 120000 <absolute path of the probe>`. Notes: `client.connection` is a property, not a method; `deleteMany({})` and `deleteOne({})` are forbidden, clean with `Filters.all()` or a real filter. Check on 9.0 and on `TYPEMO_MONGO=stable` when the result may depend on the server.

Then the docs checker:

```bash
bun scripts/docs-check.ts --types --full docs/ru/v1/queries/reading-data.mdx
bun scripts/docs-check.ts docs/ru/v1/integrations      # a whole folder
```

`docs-check` compiles every twoslash block against the working tree (a block's errors must be exactly the codes of its `// @errors:` line, none without it). `--types` prints the `// ^?` types, `--full` prints whole compiler messages (cut at 240 characters otherwise). It checks the front matter (`title`, a one-phrase `description` of at most 160 characters), `{ } < >` in prose outside code and components, and every relative Markdown link: the file exists and the `#anchor` exists in it. It does NOT check the `href` of a `<Card>`: check those by hand.

A page is done when `docs-check --types` says `ok`, every error text and every `// → value` comes from a run or a test, workaround callouts for fixed bugs are gone, first mentions of API are links, and the text reads as one whole.

Page report (your last message): pages changed or new with the `docs-check` result and block count; what was checked by running and what was not; discrepancies found (issue links); headings or anchors changed (and links to fix elsewhere); what was not done and why.

## Reporting a discrepancy

Report when you find something you cannot fix by editing your one page: the code behaves differently from its type or TSDoc; a confusing or wrong error text; a type that lets an error through or rejects sensible code; an IDE hover that hurts; a public name that looks internal; a wrong TSDoc example; a contradiction between pages; a gap in `docs-check`. On the page, describe the real behavior honestly: no silent workaround, no promise of a fix.

Open a GitHub issue (or, when you work with a person, put it in your report) with:

```text
Title: <short, what is wrong>
What is wrong: <one to three sentences>
Reproduce: <code or steps; for types a fragment and the compiler error text>
Verified: <ran on MongoDB 9.0 / 8.3, the compiler, or read the code: path:line>
Expected: <what the type, the TSDoc or common sense says>
In the docs: <what the page says now: the real behavior described / a workaround / not described>
Severity: high / medium / low
```

Search the existing issues first, so you do not duplicate one. When the code is fixed later, update the pages that describe the behavior and remove the workaround text.

## Common mistakes

Bad: copying an error text from an old page. Good: get it by running, or from a test.

Bad: `// @noErrors` to silence a block. Good: put the real code in `// @errors:`.

Bad: `{ hidden: true }` or `Map<string, V>` in prose. Good: inline code.

Bad: a new `##` in a reference page without searching for old anchors. Good: `grep -rn "#old-anchor" docs`.

Bad: a "known problem" callout around a bug that is already fixed. Good: remove it or rewrite it as a plain explanation.

Bad: a new page that is not in the folder's `meta.json`. Good: add it, and a `Card` in `index.mdx`.

## Self-check

- [ ] The page type is clear (guide or reference), the parts are in the fixed order, the title of a guide is a task.
- [ ] Every ts block with product API is twoslash; no `@noErrors`; `docs-check --types` is `ok`.
- [ ] Every result and error text comes from a run or a test; unverified claims are removed or listed.
- [ ] The first mention of each API element in each `##` is a link; replacements in "when not to use" and "common mistakes" are links; anchors match the headings on disk; `Card href` checked by hand.
- [ ] No forbidden phrases, no internal words or ids, at most one or two callouts per section.
- [ ] The new page is in `meta.json`; discrepancies are reported with the full set of fields.
