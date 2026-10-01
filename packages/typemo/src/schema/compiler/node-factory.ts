import { NullableCaster } from "../../bson/casters/nullable-caster.ts";
import type { ValueCaster } from "../../bson/casters/value-caster.ts";
import { CastError } from "../../errors/cast-error.ts";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import { SensitiveMask } from "../../policies/sensitive-mask.ts";
import type { ExtensionRegistry } from "../extensions/extension-registry.ts";
import type { ClassRef, ServiceField } from "../metadata/metadata-types.ts";
import type { CompiledSchema } from "./compiled-schema.ts";
import type { NodeValidator, PathNode, ScalarType } from "./path-node.ts";
import { SchemaWalker } from "./schema-walker.ts";
import type { ResolvedSpec } from "./type-resolver.ts";

/** Options every field accepts. */
const COMMON = [
  "required",
  "nullable",
  "default",
  "immutable",
  "hidden",
  "sensitive",
  "ext",
  "dbName",
  "index",
  "unique",
  "sparse",
  "validate",
  "get",
  "set",
] as const;
/** The reference options. */
const REF = ["ref", "refPath", "refModel"] as const;
/** Reference options of a Map of references go to its VALUE node (`map.$*`). */
const MAP_VALUE_REF: ReadonlySet<ScalarType> = new Set<ScalarType>(["string", "number", "objectId", "uuid"]);
/** Options specific to string fields. */
const STRING = ["enum", "lowercase", "uppercase", "trim", "match", "minLength", "maxLength", "text"] as const;
/** Options specific to number fields. */
const NUMBER = ["enum", "min", "max"] as const;
/** Options specific to `long` fields. */
const LONG = ["min", "max"] as const;
/** Options specific to date fields. */
const DATE = ["min", "max", "expires"] as const;
/** Options specific to subdocument fields. */
const SUBDOCUMENT = ["excludeIndexes"] as const;

/** Options of an array field that stay on the array (index-related); the other specific options go to the elements. */
const ARRAY_LEVEL: ReadonlySet<string> = new Set(["text", "expires"]);

/** The options a scalar type accepts besides the common ones. */
const SPECIFIC: Readonly<Record<ScalarType, readonly string[]>> = {
  string: [...STRING, ...REF],
  number: [...NUMBER, ...REF],
  double: [...NUMBER, ...REF],
  int32: [...NUMBER, ...REF],
  long: LONG,
  decimal128: [],
  boolean: [],
  date: DATE,
  objectId: REF,
  uuid: REF,
  binary: [],
  vector: [],
  regex: [],
  timestamp: [],
};

/**
 * Where a node is being built.
 *
 * @example
 * ```ts
 * const site: NodeSite = { where: "User.name", prefix: "", dbPrefix: "", owner: User, service: undefined,
 *   schemaOf, extensions };
 * ```
 */
export interface NodeSite {
  /** Class and field for messages: `User.name`. */
  readonly where: string;
  /** Code path of the parent (`""` at the top). */
  readonly prefix: string;
  /** Database path of the parent. */
  readonly dbPrefix: string;
  /** The class that declared the field; `undefined` below the top level. */
  readonly owner: ClassRef | undefined;
  /** The service role of the field, when the core fills it. */
  readonly service: ServiceField | undefined;
  /** The compiled schema of a class (lazy: recursive schemas are still being compiled). */
  readonly schemaOf: (target: ClassRef) => CompiledSchema;
  /** The extensions of the compile's context (the client's, else the global ones). */
  readonly extensions: ExtensionRegistry;
}

/**
 * Field options as written.
 *
 * @example
 * ```ts
 * const options: Options = { required: true, trim: true };
 * ```
 */
type Options = Readonly<Record<string, unknown>>;

/**
 * Joins a path prefix and a key.
 *
 * @param prefix - The parent path; empty at the top.
 * @param key - The key to append.
 * @returns The joined path.
 */
const join = (prefix: string, key: string): string => (prefix === "" ? key : `${prefix}.${key}`);

/**
 * Builds the path nodes of one field from its resolved spec and options: checks that every option exists and
 * applies to the type (untyped callers and plugins get the same errors as the decorator's types), normalizes
 * flags, composes the caster (type caster → built-in string transforms → `set` → nullable) and the validators,
 * and checks static values (`enum`, `default`) at build time.
 */
export class NodeFactory {
  /**
   * Builds the node of a field.
   *
   * @param key - The property name.
   * @param spec - The resolved type of the field.
   * @param options - The field options.
   * @param site - Where the node is built.
   * @returns The frozen node.
   * @throws {ConfigurationError} When an option is unknown or invalid for the type, or a static `enum` or
   * `default` value is not a value of the field.
   */
  static build(key: string, spec: ResolvedSpec, options: Options, site: NodeSite): PathNode {
    const node = NodeFactory.buildNode(key, spec, options, site);
    SensitiveMask.checkNode(node, site.where);
    return node;
  }

  /**
   * Splits the options between an array or Map and its elements or values, then builds the node.
   *
   * @param key - The property name.
   * @param spec - The resolved type of the field.
   * @param options - The field options.
   * @param site - Where the node is built.
   * @returns The frozen node.
   * @throws {ConfigurationError} When an option is unknown or invalid.
   */
  private static buildNode(key: string, spec: ResolvedSpec, options: Options, site: NodeSite): PathNode {
    NodeFactory.checkOptionNames(spec, options, site.where);
    const dbName = options.dbName;
    if (
      dbName !== undefined &&
      (typeof dbName !== "string" || dbName === "" || dbName.includes(".") || dbName.startsWith("$"))
    ) {
      throw new ConfigurationError(`${site.where}: "dbName" must be a field name (no ".", not starting with "$")`);
    }
    const dbKey = typeof dbName === "string" ? dbName : key;
    if (spec.kind === "array") {
      const fieldOptions = Object.fromEntries(
        Object.entries(options).filter(
          ([name]) => (COMMON as readonly string[]).includes(name) || ARRAY_LEVEL.has(name),
        ),
      );
      const elementOptions = Object.fromEntries(
        Object.entries(options).filter(
          ([name]) => !(COMMON as readonly string[]).includes(name) && !ARRAY_LEVEL.has(name),
        ),
      );
      return NodeFactory.node(key, dbKey, spec, fieldOptions, elementOptions, site);
    }
    if (spec.kind === "map") {
      /* A Map of references: `ref`/`refPath`/`refModel` describe the values (`map.$*`, populate). */
      const isRef = ([name]: readonly [string, unknown]): boolean => (REF as readonly string[]).includes(name);
      const mapOptions = Object.fromEntries(Object.entries(options).filter((entry) => !isRef(entry)));
      const valueOptions = Object.fromEntries(Object.entries(options).filter(isRef));
      return NodeFactory.node(key, dbKey, spec, mapOptions, valueOptions, site);
    }
    return NodeFactory.node(key, dbKey, spec, options, {}, site);
  }

  /**
   * Builds one node (and its children) from a spec.
   *
   * @param key - The property name, or `$` / `$*` for an element or Map value.
   * @param dbKey - The stored name.
   * @param spec - The resolved type.
   * @param options - The options of this node.
   * @param elementOptions - The options that go to the element or value node.
   * @param site - Where the node is built.
   * @returns The frozen node.
   * @throws {ConfigurationError} When an option, enum or default is invalid.
   */
  private static node(
    key: string,
    dbKey: string,
    spec: ResolvedSpec,
    options: Options,
    elementOptions: Options,
    site: NodeSite,
  ): PathNode {
    const path = join(site.prefix, key);
    const dbPath = join(site.dbPrefix, dbKey);
    const nullable = options.nullable === true;
    /* Checked by the registered extension and frozen (a deep copy: the caller's object is not frozen). */
    const ext = site.extensions.prop(options.ext, { where: site.where, path, dbPath, kind: spec.kind });
    const base = {
      path,
      dbPath,
      key,
      dbKey,
      owner: site.owner,
      required: options.required === true,
      nullable,
      immutable: options.immutable === true,
      hidden: options.hidden === true,
      service: site.service,
      options: Object.freeze(ext === undefined ? { ...options } : { ...options, ext }),
      ref: typeof options.ref === "function" ? (options.ref as () => ClassRef) : undefined,
      refPath: typeof options.refPath === "string" ? options.refPath : undefined,
      refModel:
        typeof options.refModel === "function"
          ? (options.refModel as (owner: object, id: unknown) => ClassRef)
          : undefined,
    };
    SensitiveMask.check(options.sensitive, site.where);
    const refs = [options.ref, options.refPath, options.refModel].filter((option) => option !== undefined).length;
    if (refs > 1) {
      throw new ConfigurationError(
        `${site.where}: "ref", "refPath" and "refModel" are exclusive (one form of reference)`,
      );
    }
    const childSite = (childKey: string): NodeSite => ({
      ...site,
      where: `${site.where}.${childKey}`,
      prefix: path,
      dbPrefix: dbPath,
      owner: undefined,
      service: undefined,
    });
    let node: PathNode;
    switch (spec.kind) {
      case "scalar":
      case "union": {
        const scalarType: ScalarType | undefined = spec.kind === "scalar" ? spec.type : undefined;
        const caster = NodeFactory.withSensitive(
          NodeFactory.withSetter(
            NodeFactory.withTransforms(NodeFactory.withRefDocument(spec.caster, options), options, site.where),
            options,
          ),
          options,
          /* The node is read when a cast fails, after it is built (`undefined` while `enum` values are checked). */
          (): PathNode | undefined => node,
        );
        const enumValues = NodeFactory.enumValues(options.enum, caster, site.where);
        const validators = NodeFactory.validators(options, scalarType, enumValues, site.where);
        node =
          spec.kind === "scalar"
            ? {
                ...base,
                kind: "scalar",
                type: spec.type,
                enumValues,
                caster: NodeFactory.nullable(caster, nullable),
                validators,
                defaultValue: undefined,
              }
            : {
                ...base,
                kind: "union",
                members: spec.members,
                caster: NodeFactory.nullable(caster, nullable),
                validators,
                defaultValue: undefined,
              };
        break;
      }
      case "array": {
        /* Specific options belong to the innermost element (`[[String]]` + `enum` restricts the strings). */
        const element =
          spec.element.kind === "array"
            ? NodeFactory.node("$", "$", spec.element, {}, elementOptions, childSite("$"))
            : NodeFactory.node("$", "$", spec.element, elementOptions, {}, childSite("$"));
        node = {
          ...base,
          kind: "array",
          element,
          caster: NodeFactory.lazyCaster(() => node, nullable),
          validators: NodeFactory.validators(options, undefined, undefined, site.where),
          defaultValue: undefined,
        };
        break;
      }
      case "map": {
        /* `Spec.map(X, { nullable: true })`: the VALUE node is nullable (not the map field itself). */
        const valueOptions = spec.nullableValues ? { ...elementOptions, nullable: true } : elementOptions;
        const value = NodeFactory.node("$*", "$*", spec.value, valueOptions, {}, childSite("$*"));
        node = {
          ...base,
          kind: "map",
          value,
          caster: NodeFactory.lazyCaster(() => node, nullable),
          validators: NodeFactory.validators(options, undefined, undefined, site.where),
          defaultValue: undefined,
        };
        break;
      }
      case "class": {
        const target = spec.target;
        const schemaOf = site.schemaOf;
        const kind = spec.nested ? "nested" : "subdocument";
        node = {
          ...base,
          kind,
          target,
          get schema(): CompiledSchema {
            return schemaOf(target);
          },
          caster: NodeFactory.lazyCaster(() => node, nullable),
          validators: NodeFactory.validators(options, undefined, undefined, site.where),
          defaultValue: undefined,
        };
        break;
      }
    }
    const defaultValue = NodeFactory.defaultOf(options, node, site.where) ?? NodeFactory.implicitDefault(node);
    if (defaultValue === undefined) return Object.freeze(node);
    /* Copy by descriptors, not by spread: a spread would evaluate the lazy `schema` getter of a class node. */
    return Object.freeze(
      Object.defineProperties(
        {},
        {
          ...Object.getOwnPropertyDescriptors(node),
          defaultValue: { value: defaultValue, enumerable: true },
        },
      ) as PathNode,
    );
  }

  /**
   * The caster of a container node: it walks the node lazily, because the node and child schemas exist only
   * after compile.
   *
   * @param node - Returns the node.
   * @param nullable - Whether `null` is allowed.
   * @returns The caster.
   */
  private static lazyCaster(node: () => PathNode, nullable: boolean): ValueCaster<unknown> {
    const caster: ValueCaster<unknown> = {
      get expected(): string {
        const current = node();
        return current.kind === "subdocument" || current.kind === "nested" ? current.schema.name : current.path;
      },
      cast: (value: unknown, path = ""): unknown => SchemaWalker.castValue(node(), value, path),
      encode: (value: unknown): unknown => value,
    };
    return NodeFactory.nullable(caster, nullable);
  }

  /**
   * Wraps a caster so it accepts `null`, when the field is nullable.
   *
   * @param caster - The caster.
   * @param nullable - Whether `null` is allowed.
   * @returns The caster, wrapped when nullable.
   */
  private static nullable(caster: ValueCaster<unknown>, nullable: boolean): ValueCaster<unknown> {
    return nullable ? NullableCaster.of(caster) : caster;
  }

  /**
   * A reference field (`ref`, `refPath` or `refModel`) also takes the referenced document itself — hydrated,
   * lean or an instance of its class — and stores its `_id`, as Mongoose does. Only an object with an own
   * `_id` counts as a document; anything else goes to the id caster as it is (and fails there when it is
   * not an id).
   *
   * @param caster - The id caster.
   * @param options - The field options.
   * @returns The caster, wrapped when the field is a reference.
   */
  private static withRefDocument(caster: ValueCaster<unknown>, options: Options): ValueCaster<unknown> {
    if (options.ref === undefined && options.refPath === undefined && options.refModel === undefined) return caster;
    const idOf = (value: unknown): unknown =>
      typeof value === "object" && value !== null && !Array.isArray(value) && Object.hasOwn(value, "_id")
        ? (value as { readonly _id: unknown })._id
        : value;
    return {
      expected: caster.expected,
      cast: (value: unknown, path = ""): unknown => caster.cast(idOf(value), path),
      encode: (value: unknown): unknown => caster.encode(value),
    };
  }

  /**
   * String transforms applied after casting: `trim`, then `lowercase` / `uppercase`.
   *
   * @param caster - The caster.
   * @param options - The field options.
   * @param where - Where the field is declared, for messages.
   * @returns The caster with the transforms.
   * @throws {ConfigurationError} When `lowercase` and `uppercase` are both set.
   */
  private static withTransforms(caster: ValueCaster<unknown>, options: Options, where: string): ValueCaster<unknown> {
    const trim = options.trim === true;
    const lower = options.lowercase === true;
    const upper = options.uppercase === true;
    if (lower && upper) throw new ConfigurationError(`${where}: "lowercase" and "uppercase" together`);
    if (!trim && !lower && !upper) return caster;
    return {
      expected: caster.expected,
      cast: (value: unknown, path = ""): unknown => {
        let text = caster.cast(value, path) as string;
        if (trim) text = text.trim();
        if (lower) text = text.toLowerCase();
        if (upper) text = text.toUpperCase();
        return text;
      },
      encode: (value: unknown): unknown => caster.encode(value),
    };
  }

  /**
   * Makes a `CastError` of a sensitive field carry the masked value, in `value` and in the message. A mask
   * function sees only a value of the field's declared type (a value that failed to cast rarely is one); every other
   * value is masked as `"?"` without calling it.
   *
   * @param caster - The caster.
   * @param options - The field options.
   * @param node - Returns the node being built (`undefined` until it is).
   * @returns The caster, wrapped when the field is sensitive.
   */
  private static withSensitive(
    caster: ValueCaster<unknown>,
    options: Options,
    node: () => PathNode | undefined,
  ): ValueCaster<unknown> {
    const option = options.sensitive;
    if (option === undefined || option === "show") return caster;
    const hide = (value: unknown, path: string): unknown =>
      SensitiveMask.forError(option, value, path, undefined, node());
    return {
      expected: caster.expected,
      cast: (value: unknown, path = ""): unknown => {
        try {
          return caster.cast(value, path);
        } catch (error) {
          if (!(error instanceof CastError)) throw error;
          throw new CastError({
            path: error.path,
            value: hide(error.value, error.path),
            expected: error.expected,
            reason: error.reason,
            detail: error.detail,
            ...(error.cause === undefined ? {} : { cause: error.cause }),
          });
        }
      },
      encode: (value: unknown): unknown => caster.encode(value),
    };
  }

  /**
   * Applies the `set` option after casting.
   *
   * @param caster - The caster.
   * @param options - The field options.
   * @returns The caster, wrapped when `set` is a function.
   */
  private static withSetter(caster: ValueCaster<unknown>, options: Options): ValueCaster<unknown> {
    const set = options.set;
    if (typeof set !== "function") return caster;
    return {
      expected: caster.expected,
      cast: (value: unknown, path = ""): unknown => (set as (v: unknown) => unknown)(caster.cast(value, path)),
      encode: (value: unknown): unknown => caster.encode(value),
    };
  }

  /**
   * The `enum` values (array or TS enum object; numeric reverse mappings dropped), each checked by the caster.
   *
   * @param option - The `enum` option.
   * @param caster - The field's caster.
   * @param where - Where the field is declared, for messages.
   * @returns The frozen values; `undefined` without the option.
   * @throws {ConfigurationError} When the option is not an array or enum object, is empty, or holds a value the
   * field cannot hold.
   */
  private static enumValues(
    option: unknown,
    caster: ValueCaster<unknown>,
    where: string,
  ): readonly unknown[] | undefined {
    if (option === undefined) return undefined;
    let values: unknown[];
    if (Array.isArray(option)) values = [...option];
    else if (typeof option === "object" && option !== null) {
      const record = option as Readonly<Record<string, unknown>>;
      /* A numeric TS enum has reverse mappings (`{ 0: "Low", Low: 0 }`): keep the numeric members. */
      values = Object.values(record).filter(
        (value) => !(typeof value === "string" && typeof record[value] === "number"),
      );
    } else throw new ConfigurationError(`${where}: "enum" must be an array or an enum object`);
    if (values.length === 0) throw new ConfigurationError(`${where}: "enum" is empty`);
    for (const value of values) {
      try {
        caster.cast(value, "");
      } catch (error) {
        throw new ConfigurationError(`${where}: the enum value ${JSON.stringify(value)} is not a value of the field`, {
          cause: error,
        });
      }
    }
    return Object.freeze(values);
  }

  /**
   * The validators of a node from its options (`enum`, bounds, lengths, `match`, user `validate`).
   *
   * @param options - The node's options.
   * @param type - The scalar type, if the node is a scalar.
   * @param enumValues - The allowed values, if any.
   * @param where - Where the field is declared, for messages.
   * @returns The frozen validators.
   * @throws {ConfigurationError} When a bound, length, `match` or `validate` option is invalid.
   */
  private static validators(
    options: Options,
    type: ScalarType | undefined,
    enumValues: readonly unknown[] | undefined,
    where: string,
  ): readonly NodeValidator[] {
    const list: NodeValidator[] = [];
    if (enumValues !== undefined) {
      const allowed = new Set(enumValues);
      list.push({
        reason: "enum",
        check: (value: unknown) =>
          allowed.has(value) || `must be one of ${enumValues.map((v) => JSON.stringify(v)).join(", ")}`,
      });
    }
    const { min, max, minLength, maxLength, match } = options;
    if (min !== undefined || max !== undefined) NodeFactory.checkBounds(min, max, type, where);
    if (min !== undefined) {
      list.push({
        reason: "min",
        check: (value: never) => (value as number) >= (min as number) || `must be at least ${NodeFactory.show(min)}`,
      });
    }
    if (max !== undefined) {
      list.push({
        reason: "max",
        check: (value: never) => (value as number) <= (max as number) || `must be at most ${NodeFactory.show(max)}`,
      });
    }
    if (minLength !== undefined || maxLength !== undefined) NodeFactory.checkLengths(minLength, maxLength, where);
    if (typeof minLength === "number") {
      list.push({
        reason: "minLength",
        check: (value: string) => value.length >= minLength || `must be at least ${minLength} characters long`,
      });
    }
    if (typeof maxLength === "number") {
      list.push({
        reason: "maxLength",
        check: (value: string) => value.length <= maxLength || `must be at most ${maxLength} characters long`,
      });
    }
    if (match !== undefined) {
      if (!(match instanceof RegExp)) throw new ConfigurationError(`${where}: "match" must be a RegExp`);
      if (match.global || match.sticky) {
        throw new ConfigurationError(`${where}: "match" with the g or y flag is stateful (lastIndex); remove the flag`);
      }
      list.push({ reason: "match", check: (value: string) => match.test(value) || `must match ${match}` });
    }
    const validate = options.validate;
    if (validate !== undefined) {
      const user = Array.isArray(validate) ? validate : [validate];
      for (const fn of user) {
        if (typeof fn !== "function")
          throw new ConfigurationError(`${where}: "validate" must be a function or a list of functions`);
        list.push({ reason: "validator", check: fn as NodeValidator["check"] });
      }
    }
    return Object.freeze(list);
  }

  /**
   * Checks the `min` and `max` options against the field type.
   *
   * @param min - The `min` option.
   * @param max - The `max` option.
   * @param type - The scalar type.
   * @param where - Where the field is declared, for messages.
   * @throws {ConfigurationError} When a bound is not a value of the field type, or `min` exceeds `max`.
   */
  private static checkBounds(min: unknown, max: unknown, type: ScalarType | undefined, where: string): void {
    const kind =
      type === "long"
        ? "bigint"
        : type === "date"
          ? "date"
          : type === "number" || type === "double" || type === "int32"
            ? "number"
            : undefined;
    const valid = (value: unknown): boolean =>
      value === undefined ||
      (kind === "bigint" && typeof value === "bigint") ||
      (kind === "number" && typeof value === "number" && Number.isFinite(value)) ||
      (kind === "date" && value instanceof Date && !Number.isNaN(value.getTime()));
    if (kind === undefined || !valid(min) || !valid(max)) {
      throw new ConfigurationError(
        `${where}: "min"/"max" must be ${kind ?? "a number, a bigint or a Date"} values of the field type`,
      );
    }
    if (min !== undefined && max !== undefined && (min as number) > (max as number)) {
      throw new ConfigurationError(`${where}: "min" is greater than "max"`);
    }
  }

  /**
   * Checks the `minLength` and `maxLength` options.
   *
   * @param minLength - The `minLength` option.
   * @param maxLength - The `maxLength` option.
   * @param where - Where the field is declared, for messages.
   * @throws {ConfigurationError} When a length is not a non-negative integer, or `minLength` exceeds
   * `maxLength`.
   */
  private static checkLengths(minLength: unknown, maxLength: unknown, where: string): void {
    const valid = (value: unknown): boolean =>
      value === undefined || (Number.isInteger(value) && (value as number) >= 0);
    if (!valid(minLength) || !valid(maxLength))
      throw new ConfigurationError(`${where}: "minLength"/"maxLength" must be non-negative integers`);
    if (minLength !== undefined && maxLength !== undefined && (minLength as number) > (maxLength as number)) {
      throw new ConfigurationError(`${where}: "minLength" is greater than "maxLength"`);
    }
  }

  /**
   * A factory of fresh defaults: a static value is checked now and cast into a copy per call.
   *
   * @param options - The field options.
   * @param node - The field node.
   * @param where - Where the field is declared, for messages.
   * @returns The factory; `undefined` without a `default` option.
   * @throws {ConfigurationError} When a static default is not a value of the field.
   */
  private static defaultOf(options: Options, node: PathNode, where: string): (() => unknown) | undefined {
    if (!Object.hasOwn(options, "default")) return undefined;
    const option = options.default;
    const castDefault = (value: unknown): unknown =>
      value === null ? NodeFactory.nullDefault(node, where) : SchemaWalker.castValue(node, value, node.path);
    if (typeof option === "function") return () => castDefault((option as () => unknown)());
    try {
      castDefault(option);
    } catch (error) {
      /* An error about this very field already names it: rethrown as is, never wrapped under the same prefix. */
      if (error instanceof ConfigurationError && error.message.startsWith(`${where}: `)) throw error;
      if (error instanceof CastError) {
        /* The cast names the field again ("at path …"): only its detail is kept, and a deeper path when there is one. */
        const at = error.path === node.path || error.path === "" ? "" : ` at "${error.path}"`;
        throw new ConfigurationError(
          `${where}: the "default" value is not a value of the field (got ${CastError.describe(option)}${at}): ${error.detail} [${error.reason}]`,
          { cause: error },
        );
      }
      if (error instanceof ConfigurationError) {
        throw new ConfigurationError(`${where}: the "default" value is not a value of the field: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
    return () => castDefault(option);
  }

  /**
   * The default a field has without a `default` option: an array field that is not `required` starts as an
   * empty array, as in Mongoose (create, `Model.new`, an upsert's insert, and a stored document read without the
   * key). A `required` array has none: the caller must give it. Elements of arrays and values of Maps are not
   * fields and get none.
   *
   * @param node - The node without a `default` option.
   * @returns The factory of a fresh `[]` for such an array field; `undefined` otherwise.
   */
  private static implicitDefault(node: PathNode): (() => unknown) | undefined {
    if (node.kind !== "array" || node.required || node.key === "$" || node.key === "$*") return undefined;
    return () => SchemaWalker.castValue(node, [], node.path);
  }

  /**
   * A `null` default, allowed only on a nullable field.
   *
   * @param node - The field node.
   * @param where - Where the field is declared, for messages.
   * @returns `null`.
   * @throws {ConfigurationError} When the field is not nullable.
   */
  private static nullDefault(node: PathNode, where: string): null {
    if (!node.nullable) throw new ConfigurationError(`${where}: "default: null" on a field that is not nullable`);
    return null;
  }

  /**
   * Refuses unknown options and options that do not apply to the type (the same rules as the decorator's
   * types).
   *
   * @param spec - The resolved type.
   * @param options - The field options.
   * @param where - Where the field is declared, for messages.
   * @throws {ConfigurationError} For an option that is not accepted by the field type.
   */
  private static checkOptionNames(spec: ResolvedSpec, options: Options, where: string): void {
    const allowed = new Set<string>(COMMON);
    const element = spec.kind === "array" ? NodeFactory.innermost(spec) : spec;
    if (spec.kind === "array") for (const name of ARRAY_LEVEL) allowed.add(name);
    switch (element.kind) {
      case "scalar":
        for (const name of SPECIFIC[element.type]) allowed.add(name);
        break;
      case "class":
        for (const name of SUBDOCUMENT) allowed.add(name);
        break;
      case "map":
        if (element.value.kind === "scalar" && MAP_VALUE_REF.has(element.value.type))
          for (const name of REF) allowed.add(name);
        break;
      default:
        break;
    }
    if (spec.kind === "array") {
      /* Index-related specific options apply to the array path only if the element type has them. */
      for (const name of ARRAY_LEVEL)
        if (element.kind !== "scalar" || !SPECIFIC[element.type].includes(name)) allowed.delete(name);
    }
    for (const name of Object.keys(options)) {
      if (!allowed.has(name)) {
        throw new ConfigurationError(`${where}: "${name}" is not an option of this field type`);
      }
    }
  }

  /**
   * The innermost element spec of nested arrays.
   *
   * @param spec - The spec.
   * @returns The spec without array levels.
   */
  private static innermost(spec: ResolvedSpec): ResolvedSpec {
    return spec.kind === "array" ? NodeFactory.innermost(spec.element) : spec;
  }

  /**
   * A bound as text for messages.
   *
   * @param value - The bound.
   * @returns The text.
   */
  private static show(value: unknown): string {
    return value instanceof Date ? value.toISOString() : typeof value === "bigint" ? `${value}n` : String(value);
  }
}
