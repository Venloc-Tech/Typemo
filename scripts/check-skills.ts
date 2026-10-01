/*
 * Compiles every ```ts block of the skill files (`skills/**\/*.md`) against the working tree of the packages,
 * the way `docs-check.ts` compiles twoslash blocks: each block is its own file, the errors it produces are exactly
 * the TypeScript codes of its `// @errors:` line (none without that line). Failures are reported as `file:line`.
 * Usage: `bun scripts/check-skills.ts [file.md | dir] ...` (default: `skills/`); exits with 1 on a failure.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(import.meta.dir, "..");
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** Same options and path mapping as the docs examples (see `docs-check.ts`). */
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  useDefineForClassFields: false,
  skipLibCheck: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  types: ["bun"],
  typeRoots: [join(ROOT, "node_modules/@types")],
  paths: {
    "@venloc/typemo": [join(ROOT, "packages/typemo/src/index.ts")],
    "@venloc/typemo/testing": [join(ROOT, "packages/typemo/src/testing/index.ts")],
    "@venloc/typemo-decorators": [join(ROOT, "packages/decorators/src/index.ts")],
    mongodb: [join(ROOT, "packages/typemo/node_modules/mongodb")],
    "@venloc/typemo-nestjs": [join(ROOT, "integrations/nestjs/src/index.ts")],
    "@venloc/typemo-nestjs/testing": [join(ROOT, "integrations/nestjs/src/testing/index.ts")],
    "@venloc/typemo-opentelemetry": [join(ROOT, "integrations/opentelemetry/src/index.ts")],
    "@venloc/typemo-sentry": [join(ROOT, "integrations/sentry/src/index.ts")],
    "@venloc/typemo-test-kit": [join(ROOT, "packages/test-kit/src/index.ts")],
    "mongodb-memory-server": [join(ROOT, "packages/test-kit/node_modules/mongodb-memory-server")],
    "@sentry/node": [join(ROOT, "integrations/sentry/node_modules/@sentry/node")],
    ...Object.fromEntries(
      ["@opentelemetry/api", "@opentelemetry/context-async-hooks"].map((name) => [
        name,
        [join(ROOT, "integrations/opentelemetry/node_modules", name)],
      ]),
    ),
    ...Object.fromEntries(
      ["@nestjs/common", "@nestjs/core", "@nestjs/testing", "rxjs"].map((name) => [
        name,
        [join(ROOT, "integrations/nestjs/node_modules", name)],
      ]),
    ),
  },
};

/** The `.md` files named on the command line (directories are walked). */
const collect = (paths: readonly string[]): string[] =>
  paths.flatMap((p) => {
    const full = resolve(p);
    if (statSync(full).isDirectory()) return collect(readdirSync(full).map((name) => join(full, name)));
    return full.endsWith(".md") ? [full] : [];
  });

interface Block {
  /** 1-based line of the opening fence. */
  readonly line: number;
  readonly code: string;
}

/** The ```ts blocks of a markdown text (fence info may carry extra words). */
const blocksOf = (text: string): Block[] => {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^```ts(\s.*)?$/.test(lines[i] as string)) continue;
    const start = i;
    const body: string[] = [];
    for (i++; i < lines.length && !/^```\s*$/.test(lines[i] as string); i++) body.push(lines[i] as string);
    blocks.push({ line: start + 1, code: body.join("\n") });
  }
  return blocks;
};

let failures = 0;
let total = 0;
const work = mkdtempSync(join(tmpdir(), "check-skills-"));
try {
  const files = collect(targets.length > 0 ? targets : [join(ROOT, "skills")]);
  for (const file of files) {
    const blocks = blocksOf(await Bun.file(file).text());
    total += blocks.length;
    blocks.forEach((block, index) => {
      const expected = [...block.code.matchAll(/\/\/ @errors: ([\d ]+)/g)].flatMap((m) =>
        (m[1] as string).trim().split(/\s+/).map(Number),
      );
      const source = block.code
        .split("\n")
        .filter((l) => !/\/\/ @errors:/.test(l))
        .join("\n");
      const dir = join(work, `${failures}-${total}-${index}`);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, "index.ts");
      writeFileSync(path, source);
      const program = ts.createProgram([path], OPTIONS);
      const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => d.file?.fileName.startsWith(dir));
      const got = diagnostics.map((d) => d.code).sort();
      if (JSON.stringify(got) === JSON.stringify([...expected].sort())) return;
      failures++;
      console.log(
        `✗ ${relative(ROOT, file)}:${block.line}: expected errors ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
      );
      for (const d of diagnostics) {
        const where = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
        console.log(
          `    TS${d.code} (block line ${where}, file line ${block.line + where}): ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 300)}`,
        );
      }
    });
  }
  console.log(
    failures === 0 ? `ok: ${total} ts block(s) in ${files.length} file(s)` : `${failures} failing block(s) of ${total}`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
