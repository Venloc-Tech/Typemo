import ts from "typescript";
import type { ProbeTypeQuery } from "../hover/type-probe.ts";
import { type FieldShape, type Shape, ShapeFormat } from "./shape.ts";

/**
 * Builds a {@link Shape} from a compiler type, usually one obtained through the
 * `TypeProbe`.
 *
 * Rules:
 * - literal types widen to their scalar kind (`"a"` → `string`; values are not compared);
 * - classes are recognised by symbol name: BSON classes (`ObjectId`, `Decimal128`, ... ; `UUID`
 *   maps to `Binary`, which is what the driver deserialises it to), `Date`, `RegExp`, `Map`/`Set`,
 *   binary views;
 * - methods (declared as methods) and getter-only accessors are not data: methods are skipped, a
 *   getter-only property is optional (it is never stored);
 * - an optional property does not accept an explicit `undefined` value unless its declared type
 *   says so (`exactOptionalPropertyTypes` semantics: the checker's internal "missing" type is dropped);
 * - a promise type is awaited (a query result is compared after `await`);
 * - recursion is cut by identity (the cut point accepts anything) and at depth 16.
 */
export class TypeShape {
  /** Depth at which the traversal stops and accepts anything. */
  private static readonly maxDepth = 16;

  /** Built-in and BSON classes by symbol name. */
  private static readonly namedKinds: Readonly<Record<string, Shape>> = {
    ObjectId: { kind: "bson", name: "ObjectId" },
    ObjectID: { kind: "bson", name: "ObjectId" },
    Decimal128: { kind: "bson", name: "Decimal128" },
    Long: { kind: "bson", name: "Long" },
    Double: { kind: "bson", name: "Double" },
    Int32: { kind: "bson", name: "Int32" },
    Timestamp: { kind: "bson", name: "Timestamp" },
    Binary: { kind: "bson", name: "Binary" },
    UUID: { kind: "bson", name: "Binary" },
    Code: { kind: "bson", name: "Code" },
    BSONRegExp: { kind: "bson", name: "BSONRegExp" },
    BSONSymbol: { kind: "bson", name: "BSONSymbol" },
    MinKey: { kind: "bson", name: "MinKey" },
    MaxKey: { kind: "bson", name: "MaxKey" },
    DBRef: { kind: "bson", name: "DBRef" },
    Date: ShapeFormat.scalar("date"),
    RegExp: ShapeFormat.scalar("regexp"),
    Map: { kind: "instance", name: "Map" },
    ReadonlyMap: { kind: "instance", name: "Map" },
    Set: { kind: "instance", name: "Set" },
    ReadonlySet: { kind: "instance", name: "Set" },
    Uint8Array: { kind: "instance", name: "Uint8Array" },
    Buffer: { kind: "instance", name: "Buffer" },
    ArrayBuffer: { kind: "instance", name: "ArrayBuffer" },
  };

  /**
   * The shape of a probe query's type (awaited first).
   *
   * @param query - The type, its node and its checker.
   * @returns The shape.
   */
  static of(query: ProbeTypeQuery): Shape {
    const { checker, type, node } = query;
    return new TypeShapeBuilder(checker, node).describe(checker.getAwaitedType(type) ?? type, 0, new Set());
  }

  /**
   * Shape for a class/alias symbol name, if it is one of the recognised built-in or BSON classes.
   *
   * @param name - The symbol name.
   * @returns The shape, or `undefined` for an unrecognised name.
   */
  static named(name: string): Shape | undefined {
    return TypeShape.namedKinds[name];
  }

  /** The depth at which the traversal is cut. */
  static get depthLimit(): number {
    return TypeShape.maxDepth;
  }
}

/** One traversal; holds the checker and the location the property types are read at. */
class TypeShapeBuilder {
  /** The checker's real `undefined` type (differs from its "missing" type under `exactOptionalPropertyTypes`). */
  private readonly undefinedType: ts.Type;

  /**
   * @param checker - The checker that owns the types.
   * @param node - The location property types are read at.
   */
  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly node: ts.Node,
  ) {
    this.undefinedType = checker.getUndefinedType();
  }

  /**
   * Describes a type.
   *
   * @param type - The type to describe.
   * @param depth - Current nesting depth.
   * @param seen - Types on the current path, used to cut recursion.
   * @returns The shape.
   */
  describe(type: ts.Type, depth: number, seen: ReadonlySet<ts.Type>): Shape {
    const flags = type.flags;
    if (flags & ts.TypeFlags.Any) return ShapeFormat.any;
    if (flags & ts.TypeFlags.Unknown) return ShapeFormat.unknown;
    if (flags & ts.TypeFlags.Never) return ShapeFormat.never;
    if (flags & ts.TypeFlags.StringLike) return ShapeFormat.scalar("string");
    if (flags & ts.TypeFlags.NumberLike) return ShapeFormat.scalar("number");
    if (flags & ts.TypeFlags.BooleanLike) return ShapeFormat.scalar("boolean");
    if (flags & ts.TypeFlags.BigIntLike) return ShapeFormat.scalar("bigint");
    if (flags & ts.TypeFlags.ESSymbolLike) return ShapeFormat.scalar("symbol");
    if (flags & ts.TypeFlags.Null) return ShapeFormat.scalar("null");
    if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return ShapeFormat.scalar("undefined");
    if (flags & ts.TypeFlags.NonPrimitive) return { kind: "object", fields: {}, index: ShapeFormat.unknown };

    if (type.isUnion()) return ShapeFormat.union(type.types.map((member) => this.describe(member, depth, seen)));

    const named = this.namedShape(type);
    if (named) return named;

    if (type.isIntersection()) {
      /* A branded primitive (`string & { __brand: "Email" }`) is still that primitive at runtime. */
      const primitive = type.types.find((member) => !(member.flags & ts.TypeFlags.Object));
      if (primitive) return this.describe(primitive, depth, seen);
    }

    if (seen.has(type) || depth >= TypeShape.depthLimit) return ShapeFormat.unknown;
    const next = new Set(seen).add(type);

    if (this.checker.isArrayType(type) || this.checker.isTupleType(type)) {
      const args = this.checker.getTypeArguments(type as ts.TypeReference);
      return { kind: "array", element: ShapeFormat.union(args.map((arg) => this.describe(arg, depth + 1, next))) };
    }
    /* An interface extending `Array` is not an "array type" for the checker, but it is one at runtime. */
    if (type.getProperty("length") && type.getProperty("push")) {
      const element = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      if (element) return { kind: "array", element: this.describe(element, depth + 1, next) };
    }

    const properties = this.checker.getPropertiesOfType(type);
    if (type.getCallSignatures().length > 0 && properties.length === 0) return ShapeFormat.scalar("function");

    const fields: Record<string, FieldShape> = {};
    for (const property of properties) {
      if (property.name.startsWith("__@") || property.name.startsWith("#")) continue;
      const declarations = property.declarations ?? [];
      if (declarations.length > 0 && declarations.every((d) => ts.isMethodDeclaration(d) || ts.isMethodSignature(d))) {
        continue;
      }
      const getterOnly =
        declarations.some(ts.isGetAccessorDeclaration) && !declarations.some(ts.isSetAccessorDeclaration);
      const optional = (property.flags & ts.SymbolFlags.Optional) !== 0;
      const propertyType = this.checker.getTypeOfSymbolAtLocation(property, this.node);
      const shape = optional
        ? this.describeOptional(propertyType, depth + 1, next)
        : this.describe(propertyType, depth + 1, next);
      fields[property.name] = { shape, optional: optional || getterOnly };
    }
    /* A numeric index signature (`Record<number, T>`, e.g. ids by input index) describes the same runtime
       keys as a string one: object keys are strings at run time (`BulkWriteResult.insertedIds`). */
    const index =
      this.checker.getIndexInfoOfType(type, ts.IndexKind.String) ??
      this.checker.getIndexInfoOfType(type, ts.IndexKind.Number);
    return index
      ? { kind: "object", fields, index: this.describe(index.type, depth + 1, next) }
      : { kind: "object", fields };
  }

  /**
   * The checker adds a "missing" member to the type of an optional property. Under
   * `exactOptionalPropertyTypes` it is a different object from the real `undefined` type, so it
   * can be dropped while an explicit `?: T | undefined` keeps its `undefined`. Without the flag
   * they are the same object and `undefined` stays (matching what the compiler then allows).
   *
   * @param type - The declared type of an optional property.
   * @param depth - Current nesting depth.
   * @param seen - Types on the current path.
   * @returns The shape without the "missing" member.
   */
  private describeOptional(type: ts.Type, depth: number, seen: ReadonlySet<ts.Type>): Shape {
    if (!type.isUnion()) return this.describe(type, depth, seen);
    const kept = type.types.filter(
      (member) => !(member.flags & ts.TypeFlags.Undefined) || member === this.undefinedType,
    );
    return ShapeFormat.union(kept.map((member) => this.describe(member, depth, seen)));
  }

  /**
   * The shape of a recognised built-in or BSON class, by its symbol or alias name.
   *
   * @param type - The type to look up.
   * @returns The shape, or `undefined` when the type is not a recognised class.
   */
  private namedShape(type: ts.Type): Shape | undefined {
    const candidates = type.isIntersection() ? type.types : [type];
    for (const candidate of candidates) {
      for (const symbol of [candidate.aliasSymbol, candidate.symbol]) {
        const shape = symbol ? TypeShape.named(symbol.name) : undefined;
        if (shape) return shape;
      }
      /* An interface extending a recognised one (`TypedMap<V> extends ReadonlyMap<string, V>`) is that one. */
      const inherited = this.inheritedShape(candidate, 0);
      if (inherited) return inherited;
    }
    return undefined;
  }

  /**
   * Walks the base types of an interface or class looking for a recognised class.
   *
   * @param type - The type whose bases are searched.
   * @param depth - Current inheritance depth; the search stops after four levels.
   * @returns The shape, or `undefined` when no base is recognised.
   */
  private inheritedShape(type: ts.Type, depth: number): Shape | undefined {
    if (depth > 4 || !(type.flags & ts.TypeFlags.Object)) return undefined;
    const target = (type as ts.TypeReference).target ?? type;
    if (!((target as ts.ObjectType).objectFlags & (ts.ObjectFlags.Interface | ts.ObjectFlags.Class))) return undefined;
    for (const base of this.checker.getBaseTypes(target as ts.InterfaceType)) {
      const shape = base.symbol ? TypeShape.named(base.symbol.name) : undefined;
      if (shape) return shape;
      const deeper = this.inheritedShape(base, depth + 1);
      if (deeper) return deeper;
    }
    return undefined;
  }
}
