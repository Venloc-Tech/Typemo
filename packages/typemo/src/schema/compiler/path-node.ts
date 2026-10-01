import type { ValueCaster } from "../../bson/casters/value-caster.ts";
import type { ClassRef, ServiceField } from "../metadata/metadata-types.ts";
import type { ValidationContext } from "../options/prop-options.ts";
import type { CompiledSchema } from "./compiled-schema.ts";

/*
 * Nodes of the compiled paths tree: ONE structure instead of Mongoose's five dictionaries
 * (`paths`, `nested`, `subpaths`, `singleNestedPaths`, `mapPaths`). Nodes are frozen at compile time;
 * reading never mutates or caches anything.
 */

/**
 * The BSON type of a scalar node (the `BsonTypeTable` row it maps to, plus `number` = int32 or double).
 *
 * @example
 * ```ts
 * const type: ScalarType = "objectId";
 * ```
 */
export type ScalarType =
  | "string"
  | "number"
  | "double"
  | "int32"
  | "long"
  | "decimal128"
  | "boolean"
  | "date"
  | "objectId"
  | "uuid"
  | "binary"
  | "vector"
  | "regex"
  | "timestamp";

/**
 * A built-in or user validator of a node, run on non-null values after casting.
 *
 * @example
 * ```ts
 * const validator: NodeValidator = { reason: "min", check: (value) => (value as number) >= 0 || "too small" };
 * ```
 */
export interface NodeValidator {
  /** Which option produced the validator. */
  readonly reason: "enum" | "min" | "max" | "minLength" | "maxLength" | "match" | "validator";
  /** `true` passes; a string is the failure message. The context says where the validator runs. */
  readonly check: (value: never, context: ValidationContext) => true | string | Promise<true | string>;
}

/**
 * The members every node of the paths tree has.
 *
 * @example
 * ```ts
 * const isRequired = (node: NodeBase): boolean => node.required;
 * ```
 */
interface NodeBase {
  /** Canonical path in code names: `addresses.$.city`, `scores.$*`. */
  readonly path: string;
  /** The same path in database names (aliases applied). */
  readonly dbPath: string;
  /** Last segment in code (`city`, `$`, `$*`). */
  readonly key: string;
  /** Last segment in the database (the alias, if any). */
  readonly dbKey: string;
  /** The class that declared the field (`undefined` for `$` / `$*` element nodes and service fields added by the compiler). */
  readonly owner: ClassRef | undefined;
  /** The `required` option. */
  readonly required: boolean;
  /** The `nullable` option. */
  readonly nullable: boolean;
  /** The `immutable` option. */
  readonly immutable: boolean;
  /** The `hidden` option. */
  readonly hidden: boolean;
  /** The service field kind (`id`, `createdAt`, ...) when a base class declared the field. */
  readonly service: ServiceField | undefined;
  /** A fresh default value per call (a static default is cast into a copy), `undefined` when none. */
  readonly defaultValue: (() => unknown) | undefined;
  /** Casts an input value of this path (nullable, built-in transforms and `set` included). Throws `CastError`. */
  readonly caster: ValueCaster<unknown>;
  /** Validators in the order they run. */
  readonly validators: readonly NodeValidator[];
  /** The options as declared (frozen); the normalized meaning is in the other members. */
  readonly options: Readonly<Record<string, unknown>>;
  /** `ref: () => Model` of a `Ref<M>` path (an array element for `Ref<M>[]`). */
  readonly ref: (() => ClassRef) | undefined;
  /** A path of the owner (sub)document holding the model's class name (a polymorphic `Ref<A | B>`). */
  readonly refPath: string | undefined;
  /** The dynamic reference: the model class from the owner (sub)document and the id. */
  readonly refModel: ((owner: object, id: unknown) => ClassRef) | undefined;
}

/**
 * A leaf node of a scalar BSON type.
 *
 * @example
 * ```ts
 * const isString = (node: ScalarNode): boolean => node.type === "string";
 * ```
 */
export interface ScalarNode extends NodeBase {
  /** Node discriminant. */
  readonly kind: "scalar";
  /** The BSON type of the value. */
  readonly type: ScalarType;
  /** Allowed values (`enum`), `undefined` when unrestricted. */
  readonly enumValues: readonly unknown[] | undefined;
}

/**
 * A leaf node that accepts several scalar types.
 *
 * @example
 * ```ts
 * const accepts = (node: UnionNode, type: ScalarType): boolean => node.members.includes(type);
 * ```
 */
export interface UnionNode extends NodeBase {
  /** Node discriminant. */
  readonly kind: "union";
  /** The scalar types the node accepts. */
  readonly members: readonly ScalarType[];
}

/**
 * An array node.
 *
 * @example
 * ```ts
 * const elementPath = (node: ArrayNode): string => node.element.path;
 * ```
 */
export interface ArrayNode extends NodeBase {
  /** Node discriminant. */
  readonly kind: "array";
  /** The element node (`path.$`). */
  readonly element: PathNode;
}

/**
 * A Map node.
 *
 * @example
 * ```ts
 * const valuePath = (node: MapNode): string => node.value.path;
 * ```
 */
export interface MapNode extends NodeBase {
  /** Node discriminant. */
  readonly kind: "map";
  /** The value node (`path.$*`). */
  readonly value: PathNode;
}

/**
 * A subdocument node: a class used as a field type.
 *
 * @example
 * ```ts
 * const className = (node: SubdocumentNode): string => node.target.name;
 * ```
 */
export interface SubdocumentNode extends NodeBase {
  /** Node discriminant. */
  readonly kind: "subdocument";
  /** The subdocument class. */
  readonly target: ClassRef;
  /** The subdocument's compiled schema (resolved lazily: recursive schemas point back to themselves). */
  readonly schema: CompiledSchema;
}

/**
 * A nested object node: a group of fields of the parent, without `_id` and hooks of its own.
 *
 * @example
 * ```ts
 * const className = (node: NestedNode): string => node.target.name;
 * ```
 */
export interface NestedNode extends NodeBase {
  /** Node discriminant. */
  readonly kind: "nested";
  /** The nested class. */
  readonly target: ClassRef;
  /** The nested class's schema; its paths are also inlined into the parent's `paths` (`name.first`). */
  readonly schema: CompiledSchema;
}

/**
 * One node of the paths tree.
 *
 * @example
 * ```ts
 * const isLeaf = (node: PathNode): boolean => node.kind === "scalar" || node.kind === "union";
 * ```
 */
export type PathNode = ScalarNode | UnionNode | ArrayNode | MapNode | SubdocumentNode | NestedNode;

/**
 * The kind of a node.
 *
 * @example
 * ```ts
 * const kind: PathKind = "array";
 * ```
 */
export type PathKind = PathNode["kind"];
