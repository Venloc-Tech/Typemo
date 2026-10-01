/*
 * Finds candidate Mongoose tests to port: given one or more
 * keywords, or a `gh-NNNN` issue reference, greps
 * `references/mongoose-master/test/**\/*.test.js` for matching `it(...)`
 * titles and prints `file:line: "title"` for each hit.
 *
 * Usage:
 *   bun run scripts/port/find-mongoose-tests.ts discriminator
 *   bun run scripts/port/find-mongoose-tests.ts gh-15800
 *   bun run scripts/port/find-mongoose-tests.ts map cast   # AND across args
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

/** The Mongoose test directory. */
const REFERENCES_TEST_ROOT = resolve(import.meta.dir, "../../references/mongoose-master/test");

/** Matches `it('title', ...)`, `it("title", ...)`, `it.only(...)`, `it.skip(...)`. */
const IT_LINE_PATTERN = /^\s*it(?:\.only|\.skip)?\(\s*(['"`])((?:(?!\1).)*)\1/;

/**
 * A Mongoose test that matches the search.
 *
 * @example
 * ```ts
 * const candidate: CandidateTest = { file: "test/model.test.js", line: 12, title: "saves" };
 * ```
 */
interface CandidateTest {
  /** The test file. */
  readonly file: string;
  /** 1-based line of the `it(...)`. */
  readonly line: number;
  /** The test title. */
  readonly title: string;
}

/** Searches the Mongoose tests. */
class MongooseTestFinder {
  /**
   * Prints the tests that match every argument.
   *
   * @param rawArgs - Keywords or `gh-NNNN` references.
   */
  static run(rawArgs: readonly string[]): void {
    if (rawArgs.length === 0) {
      console.error("Usage: bun run scripts/port/find-mongoose-tests.ts <keyword|gh-NNNN> [more...]");
      process.exitCode = 1;
      return;
    }

    const needles = rawArgs.map((arg) => MongooseTestFinder.#normalizeNeedle(arg));
    const files = MongooseTestFinder.#listTestFiles(REFERENCES_TEST_ROOT);
    const candidates: CandidateTest[] = [];

    for (const file of files) {
      candidates.push(...MongooseTestFinder.#findInFile(file, needles));
    }

    if (candidates.length === 0) {
      console.log("No candidates found.");
      return;
    }

    for (const candidate of candidates) {
      const relPath = relative(resolve(import.meta.dir, "../.."), candidate.file);
      console.log(`${relPath}:${candidate.line}: "${candidate.title}"`);
    }
    console.log(`\n${candidates.length} candidate(s).`);
  }

  /**
   * A search term in lower case; `gh-15800` becomes the bare number.
   *
   * @param arg - The argument.
   * @returns The needle to look for.
   */
  static #normalizeNeedle(arg: string): string {
    const ghMatch = /^gh-(\d+)$/i.exec(arg);
    return ghMatch ? (ghMatch[1] ?? arg) : arg.toLowerCase();
  }

  /**
   * Every `*.test.js` file below a directory.
   *
   * @param root - The directory.
   * @returns Sorted absolute paths.
   */
  static #listTestFiles(root: string): string[] {
    const results: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
          walk(full);
        } else if (extname(entry) === ".js" && entry.endsWith(".test.js")) {
          results.push(full);
        }
      }
    };
    walk(root);
    return results.sort();
  }

  /**
   * The tests of a file whose line contains every needle.
   *
   * @param file - The test file.
   * @param needles - The lower-case search terms.
   * @returns The matching tests.
   */
  static #findInFile(file: string, needles: readonly string[]): CandidateTest[] {
    const lines = readFileSync(file, "utf8").split("\n");
    const matches: CandidateTest[] = [];
    for (const [index, line] of lines.entries()) {
      const match = IT_LINE_PATTERN.exec(line);
      if (!match) {
        continue;
      }
      const title = match[2] ?? "";
      const haystack = `${title} ${line}`.toLowerCase();
      /* Every needle must appear (in the title text, or as a bare gh number
         anywhere on the line, e.g. inside `(gh-15800)`). */
      const allMatch = needles.every((needle) => haystack.includes(needle));
      if (allMatch) {
        matches.push({ file, line: index + 1, title });
      }
    }
    return matches;
  }
}

MongooseTestFinder.run(process.argv.slice(2));
