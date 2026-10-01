import { expect } from "bun:test";
import type { TypeDiagnostic } from "../types/type-check-runner.ts";
import { HoverText } from "./hover-text.ts";
import { type ProbeCheckOptions, type ProbeSource, TypeProbe } from "./type-probe.ts";

/**
 * Options of `expectHover`.
 *
 * @example
 * ```ts
 * const options: HoverExpectOptions = { marker: 1, sortUnion: true };
 * ```
 */
export interface HoverExpectOptions extends ProbeCheckOptions {
  /** Which `// ^?` marker (0-based); required when the snippet has several. */
  readonly marker?: number;
  /** Sort the members of the top-level union before comparing (off by default: order is what the IDE shows). */
  readonly sortUnion?: boolean;
  /** Probe to use (default: {@link TypeProbe.shared}). */
  readonly probe?: TypeProbe;
}

/**
 * Options of `expectTypeError` and `expectNoTypeErrors`.
 *
 * @example
 * ```ts
 * const options: TypeErrorExpectOptions = { dir: import.meta.dir };
 * ```
 */
export type TypeErrorExpectOptions = Omit<HoverExpectOptions, "marker" | "sortUnion">;

/** Assertions on the IDE hover at a `// ^?` marker. */
export class HoverExpectation {
  /** The snippet under test. */
  readonly source: ProbeSource;

  /**
   * @param code - The snippet, with at least one `// ^?` marker.
   * @param options - Marker choice, union sorting and probe selection.
   */
  constructor(
    code: string,
    private readonly options: HoverExpectOptions = {},
  ) {
    this.source = (options.probe ?? TypeProbe.shared()).check(code, options);
  }

  /** The normalized hover text the assertions compare. */
  get actual(): string {
    const text = this.source.hover(this.options.marker);
    return this.options.sortUnion ? HoverText.sortTopLevelUnion(text) : text;
  }

  /**
   * Exact comparison after whitespace normalization of both sides.
   *
   * @param expected - The expected hover text.
   */
  toBe(expected: string): void {
    const normalized = HoverText.normalize(expected);
    expect(this.actual).toBe(this.options.sortUnion ? HoverText.sortTopLevelUnion(normalized) : normalized);
  }

  /**
   * The hover contains a fragment (whitespace-normalized).
   *
   * @param fragment - The text that must appear.
   */
  toContain(fragment: string): void {
    expect(this.actual).toContain(HoverText.normalize(fragment));
  }

  /**
   * The hover matches a pattern.
   *
   * @param pattern - The pattern the hover text must match.
   */
  toMatch(pattern: RegExp): void {
    expect(this.actual).toMatch(pattern);
  }

  /**
   * Compares with bun's snapshot file (`__snapshots__/<test file>.snap`, updated with
   * `bun test --update-snapshots`). For large types that are unreadable inline.
   *
   * @param hint - Optional snapshot name suffix.
   */
  toMatchSnapshot(hint?: string): void {
    if (hint === undefined) expect(this.actual).toMatchSnapshot();
    else expect(this.actual).toMatchSnapshot(hint);
  }
}

/** Assertions on the compiler errors of a snippet: is the error there, and is it readable? */
export class TypeErrorExpectation {
  /** The snippet under test. */
  readonly source: ProbeSource;

  /**
   * @param code - The snippet expected to fail.
   * @param options - Probe selection and directory.
   */
  constructor(code: string, options: TypeErrorExpectOptions = {}) {
    this.source = (options.probe ?? TypeProbe.shared()).check(code, options);
  }

  /** Every diagnostic of the snippet. */
  get diagnostics(): TypeDiagnostic[] {
    return this.source.diagnostics();
  }

  /**
   * Some diagnostic's (flattened, untruncated) message contains `fragment`.
   *
   * @param fragment - The text that must appear.
   * @throws Error - When no diagnostic contains it.
   */
  toContain(fragment: string): void {
    this.expectSome((d) => d.message.includes(fragment), `an error containing ${JSON.stringify(fragment)}`);
  }

  /**
   * Some diagnostic's message matches a pattern.
   *
   * @param pattern - The pattern to match.
   * @throws Error - When no diagnostic matches.
   */
  toMatch(pattern: RegExp): void {
    this.expectSome((d) => pattern.test(d.message), `an error matching ${pattern}`);
  }

  /**
   * Some diagnostic has this code (`2322` for "not assignable").
   *
   * @param code - The TypeScript error number.
   * @throws Error - When no diagnostic has it.
   */
  toHaveCode(code: number): void {
    this.expectSome((d) => d.code === code, `an error TS${code}`);
  }

  /**
   * Passes when some diagnostic satisfies the predicate.
   *
   * @param predicate - The condition on one diagnostic.
   * @param wanted - Describes the condition in the failure message.
   * @throws Error - When no diagnostic satisfies it.
   */
  private expectSome(predicate: (d: TypeDiagnostic) => boolean, wanted: string): void {
    const diagnostics = this.diagnostics;
    if (diagnostics.some(predicate)) return;
    const got = diagnostics.length === 0 ? "the snippet compiles without errors" : this.source.diagnosticText();
    throw new Error(`expected ${wanted}, got:\n${got}`);
  }
}

/**
 * The hover at the snippet's `// ^?` marker.
 *
 * @param code - The snippet with a marker.
 * @param options - Marker choice, union sorting and probe selection.
 * @returns The assertions.
 *
 * @example
 * ```ts
 * expectHover("const x = 1;\n// ^?").toBe("const x: 1");
 * ```
 */
export const expectHover = (code: string, options?: HoverExpectOptions): HoverExpectation =>
  new HoverExpectation(code, options);

/**
 * The snippet must fail to compile.
 *
 * @param code - The snippet expected to fail.
 * @param options - Probe selection and directory.
 * @returns The assertions.
 *
 * @example
 * ```ts
 * expectTypeError(code).toContain('Unknown field "nmae"');
 * ```
 */
export const expectTypeError = (code: string, options?: TypeErrorExpectOptions): TypeErrorExpectation =>
  new TypeErrorExpectation(code, options);

/**
 * The snippet must compile cleanly.
 *
 * @param code - The snippet.
 * @param options - Probe selection and directory.
 * @throws Error - With every diagnostic when the snippet does not compile.
 *
 * @example
 * ```ts
 * expectNoTypeErrors("const x: number = 1;");
 * ```
 */
export const expectNoTypeErrors = (code: string, options: TypeErrorExpectOptions = {}): void => {
  const source = (options.probe ?? TypeProbe.shared()).check(code, options);
  const text = source.diagnosticText();
  if (text !== "") throw new Error(`expected the snippet to compile, got:\n${text}`);
};
