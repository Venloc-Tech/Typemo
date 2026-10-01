/*
 * The heaviest places for the type checker: runs `tsc --generateTrace` on a project and
 * reads the trace itself (no npm analyzer is downloaded): the `check*` events of the checker ranked by
 * their EXCLUSIVE time (the event minus the checker events nested in it: the work of that node itself — type
 * instantiation and relation checks have no events of their own), with their file:line and the source text.
 * Also the types with the most instantiations recorded in `types.json` are summed by their declaring file.
 *
 * Usage: `bun scripts/trace-hotspots.ts <tsconfig> [top=10]` (prints markdown; the trace goes to a temp dir).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

/** The repository root. */
const ROOT = resolve(import.meta.dir, "..");

/**
 * One event of the `tsc` trace.
 *
 * @example
 * ```ts
 * const event: TraceEvent = { name: "checkExpression", ph: "X", ts: 0, dur: 10 };
 * ```
 */
interface TraceEvent {
  /** The event name. */
  readonly name: string;
  /** The phase; `X` is a complete event. */
  readonly ph: string;
  /** Start time, microseconds. */
  readonly ts: number;
  /** Duration, microseconds. */
  readonly dur?: number;
  /** The source location of a checker event. */
  readonly args?: { readonly path?: string; readonly pos?: number; readonly end?: number; readonly kind?: number };
}

/**
 * A heavy place in the source.
 *
 * @example
 * ```ts
 * const spot: Hotspot = { name: "check", ms: 12, where: "a.ts:3", text: "x", start: 0, finish: 1, path: "a.ts" };
 * ```
 */
interface Hotspot {
  /** The checker event name. */
  readonly name: string;
  /** Exclusive time, milliseconds. */
  readonly ms: number;
  /** `file:line`. */
  readonly where: string;
  /** The first line of the node's source. */
  readonly text: string;
  /** Event start, microseconds. */
  readonly start: number;
  /** Event end, microseconds. */
  readonly finish: number;
  /** Absolute source path. */
  readonly path: string;
}

/** Ranks the checker's heaviest places. */
class TraceHotspots {
  /**
   * The line and text of a source position.
   *
   * @param path - The source file.
   * @param pos - The character offset.
   * @returns The 1-based line and the first non-blank text; line `0` when the file cannot be read.
   */
  static lineOf(path: string, pos: number): { line: number; text: string } {
    try {
      const source = readFileSync(path, "utf8");
      const before = source.slice(0, pos);
      const line = before.split("\n").length;
      /* `pos` includes the leading trivia: show the first non-blank line of the node. */
      const rest = source.slice(pos).replace(/^\s*(\/\/[^\n]*\n\s*)*/, "");
      const skipped = source.slice(pos).length - rest.length;
      const realLine = source.slice(0, pos + skipped).split("\n").length;
      return { line: Math.max(line, realLine), text: (rest.split("\n")[0] ?? "").trim().slice(0, 90) };
    } catch {
      return { line: 0, text: "" };
    }
  }

  /**
   * A trace path (lower-cased by tsc on this file system) relative to the repository.
   *
   * @param path - The path from the trace.
   * @returns The repo-relative path.
   */
  static short(path: string): string {
    const lower = path.toLowerCase();
    const root = ROOT.toLowerCase();
    return lower.startsWith(root) ? path.slice(root.length + 1) : relative(ROOT, path);
  }

  /**
   * Traces a project and prints the ranking.
   *
   * @param config - The tsconfig.
   * @param top - How many rows per table.
   * @throws Error - When `tsc` writes no trace.
   */
  static run(config: string, top: number): void {
    const dir = mkdtempSync(join(tmpdir(), "typemo-trace-"));
    try {
      const proc = Bun.spawnSync(["bunx", "tsc", "-p", config, "--generateTrace", dir, "--extendedDiagnostics"], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const diagnostics = proc.stdout.toString();
      const check = /^Check time:\s+([\d.]+)s/m.exec(diagnostics)?.[1];
      const instantiations = /^Instantiations:\s+(\d+)/m.exec(diagnostics)?.[1];
      const traceFile = readdirSync(dir).find((name) => name.startsWith("trace"));
      if (traceFile === undefined) throw new Error(`no trace in ${dir}:\n${diagnostics}${proc.stderr.toString()}`);
      const events = JSON.parse(readFileSync(join(dir, traceFile), "utf8")) as TraceEvent[];
      const candidates = events
        .filter(
          (event) =>
            event.ph === "X" &&
            event.dur !== undefined &&
            event.name.startsWith("check") &&
            event.name !== "checkSourceFile" &&
            event.args?.path !== undefined &&
            event.args.pos !== undefined,
        )
        .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0));
      /* Exclusive time: every complete event minus its direct children (events nest on one thread). */
      const complete = events
        .filter((event) => event.ph === "X" && event.dur !== undefined)
        .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
      const exclusive = new Map<TraceEvent, number>();
      const stack: TraceEvent[] = [];
      for (const event of complete) {
        while (stack.length > 0) {
          const top = stack.at(-1) as TraceEvent;
          if (event.ts >= top.ts + (top.dur ?? 0)) stack.pop();
          else break;
        }
        const parent = stack.at(-1);
        if (parent !== undefined) exclusive.set(parent, (exclusive.get(parent) ?? parent.dur ?? 0) - (event.dur ?? 0));
        exclusive.set(event, exclusive.get(event) ?? event.dur ?? 0);
        stack.push(event);
      }
      const ranked = candidates.sort((a, b) => (exclusive.get(b) ?? 0) - (exclusive.get(a) ?? 0));
      const chosen: Hotspot[] = [];
      for (const event of ranked) {
        if (chosen.length >= top) break;
        const path = event.args?.path as string;
        const { line, text } = TraceHotspots.lineOf(path, event.args?.pos ?? 0);
        chosen.push({
          name: event.name,
          ms: Math.round((exclusive.get(event) ?? 0) / 100) / 10,
          where: `${TraceHotspots.short(path)}:${line}`,
          text,
          start: event.ts,
          finish: event.ts + (event.dur ?? 0),
          path,
        });
      }
      console.log(
        `Project \`${relative(ROOT, config)}\`: check ${check ?? "?"} s, ${instantiations ?? "?"} instantiations.\n`,
      );
      console.log("| # | exclusive ms | checker event | where | source |");
      console.log("|---|---|---|---|---|");
      chosen.forEach((spot, index) => {
        console.log(
          `| ${index + 1} | ${spot.ms} | ${spot.name} | ${spot.where} | \`${spot.text.replace(/\|/g, "\\|").replace(/`/g, "'")}\` |`,
        );
      });
      const typesFile = readdirSync(dir).find((name) => name.startsWith("types"));
      if (typesFile !== undefined) {
        const types = JSON.parse(readFileSync(join(dir, typesFile), "utf8")) as {
          readonly symbolName?: string;
          readonly firstDeclaration?: { readonly path?: string };
          readonly instantiatedType?: number;
        }[];
        const byName = new Map<string, number>();
        for (const type of types) {
          if (type.instantiatedType === undefined || type.symbolName === undefined) continue;
          const file = type.firstDeclaration?.path;
          if (file === undefined || file.includes("node_modules")) continue;
          const key = `${type.symbolName} (${TraceHotspots.short(file)})`;
          byName.set(key, (byName.get(key) ?? 0) + 1);
        }
        console.log("\n| type (declared in) | instantiated types in the trace |");
        console.log("|---|---|");
        for (const [name, count] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, top)) {
          console.log(`| ${name.replace(/\|/g, "\\|")} | ${count.toLocaleString("en-US")} |`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** The tsconfig and row count given on the command line. */
const [config = "tsconfig.test.json", top = "10"] = process.argv.slice(2);
TraceHotspots.run(resolve(ROOT, config), Number(top));
