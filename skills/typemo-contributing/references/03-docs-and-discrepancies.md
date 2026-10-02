# Docs pages and discrepancies

Read this to write or change a documentation page, to verify it on a real database, or to report something that does not behave as it should. This file is self-contained: it holds the rules for page types, language, format, components, links and verification.

## Where the docs live

- `docs/<language>/<version>/<section>/<page>.mdx`: `docs/ru/v1/...` is written first and verified; `docs/en/v1/...` holds translations of approved pages. The same page has the same path in every language. File names are English `kebab-case`.
- Every section folder has `index.mdx` (an overview: one or two phrases and `Cards`) and `meta.json` (`{ "title": "...", "pages": ["index", "page-a", ...] }`, the order of the side menu). **A new page is added to the `pages` list of its folder's `meta.json`** and, when it should be found from the overview, to a `Card` in the folder's `index.mdx`.
- Sections of `docs/ru/v1` (by task, not by code module): `getting-started`, `concepts`, `connection`, `schemas`, `queries`, `writes`, `documents`, `populate`, `aggregation`, `transactions`, `hooks`, `policies`, `collections`, `change-streams`, `errors`, `observability`, `integrations`, `extensions`, `testing`, `decorators-tc39`, `migration`, `recipes`, `appendix`, and `reference` (it repeats the sections: the guide `queries/...` has the reference `reference/query/...`). List the real folder (`ls docs/ru/v1`) before you add one.
- Code examples do not live in the pages: each code block is a file under `snippets/<version>/<page path without .mdx>/` and the page has a `<Snippet id="..." />` tag in its place (see "Code: snippet files" below).
- Every heading ends with a permanent English id (`## Быстрый путь [#quick-start]`), and `docs/ru/v1/anchors.json` lists the ids of every page of the version (see "Heading ids and links").
- To copy the form, open a neighbour page of the same type: a guide such as `docs/ru/v1/queries/reading-data.mdx`, a reference such as `docs/ru/v1/reference/query/reading.mdx`.
- Docs text is Russian first. Never put internal ids, plan numbers or team words into a page.

## Two page types, never mixed

**Guide** (answers "how do I do X?", read top to bottom). The title is the reader's task, not an internal concept. Fixed order of parts; any may be skipped, none reordered:

1. intro: the first phrase says what and why; one paragraph; a link, not a lecture, for needed basics;
2. "what you need" (`prerequisites`): one or two lines;
3. quick path: the most common case, minimal code (if there are three variants, show all side by side);
4. scenario sections: each one situation, the heading is an action; in order: when it arises, minimal self-contained code, what happened and why, variations;
5. how to choose: prose, one question the reader asks, signs, not a table;
6. when this is not needed;
7. if something goes wrong (`troubleshooting`): each mistake is a paragraph that starts with the symptom in bold; wrong code, the exact error text, the reason, the fix;
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
## Что понадобится [#prerequisites]
## Быстрый путь [#quick-start]
## <Scenario as an action> [#<own-id>] ... (each: situation, code, what happened and why)
## Как выбрать [#how-to-choose]
## Когда это не нужно [#when-not-to-use]
## Если что-то пошло не так [#troubleshooting]   (each mistake: a bold symptom paragraph)
## Полный пример [#full-example]
<Callout type="migration"> ... </Callout>
## Что дальше [#next-steps]   (<Cards><Card title href>one phrase</Card></Cards>)
```

Reference page: heading and paragraph, the shared data model and the data the results come from, then per element `## Model.find [#model.find]` (explanation, short example, `<Returns>`, `<Params>`, `<FullType>`, scenario subsections, `### Ошибки [#...]` with exact texts, when it does not fit), then "Остальные методы" for elements of other groups, "Когда не подходит", "Что дальше".

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

## Heading ids and links

- Every heading (`##`, `###`, deeper) ends with a permanent English id, the last thing on the line, after a `Badge`: `## Быстрый путь [#quick-start]`, `## Model.watch <Badge variant="requires">реплика-сет</Badge> [#model.watch]`. The id is the anchor; it is never built from the heading text.
- Id rules: lowercase Latin and digits, words joined by `-`, code segments by `.`, regex `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`; `camelCase` is split with `-`, `$`, `@` and brackets are dropped: `Model.find` is `model.find`, `Model.findById` is `model.find-by-id`, `$save` is `save`, `DocumentNotFoundError` is `document-not-found-error`. Unique within a page.
- Fixed ids for the recurring guide sections: `prerequisites`, `quick-start`, `how-to-choose`, `when-not-to-use`, `troubleshooting`, `full-example`, `next-steps`.
- **An id is never renamed once published**: other pages, translations and external sites link to it. Renaming a heading keeps its id. Removing a heading (or its id) breaks external links: ask the maintainers first.
- The registry `docs/ru/v1/anchors.json` (one per docs version, shared by all languages; key = page path inside the version, value = its ids in order) lists every id. A new heading gets a new id in the page **and** in the registry; a new page gets a new key. Translations reuse the same ids. The docs site checks the headings against the registry; `docs-check` does not read it.
- The first mention of every API element in every second-level section is a link to its reference id (``[`find`](../reference/query/reading.mdx#model.find)``). In "when this is not needed", "how to choose", "if something goes wrong" and "what next" every named replacement is a link. No links inside code blocks or headings.
- Links point to ids that exist: check the target file on disk and read the id from its heading (or from the registry).

## Format (MDX)

- Front matter: `title` and `description` (one phrase, at most 160 characters; quote it if it has `: `), optional `icon` (a Lucide name in `PascalCase`). No `# H1` in the text: the title is the H1.
- MDX is stricter than Markdown. Outside code: no `{` `}` (a JS expression) and no `<` `>` (a JSX tag). Write `` `{ hidden: true }` `` and `` `Map<string, V>` `` as inline code and replace comparison signs with words. HTML comments do not work. Close tags (`<br />`). Leave a blank line after an opening component tag and before the closing one, or the Markdown inside is not parsed. No raw HTML (`<div>`, `<details>`, `<table>`).
- Components (global, no imports): `Callout` (`type` tip / warning / migration, optional `title`), `Steps`/`Step` (a `###` first inside each step), `Tabs`/`Tab` (`items`, `groupId`: `decorators` or `pm`), `FullType` (collapsed signature), `Params`/`Param` (`name`, `type`, `required`, `default`) and `Returns` (`type`), `TypeTable` (`type={{ "name": { description, type?, required?, default? } }}`), `Badge` (`variant` scope / requires), `Cards`/`Card` (`title`, `href`, one phrase), `Compare`, `ValueForms`, `Term`. Special code blocks: `package-install` (install tabs; the first line `-D` makes dev dependencies) and `tree` (a file tree, two spaces per level, a folder ends with `/`, `# comment`).
- `// [!code ++]` and `// [!code --]` inside the code mark changes; `// [!code highlight]`, `focus`, `error`, `warning`.

## Code: snippet files

- No code block is written in a page, except `package-install`, `tree` and `md`. Every other block is a file `snippets/<version>/<page path without .mdx>/<name>.<ext>`, and the page has a tag on its own line, at the indentation the fence would have had (inside `Step`, `Tab`, `Compare`, `FullType`, a list item):

  ```mdx
  <Snippet id="transactions/transactions/transfer-money" title="accounts/accounts.service.ts" twoslash />
  ```

- File name = the id of the section the block is in, `.` replaced by `-`; the second and later blocks of a section get `-2`, `-3`: `quick-start.ts`, `quick-start-2.ts`, `model-find.ts` for `[#model.find]`; code before the first heading is `overview`. The extension sets the language: `.ts` ts, `.tsx` tsx, `.json` json, `.sh` bash, `.txt` text (error texts, output). One file per id: two extensions for the same id is an error.
- Tag props (strings in double quotes or bare flags, no `{...}` expressions, always self-closing): `id` (required: the path inside `snippets/<version>/` without extension; `id="file#name"` takes one region), `title` (the project file name; always when the code lives in a project file), `twoslash`, `highlight="2,4-5"`, `lineNumbers`, `noCopy`, `lang` (overrides the language of the extension), `meta` (the rest of the fence meta as is), `version` (a file of another docs version).
- **Every tag of a TypeScript example that uses the product API has `twoslash`**, so the build compiles it. The exception is a fragment that is not complete code (a signature in `FullType`, a partial model with `...`, Mongoose code in `Compare`).
- Comments inside snippet files are in English (`// → 3`, `// compiler: ...`, `// at runtime: ...`, `// ...fields above`): the same file serves every language. Explanations in the reader's language go in the page text.
- Twoslash markers (`// ---cut---`, `// ^?`, `// @errors: ...`, `// @filename: ...`) and `// [!code ...]` marks stay inside the file; the tag props replace only the fence meta.
- Identical blocks share one file: the second tag uses the existing id (the quick start shows `getting-started/installation/quick-start` as its `tsconfig.json`). Before you edit a snippet, `grep -rn 'id="<id>' docs`: the edit changes every page that uses it.
- Regions: mark part of a file with `// #region name` ... `// #endregion` (`# #region name` in `.sh`) and use `id="<file id>#name"`; the marker lines are dropped and the common indentation removed.
- Language folders: `snippets/<version>/<language>/<id>.<ext>` overrides the common file for pages of that language (none exist now). An `id` never starts with a language code.
- `scripts/docs-check.ts` expands the tags before every check; a tag without a file or region, or with an unknown prop, is a failure that names the page line and the snippet file. `snippets/` is excluded from biome; `snippets/tsconfig.json` exists for the editor only (blocks with `// @errors` stay red there).
- A new example = a new file named after its section id + a tag.
- Twoslash rules (inside the snippet file):
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

`docs-check` first expands every `<Snippet />` tag into the code block of its file, then compiles every twoslash block against the working tree (a block's errors must be exactly the codes of its `// @errors:` line, none without it). `--types` prints the `// ^?` types, `--full` prints whole compiler messages (cut at 240 characters otherwise). It checks the front matter (`title`, a one-phrase `description` of at most 160 characters), `{ } < >` in prose outside code and components, and every relative Markdown link: the file exists and the `#id` is the id of one of its headings. It does NOT check the `href` of a `<Card>`: check those by hand.

A page is done when `docs-check --types` says `ok`, every error text and every `// → value` comes from a run or a test, workaround callouts for fixed bugs are gone, first mentions of API are links, and the text reads as one whole.

Page report (your last message): pages changed or new with the `docs-check` result and block count; what was checked by running and what was not; discrepancies found (issue links); headings added, renamed or removed, ids added to `anchors.json` (and links to fix elsewhere); what was not done and why.

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

Bad: renaming a heading id, or a new heading without an id. Good: keep the old id when the text changes; give a new heading a new id and add it to `docs/ru/v1/anchors.json`.

Bad: a fenced `ts` code block written in a page, or a Russian comment in a snippet file. Good: a file in `snippets/<version>/<page>/` named after the section id, a `<Snippet />` tag, English comments.

Bad: a "known problem" callout around a bug that is already fixed. Good: remove it or rewrite it as a plain explanation.

Bad: a new page that is not in the folder's `meta.json`. Good: add it, and a `Card` in `index.mdx`.

## Self-check

- [ ] The page type is clear (guide or reference), the parts are in the fixed order, the title of a guide is a task.
- [ ] Every code block is a snippet file with a `<Snippet />` tag (except `package-install`, `tree`, `md`); comments in it are English; every tag of a TypeScript example with product API has `twoslash`; no `@noErrors`; `docs-check --types` is `ok`.
- [ ] Every heading has an id; no published id changed; new ids are in `docs/ru/v1/anchors.json`.
- [ ] Every result and error text comes from a run or a test; unverified claims are removed or listed.
- [ ] The first mention of each API element in each `##` is a link; replacements in "when not to use" and "if something goes wrong" are links; every `#id` exists in the target page; `Card href` checked by hand.
- [ ] No forbidden phrases, no internal words or decision ids, at most one or two callouts per section.
- [ ] The new page is in `meta.json`; discrepancies are reported with the full set of fields.
