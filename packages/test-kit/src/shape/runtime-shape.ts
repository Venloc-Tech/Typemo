import { type FieldShape, type Shape, ShapeFormat } from "./shape.ts";

/**
 * Builds a {@link Shape} from a real value, e.g. a document returned by the driver.
 *
 * - BSON classes are recognised by `_bsontype` (`ObjectID` is normalised to `ObjectId`), so it
 *   works with any copy of the `bson` package and without importing it;
 * - an own key whose value is `undefined` is kept (`undefined`), a missing key is absent: this
 *   is what separates "null vs undefined vs missing" when compared with a type;
 * - arrays get the union of their element shapes; an empty array has element `never`
 *   (compatible with any element type);
 * - plain objects and instances of user classes are described by their own enumerable keys;
 *   `Map`, `Set` and binary views are kept as named instances.
 */
export class RuntimeShape {
  /** Built-in classes described by name rather than by their (irrelevant) own keys. */
  private static readonly instanceClasses: readonly (abstract new (...args: never[]) => object)[] = [
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    ArrayBuffer,
    DataView,
  ];

  /**
   * The shape of a value.
   *
   * @param value - Any value, usually a document.
   * @returns Its shape.
   */
  static of(value: unknown): Shape {
    return RuntimeShape.describe(value, new Set());
  }

  /**
   * Recursive worker of `of`.
   *
   * @param value - The value to describe.
   * @param seen - Objects on the current path; a cycle is described as `unknown`.
   * @returns The shape.
   */
  private static describe(value: unknown, seen: Set<object>): Shape {
    if (value === null) return ShapeFormat.scalar("null");
    const kind = typeof value;
    switch (kind) {
      case "undefined":
        return ShapeFormat.scalar("undefined");
      case "string":
      case "number":
      case "boolean":
      case "bigint":
      case "symbol":
      case "function":
        return ShapeFormat.scalar(kind);
    }
    const object = value as object;
    if (seen.has(object)) return ShapeFormat.unknown;
    if (value instanceof Date) return ShapeFormat.scalar("date");
    if (value instanceof RegExp) return ShapeFormat.scalar("regexp");
    const bsonType = (value as { _bsontype?: unknown })._bsontype;
    if (typeof bsonType === "string") return { kind: "bson", name: bsonType === "ObjectID" ? "ObjectId" : bsonType };
    /* A subclass of Map / Set (a tracked or read-only Map of Typemo) is a Map / Set for the comparison. */
    if (value instanceof Map) return { kind: "instance", name: "Map" };
    if (value instanceof Set) return { kind: "instance", name: "Set" };
    if (ArrayBuffer.isView(value) || RuntimeShape.instanceClasses.some((cls) => value instanceof cls)) {
      return { kind: "instance", name: object.constructor?.name ?? "Object" };
    }
    const next = new Set(seen).add(object);
    if (Array.isArray(value)) {
      return { kind: "array", element: ShapeFormat.union(value.map((item) => RuntimeShape.describe(item, next))) };
    }
    const fields: Record<string, FieldShape> = {};
    for (const [key, item] of Object.entries(object)) {
      fields[key] = { shape: RuntimeShape.describe(item, next), optional: false };
    }
    return { kind: "object", fields };
  }
}
