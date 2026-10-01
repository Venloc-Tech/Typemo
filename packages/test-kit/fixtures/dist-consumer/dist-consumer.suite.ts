/*
 * The consumer test of the COMPILED library: a project outside the monorepo setup installs the packed, built
 * packages (`bun run build`, then `bun pm pack` and extract) and uses them with a plain `tsconfig` — no
 * `allowImportingTsExtensions`, the default `lib`, legacy decorators with `experimentalDecorators` only, the
 * declarations checked too (`skipLibCheck` off). It checks:
 *  1. what ships: the files of each package, the targets of `exports`, no sources, no internal entry;
 *  2. the project compiles (legacy decorators, TC39 decorators, every entry point);
 *  3. hovers and compiler errors through the built declarations equal the sources' (the same snippets, both ways);
 *  4. a runtime smoke on a real MongoDB through the built JavaScript, run by Node.
 * Run: `bun run test:dist` (builds first). Not part of `bun run test`.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { MongoHarness, TypeProbe } from "../../src/index.ts";
import { ERROR_CASES, HEAD, HOVER_CASES } from "./hover-cases.ts";
import { DistInstall, PROJECT, PUBLISHED } from "./install.ts";

const ROOT = resolve(PROJECT, "../../../..");
const TSC = join(ROOT, "node_modules/typescript/bin/tsc");
const SRC_DIR = join(PROJECT, "src");

/**
 * Compiles a project of the consumer with `tsc` (a separate process, like a user's build).
 *
 * @param config - The tsconfig file name.
 * @param flags - Extra compiler flags.
 * @returns The exit code and the compiler output.
 */
const compile = (config: string, ...flags: string[]): { readonly code: number; readonly text: string } => {
  const result = Bun.spawnSync(["bun", TSC, "-p", config, ...flags], { cwd: PROJECT, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, text: `${result.stdout.toString()}${result.stderr.toString()}` };
};

/**
 * Runs a compiled smoke under Node against the shared MongoDB and returns its `RESULT` object.
 *
 * @param script - The compiled script, relative to the project.
 * @param db - The database name the script uses.
 * @returns The parsed result.
 */
const smoke = (script: string, db: string): Record<string, unknown> => {
  /* The smokes can run alone (`-t`): compile first when the compile tests did not run. */
  if (!existsSync(join(PROJECT, script))) {
    for (const config of ["tsconfig.json", "tsconfig.tc39.json"]) expect(compile(config).code).toBe(0);
  }
  const result = Bun.spawnSync(["node", script], {
    cwd: PROJECT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, MONGO_URI: MongoHarness.getUri(), MONGO_DB: db },
  });
  const text = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode !== 0) throw new Error(`node ${script} failed (${result.exitCode}):\n${text}`);
  const line = text.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (line === undefined) throw new Error(`node ${script} printed no RESULT line:\n${text}`);
  return JSON.parse(line.slice("RESULT ".length)) as Record<string, unknown>;
};

let shipped: Record<string, number>;

beforeAll(async () => {
  if (!DistInstall.built()) throw new Error("the packages are not built: run `bun run build` (or `bun run test:dist`)");
  shipped = DistInstall.install();
  rmSync(join(PROJECT, "out"), { recursive: true, force: true });
  await MongoHarness.ensureStarted();
}, 600_000);

describe("what the packed packages ship", () => {
  test("every package ships its dist, and every `exports` target exists", () => {
    for (const pkg of PUBLISHED) {
      const dir = join(PROJECT, "node_modules", pkg.name);
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        readonly exports: Record<string, string | Record<string, string>>;
        readonly files?: readonly string[];
      };
      expect(shipped[pkg.name]).toBeGreaterThan(3);
      for (const [entry, targets] of Object.entries(manifest.exports)) {
        /* `./package.json` is a plain file entry; every other entry is an object of conditions. */
        if (typeof targets === "string") {
          expect(existsSync(join(dir, targets)), `${pkg.name} ${entry}`).toBe(true);
          continue;
        }
        for (const [condition, target] of Object.entries(targets)) {
          expect(existsSync(join(dir, target)), `${pkg.name} ${entry} ${condition} -> ${target}`).toBe(true);
        }
      }
    }
  });

  test("the packed packages ship their agent skill", () => {
    for (const [pkg, skill] of [
      ["@venloc/typemo", "typemo"],
      ["@venloc/typemo-nestjs", "typemo-nestjs"],
    ] as const) {
      const file = join(PROJECT, "node_modules", pkg, "skills", skill, "SKILL.md");
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8")).toContain(`name: ${skill}`);
    }
  });

  test("no sources, no tests and no internal entry are shipped", () => {
    const core = join(PROJECT, "node_modules/@venloc/typemo");
    expect(existsSync(join(core, "src"))).toBe(false);
    expect(existsSync(join(core, "test"))).toBe(false);
    expect(existsSync(join(core, "dist/internal.js"))).toBe(false);
    expect(existsSync(join(core, "tsconfig.json"))).toBe(false);
  });

  test("the built JavaScript and declarations have no `.ts` import specifiers left", () => {
    const grep = Bun.spawnSync(
      /* only the shipped code: the agent skills (markdown) quote user code that imports its own `.ts` files */
      [
        "grep",
        "-rlE",
        "--include=*.js",
        "--include=*.d.ts",
        `(from|import\\()\\s*["']\\.{1,2}/[^"']*\\.ts["']`,
        join(PROJECT, "node_modules/@venloc"),
      ],
      { stdout: "pipe" },
    );
    expect(grep.stdout.toString()).toBe("");
  });

  test("the internal members are not in the built declarations", () => {
    const client = readFileSync(
      join(PROJECT, "node_modules/@venloc/typemo/dist/connection/typemo-client.d.ts"),
      "utf8",
    );
    const connection = readFileSync(
      join(PROJECT, "node_modules/@venloc/typemo/dist/connection/connection.d.ts"),
      "utf8",
    );
    for (const name of ["auditTransaction", "readyIfNeeded"]) expect(client).not.toContain(name);
    /* "extensions" also appears in prose (`TypemoExtension`); the member is a line that starts with it. */
    expect(client).not.toMatch(/^\s+(readonly )?extensions[\s:;(]/m);
    expect(connection).not.toContain("compileContext");
    expect(readFileSync(join(PROJECT, "node_modules/@venloc/typemo/dist/model/model.d.ts"), "utf8")).not.toContain(
      "runDocument",
    );
  });
});

describe("the project compiles against the built declarations", () => {
  test("legacy decorators, every entry point, declarations checked (skipLibCheck off)", () => {
    const { code, text } = compile("tsconfig.json");
    expect(text).toBe("");
    expect(code).toBe(0);
  }, 120_000);

  test("TC39 decorators of @venloc/typemo-decorators", () => {
    const { code, text } = compile("tsconfig.tc39.json");
    expect(text).toBe("");
    expect(code).toBe(0);
  }, 120_000);

  test("with skipLibCheck on, as most projects have it", () => {
    const { code, text } = compile("tsconfig.json", "--skipLibCheck");
    expect(text).toBe("");
    expect(code).toBe(0);
  }, 120_000);
});

describe("hovers and compiler errors: the built declarations equal the sources", () => {
  const dist = (): TypeProbe => TypeProbe.shared({ tsconfig: join(PROJECT, "tsconfig.json") });
  const source = (): TypeProbe => TypeProbe.shared({ tsconfig: join(PROJECT, "tsconfig.source.json") });

  test.each(HOVER_CASES.map((entry) => [entry.name, entry] as const))(
    "hover: %s",
    (_name, entry) => {
      const code = `${HEAD}${entry.code}`;
      const built = dist().check(code, { dir: SRC_DIR }).hover();
      expect(built).toBe(source().check(code, { dir: SRC_DIR }).hover());
      for (const fragment of entry.contains) expect(built).toContain(fragment);
    },
    120_000,
  );

  test.each(ERROR_CASES.map((entry) => [entry.name, entry] as const))(
    "error: %s",
    (_name, entry) => {
      const code = `${HEAD}${entry.code}`;
      const built = dist().check(code, { dir: SRC_DIR }).diagnosticText();
      expect(built).not.toBe("");
      expect(built).toContain(entry.contains);
      expect(built).toBe(source().check(code, { dir: SRC_DIR }).diagnosticText());
    },
    120_000,
  );
});

describe("runtime smoke on a real MongoDB through the built JavaScript (Node)", () => {
  test("legacy decorators: models, reads, updates, populate, aggregation, tenant, discriminators, errors, transaction", () => {
    const result = smoke("out/legacy/smoke.js", `dist_consumer_${Date.now()}`);
    expect(result.created).toEqual({
      email: "ann@x.io",
      label: "Ann <ann@x.io>",
      hasTimestamps: true,
      tags: ["a", "b"],
    });
    expect(result.lean).toEqual([{ name: "Ann" }]);
    expect(result.populated).toBe("emea");
    expect(result.afterUpdate).toBe(1);
    expect(result.rows).toEqual([
      { _id: "open", total: 7 },
      { _id: "paid", total: 15 },
    ]);
    expect(result.plan).toEqual([{ $match: { status: "paid" } }]);
    expect(result.country).toBe("France");
    expect(result.tenant).toBe("acme");
    expect(result.tenantVisible).toBe(0);
    expect(result.shapes).toEqual(["circle"]);
    expect(result.factory).toBe("F1");
    expect(result.errors).toEqual({ validation: "ValidationError", cast: "CastError", strict: "StrictModeError" });
    expect(result.transaction).toBe(1);
    expect(result.integrations).toBe(2);
  }, 120_000);

  test("NestJS: the built @venloc/typemo-nestjs in a Nest 12 application on Express", () => {
    const result = smoke("out/legacy/nest-smoke.js", `dist_consumer_nest_${Date.now()}`);
    expect(result).toEqual({
      created: [201, "ann"],
      read: 5,
      badId: 400,
      invalid: { balance: "must be at least 0" },
      duplicate: ["owner"],
      transaction: 3,
    });
  }, 120_000);

  test("TC39 decorators: create with the pre-save hook, populate, unique index", () => {
    const result = smoke("out/tc39/smoke.js", `dist_consumer_tc39_${Date.now()}`);
    expect(result.created).toEqual({ name: "Ann", city: "Paris", tags: ["a", "saved"] });
    expect(result.afterSave).toEqual(["a", "saved"]);
    expect(result.populated).toBe("core");
    expect(result.duplicate).toBe("DuplicateKeyError");
    expect(result.code).toBe("first");
  }, 120_000);
});
