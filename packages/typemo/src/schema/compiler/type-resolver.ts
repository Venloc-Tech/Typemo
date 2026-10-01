import { BsonGuards } from "../../bson/bson-guards.ts";
import { BigIntCaster } from "../../bson/casters/big-int-caster.ts";
import { BinaryCaster } from "../../bson/casters/binary-caster.ts";
import { BooleanCaster } from "../../bson/casters/boolean-caster.ts";
import { DateCaster } from "../../bson/casters/date-caster.ts";
import { Decimal128Caster } from "../../bson/casters/decimal128-caster.ts";
import { DoubleCaster } from "../../bson/casters/double-caster.ts";
import { Int32Caster } from "../../bson/casters/int32-caster.ts";
import { NumberCaster } from "../../bson/casters/number-caster.ts";
import { ObjectIdCaster } from "../../bson/casters/object-id-caster.ts";
import { RegExpCaster } from "../../bson/casters/reg-exp-caster.ts";
import { StringCaster } from "../../bson/casters/string-caster.ts";
import { TimestampCaster } from "../../bson/casters/timestamp-caster.ts";
import { UnionCaster } from "../../bson/casters/union-caster.ts";
import { UuidCaster } from "../../bson/casters/uuid-caster.ts";
import type { ValueCaster } from "../../bson/casters/value-caster.ts";
import { VectorCaster } from "../../bson/casters/vector-caster.ts";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import { MetadataStore } from "../metadata/metadata-store.ts";
import type { ClassRef } from "../metadata/metadata-types.ts";
import { SPEC_KIND, Spec } from "../options/type-spec.ts";
import type { ScalarType } from "./path-node.ts";

/**
 * A spec after resolution: what kind of node it makes.
 *
 * @example
 * ```ts
 * const resolved: ResolvedSpec = TypeResolver.resolve([String], "User.tags");
 * resolved.kind; // "array"
 * ```
 */
export type ResolvedSpec =
  | { readonly kind: "scalar"; readonly type: ScalarType; readonly caster: ValueCaster<unknown> }
  | { readonly kind: "union"; readonly members: readonly ScalarType[]; readonly caster: ValueCaster<unknown> }
  | { readonly kind: "array"; readonly element: ResolvedSpec }
  | { readonly kind: "map"; readonly value: ResolvedSpec; readonly nullableValues: boolean }
  | { readonly kind: "class"; readonly target: ClassRef; readonly nested: boolean };

/** Built-ins that are newable but are not field types (a readable error instead of "not a @Schema class"). */
const UNSUPPORTED: ReadonlyMap<unknown, string> = new Map<unknown, string>([
  [Set, "Set is not supported: use an array [X] (with a unique validator if needed)"],
  [Map, "a Map needs its value type: Spec.map(X)"],
  [Array, "an array needs its element type: [X]"],
  [Object, "Object (Mixed) is not supported: declare a @Schema class or Spec.map(X)"],
  [Function, "functions are not data"],
  [Promise, "Promise is not a field type"],
  [WeakMap, "WeakMap is not a field type"],
  [WeakSet, "WeakSet is not a field type"],
  [Symbol, "Symbol is not a field type"],
  [Error, "Error is not a field type"],
]);

/** Which values a union member claims: the member is chosen by the value's own type. */
const GUARDS: Readonly<Record<ScalarType, (value: unknown) => boolean>> = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number",
  double: (value) => typeof value === "number" || BsonGuards.isDouble(value),
  int32: (value) => typeof value === "number" || BsonGuards.isInt32(value),
  long: (value) => typeof value === "bigint" || BsonGuards.isLong(value),
  decimal128: BsonGuards.isDecimal128,
  boolean: (value) => typeof value === "boolean",
  date: BsonGuards.isDate,
  objectId: BsonGuards.isObjectId,
  uuid: BsonGuards.isUuid,
  binary: (value) => (BsonGuards.isBinary(value) && !BsonGuards.isUuid(value)) || BsonGuards.isUint8Array(value),
  vector: BsonGuards.isVector,
  regex: BsonGuards.isRegExp,
  timestamp: BsonGuards.isTimestamp,
};

/** Union members whose guards overlap (they would claim the same values). */
const GUARD_FAMILY: Readonly<Record<ScalarType, string>> = {
  string: "string",
  number: "number",
  double: "number",
  int32: "number",
  long: "long",
  decimal128: "decimal128",
  boolean: "boolean",
  date: "date",
  objectId: "objectId",
  uuid: "binary",
  binary: "binary",
  vector: "binary",
  regex: "regex",
  timestamp: "timestamp",
};

/**
 * Turns the value returned by a `@Prop` thunk into a {@link ResolvedSpec}. BSON classes are recognized
 * by the `_bsontype` of their prototype, not by identity: the ESM and CommonJS copies of `bson` are
 * different classes with the same tags.
 */
export class TypeResolver {
  /**
   * Resolves a spec.
   *
   * @param spec - The value the type thunk returned.
   * @param where - Where the spec is declared, for messages.
   * @returns The resolved spec.
   * @throws {ConfigurationError} When the spec is not a supported type.
   */
  static resolve(spec: unknown, where: string): ResolvedSpec {
    if (Array.isArray(spec)) {
      if (spec.length !== 1) {
        throw new ConfigurationError(`${where}: an array type has exactly one element type, [X] (got ${spec.length})`);
      }
      return { kind: "array", element: TypeResolver.resolve(spec[0], `${where} (array element)`) };
    }
    if (Spec.isSpecObject(spec)) return TypeResolver.resolveSpecObject(spec, where);
    if (typeof spec !== "function") {
      throw new ConfigurationError(
        `${where}: the type thunk returned ${spec === undefined ? "undefined (a class used before its declaration?)" : typeof spec}, expected a type`,
      );
    }
    const unsupported = UNSUPPORTED.get(spec);
    if (unsupported !== undefined) throw new ConfigurationError(`${where}: ${unsupported}`);
    const scalar = TypeResolver.scalarOf(spec, where);
    if (scalar !== undefined) return { kind: "scalar", type: scalar, caster: TypeResolver.casterOf(scalar) };
    const target = spec as ClassRef;
    if (!MetadataStore.isSchema(target)) {
      throw new ConfigurationError(
        `${where}: class ${target.name || "(anonymous)"} is not a schema; decorate it with @Schema()`,
      );
    }
    return { kind: "class", target, nested: MetadataStore.own(target).schema?.nested === true };
  }

  /**
   * The caster of a scalar type (Binary subtype 0; vectors of any dtype are built by spec objects).
   *
   * @param type - The scalar type.
   * @returns The caster.
   * @throws {ConfigurationError} For `vector`, which needs a spec object.
   */
  static casterOf(type: ScalarType): ValueCaster<unknown> {
    switch (type) {
      case "string":
        return StringCaster;
      case "number":
        return NumberCaster;
      case "double":
        return DoubleCaster;
      case "int32":
        return Int32Caster;
      case "long":
        return BigIntCaster;
      case "decimal128":
        return Decimal128Caster;
      case "boolean":
        return BooleanCaster;
      case "date":
        return DateCaster;
      case "objectId":
        return ObjectIdCaster;
      case "uuid":
        return UuidCaster;
      case "binary":
        return BinaryCaster;
      case "regex":
        return RegExpCaster;
      case "timestamp":
        return TimestampCaster;
      case "vector":
        throw new ConfigurationError("a vector needs Spec.vector({ dtype, dimensions })");
    }
  }

  /**
   * The scalar type of a constructor.
   *
   * @param spec - The constructor.
   * @param where - Where the spec is declared, for messages.
   * @returns The scalar type; `undefined` when the constructor is not a scalar type.
   * @throws {ConfigurationError} For `Long` and other unsupported BSON types.
   */
  private static scalarOf(spec: unknown, where: string): ScalarType | undefined {
    if (spec === String) return "string";
    if (spec === Number) return "number";
    if (spec === Boolean) return "boolean";
    if (spec === BigInt) return "long";
    if (spec === Date) return "date";
    if (spec === RegExp) return "regex";
    const prototype: unknown = (spec as { prototype?: unknown }).prototype;
    if (typeof prototype !== "object" || prototype === null) return undefined;
    const tag = BsonGuards.tagOf(prototype);
    switch (tag) {
      case "ObjectId":
        return "objectId";
      case "Decimal128":
        return "decimal128";
      case "Double":
        return "double";
      case "Int32":
        return "int32";
      case "Timestamp":
        return "timestamp";
      case "Binary":
        /* UUID is a subclass of Binary with the same tag; its static `generate` tells them apart. */
        return typeof (spec as { generate?: unknown }).generate === "function" ? "uuid" : "binary";
      case "Long":
        throw new ConfigurationError(`${where}: Long is not a field type: use BigInt (int64 is a bigint)`);
      case undefined:
        return undefined;
      default:
        throw new ConfigurationError(`${where}: ${tag} is not supported as a field type (legacy BSON types)`);
    }
  }

  /**
   * Resolves a `Spec.*` object (map, vector, binary or union).
   *
   * @param spec - The spec object.
   * @param where - Where the spec is declared, for messages.
   * @returns The resolved spec.
   * @throws {ConfigurationError} When the spec object is invalid or unknown.
   */
  private static resolveSpecObject(spec: object, where: string): ResolvedSpec {
    const object = spec as Readonly<Record<string, unknown>> & { readonly [SPEC_KIND]: string };
    switch (object[SPEC_KIND]) {
      case "map":
        /* `nullable` is the option as given: only `true` (or nothing) is a valid one. */
        if (object.nullable !== undefined && object.nullable !== true) {
          throw new ConfigurationError(`${where}: Spec.map options: "nullable" must be true`);
        }
        return {
          kind: "map",
          value: TypeResolver.resolve(object.of, `${where} (map value)`),
          nullableValues: object.nullable === true,
        };
      case "vector": {
        const dtype = object.dtype as "int8" | "float32" | "packedBit";
        const dimensions = object.dimensions as number | undefined;
        return {
          kind: "scalar",
          type: "vector",
          caster: VectorCaster.of(dimensions === undefined ? { dtype } : { dtype, dimensions }),
        };
      }
      case "binary":
        return { kind: "scalar", type: "binary", caster: BinaryCaster.of({ subtype: object.subtype as number }) };
      case "union":
        return TypeResolver.resolveUnion(object.members as readonly unknown[], where);
      default:
        throw new ConfigurationError(`${where}: unknown spec object`);
    }
  }

  /**
   * Resolves a union of scalar types.
   *
   * @param members - The member specs.
   * @param where - Where the union is declared, for messages.
   * @returns The resolved union.
   * @throws {ConfigurationError} When there are fewer than two members, a member is not scalar, or two members
   * accept the same values.
   */
  private static resolveUnion(members: readonly unknown[], where: string): ResolvedSpec {
    if (members.length < 2) throw new ConfigurationError(`${where}: a union needs at least two members`);
    const types = members.map((member, index) => {
      const resolved = TypeResolver.resolve(member, `${where} (union member ${index + 1})`);
      if (resolved.kind !== "scalar") {
        throw new ConfigurationError(
          `${where}: union members must be scalar types; a union of classes is a discriminator (@Discriminator)`,
        );
      }
      return resolved;
    });
    const families = types.map((member) => GUARD_FAMILY[member.type]);
    const clash = families.findIndex((family, index) => families.indexOf(family) !== index);
    if (clash !== -1) {
      throw new ConfigurationError(
        `${where}: union members ${types[families.indexOf(families[clash] as string)]?.type} and ${types[clash]?.type} accept the same values (exactly one member must claim a value)`,
      );
    }
    const caster = UnionCaster.byGuard(
      ...types.map((member) => UnionCaster.member(member.type, GUARDS[member.type], member.caster)),
    ) as ValueCaster<unknown>;
    return { kind: "union", members: types.map((member) => member.type), caster };
  }
}
