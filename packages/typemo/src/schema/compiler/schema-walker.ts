import { BsonGuards } from "../../bson/bson-guards.ts";
import { CastError } from "../../errors/cast-error.ts";
import type { SchemaIssue } from "../../errors/validation-error.ts";
import type { CompiledSchema } from "./compiled-schema.ts";
import type { NodeValidator, PathNode } from "./path-node.ts";

/**
 * What a walk does besides casting.
 *
 * @example
 * ```ts
 * const options: WalkOptions = { validate: true, defaults: true };
 * ```
 */
export interface WalkOptions {
  /** Run the validators (`enum`, `min`, …, `validate`) and report `required`. */
  readonly validate: boolean;
  /** Fill absent fields that have a default. */
  readonly defaults: boolean;
}

/**
 * The result of a collecting walk: the cast value (when there are no issues) and every issue.
 *
 * @example
 * ```ts
 * const result: WalkResult = SchemaWalker.validateDocument(schema, input, { validate: true, defaults: true });
 * ```
 */
export interface WalkResult {
  /** The cast document; `undefined` when there are issues. */
  readonly value: Record<string, unknown> | undefined;
  /** Every issue found. */
  readonly issues: readonly SchemaIssue[];
  /** Pending async validators; `issues` is complete only after they settle. */
  readonly pending: readonly Promise<void>[];
}

/**
 * A path as segments: keys and array indexes.
 *
 * @example
 * ```ts
 * const path: Segments = ["lines", 0, "qty"];
 * ```
 */
type Segments = readonly (string | number)[];

/** Collects issues; in throwing mode the first issue throws its `CastError`. */
class IssueSink {
  /** The issues collected. */
  readonly issues: SchemaIssue[] = [];
  /** The async validators still running. */
  readonly pending: Promise<void>[] = [];

  /**
   * @param throwing - Whether the first issue throws instead of being collected.
   */
  constructor(private readonly throwing: boolean) {}

  /**
   * Records an issue, or throws it in throwing mode.
   *
   * @param issue - The issue.
   * @throws {CastError} In throwing mode.
   */
  add(issue: SchemaIssue): void {
    if (this.throwing) {
      throw issue.cause instanceof CastError
        ? issue.cause
        : new CastError({
            path: issue.path.join("."),
            value: issue.value,
            expected: "document",
            reason:
              issue.reason === "unknown-key"
                ? "unknown-key"
                : issue.reason === "discriminator"
                  ? "discriminator"
                  : "type",
            detail: issue.message,
          });
    }
    this.issues.push(issue);
  }
}

/** The options of a plain cast: no validators, no defaults. */
const NO_VALIDATION: WalkOptions = Object.freeze({ validate: false, defaults: false });

/**
 * One walk over a document and its compiled schema, used both to cast (throwing at the first problem:
 * `CastError`) and to validate (collecting every issue: `ValidationError`, Standard Schema). Nothing in the
 * input is mutated; the output is new objects, arrays and Maps.
 *
 * Strictness: a key the schema does not declare is an issue (`unknown-key`), `undefined` is never a value,
 * `null` only on a nullable path. Validators run on non-null values after casting.
 */
export class SchemaWalker {
  /**
   * Casts a document.
   *
   * @param schema - The compiled schema.
   * @param input - The input document.
   * @param path - The document's path, for error messages.
   * @returns The cast document.
   * @throws {CastError} At the first problem.
   */
  static castDocument(schema: CompiledSchema, input: unknown, path = ""): Record<string, unknown> {
    const sink = new IssueSink(true);
    return SchemaWalker.document(schema, input, SchemaWalker.split(path), NO_VALIDATION, sink) as Record<
      string,
      unknown
    >;
  }

  /**
   * Casts a value of one node.
   *
   * @param node - The path node.
   * @param input - The input value.
   * @param path - The value's path, for error messages.
   * @returns The cast value.
   * @throws {CastError} At the first problem.
   */
  static castValue(node: PathNode, input: unknown, path = ""): unknown {
    return SchemaWalker.value(node, input, SchemaWalker.split(path), NO_VALIDATION, new IssueSink(true));
  }

  /**
   * Casts and validates a document, collecting every issue.
   *
   * @param schema - The compiled schema.
   * @param input - The input document.
   * @param options - What the walk does besides casting.
   * @returns The cast value (when there are no issues), every issue and the pending async validators.
   */
  static validateDocument(schema: CompiledSchema, input: unknown, options: WalkOptions): WalkResult {
    const sink = new IssueSink(false);
    const value = SchemaWalker.document(schema, input, [], options, sink);
    return {
      value: sink.issues.length === 0 ? (value as Record<string, unknown>) : undefined,
      issues: sink.issues,
      pending: sink.pending,
    };
  }

  /**
   * The value handed to the driver: database names (aliases), BSON wrappers of the casters
   * (`Int32`, `Double`), Maps as plain objects. The input must already be cast.
   *
   * @param schema - The compiled schema.
   * @param value - The cast document.
   * @returns The driver form.
   */
  static encodeDocument(schema: CompiledSchema, value: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const target = SchemaWalker.schemaFor(schema, value) ?? schema;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const node = target.field(key);
      if (node === undefined) continue;
      out[node.dbKey] = item === null ? null : SchemaWalker.encodeValue(node, item);
    }
    return out;
  }

  /**
   * The value of one node handed to the driver (database names, BSON wrappers, Maps as objects); `null` stays
   * `null`.
   *
   * @param node - The path node.
   * @param value - The cast value.
   * @returns The driver form.
   */
  static encodeValue(node: PathNode, value: unknown): unknown {
    if (value === null) return null;
    switch (node.kind) {
      case "array":
        return (value as readonly unknown[]).map((item) => SchemaWalker.encodeValue(node.element, item));
      case "map":
        return Object.fromEntries(
          [...(value as ReadonlyMap<string, unknown>)].map(([key, item]) => [
            key,
            SchemaWalker.encodeValue(node.value, item),
          ]),
        );
      case "subdocument":
      case "nested":
        return SchemaWalker.encodeDocument(node.schema, value as Readonly<Record<string, unknown>>);
      default:
        return node.caster.encode(value);
    }
  }

  /**
   * Splits a dotted path into segments.
   *
   * @param path - The path; empty for the root.
   * @returns The segments.
   */
  private static split(path: string): Segments {
    return path === "" ? [] : path.split(".");
  }

  /**
   * The discriminator schema selected by the value's key.
   *
   * @param schema - The compiled schema.
   * @param value - The document.
   * @returns The discriminator schema; `undefined` when the key is absent.
   */
  private static schemaFor(
    schema: CompiledSchema,
    value: Readonly<Record<string, unknown>>,
  ): CompiledSchema | undefined {
    if (schema.discriminators.size === 0) return undefined;
    const key = schema.discriminatorKey;
    return Object.hasOwn(value, key) ? schema.root.discriminatorFor(value[key]) : undefined;
  }

  /**
   * Casts (and validates) a document against its schema, choosing the discriminator schema first.
   *
   * @param base - The schema of the node; a discriminator's schema is chosen by the input.
   * @param input - The input document.
   * @param path - The document's path.
   * @param options - What the walk does besides casting.
   * @param sink - Collects the issues.
   * @returns The cast document; `undefined` when the input is not an object or names an invalid discriminator.
   */
  private static document(
    base: CompiledSchema,
    input: unknown,
    path: Segments,
    options: WalkOptions,
    sink: IssueSink,
  ): Record<string, unknown> | undefined {
    if (!BsonGuards.isPlainObject(input)) {
      sink.add(SchemaWalker.castIssue(path, input, base.name, "an object"));
      return undefined;
    }
    let schema = base;
    const byClass = SchemaWalker.schemaOfInstance(base, input);
    if (byClass === "unregistered") {
      const name = (Object.getPrototypeOf(input) as { constructor: { name: string } }).constructor.name;
      sink.add({
        path,
        reason: "discriminator",
        message: `${name} is not a registered discriminator of ${base.name} (declare it with @Discriminator)`,
        value: input,
      });
      return undefined;
    }
    const keyFromClass = byClass !== undefined && !Object.hasOwn(input, base.discriminatorKey);
    if (keyFromClass) {
      schema = byClass;
    } else if (base.discriminators.size > 0 && Object.hasOwn(input, base.discriminatorKey)) {
      const value = input[base.discriminatorKey];
      const selected = base.root.discriminatorFor(value);
      if (selected === undefined && !(base.discriminator !== undefined && value === base.discriminator.value)) {
        sink.add({
          path: [...path, base.discriminatorKey],
          reason: "discriminator",
          message: `${JSON.stringify(value)} is not a discriminator value of ${base.root.name} (known: ${[...base.discriminators.keys()].join(", ")})`,
          value,
        });
        return undefined;
      }
      if (selected !== undefined) {
        if (selected !== base && !SchemaWalker.isSameOrDescendant(selected, base)) {
          sink.add({
            path: [...path, base.discriminatorKey],
            reason: "discriminator",
            message: `${JSON.stringify(value)} selects ${selected.name}, which is not a ${base.name}`,
            value,
          });
          return undefined;
        }
        schema = selected;
      }
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      if (schema.field(key) === undefined) {
        sink.add({
          path: [...path, key],
          reason: "unknown-key",
          message: `not a field of ${schema.name}`,
          value: input[key],
        });
      }
    }
    for (const node of schema.fields) {
      const present = Object.hasOwn(input, node.key);
      const fieldPath = [...path, node.key];
      if (!present) {
        if (
          (node.service === "discriminatorKey" || (keyFromClass && node.key === schema.discriminatorKey)) &&
          schema.discriminator !== undefined
        ) {
          out[node.key] = schema.discriminator.value;
        } else if (options.defaults && node.defaultValue !== undefined) {
          out[node.key] = SchemaWalker.validated(node, node.defaultValue(), fieldPath, options, sink);
        } else if (options.validate && node.required) {
          sink.add({ path: fieldPath, reason: "required", message: "the field is required", value: undefined });
        }
        continue;
      }
      out[node.key] = SchemaWalker.field(node, input[node.key], fieldPath, options, sink);
    }
    return out;
  }

  /**
   * Whether a schema is the base or descends from it.
   *
   * @param schema - The schema to test.
   * @param base - The base schema.
   * @returns `true` when the schema's class is the base class or a subclass of it.
   */
  private static isSameOrDescendant(schema: CompiledSchema, base: CompiledSchema): boolean {
    return schema.target === base.target || schema.target.prototype instanceof base.target;
  }

  /**
   * A value that is an INSTANCE of a class of the base's hierarchy selects its schema by class (a field typed
   * `(Circle | Square)[]` receives `new Circle()` without the key).
   *
   * @param base - The schema of the node.
   * @param input - The input object.
   * @returns The schema; `undefined` for a plain object or the base class itself; `"unregistered"` for a
   * subclass that is not a registered discriminator of the base (it would silently lose its own fields).
   */
  private static schemaOfInstance(
    base: CompiledSchema,
    input: Readonly<Record<string, unknown>>,
  ): CompiledSchema | "unregistered" | undefined {
    const ctor = (Object.getPrototypeOf(input) as { constructor?: unknown } | null)?.constructor;
    if (typeof ctor !== "function" || ctor === Object || ctor === base.target) return undefined;
    if (!(ctor.prototype instanceof base.target)) return undefined;
    for (const schema of base.discriminators.values()) {
      if (schema.target === ctor && SchemaWalker.isSameOrDescendant(schema, base)) return schema;
    }
    return "unregistered";
  }

  /**
   * Casts and validates one field value, handling `null`.
   *
   * @param node - The field node.
   * @param input - The input value.
   * @param path - The field's path.
   * @param options - What the walk does besides casting.
   * @param sink - Collects the issues.
   * @returns The cast value.
   */
  private static field(node: PathNode, input: unknown, path: Segments, options: WalkOptions, sink: IssueSink): unknown {
    if (input === null) {
      if (!node.nullable) {
        sink.add(SchemaWalker.castIssue(path, input, SchemaWalker.expected(node), ""));
        return undefined;
      }
      /* A nullable field takes `null`; `required` on it asks only for the key. */
      return null;
    }
    return SchemaWalker.validated(node, SchemaWalker.value(node, input, path, options, sink), path, options, sink);
  }

  /**
   * Casts one non-null value by node kind.
   *
   * @param node - The node.
   * @param input - The input value.
   * @param path - The value's path.
   * @param options - What the walk does besides casting.
   * @param sink - Collects the issues.
   * @returns The cast value; `undefined` when it could not be cast.
   */
  private static value(node: PathNode, input: unknown, path: Segments, options: WalkOptions, sink: IssueSink): unknown {
    if (input === undefined) {
      sink.add(SchemaWalker.castIssue(path, input, SchemaWalker.expected(node), ""));
      return undefined;
    }
    switch (node.kind) {
      case "array":
        return SchemaWalker.setter(node, SchemaWalker.array(node.element, input, path, options, sink), path, sink);
      case "map":
        return SchemaWalker.setter(node, SchemaWalker.map(node.value, input, path, options, sink), path, sink);
      case "subdocument":
      case "nested":
        return SchemaWalker.setter(node, SchemaWalker.document(node.schema, input, path, options, sink), path, sink);
      default:
        try {
          return node.caster.cast(input, path.join("."));
        } catch (error) {
          if (!(error instanceof CastError)) throw error;
          sink.add({ path, reason: "cast", message: error.message, value: input, cause: error });
          return undefined;
        }
    }
  }

  /**
   * Casts an array value.
   *
   * @param element - The element node.
   * @param input - The input value.
   * @param path - The array's path.
   * @param options - What the walk does besides casting.
   * @param sink - Collects the issues.
   * @returns The cast array; `undefined` when the input is not an array.
   */
  private static array(
    element: PathNode,
    input: unknown,
    path: Segments,
    options: WalkOptions,
    sink: IssueSink,
  ): unknown[] | undefined {
    if (!Array.isArray(input)) {
      sink.add(SchemaWalker.castIssue(path, input, `Array<${SchemaWalker.expected(element)}>`, "an array"));
      return undefined;
    }
    const out: unknown[] = [];
    for (let index = 0; index < input.length; index++) {
      const itemPath = [...path, index];
      if (!(index in input)) {
        sink.add(
          SchemaWalker.castIssue(itemPath, undefined, SchemaWalker.expected(element), "arrays cannot have holes"),
        );
        continue;
      }
      out.push(SchemaWalker.field(element, input[index], itemPath, options, sink));
    }
    return out;
  }

  /**
   * Casts a Map value.
   *
   * @param valueNode - The node of the Map's values.
   * @param input - The input value: a Map or a literal object of entries.
   * @param path - The Map's path.
   * @param options - What the walk does besides casting.
   * @param sink - Collects the issues.
   * @returns The cast Map; `undefined` when the input is neither.
   */
  private static map(
    valueNode: PathNode,
    input: unknown,
    path: Segments,
    options: WalkOptions,
    sink: IssueSink,
  ): Map<string, unknown> | undefined {
    let entries: Iterable<readonly [unknown, unknown]>;
    if (BsonGuards.isMap(input)) entries = input;
    else if (BsonGuards.isPojo(input) && Object.getOwnPropertySymbols(input).length === 0)
      entries = Object.entries(input);
    else {
      sink.add(
        SchemaWalker.castIssue(
          path,
          input,
          `Map<string, ${SchemaWalker.expected(valueNode)}>`,
          "a Map or a literal object of entries",
        ),
      );
      return undefined;
    }
    const out = new Map<string, unknown>();
    for (const [key, item] of entries) {
      const keyPath = [...path, String(key)];
      const problem = SchemaWalker.mapKeyProblem(key);
      if (problem !== undefined) {
        sink.add({
          path: keyPath,
          reason: "cast",
          message: problem,
          value: key,
          cause: new CastError({
            path: keyPath.join("."),
            value: key,
            expected: "Map key",
            reason: "key",
            detail: problem,
          }),
        });
        continue;
      }
      out.set(key as string, SchemaWalker.field(valueNode, item, keyPath, options, sink));
    }
    return out;
  }

  /**
   * Checks a Map key by the same rules as `MapCaster`: strings only, no `.` or leading `$`.
   *
   * @param key - The key.
   * @returns The problem; `undefined` when the key is valid.
   */
  private static mapKeyProblem(key: unknown): string | undefined {
    if (typeof key !== "string") return "Map keys must be strings";
    if (key === "") return "an empty key cannot be addressed by a path";
    if (key.includes(".")) return `a key cannot contain "." (it would be read as a path)`;
    if (key.startsWith("$")) return `a key cannot start with "$" (reserved for operators)`;
    if (key === "__proto__") return `"__proto__" is never stored`;
    return undefined;
  }

  /**
   * Applies the `set` option of a container node (scalars apply it inside their caster).
   *
   * @param node - The container node.
   * @param value - The cast container.
   * @param path - The container's path.
   * @param sink - Collects the issues.
   * @returns The value after `set`; `undefined` when `set` threw.
   */
  private static setter(node: PathNode, value: unknown, path: Segments, sink: IssueSink): unknown {
    const set = node.options.set;
    if (value === undefined || typeof set !== "function") return value;
    try {
      return (set as (v: unknown) => unknown)(value);
    } catch (error) {
      sink.add({
        path,
        reason: "validator",
        message: `the "set" function threw: ${String(error)}`,
        value,
        cause: error,
      });
      return undefined;
    }
  }

  /**
   * Runs the validators of a node on a non-null value.
   *
   * @param node - The node.
   * @param value - The cast value.
   * @param path - The value's path.
   * @param options - What the walk does besides casting.
   * @param sink - Collects the issues.
   * @returns The value.
   */
  private static validated(
    node: PathNode,
    value: unknown,
    path: Segments,
    options: WalkOptions,
    sink: IssueSink,
  ): unknown {
    if (!options.validate || value === undefined || value === null) return value;
    for (const validator of node.validators) SchemaWalker.runValidator(validator, value, path, sink);
    return value;
  }

  /**
   * Runs one validator; an async one is added to the sink's pending list.
   *
   * @param validator - The validator.
   * @param value - The value to check.
   * @param path - The value's path.
   * @param sink - Collects the issues.
   */
  private static runValidator(validator: NodeValidator, value: unknown, path: Segments, sink: IssueSink): void {
    const report = (result: unknown, cause?: unknown): void => {
      if (result === true) return;
      const message =
        typeof result === "string" ? result : `the validator returned ${String(result)} (expected true or a message)`;
      sink.add({ path, reason: validator.reason, message, value, ...(cause === undefined ? {} : { cause }) });
    };
    let result: unknown;
    try {
      result = validator.check(value as never, { kind: "document", operation: "validate", path: path.join(".") });
    } catch (error) {
      report(`the validator threw: ${error instanceof Error ? error.message : String(error)}`, error);
      return;
    }
    if (result instanceof Promise) {
      sink.pending.push(
        result.then(
          (settled: unknown) => report(settled),
          (error: unknown) =>
            report(`the validator rejected: ${error instanceof Error ? error.message : String(error)}`, error),
        ),
      );
      return;
    }
    report(result);
  }

  /**
   * The expected type of a node, for messages.
   *
   * @param node - The node.
   * @returns The type description.
   */
  private static expected(node: PathNode): string {
    switch (node.kind) {
      case "scalar":
      case "union":
        return node.caster.expected;
      case "array":
        return `Array<${SchemaWalker.expected(node.element)}>`;
      case "map":
        return `Map<string, ${SchemaWalker.expected(node.value)}>`;
      default:
        return node.schema.name;
    }
  }

  /**
   * A cast issue for a value of the wrong kind.
   *
   * @param path - The value's path.
   * @param value - The value.
   * @param expected - The expected type.
   * @param accepted - What is accepted, for the detail.
   * @returns The issue.
   */
  private static castIssue(path: Segments, value: unknown, expected: string, accepted: string): SchemaIssue {
    const reason = value === undefined ? "undefined" : value === null ? "null" : "type";
    const detail =
      value === undefined
        ? "undefined is never a value; omit the field instead"
        : value === null
          ? "null is not allowed on a path that is not nullable"
          : `expected ${accepted}`;
    const cause = new CastError({ path: path.join("."), value, expected, reason, detail });
    return { path, reason: "cast", message: cause.message, value, cause };
  }
}
