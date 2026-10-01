import { ConfigurationError } from "../../errors/configuration-error.ts";
import type { CompiledSchema } from "../../schema/compiler/compiled-schema.ts";
import { type CompileContext, SchemaCompiler } from "../../schema/compiler/schema-compiler.ts";
import { IndexHelpers } from "../../schema/indexes/index-helpers.ts";
import type { EntityClass } from "../../schema/options/type-spec.ts";
import type { HiddenPaths } from "../../types/projection.ts";
import type { PipelineDoc, VisibleDoc } from "../types/doc-shape.ts";

/*
 * Where a pipeline reads from. A source is an entity class (`@Schema` class): its collection comes from the compiled
 * schema. A typed source (`PipelineSource<Doc>`: an object with a `pipelineTarget`) is accepted everywhere an entity
 * class is (`Pipeline.from`, `lookup.from`, `unionWith`, `graphLookup.from`, `merge.into`, `out`).
 *
 * The document type is carried by ONE phantom member (inferring the document through all members of a big model
 * type gave a garbage union or `never`).
 */

/** Type-level key of the phantom document type of a source. */
declare const SOURCE_DOC: unique symbol;

/**
 * Where the documents of a pipeline come from.
 *
 * @example
 * ```ts
 * const collection: PipelineTarget = {
 *   kind: "collection", collection: "users", entity: User, discriminator: undefined,
 * };
 * const database: PipelineTarget = { kind: "database", admin: false };
 * const sessions: PipelineTarget = { kind: "sessions" };
 * ```
 */
export type PipelineTarget =
  | {
      /** A collection. */
      readonly kind: "collection";
      /** The collection name. */
      readonly collection: string;
      /** The entity, when the source is typed by one (for the discriminator filter, hooks and policies). */
      readonly entity: EntityClass | undefined;
      /** Set for a discriminator entity: the operation restricts the pipeline to its documents. */
      readonly discriminator: { readonly key: string; readonly value: string } | undefined;
    }
  | {
      /** A whole database (`$documents`, `$currentOp`, …). */
      readonly kind: "database";
      /** Whether the `admin` database is targeted. */
      readonly admin: boolean;
    }
  | {
      /** The collection `config.system.sessions` (`$listSessions`). */
      readonly kind: "sessions";
    };

/**
 * Anything a pipeline can read from, typed by its stored document.
 *
 * @typeParam Doc - The stored document type.
 * @example
 * ```ts
 * const source: PipelineSource<{ name: string }> = {
 *   pipelineTarget: { kind: "collection", collection: "users", entity: undefined, discriminator: undefined },
 * };
 * ```
 */
export interface PipelineSource<Doc> {
  /** Phantom: the stored document type. */
  readonly [SOURCE_DOC]?: readonly [Doc];
  /** Where the documents come from. */
  readonly pipelineTarget: PipelineTarget;
}

/**
 * An entity class or a typed source.
 *
 * @example
 * ```ts
 * const a: SourceInput = User;
 * const b: SourceInput = {
 *   pipelineTarget: { kind: "collection", collection: "users", entity: undefined, discriminator: undefined },
 * };
 * ```
 */
export type SourceInput = EntityClass | PipelineSource<unknown>;

/**
 * The document type a pipeline READS from a source: an entity's stored document without its `Hidden`
 * fields (`Plus`: the ones included explicitly), a typed source's own document.
 *
 * @typeParam S - The source type.
 * @typeParam Plus - Hidden paths included explicitly.
 * @example
 * ```ts
 * type A = DocOf<typeof User>; // the stored User without Hidden fields
 * type B = DocOf<PipelineSource<{ n: number }>>; // { n: number }
 * ```
 */
export type DocOf<S, Plus extends string = never> =
  S extends PipelineSource<infer D> ? D : S extends abstract new () => infer I ? VisibleDoc<I, Plus> : never;

/**
 * The document type a source STORES (hidden fields included): update pipelines, `$merge` targets, change streams.
 *
 * @typeParam S - The source type.
 * @example
 * ```ts
 * type A = StoredDocOf<typeof User>; // the stored User with Hidden fields
 * ```
 */
export type StoredDocOf<S> =
  S extends PipelineSource<infer D> ? D : S extends abstract new () => infer I ? PipelineDoc<I> : never;

/**
 * The hidden paths of an entity source (what `include` may name), `never` for other sources.
 *
 * @typeParam S - The source type.
 * @example
 * ```ts
 * type A = HiddenOf<typeof User>; // "passwordHash"
 * type B = HiddenOf<PipelineSource<unknown>>; // never
 * ```
 */
export type HiddenOf<S> = S extends abstract new () => infer I ? HiddenPaths<I> : never;

/**
 * The instance type (class) of an entity source, for row checks against a target class.
 *
 * @typeParam S - The source type.
 * @example
 * ```ts
 * type A = EntityOf<typeof User>; // User
 * type B = EntityOf<PipelineSource<unknown>>; // never
 * ```
 */
export type EntityOf<S> = S extends abstract new () => infer I ? I : never;

/**
 * Whether a source input is a typed source (an object with a `pipelineTarget`) rather than an entity class.
 *
 * @param value - The source input.
 * @returns `true` for a typed source.
 */
const isSource = (value: SourceInput): value is PipelineSource<unknown> =>
  typeof value === "object" && value !== null && "pipelineTarget" in value;

/*
 * The schema of the entity a stage names as its other collection (`$lookup.from`, `$unionWith`, `$graphLookup.from`,
 * `$out`, `$merge.into`), by the stage object. The policies of a joined collection (soft delete, tenant, Hidden)
 * come from this schema: a model of the entity need not exist on the connection. A stage written by hand names a
 * collection by a string and carries no entity.
 */
const NAMED = new WeakMap<object, CompiledSchema>();
/* The schemas named by the stages of a pipeline, computed once per (frozen) stage array. */
const NAMED_BY_PIPELINE = new WeakMap<readonly unknown[], ReadonlyMap<string, CompiledSchema>>();

/** Resolves pipeline sources: their targets, collections and schemas. */
export class PipelineSources {
  /**
   * The compile context of the model whose pipeline is being built (`within`). An entity named as a
   * source (`$lookup.from`, `$unionWith`, …) is compiled with the extensions of THAT model's client: an
   * entity using an extension registered only by `client.use()` compiles. Outside a model (`Pipeline.from` at
   * the top level) it is the default context — the global registry (`Typemo.use()`).
   */
  static #context: CompileContext | undefined;

  /**
   * Runs a (synchronous) pipeline build with the compile context of a model's connection.
   *
   * @typeParam R - The type the build returns.
   * @param context - The compile context of the model's client.
   * @param build - The synchronous build to run.
   * @returns What `build` returns; the previous context is restored afterwards.
   */
  static within<R>(context: CompileContext, build: () => R): R {
    const outer = PipelineSources.#context;
    PipelineSources.#context = context;
    try {
      return build();
    } finally {
      PipelineSources.#context = outer;
    }
  }

  /**
   * The target of a source. An entity is compiled (`SchemaCompiler.compileModel`: it must be a model
   * with `_id`). Stages name CODE paths; a class with `dbName` aliases is translated to the stored names
   * by the operation pipeline while the documents are stored documents (H14).
   *
   * @param source - The entity class or typed source.
   * @returns The target: collection name, entity and discriminator.
   * @throws {ConfigurationError} When an entity is not a valid model.
   */
  static targetOf(source: SourceInput): PipelineTarget {
    if (isSource(source)) return source.pipelineTarget;
    const schema = SchemaCompiler.compileModel(source, PipelineSources.#context);
    return {
      kind: "collection",
      collection: schema.collection,
      entity: source,
      discriminator:
        schema.discriminator === undefined
          ? undefined
          : { key: schema.discriminator.key, value: schema.discriminator.value },
    };
  }

  /**
   * The collection name of a source (`$lookup.from`, `$unionWith.coll`, `$merge.into`, `$out`).
   *
   * @param source - The entity class or typed source.
   * @returns The collection name.
   * @throws {ConfigurationError} When the source is a database-level target.
   */
  static collectionOf(source: SourceInput): string {
    const target = PipelineSources.targetOf(source);
    if (target.kind !== "collection") throw new ConfigurationError("a database-level source has no collection");
    return target.collection;
  }

  /**
   * The compiled schema of an entity source (for hint checks), `undefined` for other sources.
   *
   * @param source - The entity class or typed source.
   * @returns The compiled schema, or `undefined` for a typed source.
   */
  static schemaOf(source: SourceInput): CompiledSchema | undefined {
    return isSource(source) ? undefined : SchemaCompiler.compileModel(source, PipelineSources.#context);
  }

  /**
   * Remembers the entity a stage names as its other collection, so that the operation applies the policies of
   * THAT entity's schema to the joined documents (and casts them by it) whether or not a model of it was created.
   * A typed source without an entity is not remembered.
   *
   * @param stage - The stage object (`{ $lookup: … }`, `{ $unionWith: … }`, …) as it goes into the pipeline.
   * @param source - The entity class or typed source the stage names.
   * @returns The same stage object.
   * @throws {ConfigurationError} When an entity is not a valid model.
   */
  static named<S extends object>(stage: S, source: SourceInput): S {
    if (isSource(source)) {
      const target = source.pipelineTarget;
      if (target.kind !== "collection" || target.entity === undefined) return stage;
      NAMED.set(stage, SchemaCompiler.compileModel(target.entity, PipelineSources.#context).root);
      return stage;
    }
    NAMED.set(stage, SchemaCompiler.compileModel(source, PipelineSources.#context).root);
    return stage;
  }

  /**
   * The schemas of the entities the stages name as other collections (also inside `$lookup`/`$unionWith`
   * sub-pipelines and `$facet` branches), by collection name. Discriminators give their root's schema: it
   * describes the shared collection.
   *
   * @param stages - The stages of a pipeline.
   * @returns The schemas by collection name; empty when no stage names an entity.
   * @throws {ConfigurationError} When two different entities name the same collection in one pipeline.
   */
  static namedSchemas(stages: readonly unknown[]): ReadonlyMap<string, CompiledSchema> {
    const cached = NAMED_BY_PIPELINE.get(stages);
    if (cached !== undefined) return cached;
    const found = new Map<string, CompiledSchema>();
    PipelineSources.collectNamed(stages, found);
    NAMED_BY_PIPELINE.set(stages, found);
    return found;
  }

  /**
   * Walks the stages (and their sub-pipelines) for remembered entities.
   *
   * @param stages - The stages.
   * @param found - Collects the schemas by collection name.
   * @throws {ConfigurationError} When two different entities name the same collection.
   */
  private static collectNamed(stages: readonly unknown[], found: Map<string, CompiledSchema>): void {
    for (const stage of stages) {
      if (typeof stage !== "object" || stage === null) continue;
      const schema = NAMED.get(stage);
      if (schema !== undefined) {
        const known = found.get(schema.collection);
        if (known !== undefined && known !== schema) {
          throw new ConfigurationError(
            `one aggregation names two entities of the collection "${schema.collection}" (${known.name} and ${schema.name}); their policies may differ, so name one of them`,
          );
        }
        found.set(schema.collection, schema);
      }
      const record = stage as Readonly<Record<string, unknown>>;
      for (const key of ["$lookup", "$unionWith"]) {
        const spec = record[key];
        if (typeof spec === "object" && spec !== null && Array.isArray((spec as { pipeline?: unknown }).pipeline)) {
          PipelineSources.collectNamed((spec as { pipeline: readonly unknown[] }).pipeline, found);
        }
      }
      const facet = record.$facet;
      if (typeof facet === "object" && facet !== null) {
        for (const branch of Object.values(facet)) {
          if (Array.isArray(branch)) PipelineSources.collectNamed(branch, found);
        }
      }
    }
  }

  /**
   * Checks a `hint` against the indexes the schema declares (by name or by the exact key spec). Types
   * check that the hint's paths exist; which indexes exist is known only at run time.
   *
   * @param schema - The compiled schema of the source entity.
   * @param hint - An index name or a key spec.
   * @throws {ConfigurationError} When the hint matches no declared index.
   */
  static assertHint(schema: CompiledSchema, hint: string | Readonly<Record<string, unknown>>): void {
    const names = schema.indexes.map((index) => IndexHelpers.nameOf(index));
    const found =
      typeof hint === "string"
        ? hint === "_id_" || names.includes(hint)
        : (Object.keys(hint).length === 1 && hint._id !== undefined) ||
          schema.indexes.some(
            (index) => JSON.stringify(Object.entries(index.keys)) === JSON.stringify(Object.entries(hint)),
          );
    if (!found) {
      throw new ConfigurationError(
        `${schema.target.name}: hint ${JSON.stringify(hint)} matches no declared index (declared: ${["_id_", ...names].join(", ")})`,
      );
    }
  }
}
