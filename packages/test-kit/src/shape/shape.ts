/**
 * Kinds of plain JavaScript values a shape distinguishes.
 *
 * @example
 * ```ts
 * const kind: ScalarKind = "date";
 * ```
 */
export type ScalarKind =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "null"
  | "undefined"
  | "date"
  | "regexp"
  | "function";

/**
 * The common vocabulary of the shape harness: both a compiler type
 * ({@link TypeShape}) and a real value ({@link RuntimeShape}) are reduced to it, then compared.
 *
 * - `unknown` accepts every value (the type is `unknown`, or recursion was cut);
 * - `any` exists only on the type side and is reported as a mismatch by default (an `any`
 *   result type proves nothing);
 * - `bson` is a BSON value class, by its `_bsontype` (`ObjectId`, `Decimal128`, `Long`, `Binary`...);
 * - `instance` is another built-in class instance kept by name (`Map`, `Set`, `Uint8Array`);
 * - `object` fields carry `optional`: a type's `?`, or on the runtime side always `false` (a
 *   missing key is simply absent from `fields`, which is how "null vs missing" is told apart);
 * - `array` of a runtime array has the union of its element shapes (`never` for `[]`).
 *
 * @example
 * ```ts
 * const shape: Shape = { kind: "array", element: ShapeFormat.scalar("string") };
 * ```
 */
export type Shape =
  | { readonly kind: "unknown" }
  | { readonly kind: "any" }
  | { readonly kind: "never" }
  | { readonly kind: "scalar"; readonly name: ScalarKind }
  | { readonly kind: "bson"; readonly name: string }
  | { readonly kind: "instance"; readonly name: string }
  | { readonly kind: "array"; readonly element: Shape }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, FieldShape>>; readonly index?: Shape }
  | { readonly kind: "union"; readonly members: readonly Shape[] };

/**
 * One field of an `object` shape.
 *
 * @example
 * ```ts
 * const field: FieldShape = { shape: ShapeFormat.scalar("number"), optional: true };
 * ```
 */
export interface FieldShape {
  /** The shape of the field's value. */
  readonly shape: Shape;
  /** `true` when the key may be absent. */
  readonly optional: boolean;
}

/** Constructors and printing for {@link Shape}. */
export class ShapeFormat {
  /** Accepts every value. */
  static readonly unknown: Shape = { kind: "unknown" };
  /** The type side's `any`. */
  static readonly any: Shape = { kind: "any" };
  /** No value. */
  static readonly never: Shape = { kind: "never" };

  /**
   * A scalar shape.
   *
   * @param name - The scalar kind.
   * @returns The shape.
   */
  static scalar(name: ScalarKind): Shape {
    return { kind: "scalar", name };
  }

  /**
   * A normalized union: nested unions are flattened, duplicates (by printed form) and `never`
   * removed, `unknown` absorbs everything, one member is returned as itself, none is `never`.
   * Members are sorted by printed form with `null`/`undefined` last (`number | string | null`), so
   * the text does not depend on the checker's internal union order.
   *
   * @param members - The members to combine.
   * @returns The normalized shape.
   */
  static union(members: readonly Shape[]): Shape {
    const flat = members.flatMap((member) => (member.kind === "union" ? member.members : [member]));
    if (flat.some((member) => member.kind === "unknown")) return ShapeFormat.unknown;
    const unique = new Map<string, Shape>();
    for (const member of flat) {
      if (member.kind !== "never") unique.set(ShapeFormat.print(member), member);
    }
    const nullish = (shape: Shape): number =>
      shape.kind === "scalar" && (shape.name === "null" || shape.name === "undefined") ? 1 : 0;
    const list = [...unique.entries()]
      .sort(([textA, a], [textB, b]) => nullish(a) - nullish(b) || textA.localeCompare(textB))
      .map(([, shape]) => shape);
    if (list.length === 0) return ShapeFormat.never;
    if (list.length === 1) return list[0] ?? ShapeFormat.never;
    return { kind: "union", members: list };
  }

  /**
   * TS-like one-line text: `{ _id: ObjectId; age?: number | null; tags: string[] }`. Keys are sorted.
   *
   * @param shape - The shape to print.
   * @returns The text.
   */
  static print(shape: Shape): string {
    switch (shape.kind) {
      case "unknown":
      case "any":
      case "never":
        return shape.kind;
      case "scalar":
      case "bson":
      case "instance":
        return shape.name;
      case "array": {
        const element = ShapeFormat.print(shape.element);
        return shape.element.kind === "union" ? `(${element})[]` : `${element}[]`;
      }
      case "union":
        return shape.members.map(ShapeFormat.print).join(" | ");
      case "object": {
        const fields = Object.keys(shape.fields)
          .sort()
          .map((key) => {
            const field = shape.fields[key];
            return field ? `${key}${field.optional ? "?" : ""}: ${ShapeFormat.print(field.shape)}` : key;
          });
        if (shape.index) fields.push(`[key: string]: ${ShapeFormat.print(shape.index)}`);
        return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`;
      }
    }
  }
}
