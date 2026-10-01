import { QueryError } from "../../errors/query-error.ts";
import { type SchemaIssue, ValidationError } from "../../errors/validation-error.ts";
import { type SchemaSource, SchemaSources } from "../compiler/schema-source.ts";
import { SchemaWalker } from "../compiler/schema-walker.ts";

/*
 * Standard Schema v1 (https://standardschema.dev). The spec asks libraries to copy its interface rather than
 * depend on a package, so no `@standard-schema/spec` dependency is added. Two directions:
 * - OUT: a model IS a Standard Schema (`Users["~standard"]`): input and output typed (`CreateInput<T>` →
 *   `DataFields<T>`, the same value `model.validate` returns), so any Standard-Schema-aware tool (forms, tRPC,
 *   …) validates with the model's casters and validators;
 * - IN: `.parse(schema)` of a lean query, an aggregation and their cursors validates every row with ANY Standard
 *   Schema (zod, valibot, arktype — no dependency in the core): the issues become a Typemo `ValidationError`.
 * Foreign schemas inside `@Prop` are NOT accepted, and no plain JSON Schema (draft 2020-12) is exported.
 */

/**
 * One issue in the Standard Schema format.
 *
 * @example
 * ```ts
 * const issue: StandardSchemaIssue = { message: "the field is required", path: ["name"] };
 * ```
 */
export interface StandardSchemaIssue {
  /** What is wrong. */
  readonly message: string;
  /** Where: a list of keys or key objects. */
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}

/**
 * The result of `~standard.validate`.
 *
 * @example
 * ```ts
 * const ok: StandardSchemaResult<{ name: string }> = { value: { name: "Ada" } };
 * const bad: StandardSchemaResult<{ name: string }> = { issues: [{ message: "required", path: ["name"] }] };
 * ```
 */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

/**
 * The `~standard` property.
 *
 * @example
 * ```ts
 * const props: StandardSchemaProps<unknown, string> = {
 *   version: 1,
 *   vendor: "mine",
 *   validate: (value) => ({ value: String(value) }),
 * };
 * ```
 */
export interface StandardSchemaProps<Input, Output> {
  /** The spec version. */
  readonly version: 1;
  /** The library that provides the validator. */
  readonly vendor: string;
  /**
   * Validates a value.
   *
   * @param value - The value to validate.
   * @returns The output value or the issues, possibly as a promise.
   */
  readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  /** Type-only carrier of the input and output types. */
  readonly types?: { readonly input: Input; readonly output: Output } | undefined;
}

/**
 * A Standard Schema v1 validator.
 *
 * @example
 * ```ts
 * const validator: StandardSchemaV1<CreateInput<User>, DataFields<User>> = Users; // a model is a validator
 * const result = await validator["~standard"].validate({ name: "Ada" });
 * ```
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaProps<Input, Output>;
}

/**
 * Any Standard Schema v1 validator (what `.parse(schema)` accepts).
 *
 * @example
 * ```ts
 * const schema: AnyStandardSchema = Users; // or a validator of any Standard Schema library
 * ```
 */
export interface AnyStandardSchema {
  /** The Standard Schema properties. */
  readonly "~standard": {
    /** The spec version. */
    readonly version: 1;
    /** The library that provides the validator. */
    readonly vendor: string;
    /** Validates a value; the result is checked at run time. */
    readonly validate: (value: unknown) => unknown;
    /** Type-only carrier of the input and output types. */
    readonly types?: { readonly input: unknown; readonly output: unknown } | undefined;
  };
}

/**
 * The input type of a Standard Schema (`StandardSchemaV1.InferInput` of the spec).
 *
 * @example
 * ```ts
 * type In = StandardSchemaInput<StandardSchemaV1<{ a: string }, { b: number }>>; // { a: string }
 * ```
 */
export type StandardSchemaInput<S> = S extends { readonly "~standard": { readonly types?: infer T } }
  ? NonNullable<T> extends { readonly input: infer I }
    ? I
    : unknown
  : unknown;

/**
 * The output type of a Standard Schema (`StandardSchemaV1.InferOutput` of the spec): what `.parse(schema)`
 * gives per row.
 *
 * @example
 * ```ts
 * type Out = StandardSchemaOutput<StandardSchemaV1<{ a: string }, { b: number }>>; // { b: number }
 * ```
 */
export type StandardSchemaOutput<S> = S extends { readonly "~standard": { readonly types?: infer T } }
  ? NonNullable<T> extends { readonly output: infer O }
    ? O
    : unknown
  : unknown;

/**
 * The result of a foreign validator, checked to be an object.
 *
 * @example
 * ```ts
 * const settled: Settled = { issues: [{ message: "required" }] };
 * ```
 */
type Settled = { readonly value: unknown; readonly issues?: undefined } | { readonly issues: readonly unknown[] };

/**
 * Whether a value is thenable.
 *
 * @param value - The value to test.
 * @returns `true` for a promise or thenable.
 */
const isPromise = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";

/**
 * The Standard Schema adapter of a compiled schema, and the validation of rows by a foreign Standard Schema.
 * `of(schema)`: `validate(input)` casts with the strict casters, fills defaults, runs `required` and every
 * validator (async ones too — then the result is a Promise) and returns the plain cast document or all issues
 * (paths as segments, array indexes as numbers). Service fields filled by the core on save (timestamps, version)
 * are not required here. The model exposes this as its `~standard` (typed by the entity).
 */
export class StandardSchema {
  /** The vendor name of Typemo's own validators. */
  static readonly vendor = "typemo";

  /**
   * A Standard Schema validator for the input of documents of this schema (the model types `Input`/`Output`).
   *
   * @param source - The model (`connection.model(Entity)`) or its `schema`.
   * @returns The validator.
   * @throws {ConfigurationError} When `source` is neither a model nor the schema of one.
   */
  static of<Input = unknown, Output = Record<string, unknown>>(source: SchemaSource): StandardSchemaV1<Input, Output> {
    const schema = SchemaSources.resolve(source, "StandardSchema.of");
    return {
      "~standard": Object.freeze({
        version: 1 as const,
        vendor: StandardSchema.vendor,
        validate: (value: unknown): StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>> => {
          const result = SchemaWalker.validateDocument(schema, value, { validate: true, defaults: true });
          const finish = (): StandardSchemaResult<Output> =>
            result.issues.length === 0
              ? { value: result.value as Output }
              : { issues: result.issues.map(StandardSchema.issue) };
          return result.pending.length === 0 ? finish() : Promise.all(result.pending).then(finish);
        },
      }),
    };
  }

  /**
   * A Typemo issue in the Standard Schema format.
   *
   * @param issue - The Typemo issue.
   * @returns The Standard Schema issue.
   */
  static issue(issue: SchemaIssue): StandardSchemaIssue {
    return {
      message: issue.message,
      path: [...issue.path],
    };
  }

  /**
   * Whether a value is a Standard Schema v1 validator (the runtime check of `.parse(schema)`'s argument).
   *
   * @param value - The value to test.
   * @returns `true` for a Standard Schema v1 validator.
   */
  static isSchema(value: unknown): value is AnyStandardSchema {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
    const props = (value as { readonly "~standard"?: unknown })["~standard"];
    return (
      typeof props === "object" &&
      props !== null &&
      (props as { readonly version?: unknown }).version === 1 &&
      typeof (props as { readonly validate?: unknown }).validate === "function"
    );
  }

  /**
   * Checks the argument of `.parse(schema)`.
   *
   * @param schema - The argument.
   * @param where - The call, for the message.
   * @returns The argument as a Standard Schema.
   * @throws {QueryError} When the argument is not a Standard Schema v1 validator.
   */
  static require(schema: unknown, where: string): AnyStandardSchema {
    if (!StandardSchema.isSchema(schema)) {
      throw new QueryError(
        `${where}: a Standard Schema v1 validator (an object with "~standard": { version: 1, validate })`,
      );
    }
    return schema;
  }

  /**
   * Validates rows by `schema` (`.parse`): the output values, or ONE `ValidationError` with every issue of every
   * row — the path starts with the row's index (`row` present: a list or a cursor), reason `"schema"`. Synchronous
   * schemas stay synchronous (no promise per row); async ones are awaited together.
   *
   * @param schema - The Standard Schema to validate with.
   * @param rows - The rows to validate.
   * @param indexed - Whether issue paths start with the row's index.
   * @param offset - The index of the first row, added to the row index in paths.
   * @returns The output values, as a promise when any validation is async.
   * @throws {ValidationError} With every issue of every row.
   * @throws {QueryError} When the Standard Schema throws, rejects or returns no result object.
   */
  static validateRows(
    schema: AnyStandardSchema,
    rows: readonly unknown[],
    indexed: boolean,
    offset = 0,
  ): unknown[] | Promise<unknown[]> {
    const results = rows.map((row) => StandardSchema.call(schema, row));
    const finish = (settled: readonly Settled[]): unknown[] => {
      const issues: SchemaIssue[] = [];
      const values = settled.map((result, index) => {
        if (result.issues !== undefined) {
          for (const issue of result.issues) {
            issues.push(StandardSchema.toIssue(issue, rows[index], indexed ? offset + index : undefined));
          }
        }
        return result.issues === undefined ? result.value : undefined;
      });
      if (issues.length > 0) throw new ValidationError(issues);
      return values;
    };
    if (!results.some(isPromise)) return finish(results as Settled[]);
    return Promise.all(results).then(finish);
  }

  /**
   * Runs the foreign validator on a row and checks its result.
   *
   * @param schema - The Standard Schema.
   * @param row - The row to validate.
   * @returns The settled result, as a promise when the validator is async.
   * @throws {QueryError} When the validator throws, rejects or returns no result object.
   */
  private static call(schema: AnyStandardSchema, row: unknown): Settled | Promise<Settled> {
    let result: unknown;
    try {
      result = schema["~standard"].validate(row);
    } catch (error) {
      throw new QueryError(
        `parse: the Standard Schema (${schema["~standard"].vendor}) threw instead of reporting issues`,
        {
          cause: error,
        },
      );
    }
    const settle = (value: unknown): Settled => {
      if (typeof value !== "object" || value === null) {
        throw new QueryError(`parse: the Standard Schema (${schema["~standard"].vendor}) returned no result object`);
      }
      return value as Settled;
    };
    return isPromise(result)
      ? Promise.resolve(result).then(settle, (error: unknown) => {
          throw new QueryError(
            `parse: the Standard Schema (${schema["~standard"].vendor}) rejected instead of reporting issues`,
            {
              cause: error,
            },
          );
        })
      : settle(result);
  }

  /**
   * A Standard Schema issue as a Typemo `SchemaIssue` (the row's index first, then the issue's path).
   *
   * @param issue - The foreign issue.
   * @param row - The row the issue belongs to.
   * @param index - The row's index, or `undefined` when paths are not indexed.
   * @returns The Typemo issue.
   */
  private static toIssue(issue: unknown, row: unknown, index: number | undefined): SchemaIssue {
    const source = (typeof issue === "object" && issue !== null ? issue : {}) as StandardSchemaIssue;
    const segments = (source.path ?? []).map((segment): string | number => {
      const key = typeof segment === "object" && segment !== null ? segment.key : segment;
      return typeof key === "number" ? key : String(key);
    });
    let value: unknown = row;
    for (const segment of segments) {
      value =
        typeof value === "object" && value !== null && Object.hasOwn(value, segment)
          ? (value as Record<string | number, unknown>)[segment]
          : undefined;
    }
    return {
      path: index === undefined ? segments : [index, ...segments],
      reason: "schema",
      message:
        index === undefined
          ? String(source.message ?? "invalid")
          : `row ${index}: ${String(source.message ?? "invalid")}`,
      value,
      cause: issue,
    };
  }
}
