import { BsonGuards } from "../bson/bson-guards.ts";
import { BulkWriteError, type BulkWriteFailure } from "../errors/bulk-write-error.ts";
import { CastError } from "../errors/cast-error.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { DriverError } from "../errors/driver-error.ts";
import { DuplicateKeyError } from "../errors/duplicate-key-error.ts";
import { DuplicateKeyText } from "../errors/duplicate-key-text.ts";
import { ErrorTranslator } from "../errors/error-translator.ts";
import { ServerError } from "../errors/server-error.ts";
import { ServerValidationError } from "../errors/server-validation-error.ts";
import { TypemoError } from "../errors/typemo-error.ts";
import { type SchemaIssue, ValidationError } from "../errors/validation-error.ts";
import type { MaskedError } from "../instrumentation/instrumentation-events.ts";
import type { SubscriberSensitive } from "../instrumentation/instrumentation-hub.ts";
import { SafeRecord } from "../internal/safe-record.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode, ScalarType } from "../schema/compiler/path-node.ts";
import type { SensitiveJson } from "../schema/options/prop-options.ts";

/*
 * The option `sensitive`: how a value looks outside the database. ONE walker for every output point — the audit
 * trail (CODE form, before encode), operation summaries and linked driver commands (DB form, after encode). It is
 * deliberately grammar-free and CONSERVATIVE:
 * - the per-schema mode map (built once, at schema compile) has every marked path by its code path AND its db
 *   path (`dbName`), so both forms match; `$*` (a Map key) matches any segment;
 * - every object is walked: operator keys (`$set`, `$match`, `$lookup`, `$facet`, …) keep the path, field keys
 *   (dotted or not; positional `$`, `$[x]`, indexes dropped) extend it — so `$lookup.pipeline`, `$facet`,
 *   `$set`/`$addFields` literals and `$push.$each` are covered;
 * - the mode of a value: the field's own mark (show/mask/hide/fn, the longest marked prefix wins), else an
 *   unmarked `Hidden` field is "mask", else the OUTPUT DEFAULT (audit trail: "show"; a subscriber: its
 *   `sensitive`);
 * - `"hide"` removes nothing: the whole condition/value of the field collapses into `"[hidden]"` — the key
 *   stays, operators are not shown, so the structure is honest and the hiding is visible as intentional;
 * - `$expr` referencing a marked path is "?" whole ("[hidden]" if a referenced path is hidden), a string
 *   `"$secret"` elsewhere likewise: the expression around it may compare the secret. False positives (a foreign
 *   `$lookup` field named like a secret) are masked: a leak is worse.
 * Errors go through the same walker: `SensitiveMask.error` is the ONE place that turns an error into its outside
 * form — the thrown form (fallback "show": field marks only, `DuplicateKeyError`/`ServerValidationError`;
 * CastError/ValidationError are masked where they are built) and the event form of a subscriber (unmarked values
 * by its `sensitive`). A masked server error gets a masked copy of the driver error as `cause` (Sentry/OTel
 * serialize the cause chain); the raw driver error stays reachable only through the non-enumerable
 * `ErrorTranslator.DRIVER_ERROR` slot (transaction retries read its labels).
 */

/** The replacement of a masked value. */
export const SENSITIVE_MASK = "?";

/** The replacement of a hidden value (`"hide"`): the whole condition of the field, operators included. */
export const SENSITIVE_HIDDEN = "[hidden]";

/** A value that is not of the field's declared type: a mask function never receives it. */
const NOT_DECLARED: unique symbol = Symbol("typemo:not-declared");

/**
 * A resolved field mode: a mask function is kept as the function.
 *
 * @example
 * ```ts
 * const rules: SensitiveRule[] = ["show", "mask", "hide", (value) => String(value).slice(0, 1)];
 * ```
 */
export type SensitiveRule = "show" | "mask" | "hide" | ((value: unknown) => SensitiveJson);

/**
 * One marked path of a schema (code or db form).
 *
 * @example
 * ```ts
 * const path: SensitivePath = { segments: ["profile", "email"], rule: "mask" };
 * ```
 */
export interface SensitivePath {
  /** The path split into segments; positional parts (`$`, `$[x]`, indexes) are dropped, `$*` is any Map key. */
  readonly segments: readonly string[];
  /** How the value at the path looks outside the database. */
  readonly rule: SensitiveRule;
}

/** Raised (as `cause`) when a field's mask function throws. */
export class SensitiveMaskFailure extends TypemoError {
  /** The dotted path of the field whose mask function threw. */
  readonly path: string;
  /**
   * @param path - The dotted path of the field.
   * @param cause - What the mask function threw; `undefined` in event copies, which must not repeat the value.
   */
  constructor(path: string, cause: unknown) {
    super(`the "sensitive" mask of "${path}" threw`, { cause });
    this.path = path;
  }

  static {
    Object.defineProperty(SensitiveMaskFailure.prototype, "name", {
      value: "SensitiveMaskFailure",
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Receives a failed mask function of the event path: the dotted path and a value-free copy of the error.
 *
 * @example
 * ```ts
 * const sink: MaskFailureSink = (path, error) => console.warn(`mask of ${path} failed`, error.message);
 * ```
 */
export type MaskFailureSink = (path: string, error: MaskedError) => void;

/** The sinks in scope (innermost last); pushed by `SensitiveMask.reporting`. */
const SINKS: MaskFailureSink[] = [];

/** How a walk treats a throwing mask function. */
type OnFailure = "throw" | "report";

/** The settings of one walk over a value. */
interface Walk {
  /** The marked paths, longest first. */
  readonly paths: readonly SensitivePath[];
  /** The mode of a value with no mark. */
  readonly fallback: SubscriberSensitive;
  /** What a throwing mask function does: fail the walk or report and show `"?"`. */
  readonly failure: OnFailure;
}

/**
 * Splits a dotted path into segments, dropping positional parts (`$`, `$[x]`, array indexes).
 *
 * @param path - The dotted path.
 * @returns The segments.
 */
const segmentsOf = (path: string): string[] =>
  path.split(".").filter((segment) => segment !== "$" && !segment.startsWith("$[") && !/^\d+$/.test(segment));

/**
 * Whether a value is an operator object (`{ $gt: 1 }`): under "hide" it collapses whole, operators are not shown.
 *
 * @param value - Any value.
 * @returns `true` for a plain object with at least one `$` key.
 */
const isCondition = (value: unknown): boolean =>
  BsonGuards.isPlainObject(value) && Object.keys(value).some((key) => key.startsWith("$"));

/** Keys of a driver command that carry user data in the schema's shape. */
const COMMAND_DATA = new Set(["filter", "query", "q", "u", "update", "documents", "pipeline", "projection", "fields"]);
/** Keys of a driver command holding a whole nested command (`explain`): walked as a command. */
const COMMAND_NESTED = new Set(["explain"]);
/** Keys of a driver command with user data NOT in the schema's shape: never shown. */
const COMMAND_FOREIGN = new Set(["let", "arrayFilters", "key"]);

/** The value part of a server duplicate key message (`… dup key: { email: "a@b.c" }`). */
const DUP_KEY = /dup key: \{[\s\S]*\}\s*$/;

/** The mode map of a schema together with its discriminators, cached per schema. */
const UNION = new WeakMap<CompiledSchema, readonly SensitivePath[]>();
/** The schema of the operation an error left (`originOf`). */
const ORIGIN = new WeakMap<object, CompiledSchema>();

/** Resolution and application of the `sensitive` option. */
export class SensitiveMask {
  /**
   * Build-time check of the option value.
   *
   * @param option - The value given for `sensitive`.
   * @param where - The field description for the message.
   * @throws {ConfigurationError} When it is not `"show"`, `"mask"`, `"hide"` or `{ mask }`.
   */
  static check(option: unknown, where: string): void {
    if (option === undefined || option === "show" || option === "mask" || option === "hide") return;
    if (
      typeof option === "object" &&
      option !== null &&
      typeof (option as { mask?: unknown }).mask === "function" &&
      Object.keys(option).length === 1
    )
      return;
    throw new ConfigurationError(`${where}: option "sensitive" is "show", "mask", "hide" or { mask: (value) => json }`);
  }

  /**
   * Refuses a mask function on a container (subdocument, array of subdocuments): masks are for values.
   *
   * @param node - The schema node with the option.
   * @param where - The field description for the message.
   * @throws {ConfigurationError} When the node is a container with a mask function.
   */
  static checkNode(node: PathNode, where: string): void {
    const option = node.options.sensitive;
    if (typeof option !== "object" || option === null) return;
    const container =
      node.kind === "subdocument" ||
      node.kind === "nested" ||
      (node.kind === "array" && (node.element.kind === "subdocument" || node.element.kind === "nested"));
    if (container) {
      throw new ConfigurationError(
        `${where}: a "sensitive" mask function is for values; on a subdocument use "mask" or "hide"`,
      );
    }
  }

  /**
   * The mode of a node: its mark, else `"mask"` for an unmarked `Hidden` field, else `undefined`. A mask function
   * is wrapped: it is called only with a value of the field's declared type (see {@link SensitiveMask.declared}),
   * any other value (an operand of `$in` on an array field, a string where a number is stored, …) is `"?"`
   * without calling it; a throw becomes `SensitiveMaskFailure`.
   *
   * @param node - The schema node.
   * @returns The rule, or `undefined` when the node is neither marked nor `Hidden`.
   */
  static ruleOf(node: PathNode): SensitiveRule | undefined {
    const option = node.options.sensitive;
    if (option === "show" || option === "mask" || option === "hide") return option;
    if (typeof option === "object" && option !== null) {
      const mask = (option as { readonly mask: (value: unknown) => SensitiveJson }).mask;
      return (value: unknown): SensitiveJson => {
        const declared = SensitiveMask.declared(node, value);
        if (declared === NOT_DECLARED) return SENSITIVE_MASK;
        try {
          return mask(declared);
        } catch (error) {
          throw new SensitiveMaskFailure(node.path, error);
        }
      };
    }
    return node.hidden ? "mask" : undefined;
  }

  /**
   * A value as the field's declared type holds it, or {@link NOT_DECLARED}: what a mask function typed by the field
   * (`(value: V) => json`) may be given. The database form of a value counts as its code form (an `Int32`/`Double`
   * wrapper as its number, a `Long` as its `bigint`, a Map stored as an object as a `Map`); `null` counts only on
   * a nullable field.
   *
   * @param node - The schema node of the value.
   * @param value - The value.
   * @returns The value in its declared form, or `NOT_DECLARED`.
   */
  private static declared(node: PathNode, value: unknown): unknown {
    if (value === null) return node.nullable ? null : NOT_DECLARED;
    if (value === undefined) return NOT_DECLARED;
    switch (node.kind) {
      case "scalar":
        return SensitiveMask.scalar(node.type, value);
      case "union":
        for (const member of node.members) {
          const one = SensitiveMask.scalar(member, value);
          if (one !== NOT_DECLARED) return one;
        }
        return NOT_DECLARED;
      case "array": {
        if (!Array.isArray(value)) return NOT_DECLARED;
        const items = (value as readonly unknown[]).map((item) => SensitiveMask.declared(node.element, item));
        return items.includes(NOT_DECLARED) ? NOT_DECLARED : items;
      }
      case "map": {
        const entries = BsonGuards.isMap(value)
          ? [...value]
          : BsonGuards.isPlainObject(value)
            ? Object.entries(value)
            : undefined;
        if (entries === undefined) return NOT_DECLARED;
        const out = new Map<unknown, unknown>();
        for (const [key, item] of entries) {
          const one = SensitiveMask.declared(node.value, item);
          if (one === NOT_DECLARED) return NOT_DECLARED;
          out.set(key, one);
        }
        return out;
      }
      default:
        /* Subdocuments take no mask function (`checkNode`). */
        return NOT_DECLARED;
    }
  }

  /**
   * A scalar value as its declared BSON type holds it, or {@link NOT_DECLARED}.
   *
   * @param type - The declared scalar type.
   * @param value - A non-null value.
   * @returns The value in its declared form, or `NOT_DECLARED`.
   */
  private static scalar(type: ScalarType, value: unknown): unknown {
    switch (type) {
      case "number":
      case "double":
      case "int32":
        if (BsonGuards.isInt32(value) || BsonGuards.isDouble(value)) return value.value;
        return typeof value === "number" ? value : NOT_DECLARED;
      case "long":
        if (BsonGuards.isLong(value)) return value.toBigInt();
        return typeof value === "bigint" ? value : NOT_DECLARED;
      case "string":
        return typeof value === "string" ? value : NOT_DECLARED;
      case "boolean":
        return typeof value === "boolean" ? value : NOT_DECLARED;
      case "decimal128":
        return BsonGuards.isDecimal128(value) ? value : NOT_DECLARED;
      case "date":
        return BsonGuards.isDate(value) ? value : NOT_DECLARED;
      case "objectId":
        return BsonGuards.isObjectId(value) ? value : NOT_DECLARED;
      case "uuid":
        return BsonGuards.isUuid(value) ? value : NOT_DECLARED;
      case "binary":
        return BsonGuards.isBinary(value) ? value : NOT_DECLARED;
      case "vector":
        return BsonGuards.isVector(value) ? value : NOT_DECLARED;
      case "regex":
        return BsonGuards.isRegExp(value) ? value : NOT_DECLARED;
      case "timestamp":
        return BsonGuards.isTimestamp(value) ? value : NOT_DECLARED;
    }
  }

  /**
   * The mode map of one schema's paths (code and db paths): built once, when the schema is compiled.
   *
   * @param allPaths - Every path node of the schema, by path.
   * @returns The marked paths, most specific first.
   */
  static pathsOf(allPaths: Readonly<Record<string, PathNode>>): readonly SensitivePath[] {
    const out: SensitivePath[] = [];
    for (const node of Object.values(allPaths)) {
      const rule = SensitiveMask.ruleOf(node);
      if (rule === undefined) continue;
      out.push({ segments: segmentsOf(node.path), rule });
      if (node.dbPath !== node.path) out.push({ segments: segmentsOf(node.dbPath), rule });
    }
    /* The longest (most specific) mark wins: a "show" inside a "mask" subdocument, a mark inside a "show" one. */
    out.sort((a, b) => b.segments.length - a.segments.length);
    return Object.freeze(out);
  }

  /**
   * The mode map of a schema and its discriminators (a filter of the root may name a child's field).
   *
   * @param schema - The compiled schema.
   * @returns The marked paths, most specific first.
   */
  static paths(schema: CompiledSchema): readonly SensitivePath[] {
    const cached = UNION.get(schema);
    if (cached !== undefined) return cached;
    const discriminators = [...schema.discriminators.values()];
    const out =
      discriminators.length === 0
        ? schema.sensitivePaths
        : Object.freeze(
            [schema, ...discriminators]
              .flatMap((one) => one.sensitivePaths)
              .sort((a, b) => b.segments.length - a.segments.length),
          );
    UNION.set(schema, out);
    return out;
  }

  /**
   * Whether a schema has a marked (or `Hidden`) path; otherwise the audit trail walks nothing.
   *
   * @param schema - The compiled schema.
   * @returns `true` when at least one path is marked.
   */
  static hasMarks(schema: CompiledSchema): boolean {
    return SensitiveMask.paths(schema).length > 0;
  }

  /**
   * The value shown in an error (`CastError`, validation issues): `"hide"` is `"[hidden]"`, a mask function gets
   * only a value of the field's declared type (a value that failed to cast is `"?"` without calling it), a
   * throwing mask `"?"` — reported like an event mask failure (a sink in scope, else `console.error`), never
   * swallowed silently.
   *
   * @param option - The `sensitive` option of the field.
   * @param value - The value to show.
   * @param path - The dotted path, for the failure report.
   * @param sink - Where a mask failure goes; defaults to the sink in scope.
   * @param node - The node of the field; without it a mask function is never called (the type is unknown).
   * @returns The value as it may appear in the error.
   */
  static forError(option: unknown, value: unknown, path = "", sink?: MaskFailureSink, node?: PathNode): unknown {
    if (option === "hide") return SENSITIVE_HIDDEN;
    if (option === "mask") return SENSITIVE_MASK;
    if (typeof option === "object" && option !== null) {
      const declared = node === undefined ? NOT_DECLARED : SensitiveMask.declared(node, value);
      if (declared === NOT_DECLARED) return SENSITIVE_MASK;
      try {
        return (option as { readonly mask: (value: unknown) => SensitiveJson }).mask(declared);
      } catch (error) {
        SensitiveMask.reportFailure(error, path, sink);
        return SENSITIVE_MASK;
      }
    }
    return value;
  }

  /**
   * A failed mask function of an event is logged (telemetry goes on with "?") — like a throwing subscriber
   * (`InstrumentationHub`): an observer must not break the operation.
   *
   * @param error - What the mask function threw.
   * @param path - The dotted path of the field.
   * @param captured - A sink captured earlier; defaults to the sink in scope.
   */
  private static reportFailure(error: unknown, path: string, captured?: MaskFailureSink): void {
    const sink = captured ?? SINKS.at(-1);
    if (sink === undefined) {
      console.error('[typemo] instrumentation: a sensitive mask threw; the value is "?"', error);
      return;
    }
    /* The thrown error may repeat the value it was given — the event carries a copy with the path only. */
    sink(path, SensitiveMask.brand(new SensitiveMaskFailure(path, undefined)));
  }

  /**
   * The sink in scope — captured by work that reports later (an async validator), outside the scope.
   *
   * @returns The innermost sink, or `undefined` outside `reporting`.
   */
  static currentSink(): MaskFailureSink | undefined {
    return SINKS.at(-1);
  }

  /**
   * Runs `run` with mask failures of the event path delivered to `sink` (the hub turns them into an
   * `instrumentation.error` event) instead of `console.error`. Synchronous: scopes nest.
   *
   * @typeParam T - The result of `run`.
   * @param sink - Receives mask failures raised during `run`.
   * @param run - The synchronous work to scope.
   * @returns What `run` returns.
   */
  static reporting<T>(sink: MaskFailureSink, run: () => T): T {
    SINKS.push(sink);
    try {
      return run();
    } finally {
      SINKS.pop();
    }
  }

  /**
   * The audit-trail form of a value (a filter, an update, a document; CODE form): unmarked values shown, a
   * throwing mask function throws `SensitiveMaskFailure` (the audit policy fails the operation).
   *
   * @typeParam T - The type of the value.
   * @param schema - The schema of the audited model.
   * @param value - The value to render.
   * @returns The value with marked parts replaced; the same value when nothing is marked.
   * @throws {SensitiveMaskFailure} When a mask function throws.
   */
  static audit<T>(schema: CompiledSchema, value: T): T {
    const paths = SensitiveMask.paths(schema);
    if (paths.length === 0) return value;
    return SensitiveMask.walk({ paths, fallback: "show", failure: "throw" }, value, []) as T;
  }

  /**
   * The event form of a value (a summary's filter, update, pipeline; DB form) for a subscriber default:
   * a throwing mask function is `"?"` and logged.
   *
   * @param schema - The schema of the operation.
   * @param value - The value to render.
   * @param fallback - The subscriber's mode for unmarked values.
   * @returns The value with marked (and, by the fallback, unmarked) parts replaced.
   */
  static event(schema: CompiledSchema, value: unknown, fallback: SubscriberSensitive): unknown {
    const paths = SensitiveMask.paths(schema);
    if (paths.length === 0 && fallback === "show") return value;
    return SensitiveMask.walk({ paths, fallback, failure: "report" }, value, []);
  }

  /**
   * A driver command for a subscriber default: the data keys walked (`schema` of the linked operation;
   * `undefined` — a command no operation issued — has no marks and is never shown raw), keys with foreign-shaped
   * data never shown, the rest (command name, collection, options) kept. The first key of a command is its
   * name and holds the collection (or `1`): it is kept even when the name is also a data key elsewhere
   * (`update` is the collection of the `update` command, but the update document of `findAndModify`).
   *
   * @param schema - The schema of the linked operation, if any.
   * @param command - The driver command document.
   * @param fallback - The subscriber's mode for unmarked values.
   * @returns The command with data keys rendered.
   */
  static command(schema: CompiledSchema | undefined, command: unknown, fallback: SubscriberSensitive): unknown {
    const walk: Walk = {
      paths: schema === undefined ? [] : SensitiveMask.paths(schema),
      fallback: schema === undefined && fallback === "show" ? "mask" : fallback,
      failure: "report",
    };
    const foreign: Walk = { ...walk, fallback: walk.fallback === "show" ? "mask" : walk.fallback };
    /* `isCommand`: a whole command (top level, `explain`), not a statement of `updates` / `deletes`. */
    const one = (value: unknown, isCommand = false): unknown => {
      if (!BsonGuards.isPlainObject(value)) return SensitiveMask.leaf(walk, value, []);
      const out: Record<string, unknown> = {};
      let first = isCommand;
      for (const [key, item] of Object.entries(value)) {
        let next: unknown;
        if (first) next = COMMAND_NESTED.has(key) ? one(item, true) : item;
        else if (COMMAND_FOREIGN.has(key)) next = SensitiveMask.walk(foreign, item, []);
        else if ((key === "updates" || key === "deletes") && Array.isArray(item))
          next = item.map((statement: unknown) => one(statement));
        else if (COMMAND_NESTED.has(key)) next = one(item, true);
        else if (key === "projection" || key === "fields") next = SensitiveMask.projectionWalk(walk, item);
        else if (COMMAND_DATA.has(key)) next = SensitiveMask.walk(walk, item, []);
        else next = item;
        first = false;
        SafeRecord.set(out, key, next);
      }
      return out;
    };
    return one(command, true);
  }

  /**
   * A projection for a subscriber default: inclusion flags (`1`, `0`, `true`, `false`) carry no data and stay;
   * operator values (`$elemMatch`, `$slice`, expressions) are walked like a filter.
   *
   * @param schema - The schema of the operation.
   * @param value - The projection.
   * @param fallback - The subscriber's mode for unmarked values.
   * @returns The rendered projection.
   */
  static projection(schema: CompiledSchema, value: unknown, fallback: SubscriberSensitive): unknown {
    return SensitiveMask.projectionWalk({ paths: SensitiveMask.paths(schema), fallback, failure: "report" }, value);
  }

  /**
   * Walks a projection: flags stay, every other value is walked as a filter under its key.
   *
   * @param walk - The walk settings.
   * @param value - The projection.
   * @returns The rendered projection.
   */
  private static projectionWalk(walk: Walk, value: unknown): unknown {
    if (!BsonGuards.isPlainObject(value)) return SensitiveMask.walk(walk, value, []);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const flag = typeof item === "number" || typeof item === "boolean";
      SafeRecord.set(
        out,
        key,
        flag ? item : (SensitiveMask.walk(walk, { [key]: item }, []) as Record<string, unknown>)[key],
      );
    }
    return out;
  }

  /**
   * The outside form of an error. `fallback: "show"` is the THROWN form: only the field
   * marks (and `Hidden` = "mask") apply, and only server errors change (`CastError`/`ValidationError` are masked
   * where they are built). Another fallback is the EVENT form of a subscriber: unmarked values of `CastError`,
   * `ValidationError`, `DuplicateKeyError`, `ServerValidationError` follow it too. The error itself is returned
   * when nothing changes; a copy never carries the raw `cause`.
   *
   * @param schema - The schema of the operation the error left, if known.
   * @param error - The error to render.
   * @param fallback - `"show"` for the thrown form, a subscriber's mode for the event form.
   * @returns The error or a masked copy, branded as masked.
   */
  static error(schema: CompiledSchema | undefined, error: unknown, fallback: SubscriberSensitive): MaskedError {
    return SensitiveMask.brand(SensitiveMask.maskError(schema, error, fallback));
  }

  /**
   * Remembers the schema of the operation an error left (`OperationPipeline`), so that an event carrying the
   * error later without the operation (`transaction.retry`/`abort`) masks it by the same marks.
   *
   * @param error - The error that left the operation.
   * @param schema - The schema of that operation.
   */
  static originOf(error: unknown, schema: CompiledSchema): void {
    if (typeof error === "object" && error !== null) ORIGIN.set(error, schema);
  }

  /**
   * The error of a `transaction.*` event for a subscriber default — by the schema of the operation
   * it left when known (as `operation.error`); else no marks are known, so it is never shown raw: an error that is
   * not Typemo's (the driver's own, a transient retry cause) becomes the masked `DriverError` copy of commands,
   * a Typemo error is masked under `"mask"` when the subscriber asked for `"show"`.
   *
   * @param error - The error carried by the event.
   * @param fallback - The subscriber's mode for unmarked values.
   * @returns The masked error; `undefined` when the event has no error.
   */
  static transaction(error: unknown, fallback: SubscriberSensitive): MaskedError | undefined {
    if (error === undefined) return undefined;
    const schema = typeof error === "object" && error !== null ? ORIGIN.get(error) : undefined;
    if (schema !== undefined) return SensitiveMask.error(schema, error, fallback);
    /* A server error (raw, or wrapped without an operation) repeats values in its text: the masked copy of
       `driver.command.failed`. Duplicate key / document validation errors are masked field by field below. */
    const raw = error instanceof TypemoError ? ErrorTranslator.driverCause(error) : error;
    const walked =
      error instanceof DuplicateKeyError || error instanceof ServerValidationError || error instanceof BulkWriteError;
    if (!walked && raw instanceof Error && ErrorTranslator.isDriverError(raw))
      return SensitiveMask.failure(undefined, raw, fallback);
    /* Anything else (the application's own error, a Typemo error without server text): as `operation.error`
       without marks, a requested "show" lowered to "mask" — no schema says which values are safe. */
    return SensitiveMask.error(undefined, error, fallback === "show" ? "mask" : fallback);
  }

  /**
   * The ONE place an error becomes a `MaskedError` (the hub takes no other) — only the results of
   * {@link error} and {@link failure}. A cast to `MaskedError` anywhere else fails `masked-error.test.ts`.
   * The brand is type-only; the value is the masked error itself.
   *
   * @param masked - A value already produced by the masking code.
   * @returns The same value typed as `MaskedError`.
   */
  private static brand(masked: unknown): MaskedError {
    return masked as MaskedError;
  }

  /**
   * Masks one error by the schema marks and the fallback.
   *
   * @param schema - The schema of the operation, if known.
   * @param error - The error to mask.
   * @param fallback - `"show"` for the thrown form, a subscriber's mode for the event form.
   * @returns The same error when nothing changes, else a masked copy.
   */
  private static maskError(schema: CompiledSchema | undefined, error: unknown, fallback: SubscriberSensitive): unknown {
    const paths = schema === undefined ? [] : SensitiveMask.paths(schema);
    const thrown = fallback === "show";
    if (thrown && paths.length === 0) return error;
    const walk: Walk = { paths, fallback, failure: "report" };
    if (error instanceof DuplicateKeyError) return SensitiveMask.duplicateKey(walk, error);
    if (error instanceof ServerValidationError) return SensitiveMask.serverValidation(walk, error);
    if (error instanceof BulkWriteError) return SensitiveMask.bulkWrite(schema, error, fallback);
    if (thrown) return error;
    if (error instanceof CastError) {
      const value = SensitiveMask.valueAt(walk, segmentsOf(error.path), error.value);
      return new CastError({
        path: error.path,
        value,
        expected: error.expected,
        reason: error.reason,
        detail: SensitiveMask.replaceIn(error.detail, error.value, value),
      });
    }
    if (error instanceof ValidationError) {
      const issues = error.issues.map((issue): SchemaIssue => {
        const path = issue.path.filter((segment): segment is string => typeof segment === "string");
        const value = SensitiveMask.valueAt(walk, path.flatMap(segmentsOf), issue.value);
        return {
          path: issue.path,
          reason: issue.reason,
          message: SensitiveMask.replaceIn(issue.message, issue.value, value),
          value,
        };
      });
      return new ValidationError(issues);
    }
    return error;
  }

  /**
   * A driver command failure for a subscriber default: a masked `DriverError` copy — never the raw driver error
   * (its `errmsg`, `keyValue`, `errInfo`, `errorResponse` repeat the values).
   *
   * @param schema - The schema of the linked operation, if any.
   * @param failure - The failure raised by the driver.
   * @param fallback - The subscriber's mode for unmarked values.
   * @returns The masked copy, branded as masked.
   */
  static failure(schema: CompiledSchema | undefined, failure: unknown, fallback: SubscriberSensitive): MaskedError {
    return SensitiveMask.brand(SensitiveMask.maskFailure(schema, failure, fallback));
  }

  /**
   * Builds the masked `DriverError` copy of a driver failure.
   *
   * @param schema - The schema of the linked operation, if any.
   * @param failure - The failure raised by the driver.
   * @param fallback - The subscriber's mode for unmarked values.
   * @returns The masked copy; a non-`Error` failure is returned as is.
   */
  private static maskFailure(
    schema: CompiledSchema | undefined,
    failure: unknown,
    fallback: SubscriberSensitive,
  ): unknown {
    if (!(failure instanceof Error)) return failure;
    const wrapped = ErrorTranslator.wrap(failure);
    const masked = SensitiveMask.maskError(
      schema,
      wrapped,
      fallback === "show" && schema === undefined ? "mask" : fallback,
    );
    const code = ErrorTranslator.codeOf(failure);
    const message =
      masked instanceof DuplicateKeyError || masked instanceof ServerValidationError
        ? masked.message
        : fallback === "show" && schema !== undefined
          ? failure.message
          : `${failure.name}${code === undefined ? "" : ` (code ${code})`}: the message is withheld (sensitive)`;
    return SensitiveMask.safeDriverError(failure, message);
  }

  /**
   * The masked copy of a driver error that stands as `cause`: name, labels and the (masked) message only.
   *
   * @param raw - The driver error.
   * @param message - The already masked message.
   * @returns The safe copy.
   */
  private static safeDriverError(raw: Error, message: string): DriverError {
    return new DriverError(raw.name, message, { errorLabels: ErrorTranslator.labelsOf(raw) });
  }

  /**
   * A copy of `error` with `cause` replaced by a masked driver error, the raw one kept out of sight.
   *
   * @typeParam E - The error type of the copy.
   * @param copy - The masked copy to finish.
   * @param source - The original error the copy stands for.
   * @param message - The already masked message of the cause.
   * @returns The same copy, with `cause` and the hidden driver slot set.
   */
  private static withSafeCause<E extends Error>(copy: E, source: Error, message: string): E {
    const raw = ErrorTranslator.driverCause(source);
    Object.defineProperty(copy, "cause", {
      value: raw instanceof Error ? SensitiveMask.safeDriverError(raw, message) : undefined,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(copy, ErrorTranslator.DRIVER_ERROR, { value: raw, enumerable: false });
    return copy;
  }

  /**
   * Masks a duplicate key error: the `keyValue` is walked and the `dup key` text of the message is rebuilt.
   *
   * @param walk - The walk settings.
   * @param error - The error to mask.
   * @returns The same error when it needs no change, else a masked copy.
   */
  private static duplicateKey(walk: Walk, error: DuplicateKeyError): unknown {
    const keyValue =
      error.keyValue === undefined
        ? undefined
        : (SensitiveMask.walk(walk, error.keyValue, []) as Record<string, unknown>);
    const shown = keyValue === undefined ? "{ ? }" : SensitiveMask.render(keyValue);

    if (walk.fallback === "show") {
      /* Without `keyValue` (a bulk write failure) the message is masked unless every index key is known unmarked. */
      const unchanged =
        keyValue === undefined
          ? error.keyPattern !== undefined &&
            Object.keys(error.keyPattern).every((key) => {
              const rule = SensitiveMask.ruleAt(walk.paths, segmentsOf(key));
              return rule === undefined || rule === "show";
            })
          : shown === SensitiveMask.render(error.keyValue);
      if (unchanged) return error;
    }
    const text = (message: string): string =>
      DUP_KEY.test(message) ? message.replace(DUP_KEY, `dup key: ${shown}`) : message;
    const copy = new DuplicateKeyError(DuplicateKeyText.of(error.index, keyValue, error.code, error.codeName), {
      code: error.code,
      codeName: error.codeName,
      errorLabels: error.errorLabels,
      serverMessage: text(error.serverMessage),
      keyPattern: error.keyPattern,
      keyValue,
      index: error.index,
    });
    const raw = ErrorTranslator.driverCause(error);
    return SensitiveMask.withSafeCause(
      copy,
      error,
      raw instanceof Error ? text(raw.message) : text(error.serverMessage),
    );
  }

  /**
   * Masks every failure of a bulk error; the error is rebuilt (its message repeats the first failure) when one
   * changed.
   *
   * @param schema - The schema of the operation, if known.
   * @param error - The bulk error.
   * @param fallback - `"show"` for the thrown form, a subscriber's mode for the event form.
   * @returns The same error when nothing changed, else a rebuilt copy.
   */
  private static bulkWrite(
    schema: CompiledSchema | undefined,
    error: BulkWriteError,
    fallback: SubscriberSensitive,
  ): unknown {
    let changed = false;
    const failures = error.writeErrors.map((failure): BulkWriteFailure => {
      const masked = SensitiveMask.maskError(schema, failure.error, fallback);
      if (masked === failure.error || !(masked instanceof TypemoError)) return failure;
      changed = true;
      /* The text of a server failure stays the server's own (masked), the same form as before masking. */
      const message = masked instanceof ServerError ? masked.serverMessage : masked.message;
      return { index: failure.index, code: failure.code, message, error: masked };
    });
    if (!changed) return error;
    const colon = error.message.indexOf(": ");
    const copy = new BulkWriteError(
      colon < 0 ? error.name : error.message.slice(0, colon),
      failures,
      error.result,
      error.ordered,
    );
    return SensitiveMask.withSafeCause(copy, error, copy.message);
  }

  /**
   * Masks a server document validation error: the considered values of `errInfo` follow the marks.
   *
   * @param walk - The walk settings.
   * @param error - The error to mask.
   * @returns The same error when it needs no change, else a masked copy.
   */
  private static serverValidation(walk: Walk, error: ServerValidationError): unknown {
    const errInfo =
      error.errInfo === undefined
        ? undefined
        : (SensitiveMask.errInfo(walk, error.errInfo, []) as Record<string, unknown>);
    if (walk.fallback === "show" && JSON.stringify(errInfo) === JSON.stringify(error.errInfo)) return error;
    const copy = new ServerValidationError(error.message, {
      code: error.code,
      codeName: error.codeName,
      errorLabels: error.errorLabels,
      errInfo,
    });
    const raw = ErrorTranslator.driverCause(error);
    /* The server message of code 121 ("Document failed validation") repeats no value. */
    return SensitiveMask.withSafeCause(copy, error, raw instanceof Error ? raw.message : error.message);
  }

  /**
   * Walks the `errInfo` of a `$jsonSchema` failure: `consideredValue(s)` are masked by the `propertyName` path
   * they sit under.
   *
   * @param walk - The walk settings.
   * @param value - The `errInfo` node.
   * @param path - The field path reached so far.
   * @returns The `errInfo` with considered values rendered.
   */
  private static errInfo(walk: Walk, value: unknown, path: readonly string[]): unknown {
    if (Array.isArray(value)) return value.map((item: unknown) => SensitiveMask.errInfo(walk, item, path));
    if (!BsonGuards.isPlainObject(value)) return value;
    const own = typeof value.propertyName === "string" ? [...path, ...segmentsOf(value.propertyName)] : path;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      SafeRecord.set(
        out,
        key,
        key === "consideredValue" || key === "consideredValues"
          ? SensitiveMask.valueAt(walk, own, item)
          : SensitiveMask.errInfo(walk, item, own),
      );
    }
    return out;
  }

  /**
   * A value at a known path: the field's mark, else the output default. An empty path is never a field.
   *
   * @param walk - The walk settings.
   * @param path - The path segments of the field.
   * @param value - The value at the path.
   * @returns The value as it may appear outside.
   */
  private static valueAt(walk: Walk, path: readonly string[], value: unknown): unknown {
    const rule = path.length === 0 ? undefined : SensitiveMask.ruleAt(walk.paths, path);
    if (rule === "hide") return SENSITIVE_HIDDEN;
    if (rule === undefined) return SensitiveMask.leaf(walk, value, path);
    if (rule === "show") return value;
    return SensitiveMask.masked(walk, rule, value, path);
  }

  /**
   * `text` with the rendering of `raw` replaced by `shown` (messages repeat values).
   *
   * @param text - The message.
   * @param raw - The original value.
   * @param shown - What is shown instead.
   * @returns The message; unchanged for a non-primitive or unchanged value.
   */
  private static replaceIn(text: string, raw: unknown, shown: unknown): string {
    if (raw === shown) return text;
    const plain =
      typeof raw === "string" || typeof raw === "number" || typeof raw === "bigint" || typeof raw === "boolean"
        ? String(raw)
        : "";
    return plain === "" ? text : text.split(plain).join(String(shown));
  }

  /**
   * The server's `dup key` rendering of a value, for masked values.
   *
   * @param value - A key value document or a scalar.
   * @returns The text, for example `{ email: "?" }`.
   */
  private static render(value: unknown): string {
    return DuplicateKeyText.render(value);
  }

  /**
   * The mark of a path: the first (most specific) marked path that is a prefix of it.
   *
   * @param paths - The marked paths, most specific first.
   * @param path - The path segments to look up.
   * @returns The rule, or `undefined` when no mark covers the path.
   */
  private static ruleAt(paths: readonly SensitivePath[], path: readonly string[]): SensitiveRule | undefined {
    for (const marked of paths) {
      if (marked.segments.length > path.length) continue;
      if (marked.segments.every((segment, index) => segment === "$*" || segment === path[index])) return marked.rule;
    }
    return undefined;
  }

  /**
   * The replacement of an expression referencing a marked (not shown) path (`"$password"`): `"[hidden]"` when a
   * referenced path is hidden, else `"?"`; `undefined` when it references none.
   *
   * @param paths - The marked paths, most specific first.
   * @param value - An expression or a part of one.
   * @returns The replacement text, or `undefined`.
   */
  private static references(paths: readonly SensitivePath[], value: unknown): string | undefined {
    if (typeof value === "string") {
      if (!value.startsWith("$") || value.startsWith("$$")) return undefined;
      const rule = SensitiveMask.ruleAt(paths, segmentsOf(value.slice(1)));
      if (rule === undefined || rule === "show") return undefined;
      return rule === "hide" ? SENSITIVE_HIDDEN : SENSITIVE_MASK;
    }
    const items = Array.isArray(value)
      ? (value as readonly unknown[])
      : BsonGuards.isPlainObject(value)
        ? Object.values(value)
        : [];
    let found: string | undefined;
    for (const item of items) {
      const one = SensitiveMask.references(paths, item);
      if (one === SENSITIVE_HIDDEN) return one;
      found ??= one;
    }
    return found;
  }

  /**
   * Applies a mask function; a throw is re-raised (audit) or `"?"` + logged (events).
   *
   * @param walk - The walk settings.
   * @param run - Calls the mask function.
   * @param path - The path, for the failure report.
   * @returns The masked value or `"?"`.
   * @throws {SensitiveMaskFailure} When the walk fails on a throwing mask function.
   */
  private static call(walk: Walk, run: () => SensitiveJson, path: readonly string[] = []): unknown {
    if (walk.failure === "throw") return run();
    try {
      return run();
    } catch (error) {
      SensitiveMask.reportFailure(error, path.join("."));
      return SENSITIVE_MASK;
    }
  }

  /**
   * An unmarked leaf under the output default.
   *
   * @param walk - The walk settings.
   * @param value - The leaf value.
   * @param path - The path segments of the leaf.
   * @returns The value as the fallback shows it.
   */
  private static leaf(walk: Walk, value: unknown, path: readonly string[]): unknown {
    const fallback = walk.fallback;
    if (fallback === "show") return value;
    if (fallback === "mask") return SENSITIVE_MASK;
    if (fallback === "hide") return SENSITIVE_HIDDEN;
    return SensitiveMask.call(walk, () => fallback.mask(value, { path: path.join(".") }), path);
  }

  /**
   * A value of a marked path: `"mask"` → "?"; a function is applied to every value — a literal, `$eq`/`$ne`,
   * elements of `$in`/`$nin`/`$all`/`$each`; other operators (`$regex`, expressions) → "?".
   *
   * @param walk - The walk settings.
   * @param rule - The marked rule (`"mask"` or a function).
   * @param value - The value or operator object at the path.
   * @param path - The path segments, for failure reports.
   * @returns The masked value.
   */
  private static masked(
    walk: Walk,
    rule: Exclude<SensitiveRule, "hide" | "show">,
    value: unknown,
    path: readonly string[] = [],
  ): unknown {
    if (rule === "mask") return SENSITIVE_MASK;
    const one = (item: unknown): unknown => SensitiveMask.call(walk, () => rule(item), path);
    if (BsonGuards.isPlainObject(value) && Object.keys(value).some((key) => key.startsWith("$"))) {
      const out: Record<string, unknown> = {};
      for (const [operator, operand] of Object.entries(value)) {
        if (operator === "$eq" || operator === "$ne") SafeRecord.set(out, operator, one(operand));
        else if (
          (operator === "$in" || operator === "$nin" || operator === "$all" || operator === "$each") &&
          Array.isArray(operand)
        )
          SafeRecord.set(out, operator, operand.map(one));
        else SafeRecord.set(out, operator, SENSITIVE_MASK);
      }
      return out;
    }
    return one(value);
  }

  /**
   * An operator's operand; sub-pipelines (`$lookup`/`$unionWith` `pipeline`, `$facet` branches) restart at the
   * root.
   *
   * @param walk - The walk settings.
   * @param operator - The operator key.
   * @param operand - The operator's value.
   * @param path - The field path the operator sits under.
   * @returns The rendered operand.
   */
  private static operand(walk: Walk, operator: string, operand: unknown, path: readonly string[]): unknown {
    if (operator === "$expr") {
      const replaced = SensitiveMask.references(walk.paths, operand);
      if (replaced !== undefined) return replaced;
    }
    if (!BsonGuards.isPlainObject(operand)) return SensitiveMask.walk(walk, operand, path);
    if (operator === "$facet") {
      const out: Record<string, unknown> = {};
      for (const [name, branch] of Object.entries(operand))
        SafeRecord.set(out, name, SensitiveMask.walk(walk, branch, []));
      return out;
    }
    if (operator === "$lookup" || operator === "$unionWith") {
      const foreign: Walk = { ...walk, fallback: walk.fallback === "show" ? "mask" : walk.fallback };
      const out: Record<string, unknown> = {};
      for (const [name, item] of Object.entries(operand)) {
        const next =
          name === "pipeline"
            ? SensitiveMask.walk(walk, item, [])
            : name === "let"
              ? SensitiveMask.walk(foreign, item, [])
              : SensitiveMask.leaf(walk, item, path);
        SafeRecord.set(out, name, next);
      }
      return out;
    }
    return SensitiveMask.walk(walk, operand, path);
  }

  /**
   * The one walker: renders a value (filter, update, pipeline, document, Map) by the marks and the fallback.
   *
   * @param walk - The walk settings.
   * @param value - The value to render.
   * @param path - The field path reached so far.
   * @returns A rendered copy; the input is never mutated.
   */
  private static walk(walk: Walk, value: unknown, path: readonly string[]): unknown {
    if (typeof value === "string") {
      const replaced = SensitiveMask.references(walk.paths, value);
      if (replaced !== undefined) return replaced;
    }
    if (Array.isArray(value)) {
      /* Arrays of documents (`$or`, stages, subdocuments) are walked; an array of values is ONE value (its length
         is data too) unless values are shown. */
      const documents =
        value.length > 0 && value.every((item: unknown) => BsonGuards.isPlainObject(item) || Array.isArray(item));
      if (!documents && walk.fallback !== "show") return SensitiveMask.leaf(walk, value, path);
      return (value as readonly unknown[]).map((item) => SensitiveMask.walk(walk, item, path));
    }
    const entries = BsonGuards.isMap(value)
      ? [...(value as ReadonlyMap<unknown, unknown>)].map(([key, item]) => [String(key), item] as const)
      : BsonGuards.isPlainObject(value)
        ? Object.entries(value)
        : undefined;
    if (entries === undefined) return SensitiveMask.leaf(walk, value, path);
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      let next: unknown;
      if (key.startsWith("$")) next = SensitiveMask.operand(walk, key, item, path);
      else {
        const inner = [...path, ...segmentsOf(key)];
        const rule = SensitiveMask.ruleAt(walk.paths, inner);
        /* A hidden field — marked, or unmarked under a subscriber "hide" with an operator condition — is one
           "[hidden]": its operators are not shown. */
        if (rule === "hide" || (rule === undefined && walk.fallback === "hide" && isCondition(item)))
          next = SENSITIVE_HIDDEN;
        else if (rule === undefined) next = SensitiveMask.walk(walk, item, inner);
        else if (rule === "show") next = SensitiveMask.walk({ ...walk, fallback: "show" }, item, inner);
        else next = SensitiveMask.masked(walk, rule, item, inner);
      }
      SafeRecord.set(out, key, next);
    }
    return BsonGuards.isMap(value) ? new Map(Object.entries(out)) : out;
  }
}
