import { type ProbeCheckOptions, type ProbeSource, TypeProbe } from "../hover/type-probe.ts";
import { RuntimeShape } from "./runtime-shape.ts";
import { type Shape, ShapeFormat } from "./shape.ts";
import { TypeShape } from "./type-shape.ts";

/**
 * One disagreement between a type and a value.
 *
 * @example
 * ```ts
 * const mismatch: ShapeMismatch = result.mismatches[0]!;
 * ```
 */
export interface ShapeMismatch {
  /** `$` is the value itself; `$.a.b`, `$.tags[]` (any element), `$.meta[*]` (index signature). */
  readonly path: string;
  /** What kind of disagreement it is. */
  readonly problem: "missing-key" | "unknown-key" | "kind" | "any";
  /** What the type allows at this path (printed shape). */
  readonly expected: string;
  /** What the data has at this path (printed shape, or `(missing)`). */
  readonly actual: string;
  /** Human-readable description. */
  readonly message: string;
}

/**
 * Options of a shape comparison.
 *
 * @example
 * ```ts
 * const options: ShapeCompareOptions = { requireOptional: true };
 * ```
 */
export interface ShapeCompareOptions {
  /** Accept `any` in the type instead of reporting it (default `false`: an `any` proves nothing). */
  readonly allowAny?: boolean;
  /**
   * Every OPTIONAL key of the type must be in the data too (default `false`: an optional key may be absent). For a
   * fixture that fills every field: then a key the type promises but the form never returns (a field the runtime
   * leaves out, e.g. a `Hidden` one) is caught, which the default check cannot see.
   */
  readonly requireOptional?: boolean;
}

/**
 * Which type to check. The snippet is compiled by the probe; the type is taken from
 * - `type`: a type expression (`"User"`, `"WithId<User>"`),
 * - `expr`: an expression evaluated after the snippet (`"await users.findOne({})"` or `"doc"`),
 * - neither: the `// ^?` marker in the snippet (`marker` picks one of several).
 * A promise type is awaited.
 *
 * @example
 * ```ts
 * const target: ShapeTarget = { code: "interface User { name: string }", type: "User" };
 * ```
 */
export interface ShapeTarget extends ProbeCheckOptions {
  /** The snippet the probe compiles. */
  readonly code: string;
  /** A type expression to check. */
  readonly type?: string;
  /** An expression to check, evaluated after the snippet. */
  readonly expr?: string;
  /** Which `// ^?` marker to check when neither `type` nor `expr` is given. */
  readonly marker?: number;
  /** Probe to use (default: the shared one). */
  readonly probe?: TypeProbe;
}

/**
 * The outcome of `ShapeCompare.check`.
 *
 * @example
 * ```ts
 * const result: ShapeCheckResult = ShapeCompare.check(target, doc);
 * if (!result.ok) console.log(result.report);
 * ```
 */
export interface ShapeCheckResult {
  /** `true` when there are no mismatches. */
  readonly ok: boolean;
  /** Every disagreement found. */
  readonly mismatches: readonly ShapeMismatch[];
  /** The shape of the type. */
  readonly typeShape: Shape;
  /** The shape of the value. */
  readonly runtimeShape: Shape;
  /** Human-readable report (empty when `ok`). */
  readonly report: string;
}

/**
 * Type-versus-runtime comparison. Both directions are checked:
 * everything the data has must be allowed by the type (no unknown keys, no wrong kinds), and every
 * required key of the type must be present in the data. "Present" is strict: `null` is a value,
 * an own `undefined` is a value, a missing key is neither.
 */
export class ShapeCompare {
  /**
   * Compares the shape of a type with the shape of a value.
   *
   * @param expected - The type side.
   * @param actual - The data side.
   * @param options - Comparison options.
   * @param path - Path of this position, `$` for the root.
   * @returns Every disagreement; empty when the shapes agree.
   */
  static compare(expected: Shape, actual: Shape, options: ShapeCompareOptions = {}, path = "$"): ShapeMismatch[] {
    const mismatch = (problem: ShapeMismatch["problem"], message: string): ShapeMismatch[] => [
      { path, problem, expected: ShapeFormat.print(expected), actual: ShapeFormat.print(actual), message },
    ];
    if (expected.kind === "unknown" || actual.kind === "never") return [];
    if (expected.kind === "any") {
      return options.allowAny ? [] : mismatch("any", `${path}: the type is any, nothing is checked here`);
    }
    if (actual.kind === "union") {
      return actual.members.flatMap((member) => ShapeCompare.compare(expected, member, options, path));
    }
    if (expected.kind === "union") return ShapeCompare.compareUnion(expected.members, actual, options, path);

    const kindMismatch = (): ShapeMismatch[] =>
      mismatch(
        "kind",
        `${path}: the type says ${ShapeFormat.print(expected)}, the data is ${ShapeCompare.summary(actual)}`,
      );
    switch (expected.kind) {
      case "never":
        return kindMismatch();
      case "scalar":
        return actual.kind === "scalar" && actual.name === expected.name ? [] : kindMismatch();
      case "bson":
        return actual.kind === "bson" && actual.name === expected.name ? [] : kindMismatch();
      case "instance":
        return actual.kind === "instance" && ShapeCompare.sameInstance(expected.name, actual.name)
          ? []
          : kindMismatch();
      case "array":
        return actual.kind === "array"
          ? ShapeCompare.compare(expected.element, actual.element, options, `${path}[]`)
          : kindMismatch();
      case "object": {
        if (actual.kind !== "object") return kindMismatch();
        const problems: ShapeMismatch[] = [];
        for (const [key, field] of Object.entries(actual.fields)) {
          const declared = expected.fields[key];
          if (declared) {
            problems.push(...ShapeCompare.compare(declared.shape, field.shape, options, `${path}.${key}`));
          } else if (expected.index) {
            problems.push(...ShapeCompare.compare(expected.index, field.shape, options, `${path}.${key}`));
          } else {
            problems.push({
              path: `${path}.${key}`,
              problem: "unknown-key",
              expected: "(no such key)",
              actual: ShapeFormat.print(field.shape),
              message: `${path}.${key}: the data has this key (${ShapeFormat.print(field.shape)}), the type does not know it`,
            });
          }
        }
        for (const [key, field] of Object.entries(expected.fields)) {
          if (key in actual.fields || (field.optional && options.requireOptional !== true)) continue;
          const promise = field.optional ? "has this optional key" : "promises this key";
          problems.push({
            path: `${path}.${key}`,
            problem: "missing-key",
            expected: ShapeFormat.print(field.shape),
            actual: "(missing)",
            message: `${path}.${key}: the type ${promise} (${ShapeFormat.print(field.shape)}), the data lacks it`,
          });
        }
        return problems;
      }
    }
  }

  /**
   * Full check of a probe target against a value.
   *
   * @param target - Which type to check.
   * @param value - The real value.
   * @param options - Comparison options.
   * @returns The mismatches, both shapes and a report.
   */
  static check(target: ShapeTarget, value: unknown, options: ShapeCompareOptions = {}): ShapeCheckResult {
    const source = (target.probe ?? TypeProbe.shared()).check(target.code, target);
    const typeShape = ShapeCompare.typeShapeOf(source, target);
    const runtimeShape = RuntimeShape.of(value);
    const mismatches = ShapeCompare.compare(typeShape, runtimeShape, options);
    return {
      ok: mismatches.length === 0,
      mismatches,
      typeShape,
      runtimeShape,
      report: ShapeCompare.report(mismatches, typeShape, runtimeShape),
    };
  }

  /**
   * The type side of a target, as a shape.
   *
   * @param source - The compiled snippet.
   * @param target - Which type to read.
   * @returns The type's shape.
   */
  static typeShapeOf(source: ProbeSource, target: Pick<ShapeTarget, "type" | "expr" | "marker">): Shape {
    if (target.type !== undefined) return source.queryType(target.type, TypeShape.of);
    if (target.expr !== undefined) return source.queryExpression(target.expr, TypeShape.of);
    return source.queryMarker(target.marker ?? 0, TypeShape.of);
  }

  /**
   * Formats mismatches for a failure message.
   *
   * @param mismatches - The disagreements.
   * @param typeShape - The type's shape.
   * @param runtimeShape - The value's shape.
   * @returns The report; empty when there are no mismatches.
   */
  static report(mismatches: readonly ShapeMismatch[], typeShape: Shape, runtimeShape: Shape): string {
    if (mismatches.length === 0) return "";
    return [
      `shape mismatch (${mismatches.length}):`,
      ...mismatches.map((m) => `  ${m.message}`),
      `type:    ${ShapeFormat.print(typeShape)}`,
      `runtime: ${ShapeFormat.print(runtimeShape)}`,
    ].join("\n");
  }

  /**
   * A runtime `Buffer` is a `Uint8Array`.
   *
   * @param expected - The class name the type names.
   * @param actual - The class name of the value.
   * @returns `true` when they are compatible.
   */
  private static sameInstance(expected: string, actual: string): boolean {
    return expected === actual || (expected === "Uint8Array" && actual === "Buffer");
  }

  /**
   * Short description of a runtime shape for messages: the kind, not the whole structure.
   *
   * @param shape - The shape to describe.
   * @returns The description.
   */
  private static summary(shape: Shape): string {
    if (shape.kind === "object") return "an object";
    if (shape.kind === "array") return "an array";
    return ShapeFormat.print(shape);
  }

  /**
   * Compares a value against a union: it passes when some member accepts it.
   *
   * @param members - The union members of the type.
   * @param actual - The data side.
   * @param options - Comparison options.
   * @param path - Path of this position.
   * @returns The most useful set of problems, or none when a member matches.
   */
  private static compareUnion(
    members: readonly Shape[],
    actual: Shape,
    options: ShapeCompareOptions,
    path: string,
  ): ShapeMismatch[] {
    const attempts = members.map((member) => ({
      member,
      problems: ShapeCompare.compare(member, actual, options, path),
    }));
    if (attempts.some((attempt) => attempt.problems.length === 0)) return [];
    /* Report the member of the same kind (object vs object...): its inner problems are the useful ones. */
    const sameKind = attempts
      .filter((attempt) => (actual.kind === "object" || actual.kind === "array") && attempt.member.kind === actual.kind)
      .sort((a, b) => a.problems.length - b.problems.length)[0];
    if (sameKind) return sameKind.problems;
    const expected = ShapeFormat.union(members);
    return [
      {
        path,
        problem: "kind",
        expected: ShapeFormat.print(expected),
        actual: ShapeFormat.print(actual),
        message: `${path}: the type says ${ShapeFormat.print(expected)}, the data is ${ShapeCompare.summary(actual)}`,
      },
    ];
  }
}

/**
 * Asserts that a value has the shape the type promises (no unknown keys, no missing required keys,
 * no wrong kinds, no `any`).
 *
 * @param target - Which type to check.
 * @param value - The real value.
 * @param options - Comparison options.
 * @returns The check result when it passes.
 * @throws Error - With a readable report when the shape does not match.
 *
 * @example
 * ```ts
 * expectShapeMatches({ code: "interface User { name: string }", type: "User" }, { name: "Ada" });
 * ```
 */
export const expectShapeMatches = (
  target: ShapeTarget,
  value: unknown,
  options?: ShapeCompareOptions,
): ShapeCheckResult => {
  const result = ShapeCompare.check(target, value, options);
  if (!result.ok) throw new Error(result.report);
  return result;
};
