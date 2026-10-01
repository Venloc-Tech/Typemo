import { BsonGuards } from "../../bson/bson-guards.ts";
import { type SchemaIssue, ValidationError } from "../../errors/validation-error.ts";
import { SensitiveMask } from "../../policies/sensitive-mask.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { NodeValidator, PathNode } from "../../schema/compiler/path-node.ts";
import type { ValidationContext } from "../../schema/options/prop-options.ts";

/*
 * Validation of CAST values: the validators of every node (`enum`, `min`, `max`,
 * `minLength`, `maxLength`, `match`, user `validate`) and `required`, collecting every issue (not only the
 * first) into one `ValidationError`. Nothing is cast again (a user `set` must run once, Mongoose H508);
 * `SchemaWalker.validateDocument` casts and validates raw input in one walk, this walks values the cast
 * step already produced. Async validators are awaited together.
 */

/**
 * A path as segments: property names, and indexes for array elements.
 *
 * @example
 * const path: Segments = ["items", 0, "qty"];
 */
type Segments = readonly (string | number)[];

/**
 * Where a value is validated: builds the context handed to each validator.
 *
 * @example
 * const context: ContextOf = (path) => ({ kind: "document", operation: "insertOne", path: path.join(".") });
 */
export type ContextOf = (path: Segments) => ValidationContext;

/**
 * Collects the issues of one validation.
 *
 * @example
 * const sink = new IssueCollector();
 * ValueValidator.document(schema, document, [], context, sink);
 * await sink.finish(); // throws a ValidationError with every issue
 */
export class IssueCollector {
  /** The issues found so far. */
  readonly issues: SchemaIssue[] = [];
  /** The async validators still running. */
  readonly pending: Promise<void>[] = [];

  /**
   * Waits for the async validators and throws a `ValidationError` when anything failed.
   *
   * @param schema - When given, the issues come in the order of its fields (see `IssueCollector.inSchemaOrder`);
   *   otherwise sorted by path.
   * @throws {ValidationError} With every issue, when any validator failed.
   */
  async finish(schema?: CompiledSchema): Promise<void> {
    await Promise.all(this.pending);
    if (this.issues.length > 0) {
      const sorted =
        schema === undefined
          ? [...this.issues].sort((a, b) => a.path.join(".").localeCompare(b.path.join(".")))
          : IssueCollector.inSchemaOrder(schema, this.issues);
      throw new ValidationError(sorted);
    }
  }

  /**
   * The issues in the order of the schema fields, whatever order the validators (sync or async) finished in:
   * top-level fields in declaration order, inside a subdocument its fields in declaration order, array elements
   * by index. Issues on one path, and Map entries, keep the order they were found in (the sort is stable).
   *
   * @param schema - The schema the issue paths start at.
   * @param issues - The issues to order.
   * @returns A new, ordered array.
   */
  static inSchemaOrder(schema: CompiledSchema, issues: readonly SchemaIssue[]): SchemaIssue[] {
    const rankOf = (path: readonly (string | number)[]): number[] => {
      const rank: number[] = [];
      let fields: readonly PathNode[] | undefined = schema.fields;
      let node: PathNode | undefined;
      for (const segment of path) {
        if (typeof segment === "number") {
          rank.push(segment);
          node = node?.kind === "array" ? node.element : undefined;
        } else if (node?.kind === "map") {
          rank.push(0);
          node = node.value;
        } else {
          const index = fields?.findIndex((field) => field.key === segment) ?? -1;
          node = index < 0 ? undefined : fields?.[index];
          rank.push(index < 0 ? Number.MAX_SAFE_INTEGER : index);
        }
        fields = node?.kind === "subdocument" || node?.kind === "nested" ? node.schema.fields : undefined;
      }
      return rank;
    };
    const ranked = issues.map((issue) => ({ issue, rank: rankOf(issue.path) }));
    ranked.sort((a, b) => {
      const length = Math.min(a.rank.length, b.rank.length);
      for (let i = 0; i < length; i++) {
        const diff = (a.rank[i] ?? 0) - (b.rank[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return a.rank.length - b.rank.length;
    });
    return ranked.map((entry) => entry.issue);
  }
}

/**
 * Validates cast values by their nodes.
 *
 * @example
 * const sink = new IssueCollector();
 * ValueValidator.value(node, "abc", ["name"], context, sink);
 */
export class ValueValidator {
  /**
   * A whole document of `base` (the discriminator schema of its key): `required` and every value.
   *
   * @param base - The compiled schema of the document; a discriminator's schema is picked by the document's key.
   * @param document - The cast document.
   * @param path - The path of the document, for issues.
   * @param context - Builds the validator context of a path.
   * @param sink - Receives the issues.
   * @param replacement - Whether the document is a replacement (its `_id` may be absent).
   */
  static document(
    base: CompiledSchema,
    document: Readonly<Record<string, unknown>>,
    path: Segments,
    context: ContextOf,
    sink: IssueCollector,
    replacement = false,
  ): void {
    const schema = ValueValidator.schemaOf(base, document);
    for (const node of schema.fields) {
      const at = [...path, node.key];
      if (!Object.hasOwn(document, node.key)) {
        /* A replacement keeps the stored `_id`: its absence there is not a missing required field. */
        if (node.required && !(replacement && node.service === "id"))
          sink.issues.push({ path: at, reason: "required", message: "the field is required", value: undefined });
        continue;
      }
      ValueValidator.value(node, document[node.key], at, context, sink);
    }
  }

  /**
   * One value of `node`: `null` against `required` (a `nullable` field takes `null` even when `required`), then
   * the validators, then the embedded values.
   *
   * @param node - The path node.
   * @param value - The cast value.
   * @param path - The path of the value, for issues.
   * @param context - Builds the validator context of a path.
   * @param sink - Receives the issues.
   */
  static value(node: PathNode, value: unknown, path: Segments, context: ContextOf, sink: IssueCollector): void {
    if (value === null || value === undefined) {
      /* `required` + `nullable`: the key must be there, `null` is a value. */
      if (node.required && !(value === null && node.nullable)) {
        sink.issues.push({
          path,
          reason: "required",
          message: "the field is required (null is not a value here)",
          value,
        });
      }
      return;
    }
    for (const validator of node.validators) ValueValidator.run(validator, value, path, context, sink, node);
    switch (node.kind) {
      case "array":
        if (Array.isArray(value)) {
          value.forEach((item: unknown, index) => {
            if (item !== null) ValueValidator.value(node.element, item, [...path, index], context, sink);
          });
        }
        return;
      case "map":
        if (BsonGuards.isMap(value)) {
          for (const [key, item] of value) {
            if (item !== null) ValueValidator.value(node.value, item, [...path, String(key)], context, sink);
          }
        }
        return;
      case "subdocument":
      case "nested":
        if (BsonGuards.isPlainObject(value)) ValueValidator.document(node.schema, value, path, context, sink);
        return;
      default:
        return;
    }
  }

  /**
   * Runs the validators of `node` on `value` only (no embedded values, no `required`).
   *
   * @param node - The path node.
   * @param value - The cast value.
   * @param path - The path of the value, for issues.
   * @param context - Builds the validator context of a path.
   * @param sink - Receives the issues.
   */
  static own(node: PathNode, value: unknown, path: Segments, context: ContextOf, sink: IssueCollector): void {
    if (value === null || value === undefined) return;
    for (const validator of node.validators) ValueValidator.run(validator, value, path, context, sink, node);
  }

  /**
   * Runs one validator and reports a failure into the sink. A synchronous throw and an async rejection are
   * failures too. On a sensitive field the value is masked in the issue and in the message.
   *
   * @param validator - The validator.
   * @param value - The value to check.
   * @param path - The path of the value, for issues.
   * @param context - Builds the validator context of a path.
   * @param sink - Receives the issues and the pending async validators.
   * @param node - The node of the value: its `sensitive` option masks the value in the issue.
   */
  private static run(
    validator: NodeValidator,
    value: unknown,
    path: Segments,
    context: ContextOf,
    sink: IssueCollector,
    node: PathNode,
  ): void {
    const sensitive = node.options.sensitive;
    /* An async validator reports after the step's synchronous scope ended, so its sink is kept. */
    const masks = sensitive !== undefined && sensitive !== "show" ? SensitiveMask.currentSink() : undefined;
    const report = (result: unknown, cause?: unknown): void => {
      if (result === true) return;
      const text =
        typeof result === "string" ? result : `the validator returned ${String(result)} (expected true or a message)`;
      if (sensitive === undefined || sensitive === "show") {
        sink.issues.push({
          path,
          reason: validator.reason,
          message: text,
          value,
          ...(cause === undefined ? {} : { cause }),
        });
        return;
      }
      /* A sensitive field: the value is masked in the issue and wherever the message repeats it. */
      const shown = SensitiveMask.forError(sensitive, value, path.join("."), masks, node);
      const raw =
        typeof value === "string" || typeof value === "number" || typeof value === "bigint" ? String(value) : "";
      const message = raw === "" ? text : text.split(raw).join(String(shown));
      sink.issues.push({
        path,
        reason: validator.reason,
        message,
        value: shown,
        ...(cause === undefined ? {} : { cause }),
      });
    };
    let result: unknown;
    try {
      result = validator.check(value as never, context(path));
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
   * The schema that describes a document: the discriminator's schema when the document names one.
   *
   * @param base - The base schema.
   * @param document - The document.
   * @returns The discriminator's schema, or `base`.
   */
  private static schemaOf(base: CompiledSchema, document: Readonly<Record<string, unknown>>): CompiledSchema {
    if (base.discriminators.size === 0 || !Object.hasOwn(document, base.discriminatorKey)) return base;
    return base.root.discriminatorFor(document[base.discriminatorKey]) ?? base;
  }
}
