import type { PipelineStage } from "../../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../../bson/bson-guards.ts";
import { ConfigurationError } from "../../errors/configuration-error.ts";
import { SafeRecord } from "../../internal/safe-record.ts";
import type { PlanDocument } from "../../query/plan.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../../schema/compiler/path-node.ts";
import { ExpressionPaths } from "./expression-paths.ts";
import { FilterCodec, type FilterMode } from "./filter-codec.ts";
import { PathResolver, type ResolvedPath } from "./path-resolver.ts";
import type { ResultShape } from "./result-shape.ts";

/*
 * The stages of an aggregation while the documents are still STORED documents of a schema (Mongoose H14): a
 * `$match` there compares stored values (its literals are cast by the schema), and every path —
 * `$match`/`$sort` keys, `$project`/`$addFields`/`$unset` keys, field references `"$x"` in expressions,
 * `$lookup.localField`, `$unwind`, `$group` keys — is translated to database names before execute.
 *
 * The walk tracks the SHAPE of the documents stage by stage: `schema` (stored documents of that schema;
 * top-level fields in `overwritten` were replaced by the pipeline and are no longer schema values) or
 * `undefined` (the pipeline named every field: after `$group`, `$bucket`, `$count`, a computed
 * `$replaceRoot`, …). The final shape tells the result post-processing how to translate rows back.
 *
 * What cannot be translated honestly is an error, never silence: a stored subdocument with aliased
 * fields copied into a field the pipeline names (`$push: "$profile"`, `$$ROOT`), a `$unionWith` of two
 * differently stored models, `$search` over aliased fields, `$merge`/`$out` into an aliased model.
 */

/**
 * The shape of the documents at one point of the pipeline.
 *
 * @example
 * const shape: Shape = { schema: userSchema, overwritten: new Set(["total"]), fields: new Map() };
 */
interface Shape {
  /** The schema the documents are stored documents of; `undefined` once the pipeline named every field. */
  readonly schema: CompiledSchema | undefined;
  /** Top-level fields the pipeline replaced: they are no longer schema values. */
  readonly overwritten: ReadonlySet<string>;
  /** Fields added by the pipeline whose values have a shape of their own (`$lookup.as`, `$facet` branches). */
  readonly fields: ReadonlyMap<string, ResultShape>;
}

/**
 * Where the stages find the schemas of other collections.
 *
 * @example
 * const env: StageEnvironment = { schemaOfCollection: (name) => registry.get(name) };
 */
export interface StageEnvironment {
  /** The schema of a collection (`$lookup.from`, …), when a model stores it. */
  readonly schemaOfCollection: (collection: string) => CompiledSchema | undefined;
  /**
   * The stages are an UPDATE pipeline: what they build is written back as the stored document, so the keys of a
   * replacement root (`$replaceWith`/`$replaceRoot` of an object) are field names to store — in database names —
   * not the names of result rows.
   */
  readonly document?: boolean;
}

/** The shape of documents about which nothing is known: the pipeline named every field. */
const FREE: Shape = Object.freeze({ schema: undefined, overwritten: new Set<string>(), fields: new Map() });

/**
 * The first segment of a dotted path.
 *
 * @param path - The path.
 * @returns The top-level key.
 */
const top = (path: string): string => path.split(".")[0] ?? path;
/**
 * `true` for a plain object.
 *
 * @param value - The value to test.
 * @returns Whether `value` is a plain object.
 */
const plain = (value: unknown): value is Readonly<Record<string, unknown>> => BsonGuards.isPlainObject(value);
/** Whether each schema has an aliased path, cached. */
const aliasCache = new WeakMap<CompiledSchema, boolean>();

/**
 * Aggregation stages: literal casting and `dbName` translation in the stored shape.
 *
 * @example
 * const { stages, shape } = AggregateStages.encode([{ $match: { name: "a" } }], schema, env);
 */
export class AggregateStages {
  /**
   * `true` when some path of the schema (discriminators included) is stored under another name.
   *
   * @param schema - The compiled schema.
   * @returns Whether any path has a different database name.
   */
  static hasAliases(schema: CompiledSchema): boolean {
    const cached = aliasCache.get(schema);
    if (cached !== undefined) return cached;
    const schemas = [schema, ...schema.discriminators.values()];
    const result = schemas.some((one) => Object.values(one.allPaths).some((node) => node.dbPath !== node.path));
    aliasCache.set(schema, result);
    return result;
  }

  /**
   * The stages with `$match` literals cast by the schema while the documents are stored documents.
   *
   * @param stages - The pipeline stages.
   * @param schema - The schema of the collection the pipeline starts from, if any.
   * @param env - Finds the schemas of other collections.
   * @returns The stages with cast `$match` values, in code names.
   * @throws {ConfigurationError} When a stage does not have exactly one key.
   */
  static cast(
    stages: readonly PipelineStage[],
    schema: CompiledSchema | undefined,
    env: StageEnvironment,
  ): readonly PipelineStage[] {
    return AggregateStages.run(stages, AggregateStages.initial(schema), env, "cast").stages;
  }

  /**
   * The stages in database names (Mongoose H14) and the shape of the rows they produce.
   *
   * @param stages - The pipeline stages.
   * @param schema - The schema of the collection the pipeline starts from, if any.
   * @param env - Finds the schemas of other collections.
   * @returns The translated stages and the shape that maps the rows back to code names.
   * @throws {ConfigurationError} When a stage cannot be translated honestly (aliased subdocument copied whole,
   * `$$ROOT`, `$unionWith` of differently stored models, `$search`, `$out`/`$merge` into an aliased model, a
   * new field named like a stored name).
   */
  static encode(
    stages: readonly PipelineStage[],
    schema: CompiledSchema | undefined,
    env: StageEnvironment,
  ): { readonly stages: readonly PipelineStage[]; readonly shape: ResultShape } {
    const result = AggregateStages.run(stages, AggregateStages.initial(schema), env, "encode");
    return { stages: result.stages, shape: { schema: result.shape.schema, fields: result.shape.fields } };
  }

  /**
   * The shape of the documents a pipeline starts from.
   *
   * @param schema - The schema of the collection, if known.
   * @returns Stored documents of `schema`, or the free shape.
   */
  private static initial(schema: CompiledSchema | undefined): Shape {
    return schema === undefined ? FREE : { schema, overwritten: new Set(), fields: new Map() };
  }

  /**
   * Walks the stages one after the other, tracking the shape.
   *
   * @param stages - The pipeline stages.
   * @param start - The shape the first stage sees.
   * @param env - Finds the schemas of other collections.
   * @param mode - `cast` or `encode`.
   * @returns The translated stages and the final shape.
   * @throws {ConfigurationError} When a stage does not have exactly one key or cannot be translated.
   */
  private static run(
    stages: readonly PipelineStage[],
    start: Shape,
    env: StageEnvironment,
    mode: FilterMode,
  ): { readonly stages: readonly PipelineStage[]; readonly shape: Shape } {
    let shape = start;
    const out: PipelineStage[] = [];
    for (const stage of stages) {
      const [name] = Object.keys(stage);
      if (name === undefined || Object.keys(stage).length !== 1) {
        throw new ConfigurationError(
          `an aggregation stage has exactly one key, got ${JSON.stringify(Object.keys(stage))}`,
        );
      }
      const next = AggregateStages.stage(name, stage[name], shape, env, mode);
      out.push(Object.freeze({ [name]: next.spec }) as PipelineStage);
      shape = next.shape;
    }
    /* Each stage is frozen; the list is not (it is the context's list; a nested one is frozen where it is put). */
    return { stages: out, shape };
  }

  /* ---- helpers over a shape ---- */

  /**
   * The resolution of a code path in the stored shape (`undefined`: not a stored path any more).
   *
   * @param shape - The shape.
   * @param path - The path in code names.
   * @returns The resolved path, or `undefined`.
   */
  private static resolve(shape: Shape, path: string): ResolvedPath | undefined {
    if (shape.schema === undefined || shape.overwritten.has(top(path))) return undefined;
    const resolution = PathResolver.resolve(shape.schema, path, "read");
    return resolution.ok ? resolution.value : undefined;
  }

  /**
   * A path as the stage must write it: in database names when encoding, as written otherwise.
   *
   * @param shape - The shape.
   * @param path - The path in code names.
   * @param mode - `cast` or `encode`.
   * @returns The path to write.
   */
  private static key(shape: Shape, path: string, mode: FilterMode): string {
    /*
     * Nothing stored under another name in this shape: every path is its own database path (no path
     * resolution per key). `hasAliases` covers the whole tree (`allPaths`) and the discriminators.
     */
    if (mode !== "encode" || (shape.fields.size === 0 && !AggregateStages.aliased(shape))) return path;
    return AggregateStages.resolve(shape, path)?.dbPath ?? AggregateStages.joinedKey(shape, path) ?? path;
  }

  /**
   * `true` when the stored documents of the shape have a field stored under another name.
   *
   * @param shape - The shape.
   * @returns Whether the shape's schema has aliased paths.
   */
  private static aliased(shape: Shape): boolean {
    return shape.schema !== undefined && AggregateStages.hasAliases(shape.schema);
  }

  /**
   * A path inside a field that holds stored documents of another schema (`$lookup.as`): `as` + translated rest.
   *
   * @param shape - The shape.
   * @param path - The path in code names.
   * @returns The translated path, or `undefined` when the path does not lead into a joined field.
   */
  private static joinedKey(shape: Shape, path: string): string | undefined {
    const head = top(path);
    const joined = shape.fields.get(head)?.schema;
    if (joined === undefined || head === path) return undefined;
    const resolution = PathResolver.resolve(joined, path.slice(head.length + 1), "read");
    return resolution.ok ? `${head}.${resolution.value.dbPath}` : undefined;
  }

  /**
   * A new field named by the pipeline: refused when it is the stored name of another field (ambiguous rows).
   *
   * @param shape - The shape.
   * @param key - The new field's name.
   * @throws {ConfigurationError} When `key` is the stored name of another field.
   */
  private static newKey(shape: Shape, key: string): void {
    const schema = shape.schema;
    if (schema === undefined || !AggregateStages.hasAliases(schema)) return;
    const clash = schema.fields.find((field) => field.dbKey === top(key) && field.key !== top(key));
    if (clash !== undefined) {
      throw new ConfigurationError(
        `${schema.name}: the pipeline names a field "${key}", which is the stored name (dbName) of "${clash.key}" — rows would be ambiguous; choose another name`,
      );
    }
  }

  /**
   * An expression with field references in database names (encode), checked for untranslatable values.
   *
   * @param shape - The shape.
   * @param expression - The expression.
   * @param mode - `cast` or `encode`.
   * @returns The expression, translated when encoding.
   * @throws {ConfigurationError} When a reference is a stored subdocument with aliased fields.
   */
  private static expr(shape: Shape, expression: unknown, mode: FilterMode): unknown {
    if (mode === "cast") return expression;
    const schema = shape.schema;
    if (schema === undefined || !AggregateStages.hasAliases(schema)) return expression;
    return ExpressionPaths.map(expression, (path) => {
      const resolved = AggregateStages.resolve(shape, path);
      if (resolved === undefined) return undefined;
      if (AggregateStages.aliasedSubtree(resolved.node, new Set())) {
        throw new ConfigurationError(
          `${schema.name}: "$${path}" is a stored subdocument with dbName fields; used as a value, its fields would keep their stored names — reference its scalar fields instead`,
        );
      }
      return resolved.dbPath;
    });
  }

  /**
   * `$$ROOT`/`$$CURRENT` of a model with aliases would hand stored names to the pipeline's rows.
   *
   * @param shape - The shape.
   * @param expression - The stage spec or expression to search.
   * @throws {ConfigurationError} When the shape has aliased fields and the expression uses `$$ROOT`/`$$CURRENT`.
   */
  private static checkRoot(shape: Shape, expression: unknown): void {
    const schema = shape.schema;
    if (schema === undefined || !AggregateStages.hasAliases(schema)) return;
    const text = JSON.stringify(expression) ?? "";
    if (text.includes('"$$ROOT') || text.includes('"$$CURRENT')) {
      throw new ConfigurationError(
        `${schema.name}: $$ROOT/$$CURRENT of a model with dbName fields would give stored names to the rows; list the fields instead`,
      );
    }
  }

  /**
   * Whether a node holds documents with an aliased field somewhere below.
   *
   * @param node - The path node.
   * @param seen - The schemas already visited (breaks cycles).
   * @returns `true` when a field below is stored under another name.
   */
  private static aliasedSubtree(node: PathNode, seen: Set<CompiledSchema>): boolean {
    switch (node.kind) {
      case "array":
        return AggregateStages.aliasedSubtree(node.element, seen);
      case "map":
        return AggregateStages.aliasedSubtree(node.value, seen);
      case "subdocument":
      case "nested": {
        if (seen.has(node.schema)) return false;
        seen.add(node.schema);
        return node.schema.fields.some(
          (field) => field.dbKey !== field.key || AggregateStages.aliasedSubtree(field, seen),
        );
      }
      default:
        return false;
    }
  }

  /**
   * The shape after the pipeline replaced the given top-level fields.
   *
   * @param shape - The shape.
   * @param keys - The fields (paths are cut to their top-level key).
   * @returns The new shape.
   */
  private static overwrite(shape: Shape, keys: Iterable<string>): Shape {
    if (shape.schema === undefined) return shape;
    const overwritten = new Set(shape.overwritten);
    for (const key of keys) overwritten.add(top(key));
    return { ...shape, overwritten };
  }

  /**
   * The shape with a field the pipeline added, whose values have a shape of their own.
   *
   * @param shape - The shape.
   * @param key - The field name.
   * @param value - The shape of the field's values.
   * @returns The new shape.
   */
  private static withField(shape: Shape, key: string, value: ResultShape): Shape {
    const fields = new Map(shape.fields);
    fields.set(key, value);
    return { ...shape, fields };
  }

  /**
   * A `$match` filter walked over the stored shape: overwritten fields are kept as written.
   *
   * @param shape - The shape.
   * @param filter - The filter.
   * @param mode - `cast` or `encode`.
   * @returns The cast or encoded filter.
   * @throws {PolicyError} When the filter is invalid.
   * @throws {CastError} When a value does not fit its field.
   */
  private static filter(shape: Shape, filter: unknown, mode: FilterMode): unknown {
    if (!plain(filter) || shape.schema === undefined) return filter;
    const overwritten = shape.overwritten;
    const walked = FilterCodec.walk(filter, shape.schema, mode, "", (key) => overwritten.has(top(key)));
    return mode === "encode" && shape.fields.size > 0 ? AggregateStages.joinedKeys(shape, walked) : walked;
  }

  /**
   * Filter keys under joined fields translated by the joined schema (top level and logical clauses).
   *
   * @param shape - The shape.
   * @param filter - The already walked filter.
   * @returns The filter with keys under joined fields translated.
   */
  private static joinedKeys(shape: Shape, filter: PlanDocument): PlanDocument {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      const translated =
        (key === "$and" || key === "$or" || key === "$nor") && Array.isArray(value)
          ? Object.freeze(
              value.map((clause: unknown) => (plain(clause) ? AggregateStages.joinedKeys(shape, clause) : clause)),
            )
          : value;
      SafeRecord.set(out, AggregateStages.joinedKey(shape, key) ?? key, translated);
    }
    return Object.freeze(out);
  }

  /**
   * The schema of another collection named by a stage.
   *
   * @param env - Finds the schemas of other collections.
   * @param collection - The collection name as written in the stage.
   * @returns The schema, or `undefined` when the name is not a string or no model stores it.
   */
  private static foreign(env: StageEnvironment, collection: unknown): CompiledSchema | undefined {
    return typeof collection === "string" ? env.schemaOfCollection(collection) : undefined;
  }

  /**
   * An object of field names to expressions (`$addFields`, `$project`, `$let` variables).
   *
   * @param shape - The shape.
   * @param spec - The object.
   * @param mode - `cast` or `encode`.
   * @param keys - `translate` writes the keys in database names, `keep` leaves them as written.
   * @returns A new object.
   * @throws {ConfigurationError} When a new field is named like the stored name of another field.
   */
  private static record(
    shape: Shape,
    spec: unknown,
    mode: FilterMode,
    keys: "translate" | "keep",
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!plain(spec)) return out;
    for (const [key, value] of Object.entries(spec)) {
      /* `newKey` refuses only over a shape with aliases: no resolution otherwise. */
      if (keys === "translate" && AggregateStages.aliased(shape) && AggregateStages.resolve(shape, key) === undefined) {
        AggregateStages.newKey(shape, key);
      }
      SafeRecord.set(
        out,
        keys === "translate" ? AggregateStages.key(shape, key, mode) : key,
        AggregateStages.expr(shape, value, mode),
      );
    }
    return out;
  }

  /**
   * A `$sort` spec with its keys in database names when encoding.
   *
   * @param shape - The shape.
   * @param spec - The spec.
   * @param mode - `cast` or `encode`.
   * @returns The frozen spec, or `spec` when it is not an object.
   */
  private static sortSpec(shape: Shape, spec: unknown, mode: FilterMode): unknown {
    if (!plain(spec)) return spec;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(spec)) SafeRecord.set(out, AggregateStages.key(shape, key, mode), value);
    return Object.freeze(out);
  }

  /**
   * Refuses a stage whose inner paths cannot be translated, over a model with aliased fields.
   *
   * @param shape - The shape.
   * @param name - The stage name.
   * @throws {ConfigurationError} When the shape has aliased fields.
   */
  private static unsupportedWithAliases(shape: Shape, name: string): void {
    if (shape.schema !== undefined && AggregateStages.hasAliases(shape.schema)) {
      throw new ConfigurationError(
        `${shape.schema.name}: ${name} over a model with dbName fields is not supported (paths inside it are not translated)`,
      );
    }
  }

  /* ---- one stage ---- */

  /**
   * One stage: its paths and literals translated, and the shape after it.
   *
   * @param name - The stage name (`$match`, `$lookup`, …).
   * @param spec - The stage's spec.
   * @param shape - The shape before the stage.
   * @param env - Finds the schemas of other collections.
   * @param mode - `cast` or `encode`.
   * @returns The translated spec and the shape after the stage.
   * @throws {ConfigurationError} When the stage cannot be translated honestly.
   */
  private static stage(
    name: string,
    spec: unknown,
    shape: Shape,
    env: StageEnvironment,
    mode: FilterMode,
  ): { readonly spec: unknown; readonly shape: Shape } {
    const S = AggregateStages;
    switch (name) {
      case "$match":
        if (mode === "encode") S.checkRoot(shape, spec);
        return { spec: S.filter(shape, spec, mode), shape };
      case "$sort":
        return { spec: S.sortSpec(shape, spec, mode), shape };
      case "$limit":
      case "$skip":
      case "$sample":
        return { spec, shape };
      case "$redact":
        if (mode === "encode") S.checkRoot(shape, spec);
        return { spec: S.expr(shape, spec, mode), shape };
      case "$addFields":
      case "$set": {
        const keys = plain(spec) ? Object.keys(spec) : [];
        return { spec: Object.freeze(S.record(shape, spec, mode, "translate")), shape: S.overwrite(shape, keys) };
      }
      case "$project": {
        if (!plain(spec)) return { spec, shape: FREE };
        const computed = Object.entries(spec).filter(
          ([, value]) => typeof value !== "number" && typeof value !== "boolean",
        );
        const out = S.record(shape, spec, mode, "translate");
        /* Included and kept fields stay stored values under stored names; computed ones are the pipeline's. */
        return {
          spec: Object.freeze(out),
          shape: S.overwrite(
            shape,
            computed.map(([key]) => key),
          ),
        };
      }
      case "$unset": {
        const list = typeof spec === "string" ? [spec] : Array.isArray(spec) ? (spec as unknown[]) : [];
        const translated = list.map((path) => (typeof path === "string" ? S.key(shape, path, mode) : path));
        return { spec: typeof spec === "string" ? translated[0] : Object.freeze(translated), shape };
      }
      case "$unwind": {
        if (typeof spec === "string") return { spec: S.fieldRef(shape, spec, mode), shape };
        if (!plain(spec)) return { spec, shape };
        const out: Record<string, unknown> = { ...spec };
        if (typeof spec.path === "string") out.path = S.fieldRef(shape, spec.path, mode);
        const index = spec.includeArrayIndex;
        if (typeof index === "string") S.newKey(shape, index);
        return { spec: Object.freeze(out), shape: typeof index === "string" ? S.overwrite(shape, [index]) : shape };
      }
      case "$group":
      case "$bucket":
      case "$bucketAuto":
      case "$sortByCount":
        if (mode === "encode") S.checkRoot(shape, spec);
        return { spec: S.expr(shape, spec, mode), shape: FREE };
      case "$count":
        return { spec, shape: FREE };
      case "$replaceRoot":
      case "$replaceWith": {
        const root = name === "$replaceRoot" && plain(spec) ? spec.newRoot : spec;
        if (
          env.document === true &&
          mode === "encode" &&
          plain(root) &&
          !Object.keys(root).some((key) => key.startsWith("$"))
        ) {
          /* The new stored document: its keys are fields (database names), like the keys of `$set`. */
          S.checkRoot(shape, root);
          const written = Object.freeze(S.record(shape, root, mode, "translate"));
          return { spec: name === "$replaceRoot" ? Object.freeze({ newRoot: written }) : written, shape: FREE };
        }
        const next = S.replacedShape(shape, root);
        if (mode === "encode" && next.schema === undefined) S.checkRoot(shape, root);
        const translated =
          typeof root === "string" && next.schema !== undefined
            ? S.fieldRef(shape, root, mode)
            : S.expr(shape, root, mode);
        return { spec: name === "$replaceRoot" ? Object.freeze({ newRoot: translated }) : translated, shape: next };
      }
      case "$setWindowFields": {
        if (!plain(spec)) return { spec, shape };
        const out: Record<string, unknown> = {};
        if (spec.partitionBy !== undefined) out.partitionBy = S.expr(shape, spec.partitionBy, mode);
        if (spec.sortBy !== undefined) out.sortBy = S.sortSpec(shape, spec.sortBy, mode);
        out.output = Object.freeze(S.record(shape, spec.output, mode, "translate"));
        const keys = plain(spec.output) ? Object.keys(spec.output) : [];
        return { spec: Object.freeze(out), shape: S.overwrite(shape, keys) };
      }
      case "$densify": {
        if (!plain(spec)) return { spec, shape };
        const out: Record<string, unknown> = { ...spec };
        if (typeof spec.field === "string") out.field = S.key(shape, spec.field, mode);
        if (Array.isArray(spec.partitionByFields)) {
          out.partitionByFields = spec.partitionByFields.map((path: unknown) =>
            typeof path === "string" ? S.key(shape, path, mode) : path,
          );
        }
        return { spec: Object.freeze(out), shape };
      }
      case "$fill": {
        if (!plain(spec)) return { spec, shape };
        const out: Record<string, unknown> = { ...spec };
        if (spec.partitionBy !== undefined) out.partitionBy = S.expr(shape, spec.partitionBy, mode);
        if (Array.isArray(spec.partitionByFields)) {
          out.partitionByFields = spec.partitionByFields.map((path: unknown) =>
            typeof path === "string" ? S.key(shape, path, mode) : path,
          );
        }
        if (spec.sortBy !== undefined) out.sortBy = S.sortSpec(shape, spec.sortBy, mode);
        out.output = Object.freeze(S.record(shape, spec.output, mode, "translate"));
        return {
          spec: Object.freeze(out),
          shape: S.overwrite(shape, plain(spec.output) ? Object.keys(spec.output) : []),
        };
      }
      case "$lookup":
        return S.lookup(spec, shape, env, mode);
      case "$graphLookup":
        return S.graphLookup(spec, shape, env, mode);
      case "$unionWith":
        return S.unionWith(spec, shape, env, mode);
      case "$facet": {
        if (!plain(spec)) return { spec, shape: FREE };
        const out: Record<string, unknown> = {};
        let next: Shape = FREE;
        for (const [branch, stages] of Object.entries(spec)) {
          const result = S.run(Array.isArray(stages) ? (stages as PipelineStage[]) : [], shape, env, mode);
          SafeRecord.set(out, branch, Object.freeze(result.stages));
          next = S.withField(next, branch, { schema: result.shape.schema, fields: result.shape.fields });
        }
        return { spec: Object.freeze(out), shape: next };
      }
      case "$geoNear": {
        if (!plain(spec)) return { spec, shape };
        const out: Record<string, unknown> = { ...spec };
        if (typeof spec.key === "string") out.key = S.key(shape, spec.key, mode);
        if (spec.query !== undefined) out.query = S.filter(shape, spec.query, mode);
        const added = [spec.distanceField, spec.includeLocs].filter((key): key is string => typeof key === "string");
        for (const key of added) S.newKey(shape, key);
        return { spec: Object.freeze(out), shape: S.overwrite(shape, added) };
      }
      case "$search":
      case "$searchMeta":
      case "$vectorSearch":
      case "$rankFusion":
      case "$scoreFusion":
      case "$score":
        if (mode === "encode") S.unsupportedWithAliases(shape, name);
        return { spec, shape: name === "$searchMeta" ? FREE : shape };
      case "$out":
      case "$merge": {
        if (mode === "encode") {
          const into = name === "$out" ? (plain(spec) ? spec.coll : spec) : plain(spec) ? spec.into : undefined;
          const target = typeof into === "string" ? env.schemaOfCollection(into) : undefined;
          if (target !== undefined && AggregateStages.hasAliases(target)) {
            throw new ConfigurationError(
              `${name} into ${target.name}, a model with dbName fields, is not supported: the rows are not translated`,
            );
          }
        }
        return { spec, shape: FREE };
      }
      default:
        /* Database-level and change-stream stages: no stored document of the model to translate. */
        if (mode === "encode") S.unsupportedWithAliases(shape, name);
        return { spec, shape: FREE };
    }
  }

  /**
   * A field reference (`"$path"`) with its path in database names when encoding; `$$` variables and
   * non-references stay as they are.
   *
   * @param shape - The shape.
   * @param ref - The reference text.
   * @param mode - `cast` or `encode`.
   * @returns The reference to write.
   */
  private static fieldRef(shape: Shape, ref: string, mode: FilterMode): string {
    return ref.startsWith("$") && !ref.startsWith("$$") ? `$${AggregateStages.key(shape, ref.slice(1), mode)}` : ref;
  }

  /**
   * The shape after `$replaceRoot`: a reference to a stored subdocument keeps a stored shape.
   *
   * @param shape - The shape before the stage.
   * @param root - The new root expression.
   * @returns The shape of the new root.
   */
  private static replacedShape(shape: Shape, root: unknown): Shape {
    if (typeof root !== "string" || !root.startsWith("$") || root.startsWith("$$")) return FREE;
    const resolved = AggregateStages.resolve(shape, root.slice(1));
    if (resolved === undefined) return FREE;
    let node = resolved.node;
    while (node.kind === "array") node = node.element;
    if (node.kind !== "subdocument" && node.kind !== "nested") return FREE;
    return { schema: node.schema, overwritten: new Set(), fields: new Map() };
  }

  /**
   * `$lookup`: local and foreign fields translated by their own schemas, the joined field gets the foreign shape.
   *
   * @param spec - The stage spec.
   * @param shape - The shape before the stage.
   * @param env - Finds the schemas of other collections.
   * @param mode - `cast` or `encode`.
   * @returns The translated spec and the shape after the stage.
   * @throws {ConfigurationError} When `as` is the stored name of another field.
   */
  private static lookup(
    spec: unknown,
    shape: Shape,
    env: StageEnvironment,
    mode: FilterMode,
  ): { readonly spec: unknown; readonly shape: Shape } {
    const S = AggregateStages;
    if (!plain(spec)) return { spec, shape };
    const foreign = S.foreign(env, spec.from);
    const foreignShape = S.initial(foreign);
    const out: Record<string, unknown> = { ...spec };
    if (typeof spec.localField === "string") out.localField = S.key(shape, spec.localField, mode);
    if (typeof spec.foreignField === "string") out.foreignField = S.key(foreignShape, spec.foreignField, mode);
    if (spec.let !== undefined) out.let = Object.freeze(S.record(shape, spec.let, mode, "keep"));
    let joined: ResultShape = { schema: foreign, fields: new Map() };
    if (Array.isArray(spec.pipeline)) {
      const result = S.run(spec.pipeline as PipelineStage[], foreignShape, env, mode);
      out.pipeline = Object.freeze(result.stages);
      joined = { schema: result.shape.schema, fields: result.shape.fields };
    }
    const as = typeof spec.as === "string" ? spec.as : "";
    S.newKey(shape, as);
    return { spec: Object.freeze(out), shape: S.withField(S.overwrite(shape, [as]), as, joined) };
  }

  /**
   * `$graphLookup`: connection fields and the restricting match translated by the foreign schema.
   *
   * @param spec - The stage spec.
   * @param shape - The shape before the stage.
   * @param env - Finds the schemas of other collections.
   * @param mode - `cast` or `encode`.
   * @returns The translated spec and the shape after the stage.
   * @throws {ConfigurationError} When `as` is the stored name of another field.
   */
  private static graphLookup(
    spec: unknown,
    shape: Shape,
    env: StageEnvironment,
    mode: FilterMode,
  ): { readonly spec: unknown; readonly shape: Shape } {
    const S = AggregateStages;
    if (!plain(spec)) return { spec, shape };
    const foreign = S.foreign(env, spec.from);
    const foreignShape = S.initial(foreign);
    const out: Record<string, unknown> = { ...spec };
    out.startWith = S.expr(shape, spec.startWith, mode);
    if (typeof spec.connectFromField === "string")
      out.connectFromField = S.key(foreignShape, spec.connectFromField, mode);
    if (typeof spec.connectToField === "string") out.connectToField = S.key(foreignShape, spec.connectToField, mode);
    if (spec.restrictSearchWithMatch !== undefined) {
      out.restrictSearchWithMatch = S.filter(foreignShape, spec.restrictSearchWithMatch, mode);
    }
    const as = typeof spec.as === "string" ? spec.as : "";
    S.newKey(shape, as);
    const joined: ResultShape = { schema: foreign, fields: new Map() };
    return { spec: Object.freeze(out), shape: S.withField(S.overwrite(shape, [as]), as, joined) };
  }

  /**
   * `$unionWith`: the inner pipeline is walked over the other collection's shape; rows of two different stored
   * shapes cannot be translated back when either has aliased fields.
   *
   * @param spec - The stage spec (a collection name, or an object with `coll` and `pipeline`).
   * @param shape - The shape before the stage.
   * @param env - Finds the schemas of other collections.
   * @param mode - `cast` or `encode`.
   * @returns The translated spec and the shape after the stage.
   * @throws {ConfigurationError} When the two shapes differ and one has aliased fields (encode).
   */
  private static unionWith(
    spec: unknown,
    shape: Shape,
    env: StageEnvironment,
    mode: FilterMode,
  ): { readonly spec: unknown; readonly shape: Shape } {
    const S = AggregateStages;
    const coll = typeof spec === "string" ? spec : plain(spec) ? spec.coll : undefined;
    const other = S.foreign(env, coll);
    const out: Record<string, unknown> | string = typeof spec === "string" ? spec : plain(spec) ? { ...spec } : {};
    let otherSchema = other;
    if (plain(spec) && Array.isArray(spec.pipeline) && typeof out === "object") {
      const result = S.run(spec.pipeline as PipelineStage[], S.initial(other), env, mode);
      out.pipeline = Object.freeze(result.stages);
      otherSchema = result.shape.schema;
    }
    const same = otherSchema === shape.schema && shape.overwritten.size === 0;
    if (!same && mode === "encode") {
      const aliased = [shape.schema, otherSchema].find((schema) => schema !== undefined && S.hasAliases(schema));
      if (aliased !== undefined) {
        throw new ConfigurationError(
          `$unionWith mixes rows of two stored shapes and ${aliased.name} has dbName fields: the rows could not be translated back`,
        );
      }
    }
    return { spec: typeof out === "string" ? out : Object.freeze(out), shape: same ? shape : FREE };
  }
}
