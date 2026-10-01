/*
 * zod (the latest version, pinned in this package's devDependencies and in VERSIONS.md) is used ONLY
 * by the Standard Schema compatibility tests of `.parse(schema)` and of a model's `~standard`. The core has no
 * dependency on it: it sees any Standard Schema v1 through the spec's interface. `StandardSchemaKit.validate` is
 * a Standard-Schema-aware consumer written against the spec only (like a form library or tRPC would be), so a
 * test can prove that a Typemo model is accepted by such a tool.
 */
import { z } from "zod";

export { z };

/**
 * The part of the Standard Schema v1 interface a consumer reads (https://standardschema.dev).
 *
 * @example
 * ```ts
 * const schema: StandardSchemaLike<unknown, { name: string }> = z.object({ name: z.string() });
 * ```
 */
export interface StandardSchemaLike<Input = unknown, Output = Input> {
  /** The standard properties object. */
  readonly "~standard": {
    /** Spec version. */
    readonly version: 1;
    /** Name of the library that made the schema. */
    readonly vendor: string;
    /** Validates a value, synchronously or asynchronously. */
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly value: Output; readonly issues?: undefined }
      | { readonly issues: readonly { readonly message: string; readonly path?: readonly unknown[] | undefined }[] }
      | Promise<
          | { readonly value: Output; readonly issues?: undefined }
          | { readonly issues: readonly { readonly message: string; readonly path?: readonly unknown[] | undefined }[] }
        >;
    /** Phantom input and output types. */
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/**
 * The output type of a Standard Schema, read the way consumers read it (`StandardSchemaV1.InferOutput`).
 *
 * @example
 * ```ts
 * type Out = InferStandardOutput<typeof schema>;
 * ```
 */
export type InferStandardOutput<S> = S extends StandardSchemaLike<unknown, infer O> ? O : never;

/**
 * The result of {@link StandardSchemaKit.validate}: the value, or the issues as `{ path, message }`.
 *
 * @example
 * ```ts
 * const result: StandardValidation<{ name: string }> = await StandardSchemaKit.validate(schema, input);
 * if (!result.ok) console.log(result.issues);
 * ```
 */
export type StandardValidation<Output> =
  | { readonly ok: true; readonly value: Output }
  | { readonly ok: false; readonly issues: readonly { readonly path: string; readonly message: string }[] };

/** A minimal Standard-Schema-aware consumer (spec-only, no Typemo import). */
export class StandardSchemaKit {
  /**
   * Validates `value` by any Standard Schema v1 (sync or async), paths joined with dots.
   *
   * @param schema - Any Standard Schema v1.
   * @param value - The value to validate.
   * @returns The validated value, or the issues.
   * @throws Error - When the schema is not Standard Schema version 1.
   */
  static async validate<S extends StandardSchemaLike>(
    schema: S,
    value: unknown,
  ): Promise<StandardValidation<InferStandardOutput<S>>> {
    const props = schema["~standard"];
    if (props.version !== 1) throw new Error("not a Standard Schema v1");
    const result = await props.validate(value);
    if (result.issues === undefined) return { ok: true, value: result.value as InferStandardOutput<S> };
    return {
      ok: false,
      issues: result.issues.map((issue) => ({
        message: issue.message,
        path: (issue.path ?? [])
          .map((segment) =>
            typeof segment === "object" && segment !== null && "key" in segment
              ? String((segment as { readonly key: PropertyKey }).key)
              : String(segment),
          )
          .join("."),
      })),
    };
  }
}
