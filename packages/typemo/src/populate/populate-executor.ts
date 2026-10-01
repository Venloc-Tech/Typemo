import type { ClientSession } from "mongodb";
import type { PipelineStage } from "../aggregate/pipeline/aggregate-plan.ts";
import { BsonGuards } from "../bson/bson-guards.ts";
import type { Connection } from "../connection/connection.ts";
import { Collections } from "../document/collections/collections.ts";
import { Subdocuments } from "../document/collections/subdocument.ts";
import { DocumentSerializer } from "../document/document-serializer.ts";
import { DocumentStates } from "../document/document-state.ts";
import { Documents } from "../document/documents.ts";
import { PopulatedFields } from "../document/populated-fields.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { QueryError } from "../errors/query-error.ts";
import { DocumentHooks } from "../hooks/document-hooks.ts";
import { DocumentReader } from "../model/document-reader.ts";
import type { Model } from "../model/model.ts";
import { ModelInternals } from "../model/model-internals.ts";
import { PlainReader } from "../model/plain-reader.ts";
import { ReadValidator } from "../model/read-validator.ts";
import type { AggregateExecutionPlan } from "../operation/pipeline/execution-plan.ts";
import type { OperationContext } from "../operation/pipeline/operation-context.ts";
import { OperationView } from "../operation/steps/operation-view.ts";
import { PathResolver } from "../operation/steps/path-resolver.ts";
import type { FindPlan, PlanDocument, PlanOptions, PopulatePlan } from "../query/plan.ts";
import { ProjectionPlanner } from "../query/projection-planner.ts";
import type { CompiledSchema } from "../schema/compiler/compiled-schema.ts";
import type { PathNode } from "../schema/compiler/path-node.ts";
import { SchemaWalker } from "../schema/compiler/schema-walker.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import type { VirtualOptions } from "../schema/options/virtual-options.ts";
import { PopulateAssigner, type Site, type Slot, type SlotResults } from "./populate-assigner.ts";
import { PopulatePlanner, type Population } from "./populate-planner.ts";
import { PopulateKeys } from "./populated-values.ts";

/** Values per `$in` / per `$lookup` batch (Mongoose H031: one `$in` above 16 MB failed). */
const IN_BATCH = 50_000;
/** Populate queries in flight at once outside transactions and write sessions. */
const CONCURRENCY = 8;

/**
 * How a populate runs (from the parent operation, or from `$populate`).
 *
 * @example
 * ```ts
 * const run: PopulateRun = {
 *   connection, session: undefined, sequential: false, lean: false, parent: undefined, options: {},
 * };
 * ```
 */
export interface PopulateRun {
  /** The connection whose models the sub-queries run on. */
  readonly connection: Connection;
  /** The parent's session (sub-queries use it, or none: `session(null)` semantics). */
  readonly session: ClientSession | undefined;
  /** One query after another (transaction, write session). */
  readonly sequential: boolean;
  /** Lean results (plain objects) instead of hydrated documents. */
  readonly lean: boolean;
  /** The parent operation (instrumentation nests the sub-queries under it). */
  readonly parent: OperationContext | undefined;
  /** Read options the sub-queries inherit (readPreference/readConcern/timeoutMS/comment; Mongoose H111). */
  readonly options: Omit<PlanOptions, "session">;
  /** The populated path of the current sub-queries (instrumentation: `OperationInfo.populatePath`). */
  readonly populatePath?: string;
}

/** A document of the populated level and the schema it is an instance of. */
interface Owner {
  /** The object that holds the reference field. */
  readonly object: Record<string, unknown>;
  /** The schema of `object`. */
  readonly schema: CompiledSchema;
  /** The root document of the level (what a `match` function receives). */
  readonly root: object;
}

/** A set of target documents found for a population and a target model. */
interface Found {
  /** The target model the documents belong to. */
  readonly model: Model<object>;
  /** Documents by the key of each of their foreign values (a document may be under several keys). */
  readonly byKey: Map<string, object[]>;
  /** For per-owner queries (`$lookup`, one owner), the documents of each slot. */
  readonly bySlot: Map<Slot, readonly object[]> | undefined;
  /** For a count: the matching document count per slot. */
  readonly counts: Map<Slot, number> | undefined;
  /** Result order of the documents (for `sort`). */
  readonly order: Map<object, number>;
}

/** A plain document-like record. */
type Doc = Record<string, unknown>;

/**
 * Runs the populations of a list of documents. Every query is an ordinary operation of the TARGET
 * model through the connection's operation pipeline (session, sanitize — Mongoose H145 / CVE-2025-23061 —
 * and the other policies, casting, dbName, hooks, instrumentation nested under the parent operation):
 * no side path.
 *
 * Queries, per population and target model:
 * - references and virtuals: ONE `find` with `{ foreignField: { $in: ids } }` (`$and` the virtual's `match`
 *   and the call's `match`), split into batches of at most `IN_BATCH` values; per-document
 *   `limit`/`skip`/`justOne` of REFERENCES are applied to that result per owner (a reference array holds
 *   its ids: nothing unbounded is fetched), exactly — no Mongoose "limit × N";
 * - a VIRTUAL with a per-document limit (`limit`, `perDocumentLimit`, `skip`, `justOne`) on several owners:
 *   ONE aggregation with `$lookup` + `$limit` per owner — the owners' local values are given as data,
 *   so the documents in memory decide (not a re-read of the parents); one owner: a `find` with the limit;
 * - a `count` virtual: ONE aggregation counting per foreign value (`$group`), not a download of the documents;
 * - a `match` FUNCTION: one query per document it is called with (server semantics, no client filter);
 * - nothing to look up: no query.
 *
 * Inside a transaction, or in an explicit session of a write, the queries run one after another
 * (Mongoose H134); otherwise in parallel, at most `CONCURRENCY` at a time. Nested populate runs on the
 * documents found, before they are assigned (a transform sees them populated).
 *
 * `clone: true` (off by default): every owner gets its OWN copy of a found document (a hydrated
 * copy is hydrated again from the found document's data — fresh from the database, nothing changed yet; a
 * lean copy is a deep copy). Nested populate then runs on the copies, after they are assigned, so the copies
 * share nothing. Without `clone` a document found for several owners is one object in all of them.
 *
 * @example
 * ```ts
 * await PopulateExecutor.populate(docs, schema, plans, run);
 * ```
 */
export class PopulateExecutor {
  /**
   * Populates `docs` (documents of `schema`, hydrated or lean as `run.lean` says) with `plans`.
   *
   * @param docs - The documents to populate.
   * @param schema - The compiled schema of `docs`.
   * @param plans - The populate instructions.
   * @param run - How the populate runs.
   * @param prefix - The path of `docs` from the root populate, used in messages.
   * @throws {QueryError} If a plan is invalid or a sub-query fails.
   * @throws {DocumentNotFoundError} If a `required` reference found nothing.
   */
  static async populate(
    docs: readonly object[],
    schema: CompiledSchema,
    plans: readonly PopulatePlan[],
    run: PopulateRun,
    prefix = "",
  ): Promise<void> {
    if (plans.length === 0 || docs.length === 0) return;
    const populations = PopulatePlanner.plan(schema, plans, prefix);
    /* A match function sees each document as it was BEFORE any path was populated (its lean
     * form, ids) — whichever populations of the list ran first (Mongoose H064). */
    const snapshots = populations.some((population) => population.matchFn !== undefined)
      ? new Map(docs.map((doc) => [doc, PopulateExecutor.snapshot(doc)] as const))
      : undefined;
    await PopulateExecutor.each(
      populations.map(
        (population) => () => PopulateExecutor.population(docs, schema, population, run, prefix, snapshots),
      ),
      run.sequential,
    );
  }

  /**
   * The lean form of a document with its stored ids (hydrated: containers plain, Maps as records; lean: a deep copy).
   *
   * @param doc - A hydrated or lean document.
   * @returns The plain snapshot.
   */
  private static snapshot(doc: object): object {
    if (!DocumentStates.is(doc)) return PopulateExecutor.copy(doc) as object;
    const out: Doc = {};
    for (const node of DocumentStates.of(doc).schema.fields) {
      if (!Object.hasOwn(doc, node.key)) continue;
      const value = PopulatedFields.stored(doc, node.key, (doc as Doc)[node.key]);
      if (value === undefined) continue;
      Object.defineProperty(out, node.key, {
        value: Collections.toPlain(value, { maps: "record" }),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }

  /**
   * Deep-copies dates, arrays and literal objects; every other value is returned as is.
   *
   * @param value - The value to copy.
   * @returns The copy.
   */
  private static copy(value: unknown): unknown {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map((item: unknown) => PopulateExecutor.copy(item));
    if (!BsonGuards.isPojo(value)) return value;
    const out: Doc = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(out, key, {
        value: PopulateExecutor.copy(item),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }

  /**
   * Runs tasks one after another, or at most `CONCURRENCY` at once; the first error is thrown after all settle.
   *
   * @param tasks - The tasks to run.
   * @param sequential - `true` to run them strictly one after another.
   * @throws The first error a task raised, after every task settled.
   */
  static async each(tasks: readonly (() => Promise<void>)[], sequential: boolean): Promise<void> {
    if (sequential || tasks.length <= 1) {
      for (const task of tasks) await task();
      return;
    }
    const errors: unknown[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < tasks.length) {
        const task = tasks[next++] as () => Promise<void>;
        try {
          await task();
        } catch (error) {
          errors.push(error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
    if (errors.length > 0) throw errors[0];
  }

  /**
   * Runs one population: collects the sites, queries the target models and assigns the results.
   *
   * @param docs - The documents of the level.
   * @param schema - Their schema.
   * @param population - The planned population.
   * @param run - How the populate runs.
   * @param prefix - The path prefix for messages.
   * @param snapshots - Pre-populate snapshots for `match` functions, if any population has one.
   */
  private static async population(
    docs: readonly object[],
    schema: CompiledSchema,
    population: Population,
    run: PopulateRun,
    prefix: string,
    snapshots: ReadonlyMap<object, object> | undefined,
  ): Promise<void> {
    const sites = docs.flatMap((doc) => PopulateExecutor.sites(doc, schema, population, run, prefix));
    if (sites.length === 0) return;
    /* Transform results are values of the user, not documents: the documents they are made from are lean. */
    const lean = run.lean || population.transform !== undefined;
    const childRun: PopulateRun = lean === run.lean ? run : { ...run, lean };
    /* Targets: per slot value, the model it points to. */
    const requests = new Map<Model<object>, Map<Slot, unknown[]>>();
    for (const site of sites) {
      for (const slot of site.slots) {
        for (const value of slot.locals) {
          if (value === null || value === undefined) continue;
          const model = PopulateExecutor.target(site, value, run, prefix, population);
          let bySlot = requests.get(model);
          if (bySlot === undefined) {
            bySlot = new Map();
            requests.set(model, bySlot);
          }
          const list = bySlot.get(slot) ?? [];
          list.push(value);
          bySlot.set(slot, list);
        }
      }
    }
    const results = new Map<Model<object>, Found[]>();
    /* The results a slot may use: those of the queries it took part in (a match function gives each document
     * its own query — another document's result must never leak into it). */
    const bySlotFound = new Map<Slot, Found[]>();
    const tasks: (() => Promise<void>)[] = [];
    for (const [model, bySlot] of requests) {
      for (const group of PopulateExecutor.byMatch(sites, bySlot, population, snapshots)) {
        tasks.push(async () => {
          const found = await PopulateExecutor.query(model, group.slots, group.match, population, childRun, prefix);
          const list = results.get(model) ?? [];
          list.push(found);
          results.set(model, list);
          for (const slot of group.slots.keys()) {
            const own = bySlotFound.get(slot) ?? [];
            own.push(found);
            bySlotFound.set(slot, own);
          }
        });
      }
    }
    await PopulateExecutor.each(tasks, run.sequential);
    if (population.clone) {
      await PopulateExecutor.assignCopies(sites, population, results, bySlotFound, childRun, run, prefix);
      return;
    }
    /* Nested populate on the documents found (each model once), before they are assigned. */
    if (population.populate.length > 0) {
      await PopulateExecutor.each(
        [...results].map(([model, found]) => async () => {
          const unique = [...new Set(found.flatMap((one) => [...one.order.keys()]))];
          await PopulateExecutor.populate(
            unique,
            ModelInternals.schema(model),
            population.populate,
            childRun,
            `${prefix}${population.path}.`,
          );
        }),
        run.sequential,
      );
    }
    PopulateAssigner.assign(sites, population, (site, slot) =>
      PopulateExecutor.documentsOf(site, slot, population, bySlotFound.get(slot) ?? [], run, prefix),
    );
  }

  /**
   * `clone: true`: assigns a copy of each found document per slot (one copy per owner field), then runs
   * the nested populate on the copies (grouped by the model they come from).
   *
   * @param sites - The sites to fill.
   * @param population - The planned population.
   * @param results - The found documents per target model.
   * @param bySlotFound - The results each slot may use.
   * @param childRun - The run for nested populates.
   * @param run - The run of this level.
   * @param prefix - The path prefix for messages.
   */
  private static async assignCopies(
    sites: readonly Site[],
    population: Population,
    results: ReadonlyMap<Model<object>, readonly Found[]>,
    bySlotFound: ReadonlyMap<Slot, readonly Found[]>,
    childRun: PopulateRun,
    run: PopulateRun,
    prefix: string,
  ): Promise<void> {
    const origin = new Map<object, Model<object>>();
    for (const [model, founds] of results)
      for (const found of founds) for (const doc of found.order.keys()) origin.set(doc, model);
    const copies = new Map<Model<object>, object[]>();
    PopulateAssigner.assign(sites, population, (site, slot) => {
      const found = PopulateExecutor.documentsOf(site, slot, population, bySlotFound.get(slot) ?? [], run, prefix);
      /* One copy per original within a slot: `all()` (sort order) and `byKey` must agree on identity. */
      const own = new Map<object, object>();
      const copyOf = (doc: object): object => {
        const existing = own.get(doc);
        if (existing !== undefined) return existing;
        const copy = PopulateExecutor.copyDocument(doc, childRun);
        own.set(doc, copy);
        const model = origin.get(doc);
        if (model !== undefined) {
          copies.set(model, [...(copies.get(model) ?? []), copy]);
          if (!DocumentStates.is(copy)) PlainReader.remember(copy, ModelInternals.schema(model));
        }
        return copy;
      };
      return {
        byKey: (value) => {
          const doc = found.byKey(value);
          return doc === undefined ? undefined : copyOf(doc);
        },
        all: () => found.all().map(copyOf),
        count: found.count,
      };
    });
    if (population.populate.length === 0) return;
    await PopulateExecutor.each(
      [...copies].map(
        ([model, docs]) =>
          () =>
            PopulateExecutor.populate(
              docs,
              ModelInternals.schema(model),
              population.populate,
              childRun,
              `${prefix}${population.path}.`,
            ),
      ),
      run.sequential,
    );
  }

  /**
   * An owner's own copy of a found document (fresh from the database: nothing changed, nothing populated).
   *
   * @param doc - The found document.
   * @param run - The populate run.
   * @returns The copy.
   */
  private static copyDocument(doc: object, run: PopulateRun): object {
    if (!DocumentStates.is(doc)) return PopulateExecutor.copy(doc) as object;
    const state = DocumentStates.of(doc);
    const stored = SchemaWalker.encodeDocument(state.schema, DocumentSerializer.data(doc, state.schema));
    return Documents.hydrate(run.connection, state.schema, stored, {
      selection: state.selection,
      partial: state.partial,
      session: state.session ?? undefined,
      /* A record the core built from its own document (own enumerable keys only), like a driver record. */
      driver: true,
    });
  }

  /**
   * The sites of one document: the owners reached by `population.owners` that have the field.
   *
   * @param doc - The document.
   * @param schema - Its schema.
   * @param population - The planned population.
   * @param run - The populate run.
   * @param prefix - The path prefix for messages.
   * @returns The sites found.
   */
  private static sites(
    doc: object,
    schema: CompiledSchema,
    population: Population,
    run: PopulateRun,
    prefix: string,
  ): Site[] {
    let owners: Owner[] = [{ object: doc as Doc, schema: PopulateExecutor.schemaOfRoot(doc, schema), root: doc }];
    for (let index = 0; index < population.owners.length; index++) {
      const segment = population.owners[index] as string;
      const entersMap = population.owners[index + 1] === "$*";
      const next: Owner[] = [];
      for (const owner of owners) {
        const node = owner.schema.field(segment);
        /* A discriminator without the field (Mongoose H011). */
        if (node === undefined) continue;
        const value = owner.object[segment];
        const embedded = PopulateExecutor.embeddedNode(node, entersMap);
        if (embedded === undefined) continue;
        for (const item of PopulateExecutor.items(value, entersMap)) {
          next.push({ object: item, schema: PopulateExecutor.schemaOfEmbedded(item, embedded), root: owner.root });
        }
      }
      if (entersMap) index++;
      owners = next;
    }
    const sites: Site[] = [];
    for (const owner of owners) {
      const site = PopulateAssigner.site(owner, population, run, prefix);
      if (site !== undefined) sites.push(site);
    }
    return sites;
  }

  /**
   * The node whose values are the next owners (an element of an array, a value of a Map).
   *
   * @param node - The field node.
   * @param entersMap - Whether the path enters the values of a Map.
   * @returns The embedded node, or `undefined` when the node holds no embedded documents.
   */
  private static embeddedNode(node: PathNode, entersMap: boolean): PathNode | undefined {
    let current = node;
    while (current.kind === "array") current = current.element;
    if (entersMap) {
      if (current.kind !== "map") return undefined;
      current = current.value;
      while (current.kind === "array") current = current.element;
    }
    return current.kind === "subdocument" || current.kind === "nested" ? current : undefined;
  }

  /**
   * The embedded documents in a value (arrays flattened, Map values when entering a Map).
   *
   * @param value - The stored value.
   * @param entersMap - Whether the path enters the values of a Map.
   * @returns The embedded documents.
   */
  private static items(value: unknown, entersMap: boolean): Doc[] {
    if (value === null || value === undefined) return [];
    if (entersMap) {
      const values = BsonGuards.isMap(value)
        ? [...value.values()]
        : BsonGuards.isPlainObject(value)
          ? Object.values(value)
          : [];
      return values.flatMap((item) => PopulateExecutor.items(item, false));
    }
    if (Array.isArray(value)) return value.flatMap((item: unknown) => PopulateExecutor.items(item, false));
    return typeof value === "object" ? [value as Doc] : [];
  }

  /**
   * The schema of a root document (its discriminator's when it has one).
   *
   * @param doc - The document.
   * @param schema - The base schema.
   * @returns The schema that describes `doc`.
   */
  private static schemaOfRoot(doc: object, schema: CompiledSchema): CompiledSchema {
    return DocumentStates.is(doc) ? DocumentStates.of(doc).schema : PopulateExecutor.byKey(doc as Doc, schema);
  }

  /**
   * The schema of an embedded document (its discriminator's when it has one).
   *
   * @param item - The embedded document.
   * @param node - The subdocument node it belongs to.
   * @returns The schema that describes `item`.
   */
  private static schemaOfEmbedded(item: Doc, node: PathNode): CompiledSchema {
    if (Subdocuments.isSubdocument(item)) return Subdocuments.schemaOf(item);
    if (node.kind !== "subdocument" && node.kind !== "nested") throw new QueryError("Internal error: not embedded");
    return PopulateExecutor.byKey(item, node.schema);
  }

  /**
   * The discriminator schema a plain document names by its key (code names: lean results).
   *
   * @param doc - The plain document.
   * @param schema - The base schema.
   * @returns The discriminator schema, or `schema` itself.
   */
  private static byKey(doc: Doc, schema: CompiledSchema): CompiledSchema {
    return schema.discriminators.size === 0
      ? schema
      : (schema.root.discriminatorFor(doc[schema.discriminatorKey]) ?? schema);
  }

  /**
   * The model a local value of a site points to (`ref`, `refPath`, `refModel`, the virtual's `ref`).
   *
   * @param site - The site holding the value.
   * @param value - The local value.
   * @param run - The populate run.
   * @param prefix - The path prefix for messages.
   * @param population - The planned population.
   * @returns The target model.
   * @throws {QueryError} If the model cannot be determined.
   */
  private static target(
    site: Site,
    value: unknown,
    run: PopulateRun,
    prefix: string,
    population: Population,
  ): Model<object> {
    const where = `populate "${prefix}${population.path}"`;
    if (site.virtual !== undefined) return PopulateExecutor.model(site.virtual.ref(), run, where);
    const node = site.node as PathNode;
    if (node.ref !== undefined) return PopulateExecutor.model(node.ref() as EntityClass, run, where);
    if (node.refModel !== undefined) {
      const chosen = node.refModel(site.owner.object, value);
      return PopulateExecutor.model(chosen as EntityClass, run, `${where} (refModel)`);
    }
    const namePath = node.refPath as string;
    const name = PopulateExecutor.read(site.owner.object, namePath);
    if (typeof name !== "string") {
      /* Mongoose H308 did not know the model when the projection left the path out: say so. */
      throw new QueryError(
        `${where}: the refPath "${namePath}" (the model name) of "${site.path}" is ${name === undefined ? "absent: select it with the reference" : `not a string (${String(name)})`}`,
        { path: population.path },
      );
    }
    const model = run.connection.models.find((candidate) => candidate.modelName === name);
    if (model === undefined) {
      throw new QueryError(
        `${where}: no model named "${name}" on this connection (refPath "${namePath}"); register it with connection.model(${name}) — known: ${run.connection.models.map((one) => one.modelName).join(", ")}`,
        { path: population.path },
      );
    }
    return model;
  }

  /**
   * Resolves a model reference (a model or a name) on the run's connection.
   *
   * @param entity - The model or model name.
   * @param run - The populate run.
   * @param where - The populate path for the error message.
   * @returns The model.
   * @throws {QueryError} If the model cannot be resolved.
   */
  private static model(entity: unknown, run: PopulateRun, where: string): Model<object> {
    if (typeof entity !== "function")
      throw new ConfigurationError(`${where}: the reference does not name a model class`);
    return run.connection.model(entity as EntityClass<object>);
  }

  /**
   * A value at a (dotted) path of an owner.
   *
   * @param owner - The owner object.
   * @param path - The dotted path.
   * @returns The value, or `undefined`.
   */
  private static read(owner: Doc, path: string): unknown {
    let value: unknown = owner;
    for (const segment of path.split(".")) {
      if (value === null || typeof value !== "object") return undefined;
      value = BsonGuards.isMap(value) ? value.get(segment) : (value as Doc)[segment];
    }
    return value;
  }

  /**
   * The slots of one target model, grouped by their extra filter (one group, or one per document for a match function).
   *
   * @param sites - The sites of the population.
   * @param bySlot - The local values per slot for this model.
   * @param population - The planned population.
   * @param snapshots - Pre-populate snapshots given to `match` functions.
   * @returns The groups, each with its slots and extra filter.
   */
  private static byMatch(
    sites: readonly Site[],
    bySlot: ReadonlyMap<Slot, readonly unknown[]>,
    population: Population,
    snapshots: ReadonlyMap<object, object> | undefined,
  ): { readonly slots: ReadonlyMap<Slot, readonly unknown[]>; readonly match: PlanDocument | undefined }[] {
    const fn = population.matchFn;
    if (fn === undefined) return [{ slots: bySlot, match: population.match }];
    const byRoot = new Map<object, Map<Slot, readonly unknown[]>>();
    for (const site of sites) {
      for (const slot of site.slots) {
        const values = bySlot.get(slot);
        if (values === undefined) continue;
        const map = byRoot.get(site.owner.root) ?? new Map<Slot, readonly unknown[]>();
        map.set(slot, values);
        byRoot.set(site.owner.root, map);
      }
    }
    return [...byRoot].map(([root, slots]) => {
      /* Mongoose H064: the function sees the document BEFORE this path is assigned (ids, not documents). */
      const result = (fn as (document: object) => unknown)(snapshots?.get(root) ?? root);
      if (!BsonGuards.isPlainObject(result)) {
        throw new QueryError(`populate "${population.path}": the match function must return a filter object`, {
          path: population.path,
        });
      }
      return { slots, match: Object.freeze({ ...result }) };
    });
  }

  /**
   * Runs the query (or aggregation) of one group of slots against a target model.
   *
   * @param model - The target model.
   * @param slots - The local values per slot.
   * @param match - The extra filter of the group.
   * @param population - The planned population.
   * @param outer - The populate run.
   * @param prefix - The path prefix for messages.
   * @returns The documents found.
   */
  private static async query(
    model: Model<object>,
    slots: ReadonlyMap<Slot, readonly unknown[]>,
    match: PlanDocument | undefined,
    population: Population,
    outer: PopulateRun,
    prefix: string,
  ): Promise<Found> {
    const run: PopulateRun = { ...outer, populatePath: `${prefix}${population.path}` };
    const virtual = population.source.kind === "virtual" ? population.source.options : undefined;
    const foreignField = virtual?.foreignField ?? "_id";
    const filter = PopulateExecutor.filter(virtual?.match, match);
    if (population.count) return PopulateExecutor.count(model, slots, foreignField, filter, run);
    const perOwner =
      virtual !== undefined &&
      (population.limit !== undefined ||
        population.skip !== undefined ||
        PopulateExecutor.justOne(population, virtual));
    if (perOwner && slots.size > 1) {
      return PopulateExecutor.lookup(model, slots, foreignField, filter, population, run, prefix);
    }
    const values = PopulateExecutor.unique([...slots.values()].flat());
    const { projection, strip } = PopulateExecutor.projection(
      ModelInternals.schema(model),
      population.select,
      foreignField,
      prefix,
      population,
    );
    const window =
      perOwner && slots.size === 1
        ? {
            skip: population.skip,
            limit: PopulateExecutor.justOne(population, virtual)
              ? Math.min(population.limit ?? 1, 1)
              : population.limit,
          }
        : { skip: undefined, limit: undefined };
    const batches = PopulateExecutor.batches(values);
    if (batches.length > 1 && population.sort !== undefined) {
      throw new QueryError(
        `populate "${prefix}${population.path}": ${values.length} ids need ${batches.length} queries, which cannot be sorted together; populate fewer documents at once or drop the sort`,
        { path: population.path },
      );
    }
    const docs: object[] = [];
    await PopulateExecutor.each(
      batches.map((batch) => async () => {
        const plan: FindPlan = Object.freeze({
          op: "find",
          entity: model.entity as EntityClass,
          filter: PopulateExecutor.withIn(foreignField, batch, filter),
          ...(projection === undefined ? {} : { projection }),
          ...(population.sort === undefined ? {} : { sort: population.sort }),
          ...(window.skip === undefined ? {} : { skip: window.skip }),
          ...(window.limit === undefined ? {} : { limit: window.limit }),
          populate: Object.freeze([]),
          lean: run.lean,
          orFail: false,
          mode: Object.freeze({ kind: "run" }),
          options: PopulateExecutor.options(run),
        });
        const rows = (await model.runPopulation(plan, run.parent, PopulateExecutor.locals(run, false))) as object[];
        docs.push(...rows);
      }),
      run.sequential,
    );
    const found = PopulateExecutor.index(model, docs, foreignField);
    if (window.limit !== undefined || window.skip !== undefined) {
      const [slot] = slots.keys();
      if (slot !== undefined) found.bySlot?.set(slot, docs);
    }
    if (strip !== undefined) for (const doc of docs) PopulateExecutor.strip(doc, strip, run);
    return found;
  }

  /**
   * One aggregation: per owner (slot), the documents of its local values with `$sort`/`$skip`/`$limit`.
   *
   * @param model - The target model.
   * @param slots - The local values per slot.
   * @param foreignField - The field of the target matched against the local values.
   * @param filter - The extra filter.
   * @param population - The planned population.
   * @param run - The populate run.
   * @param prefix - The path prefix for messages.
   * @returns The documents found, per slot.
   */
  private static async lookup(
    model: Model<object>,
    slots: ReadonlyMap<Slot, readonly unknown[]>,
    foreignField: string,
    filter: PlanDocument | undefined,
    population: Population,
    run: PopulateRun,
    prefix: string,
  ): Promise<Found> {
    const where = `populate "${prefix}${population.path}"`;
    if (population.select !== undefined && Object.keys(population.select).some((key) => key.startsWith("+"))) {
      throw new QueryError(
        `${where}: "+field" selects are not supported with a per-document limit on several documents`,
      );
    }
    const resolved = PathResolver.resolve(ModelInternals.schema(model), foreignField, "read");
    if (!resolved.ok)
      throw new QueryError(`${where}: foreignField "${foreignField}" is not a path of ${model.modelName}`);
    /* An array foreign field matches by element (as `$in` and `$lookup` do): the values are elements. */
    let foreignNode = resolved.value.node;
    while (foreignNode.kind === "array") foreignNode = foreignNode.element;
    const entries = [...slots];
    const perSlot = new Map<Slot, object[]>();
    const all: object[] = [];
    const batches: [Slot, readonly unknown[]][][] = [];
    let current: [Slot, readonly unknown[]][] = [];
    let size = 0;
    for (const entry of entries) {
      if (size + entry[1].length > IN_BATCH && current.length > 0) {
        batches.push(current);
        current = [];
        size = 0;
      }
      current.push(entry);
      size += entry[1].length;
    }
    if (current.length > 0) batches.push(current);
    const { projection, strip } = PopulateExecutor.projection(
      ModelInternals.schema(model),
      population.select,
      foreignField,
      prefix,
      population,
    );
    const limit = PopulateExecutor.justOne(
      population,
      population.source.kind === "virtual" ? population.source.options : undefined,
    )
      ? Math.min(population.limit ?? 1, 1)
      : population.limit;
    await PopulateExecutor.each(
      batches.map((batch) => async () => {
        const owners = batch.map(([, values], index) => ({
          i: index,
          /* Cast here (a `$literal` is never cast by the pipeline): a value of the wrong type is a CastError,
           * as in a find. */
          v: PopulateExecutor.unique(values).map((value) => foreignNode.caster.cast(value, foreignField)),
        }));
        const inner: PipelineStage[] = [];
        if (filter !== undefined) inner.push({ $match: filter });
        if (population.sort !== undefined) inner.push({ $sort: Object.fromEntries(population.sort) });
        if (population.skip !== undefined) inner.push({ $skip: population.skip });
        if (limit !== undefined) inner.push({ $limit: limit });
        if (projection !== undefined) inner.push({ $project: projection });
        const plan: AggregateExecutionPlan = Object.freeze({
          op: "aggregate",
          entity: model.entity as EntityClass,
          pipeline: Object.freeze([
            /* Rows come from the owners given as data (the documents in memory decide, not a re-read); an empty
             * target collection gives no row, and then nothing would be found anyway. */
            { $limit: 1 },
            { $replaceWith: { $literal: { owners } } },
            { $unwind: "$owners" },
            { $replaceWith: "$owners" },
            {
              $lookup: {
                from: model.collectionName,
                localField: "v",
                foreignField,
                pipeline: inner,
                as: "found",
              },
            },
          ]),
          aggregateOptions: Object.freeze({}),
          options: PopulateExecutor.options(run),
        });
        const rows = (await model.runPopulation(plan, run.parent, PopulateExecutor.locals(run, true))) as readonly {
          readonly i: number;
          readonly found: readonly Readonly<Record<string, unknown>>[];
        }[];
        for (const row of rows) {
          const slot = batch[row.i]?.[0];
          if (slot === undefined) continue;
          const docs = row.found.map((raw) => PopulateExecutor.fromRow(model, raw, projection, run));
          perSlot.set(slot, docs);
          all.push(...docs);
        }
      }),
      run.sequential,
    );
    if (strip !== undefined) for (const doc of all) PopulateExecutor.strip(doc, strip, run);
    /* Documents hydrated here (not through a find) get their `document.init` hooks too. */
    if (!run.lean && DocumentHooks.hasInit(ModelInternals.schema(model))) await DocumentHooks.init(all);
    const found = PopulateExecutor.index(model, all, foreignField);
    for (const [slot, docs] of perSlot) found.bySlot?.set(slot, docs);
    return found;
  }

  /**
   * One aggregation: the number of matching documents per foreign value (never the documents, Mongoose M8 #8).
   *
   * @param model - The target model.
   * @param slots - The local values per slot.
   * @param foreignField - The field of the target matched against the local values.
   * @param filter - The extra filter.
   * @param run - The populate run.
   * @returns The counts, per slot.
   */
  private static async count(
    model: Model<object>,
    slots: ReadonlyMap<Slot, readonly unknown[]>,
    foreignField: string,
    filter: PlanDocument | undefined,
    run: PopulateRun,
  ): Promise<Found> {
    const values = PopulateExecutor.unique([...slots.values()].flat());
    const resolution = PathResolver.resolve(ModelInternals.schema(model), foreignField, "read");
    if (!resolution.ok)
      throw new QueryError(`populate count: foreignField "${foreignField}" is not a path of ${model.modelName}`);
    /* An array foreign field: a document is counted once per owner even when several of its values match. */
    const multi = resolution.value.path.includes(".$") || resolution.value.node.kind === "array";
    const counts = new Map<Slot, number>();
    const perKey = new Map<string, Set<string> | number>();
    for (const batch of PopulateExecutor.batches(values)) {
      const pipeline: PipelineStage[] = [
        { $match: PopulateExecutor.withIn(foreignField, batch, filter) },
        ...(multi
          ? [
              { $unwind: `$${foreignField}` },
              { $match: { [foreignField]: { $in: batch } } },
              { $group: { _id: `$${foreignField}`, ids: { $addToSet: "$_id" } } },
            ]
          : [{ $group: { _id: `$${foreignField}`, n: { $sum: 1 } } }]),
      ];
      const plan: AggregateExecutionPlan = Object.freeze({
        op: "aggregate",
        entity: model.entity as EntityClass,
        pipeline: Object.freeze(pipeline),
        aggregateOptions: Object.freeze({}),
        options: PopulateExecutor.options(run),
      });
      const rows = (await model.runPopulation(plan, run.parent, PopulateExecutor.locals(run, true))) as readonly {
        readonly _id: unknown;
        readonly n?: number;
        readonly ids?: readonly unknown[];
      }[];
      for (const row of rows) {
        const key = PopulateKeys.of(row._id);
        perKey.set(key, row.ids === undefined ? (row.n ?? 0) : new Set(row.ids.map((id) => PopulateKeys.of(id))));
      }
    }
    for (const [slot, locals] of slots) {
      const keys = new Set(locals.map((value) => PopulateKeys.of(value)));
      if (!multi) {
        let total = 0;
        for (const key of keys) total += (perKey.get(key) as number | undefined) ?? 0;
        counts.set(slot, total);
      } else {
        const ids = new Set<string>();
        for (const key of keys) for (const id of (perKey.get(key) as Set<string> | undefined) ?? []) ids.add(id);
        counts.set(slot, ids.size);
      }
    }
    return { model, byKey: new Map(), bySlot: undefined, counts, order: new Map() };
  }

  /**
   * `$and` of the virtual's `match` and the call's `match` (Mongoose REPLACED the virtual's).
   *
   * @param virtualMatch - The virtual's own `match`.
   * @param match - The call's `match`.
   * @returns The combined filter, or `undefined` when both are empty.
   */
  private static filter(
    virtualMatch: Readonly<Record<string, unknown>> | undefined,
    match: PlanDocument | undefined,
  ): PlanDocument | undefined {
    const parts = [virtualMatch, match].filter(
      (part): part is Readonly<Record<string, unknown>> => part !== undefined && Object.keys(part).length > 0,
    );
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return Object.freeze({ ...(parts[0] as PlanDocument) });
    return Object.freeze({ $and: Object.freeze(parts.map((part) => Object.freeze({ ...part }))) });
  }

  /**
   * `{ ff: { $in } }`, with the extra filter by `$and` (Mongoose H432: a `match` on `_id` never replaces the ids).
   *
   * @param foreignField - The field matched.
   * @param values - The values for `$in`.
   * @param filter - The extra filter.
   * @returns The filter document.
   */
  private static withIn(
    foreignField: string,
    values: readonly unknown[],
    filter: PlanDocument | undefined,
  ): PlanDocument {
    const ids = Object.freeze({ [foreignField]: Object.freeze({ $in: Object.freeze([...values]) }) });
    return filter === undefined ? ids : Object.freeze({ $and: Object.freeze([ids, filter]) });
  }

  /**
   * The projection of a populate query: the call's `select`, plus the foreign field when the select left it
   * out (it is needed to match documents to owners) — then it is removed from the results (`strip`), so the
   * documents are exactly what the select asked for (and what the type says).
   *
   * @param schema - The target schema.
   * @param select - The call's `select`.
   * @param foreignField - The field needed for matching.
   * @param prefix - The path prefix for messages.
   * @param population - The planned population.
   * @returns The projection and the top-level key to strip afterwards, if any.
   * @throws {QueryError} If the foreign field is hidden or cannot be selected.
   */
  private static projection(
    schema: CompiledSchema,
    select: PlanDocument | undefined,
    foreignField: string,
    prefix: string,
    population: Population,
  ): { readonly projection: PlanDocument | undefined; readonly strip: string | undefined } {
    const top = foreignField.split(".")[0] as string;
    const hidden = ProjectionPlanner.hiddenPaths(schema).some(
      (path) => path === top || foreignField.startsWith(`${path}.`),
    );
    if (select === undefined) {
      return hidden
        ? { projection: Object.freeze({ [`+${top}`]: true }), strip: top }
        : { projection: undefined, strip: undefined };
    }
    const mode = ProjectionPlanner.modeOfProjection(select);
    const entries = Object.entries(select);
    if (mode === "include") {
      const covered =
        (foreignField === "_id" && select._id !== 0 && select._id !== false) ||
        entries.some(
          ([key, value]) =>
            value !== 0 && value !== false && (key === foreignField || foreignField.startsWith(`${key}.`)),
        );
      if (covered) return { projection: select, strip: undefined };
      if (entries.some(([key]) => key.startsWith(`${top}.`)) && foreignField !== top) {
        throw new QueryError(
          `populate "${prefix}${population.path}": the select names part of "${top}" but not the foreign field "${foreignField}"; select "${foreignField}" too`,
        );
      }
      const own = Object.fromEntries(entries.filter(([key]) => key !== foreignField));
      return { projection: Object.freeze({ ...own, [foreignField]: 1 }), strip: top };
    }
    const excluded = entries.some(
      ([key, value]) => (value === 0 || value === false) && (key === top || key === foreignField),
    );
    if (!excluded && !hidden) return { projection: select, strip: undefined };
    const own = Object.fromEntries(entries.filter(([key]) => key !== top && key !== foreignField));
    const plus = hidden ? { [`+${top}`]: true } : {};
    const projection = Object.keys({ ...own, ...plus }).length === 0 ? undefined : Object.freeze({ ...own, ...plus });
    return { projection, strip: top };
  }

  /**
   * Removes the field the select did not ask for (top-level key).
   *
   * @param doc - The found document.
   * @param key - The key to remove.
   * @param run - The populate run.
   */
  private static strip(doc: object, key: string, run: PopulateRun): void {
    if (!run.lean && DocumentStates.is(doc)) Documents.forget(doc, key);
    else delete (doc as Doc)[key];
  }

  /**
   * One stored document of a `$lookup` row in the result form (hydrated, bound to the connection, or lean).
   *
   * @param model - The target model.
   * @param raw - The stored row.
   * @param projection - The projection the row was read with.
   * @param run - The populate run.
   * @returns The document.
   */
  private static fromRow(
    model: Model<object>,
    raw: Readonly<Record<string, unknown>>,
    projection: PlanDocument | undefined,
    run: PopulateRun,
  ): object {
    if (run.options.validateReads === true) ReadValidator.check(ModelInternals.schema(model), raw);
    if (run.lean) return DocumentReader.lean(ModelInternals.schema(model), raw);
    const effective = ProjectionPlanner.effective(ModelInternals.schema(model), projection);
    const stored =
      effective === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(effective).map(([key, value]) => [model.schema.toDbPath(key) ?? key, value]),
          );
    return Documents.hydrate(
      run.connection,
      ModelInternals.schema(model),
      raw,
      Documents.readInfo(ModelInternals.schema(model), stored, run.session),
    );
  }

  /** Documents by the key of each value of their foreign field (arrays and dotted paths walked). */
  /**
   * Indexes found documents by the key of each value of their foreign field.
   *
   * @param model - The target model.
   * @param docs - The found documents.
   * @param foreignField - The foreign field path.
   * @returns The found set.
   */
  private static index(model: Model<object>, docs: readonly object[], foreignField: string): Found {
    const byKey = new Map<string, object[]>();
    const order = new Map<object, number>();
    docs.forEach((doc, position) => {
      if (!order.has(doc)) order.set(doc, position);
      /* A lean document found here is walked by its own schema when the query wants the plain form. */
      if (!DocumentStates.is(doc)) PlainReader.remember(doc, ModelInternals.schema(model));
      for (const value of PopulateExecutor.values(doc, foreignField.split("."))) {
        const key = PopulateKeys.of(value);
        const list = byKey.get(key) ?? [];
        if (!list.includes(doc)) list.push(doc);
        byKey.set(key, list);
      }
    });
    return { model, byKey, bySlot: new Map(), counts: undefined, order };
  }

  /** Every value at a dotted path (arrays flattened, Maps entered by key). */
  /**
   * Collects the values at a dotted path (arrays flattened, Maps entered by key).
   *
   * @param value - The value to walk.
   * @param segments - The remaining path segments.
   * @returns Every value found.
   */
  private static values(value: unknown, segments: readonly string[]): unknown[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap((item: unknown) => PopulateExecutor.values(item, segments));
    if (segments.length === 0) return [value];
    if (typeof value !== "object" || BsonGuards.isBsonValue(value)) return [];
    const [head, ...rest] = segments as [string, ...string[]];
    const next = BsonGuards.isMap(value) ? value.get(head) : (value as Doc)[head];
    return PopulateExecutor.values(next, rest);
  }

  /**
   * Distinct values by BSON key (`$in` needs each once).
   *
   * @param values - The values.
   * @returns The values without duplicates.
   */
  private static unique(values: readonly unknown[]): unknown[] {
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const value of values) {
      const key = PopulateKeys.of(value);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  }

  /**
   * Splits values into batches of at most `IN_BATCH`.
   *
   * @param values - The values.
   * @returns The batches.
   */
  private static batches(values: readonly unknown[]): unknown[][] {
    const out: unknown[][] = [];
    for (let start = 0; start < values.length; start += IN_BATCH) out.push(values.slice(start, start + IN_BATCH));
    return out;
  }

  /**
   * Whether the result is one document per owner.
   *
   * @param population - The planned population.
   * @param virtual - The virtual's options, if any.
   * @returns `true` for one document per owner.
   */
  private static justOne(population: Population, virtual: VirtualOptions | undefined): boolean {
    return population.justOne ?? virtual?.justOne === true;
  }

  /**
   * The options of a sub-query: the parent's session (or none, explicitly) and its read options (Mongoose H111).
   *
   * @param run - The populate run.
   * @returns The plan options.
   */
  private static options(run: PopulateRun): PlanOptions {
    return Object.freeze({ ...run.options, session: run.session ?? null });
  }

  /**
   * The documents found for one slot, in result order (a count: see `Found.counts`).
   *
   * @param site - The slot's site.
   * @param slot - The slot.
   * @param population - The planned population.
   * @param founds - The results the slot may use.
   * @param run - The populate run.
   * @param prefix - The path prefix for messages.
   * @returns The lookup functions for the slot.
   */
  private static documentsOf(
    site: Site,
    slot: Slot,
    population: Population,
    founds: readonly Found[],
    run: PopulateRun,
    prefix: string,
  ): SlotResults {
    const count = founds.reduce((sum, found) => sum + (found.counts?.get(slot) ?? 0), 0);
    const byKey = (value: unknown): object | undefined => {
      const model = PopulateExecutor.target(site, value, run, prefix, population);
      for (const found of founds) {
        if (found.model !== model) continue;
        const docs = found.byKey.get(PopulateKeys.of(value));
        if (docs !== undefined && docs.length > 0) return docs[0];
      }
      return undefined;
    };
    const all = (): readonly object[] => {
      for (const found of founds) {
        const own = found.bySlot?.get(slot);
        if (own !== undefined) return own;
      }
      /* Virtual: every document whose foreign value is one of the slot's local values, in result order. */
      const docs = new Set<object>();
      for (const value of slot.locals) {
        if (value === null || value === undefined) continue;
        for (const found of founds) for (const doc of found.byKey.get(PopulateKeys.of(value)) ?? []) docs.add(doc);
      }
      const order = (doc: object): number => {
        for (const found of founds) {
          const position = found.order.get(doc);
          if (position !== undefined) return position;
        }
        return 0;
      };
      return [...docs].sort((a, b) => order(a) - order(b));
    };
    return { byKey, all, count };
  }

  /**
   * The `locals` of a sub-query: the populated path (instrumentation), and raw rows for the internal aggregations.
   *
   * @param run - The populate run.
   * @param raw - Whether the sub-query is an internal aggregation returning stored rows.
   * @returns The locals map, or `undefined` when there is nothing to pass.
   */
  private static locals(run: PopulateRun, raw: boolean): ReadonlyMap<symbol, unknown> | undefined {
    if (run.populatePath === undefined) return raw ? RAW : undefined;
    const out = new Map<symbol, unknown>([[OperationView.POPULATE_PATH, run.populatePath]]);
    if (raw) out.set(OperationView.RAW_ROWS, true);
    return out;
  }
}

/** `locals` of the internal aggregations: rows as stored (populate hydrates the joined documents itself). */
const RAW: ReadonlyMap<symbol, unknown> = new Map([[OperationView.RAW_ROWS, true]]);
