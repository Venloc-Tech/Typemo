import type { ChangeStreamOptions } from "mongodb";
import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { Connection } from "../connection/connection.ts";
import { Documents } from "../document/documents.ts";
import { CastError } from "../errors/cast-error.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { QueryError } from "../errors/query-error.ts";
import { DocumentReader } from "../model/document-reader.ts";
import { DbNames } from "../operation/steps/db-names.ts";
import { HiddenPolicy } from "../policies/hidden-policy.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import type { ModelWatchOptions } from "./change-events.ts";

type Plain = Readonly<Record<string, unknown>>;

/** The option keys `Model.watch` knows; anything else is a `QueryError`. */
const OPTION_KEYS: ReadonlySet<string> = new Set([
  "fullDocument",
  "fullDocumentBeforeChange",
  "hydrate",
  "resumeAfter",
  "startAfter",
  "startAtOperationTime",
  "maxAwaitTimeMS",
  "batchSize",
  "showExpandedEvents",
  "include",
]);

/** The values of `fullDocument`. */
const FULL_DOCUMENT: readonly string[] = ["default", "updateLookup", "whenAvailable", "required"];

/** The values of `fullDocumentBeforeChange`. */
const FULL_DOCUMENT_BEFORE_CHANGE: readonly string[] = ["off", "whenAvailable", "required"];

/** The operation types of events that carry a document. */
const DOCUMENT_OPERATIONS = ["insert", "update", "replace", "delete"] as const;

/** Event fields holding a stored document. */
const DOCUMENT_FIELDS = ["fullDocument", "fullDocumentBeforeChange"] as const;

/**
 * A prepared change stream: the stages sent, the driver options, the conversion of each event.
 *
 * @example
 * ```ts
 * const prepared: PreparedWatch = ChangeStreams.prepare(schema, connection, [], {});
 * const raw = collection.watch([...prepared.pipeline], { ...prepared.driverOptions });
 * ```
 */
export interface PreparedWatch {
  /** The stages sent to the server (discriminator filter, hidden-field removal, the user's stages). */
  readonly pipeline: readonly PipelineStage[];
  /** The options for the driver (Typemo-only options removed). */
  readonly driverOptions: Readonly<ChangeStreamOptions>;
  /** `true` when the events keep their shape (only `$match` stages): they are converted. */
  readonly converts: boolean;
  /** Converts one raw event (identity when the stream does not convert). */
  readonly convert: (raw: unknown) => unknown;
}

/**
 * Prepares the change stream of `Model.watch`.
 *
 * - A discriminator model's stream is filtered by `$or` over the operation types: an insert or replace (and an
 *   update with a post-image) by `fullDocument.<key>`, anything with a pre-image by
 *   `fullDocumentBeforeChange.<key>`, and an update or delete without either image passes, because the server
 *   cannot tell its class. Mongoose filtered by `fullDocument.<key>` only and lost every delete; the user's
 *   `$match` is never mutated either.
 * - `Hidden` fields are removed (`$unset` of `fullDocument.<path>` and `fullDocumentBeforeChange.<path>` on the
 *   server; `updatedFields`, `removedFields` and `truncatedArrays` in the conversion), like `find()` without
 *   `+field`, except the paths named by `include`, which must be hidden paths of the model. Update paths are
 *   compared without array positions (`items.0.secret` is `items.secret`); an updated container (`items`,
 *   `items.0`, `profile`) keeps its entry with the hidden fields taken out of its value, as `find()` would show
 *   it. A stream with stages other than `$match` cannot be converted (the rows are the pipeline's own) and the
 *   server cannot clean `updatedFields` keys holding dots, so while a hidden path is not included such a stream
 *   is a `QueryError`: it is refused, not leaked.
 * - The user's stages name code paths; with `dbName` aliases a `$match` on `fullDocument.*`,
 *   `fullDocumentBeforeChange.*` and `updateDescription.updatedFields.*` is translated. Other stages are not
 *   translated on such a schema: an error, not a silent wrong path.
 * - Each event of a `$match`-only stream is converted: documents lean (code names) or hydrated
 *   (`hydrate: true`), update paths in code names. Otherwise the rows are the pipeline's own and pass as they come.
 */
export class ChangeStreams {
  /**
   * Tells whether a stage list keeps the event shape (`$match` only).
   *
   * @param stages - The user's stages.
   * @returns `true` when every stage is a `$match`.
   */
  static matchOnly(stages: readonly PipelineStage[]): boolean {
    return stages.every((stage) => {
      const keys = Object.keys(stage);
      return keys.length === 1 && keys[0] === "$match";
    });
  }

  /**
   * The `$match` that keeps a discriminator's events (see the class description).
   *
   * @param schema - The compiled schema of the model.
   * @returns The stage, or `undefined` for a model that is not a discriminator.
   */
  static discriminatorFilter(schema: CompiledSchema): PipelineStage | undefined {
    const info = schema.discriminator;
    if (info === undefined) return undefined;
    const key = schema.root.field(info.key)?.dbKey ?? info.key;
    return Object.freeze({
      $match: {
        $or: [
          { [`fullDocument.${key}`]: info.value },
          { [`fullDocumentBeforeChange.${key}`]: info.value },
          /* No image to tell the class by: an update without a post-image, a delete without a pre-image. */
          { operationType: { $in: ["update", "delete"] }, fullDocument: null, fullDocumentBeforeChange: null },
          /* Events of the collection itself (drop, rename, invalidate, DDL) concern every class. */
          { operationType: { $nin: [...DOCUMENT_OPERATIONS] } },
        ],
      },
    });
  }

  /**
   * The database paths of the hidden fields of the model's collection (root and discriminators).
   *
   * @param schema - The compiled schema of the model.
   * @returns The hidden paths in database names.
   */
  static hiddenDbPaths(schema: CompiledSchema): readonly string[] {
    const root = schema.root;
    return HiddenPolicy.hiddenPaths(root).map((path) => root.toDbPath(path) ?? path);
  }

  /**
   * The code path of a database path (unknown segments, array positions and Map keys are kept as they are).
   *
   * @param schema - The compiled schema.
   * @param dbPath - The dotted database path.
   * @returns The dotted code path.
   */
  static toCodePath(schema: CompiledSchema, dbPath: string): string {
    const segments = dbPath.split(".");
    const out: string[] = [];
    let current: CompiledSchema | undefined = schema;
    let mapValue = false;
    for (const segment of segments) {
      if (current === undefined || mapValue || /^\d+$/.test(segment)) {
        out.push(segment);
        mapValue = false;
        continue;
      }
      const node: PathNode | undefined = current.fields.find((field) => field.dbKey === segment);
      if (node === undefined) {
        out.push(segment);
        current = undefined;
        continue;
      }
      out.push(node.key);
      let inner: PathNode = node;
      while (inner.kind === "array") inner = inner.element;
      if (inner.kind === "map") {
        mapValue = true;
        let value: PathNode = inner.value;
        while (value.kind === "array") value = value.element;
        current = value.kind === "subdocument" || value.kind === "nested" ? value.schema : undefined;
      } else current = inner.kind === "subdocument" || inner.kind === "nested" ? inner.schema : undefined;
    }
    return out.join(".");
  }

  /**
   * A `$match` filter of the user with code paths translated to database paths (see the class description).
   *
   * @param schema - The compiled schema.
   * @param filter - The user's filter.
   * @returns A new filter with database paths; the input is not changed.
   * @throws {ConfigurationError} When the filter uses `$expr`, which is not translated.
   */
  static translateMatch(schema: CompiledSchema, filter: Plain): Plain {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      if ((key === "$and" || key === "$or" || key === "$nor") && Array.isArray(value)) {
        out[key] = value.map((clause) =>
          BsonGuards.isPlainObject(clause) ? ChangeStreams.translateMatch(schema, clause) : clause,
        );
        continue;
      }
      if (key === "$expr")
        throw new ConfigurationError(
          `${schema.name}.watch: $expr is not translated to the dbName aliases of the schema; use a filter object`,
        );
      out[ChangeStreams.translateKey(schema, key)] = value;
    }
    return out;
  }

  /**
   * Translates one filter key that names a path inside an event document or update description.
   *
   * @param schema - The compiled schema.
   * @param key - The filter key.
   * @returns The key with the path part in database names (other keys are returned as they are).
   */
  private static translateKey(schema: CompiledSchema, key: string): string {
    for (const prefix of ["fullDocument.", "fullDocumentBeforeChange.", "updateDescription.updatedFields."]) {
      if (!key.startsWith(prefix)) continue;
      const path = key.slice(prefix.length);
      return `${prefix}${schema.root.toDbPath(path) ?? path}`;
    }
    return key;
  }

  /**
   * The database paths of the hidden fields that stay hidden: all of them minus `include`.
   *
   * @param schema - The compiled schema.
   * @param include - The `include` option of `watch`.
   * @returns The hidden paths in database names that must be removed.
   * @throws {QueryError} When `include` is not a list, or names a path that is not a hidden path of the model
   * (never a silent no-op).
   */
  static visibleHidden(schema: CompiledSchema, include: unknown): readonly string[] {
    const all = HiddenPolicy.hiddenPaths(schema.root);
    if (include === undefined) return ChangeStreams.hiddenDbPaths(schema);
    if (!Array.isArray(include)) throw new QueryError("watch: include is a list of hidden paths", { path: "include" });
    for (const path of include as unknown[]) {
      if (typeof path !== "string" || !all.includes(path)) {
        throw new QueryError(
          `watch: include "${String(path)}" is not a hidden path of ${schema.name} (hidden: ${all.join(", ") || "none"})`,
          { path: "include" },
        );
      }
    }
    const kept = new Set(include as string[]);
    return all.filter((path) => !kept.has(path)).map((path) => schema.root.toDbPath(path) ?? path);
  }

  /**
   * Checks the options and prepares the stream (see the class description).
   *
   * @param schema - The compiled schema of the model.
   * @param connection - The connection, used to hydrate documents.
   * @param stages - The user's stages.
   * @param options - The `watch` options.
   * @returns The pipeline, driver options and conversion.
   * @throws {QueryError} On an unknown option, or a pipeline that would leak hidden fields or cannot hydrate.
   * @throws {ConfigurationError} When the schema has `dbName` aliases and a stage other than `$match` is used.
   */
  static prepare(
    schema: CompiledSchema,
    connection: Connection,
    stages: readonly PipelineStage[],
    options: ModelWatchOptions,
  ): PreparedWatch {
    ChangeStreams.checkOptions(options);
    const converts = ChangeStreams.matchOnly(stages);
    if (options.hydrate === true && !converts) {
      throw new QueryError(
        "watch: hydrate needs the events as the server sends them; a pipeline with stages other than $match changes their shape",
      );
    }
    const hidden = ChangeStreams.visibleHidden(schema, options.include);
    if (hidden.length > 0 && !converts) {
      throw new QueryError(
        `watch: ${schema.name} has Hidden fields (${hidden.join(", ")}) and a pipeline with stages other than $match would pass their values in updateDescription; list them in include or use $match stages only`,
      );
    }
    const aliases = DbNames.hasAliases(schema.root);
    if (aliases && !converts) {
      throw new ConfigurationError(
        `${schema.name}.watch: the schema stores fields under dbName aliases; only $match stages are translated`,
      );
    }
    const user = aliases
      ? stages.map((stage) => Object.freeze({ $match: ChangeStreams.translateMatch(schema, stage.$match as Plain) }))
      : stages;
    const discriminator = ChangeStreams.discriminatorFilter(schema);
    const pipeline: PipelineStage[] = [];
    if (discriminator !== undefined) pipeline.push(discriminator);
    if (hidden.length > 0)
      pipeline.push(
        Object.freeze({ $unset: DOCUMENT_FIELDS.flatMap((field) => hidden.map((path) => `${field}.${path}`)) }),
      );
    pipeline.push(...user);
    const { hydrate: _hydrate, include: _include, ...driverOptions } = options;
    return Object.freeze({
      pipeline: Object.freeze(pipeline),
      driverOptions: Object.freeze({ ...driverOptions }) as Readonly<ChangeStreamOptions>,
      converts,
      convert: converts ? ChangeStreams.converter(schema, connection, options.hydrate === true, hidden) : (raw) => raw,
    });
  }

  /**
   * Checks the option names and values at run time, like the options of a query: plain JavaScript (or a cast)
   * gets the same answer the types give. `include` is checked against the schema by `visibleHidden`.
   *
   * @param options - The `watch` options.
   * @throws {QueryError} On an unknown option or a value of the wrong type; `batchSize` and `maxAwaitTimeMS`
   * are positive integers (the driver reads `0` as "the server default").
   */
  private static checkOptions(options: ModelWatchOptions): void {
    const fail = (key: string, expected: string, value: unknown): never => {
      throw new QueryError(`watch: ${key} must be ${expected}, got ${CastError.describe(value)}`, { path: key });
    };
    for (const [key, value] of Object.entries(options)) {
      if (!OPTION_KEYS.has(key)) throw new QueryError(`watch: unknown option "${key}"`, { path: key });
      if (value === undefined) continue;
      switch (key) {
        case "fullDocument":
        case "fullDocumentBeforeChange": {
          const allowed = key === "fullDocument" ? FULL_DOCUMENT : FULL_DOCUMENT_BEFORE_CHANGE;
          if (typeof value !== "string" || !allowed.includes(value)) {
            fail(key, `one of ${allowed.map((one) => `"${one}"`).join(", ")}`, value);
          }
          break;
        }
        case "hydrate":
        case "showExpandedEvents":
          if (typeof value !== "boolean") fail(key, "a boolean", value);
          break;
        case "resumeAfter":
        case "startAfter":
          if (!BsonGuards.isPlainObject(value)) fail(key, "a resume token (the _id of an event)", value);
          break;
        case "startAtOperationTime":
          if ((value as { _bsontype?: unknown } | null)?._bsontype !== "Timestamp") fail(key, "a Timestamp", value);
          break;
        case "maxAwaitTimeMS":
        case "batchSize":
          if (!Number.isInteger(value) || (value as number) <= 0) {
            fail(key, 'a positive integer (0 would mean "the server default"; leave it out for the default)', value);
          }
          break;
      }
    }
  }

  /**
   * Builds the conversion of one event of a `$match`-only stream.
   *
   * @param schema - The compiled schema.
   * @param connection - The connection, used to hydrate documents.
   * @param hydrate - Hydrate documents instead of returning plain objects.
   * @param hiddenDb - The hidden paths in database names.
   * @returns A function that converts a raw event.
   */
  static converter(schema: CompiledSchema, connection: Connection, hydrate: boolean, hiddenDb: readonly string[]) {
    return (raw: unknown): unknown => {
      if (!BsonGuards.isPlainObject(raw)) return raw;
      const root = schema.root;
      const event: Record<string, unknown> = { ...raw };
      const hiddenInfo =
        hiddenDb.length === 0
          ? undefined
          : Documents.readInfo(root, Object.fromEntries(hiddenDb.map((path) => [path, 0])), undefined);
      for (const field of DOCUMENT_FIELDS) {
        const document = event[field];
        if (!BsonGuards.isPlainObject(document)) continue;
        event[field] = hydrate
          ? Documents.hydrate(connection, root, document, hiddenInfo ?? Documents.DRIVER)
          : DocumentReader.lean(root, document);
      }
      /* The image keys of the event's type are always present (`undefined` when not asked for). */
      if (event.operationType === "update" && !Object.hasOwn(event, "fullDocument")) event.fullDocument = undefined;
      if (
        (event.operationType === "update" || event.operationType === "replace" || event.operationType === "delete") &&
        !Object.hasOwn(event, "fullDocumentBeforeChange")
      )
        event.fullDocumentBeforeChange = undefined;
      const description = event.updateDescription;
      if (BsonGuards.isPlainObject(description))
        event.updateDescription = ChangeStreams.description(root, description, hiddenDb);
      return event;
    };
  }

  /**
   * `updateDescription` in code names, hidden paths removed.
   *
   * @param schema - The compiled schema.
   * @param description - The raw description.
   * @param hiddenDb - The hidden paths in database names.
   * @returns The converted description.
   */
  private static description(schema: CompiledSchema, description: Plain, hiddenDb: readonly string[]): Plain {
    const hidden = hiddenDb.map(ChangeStreams.fieldSegments);
    /* A path at or under a hidden path (array positions ignored). */
    const hiddenPath = (path: string): boolean => {
      const segments = ChangeStreams.fieldSegments(path);
      return hidden.some(
        (one) => one.length <= segments.length && one.every((part, index) => part === segments[index]),
      );
    };
    const code = (path: string): string => ChangeStreams.toCodePath(schema, path);
    const out: Record<string, unknown> = { ...description };
    const updated = description.updatedFields;
    if (BsonGuards.isPlainObject(updated)) {
      const fields: Record<string, unknown> = {};
      for (const [path, value] of Object.entries(updated)) {
        if (hiddenPath(path)) continue;
        /* A container above hidden paths: the hidden fields are taken out of the new value. */
        const segments = ChangeStreams.fieldSegments(path);
        let shown = value;
        for (const one of hidden) {
          if (one.length > segments.length && segments.every((part, index) => part === one[index]))
            shown = ChangeStreams.without(shown, one.slice(segments.length));
        }
        fields[code(path)] = shown;
      }
      out.updatedFields = fields;
    }
    if (Array.isArray(description.removedFields)) {
      out.removedFields = (description.removedFields as unknown[])
        .filter((path): path is string => typeof path === "string" && !hiddenPath(path))
        .map(code);
    }
    if (Array.isArray(description.truncatedArrays)) {
      out.truncatedArrays = (description.truncatedArrays as unknown[])
        .filter(
          (entry) => !(BsonGuards.isPlainObject(entry) && typeof entry.field === "string" && hiddenPath(entry.field)),
        )
        .map((entry) =>
          BsonGuards.isPlainObject(entry) && typeof entry.field === "string"
            ? { ...entry, field: code(entry.field) }
            : entry,
        );
    }
    return out;
  }

  /**
   * The field segments of a dotted path with array positions dropped.
   *
   * @param path - The dotted path.
   * @returns The segments.
   */
  private static fieldSegments(path: string): string[] {
    return path.split(".").filter((segment) => !/^\d+$/.test(segment));
  }

  /**
   * A copy of a value without the field at a path; arrays are walked element by element. The input is not changed.
   *
   * @param value - The value to copy.
   * @param rest - The remaining path segments.
   * @returns The copy, or `value` itself when the field is not there.
   */
  private static without(value: unknown, rest: readonly string[]): unknown {
    if (rest.length === 0) return value;
    if (Array.isArray(value)) return value.map((item: unknown) => ChangeStreams.without(item, rest));
    if (!BsonGuards.isPlainObject(value)) return value;
    const [head, ...tail] = rest as [string, ...string[]];
    if (!Object.hasOwn(value, head)) return value;
    const out: Record<string, unknown> = { ...value };
    if (tail.length === 0) delete out[head];
    else out[head] = ChangeStreams.without(value[head], tail);
    return out;
  }
}
