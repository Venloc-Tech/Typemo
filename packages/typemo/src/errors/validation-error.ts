import { TypemoError } from "./typemo-error.ts";

/**
 * Why a value failed validation against a schema. A closed list:
 * - `cast` — the value could not be cast (the `CastError` is the issue's `cause`); only the input validation that
 *   lists every problem (`Model.validate(input)`, Standard Schema) reports it as an issue — documents and writes
 *   throw the `CastError` itself;
 * - `required` — a required field is absent or `null`;
 * - `unknown-key` — a key the schema does not declare (strict mode);
 * - `enum`, `min`, `max`, `minLength`, `maxLength`, `match` — the built-in validators of the options;
 * - `validator` — a user validator (`validate`) returned a message or threw;
 * - `discriminator` — the discriminator value names no known class;
 * - `schema` — a foreign Standard Schema passed to `.parse(schema)` reported the issue (the issue's `cause` is
 *   the original Standard Schema issue).
 *
 * @example
 * ```ts
 * const reason: ValidationReason = "required";
 * ```
 */
export type ValidationReason =
  | "cast"
  | "required"
  | "unknown-key"
  | "enum"
  | "min"
  | "max"
  | "minLength"
  | "maxLength"
  | "match"
  | "validator"
  | "discriminator"
  | "schema";

/**
 * One validation failure. `path` is split into segments (array indexes are numbers).
 *
 * @example
 * ```ts
 * const issue: SchemaIssue = { path: ["items", 3, "price"], reason: "min", message: "below 0", value: -1 };
 * ```
 */
export interface SchemaIssue {
  /** Path segments of the failing value. */
  readonly path: readonly (string | number)[];
  /** Machine-readable reason. */
  readonly reason: ValidationReason;
  /** Human-readable message. */
  readonly message: string;
  /** The failing value, as given. */
  readonly value: unknown;
  /** The underlying error or foreign issue, when there is one. */
  readonly cause?: unknown;
}

/**
 * A document (or input) broke the schema: every issue is listed, not only the first (validation
 * collects). A value that cannot be cast is a `CastError` instead, thrown before the validation, so the
 * constraints of that field are not checked. Values are kept on the issues but left out of `toJSON` (they may be
 * large or sensitive), as in `CastError`.
 *
 * @example
 * ```ts
 * try {
 *   await user.$validate();
 * } catch (error) {
 *   if (error instanceof ValidationError) console.log(error.errors["age"]); // the issues of `age`, in order
 * }
 * ```
 */
export class ValidationError extends TypemoError {
  /** Every issue found, in order. */
  readonly issues: readonly SchemaIssue[];

  /**
   * @param issues - The issues found.
   * @param options - Optional `cause`.
   */
  constructor(issues: readonly SchemaIssue[], options: { readonly cause?: unknown } = {}) {
    super(ValidationError.format(issues), options);
    this.issues = Object.freeze([...issues]);
  }

  static {
    Object.defineProperty(ValidationError.prototype, "name", {
      value: "ValidationError",
      writable: true,
      configurable: true,
    });
  }

  /**
   * Builds the error message.
   *
   * @param issues - The issues to list.
   * @returns The message, e.g. `Validation failed: "age": below the minimum 0 [min]; "name": required [required]`.
   */
  static format(issues: readonly SchemaIssue[]): string {
    return `Validation failed: ${issues.map((issue) => `"${issue.path.join(".")}": ${issue.message} [${issue.reason}]`).join("; ")}`;
  }

  /** The issues grouped by dotted path (`items.3.price`), each group in order. */
  get errors(): Readonly<Record<string, readonly SchemaIssue[]>> {
    const byPath: Record<string, SchemaIssue[]> = Object.create(null) as Record<string, SchemaIssue[]>;
    for (const issue of this.issues) {
      const path = issue.path.join(".");
      byPath[path] = [...(byPath[path] ?? []), issue];
    }
    return Object.freeze(byPath);
  }

  /**
   * Plain data for logs and JSON responses (issue values are left out: they may be large or sensitive).
   *
   * @returns Name, message and the issues without values.
   */
  toJSON(): { name: string; message: string; issues: { path: string; reason: ValidationReason; message: string }[] } {
    return {
      name: this.name,
      message: this.message,
      issues: this.issues.map((issue) => ({
        path: issue.path.join("."),
        reason: issue.reason,
        message: issue.message,
      })),
    };
  }
}
