/*
 * `@venloc/typemo/testing`: test utilities for USERS of Typemo, shipped with the core package. Runtime
 * dependencies: the core only — never `mongodb-memory-server`, `mongoose` or the private test-kit (a guard
 * test checks the import graph of this entry point).
 *
 * - `defineFactory(model, defaults)`: typed test data (`CreateInput<T>`: a renamed field breaks the
 *   factory, not silently the test).
 * - `explainIndexUsage(query)`, `expectIndexScan(query, options)`, `expectCollScan(query)`: read the
 *   query plan (`explain("executionStats")`) of a `find`/`findOne` query or an aggregation, so a test fails
 *   when a query stops using its index; stage names checked on MongoDB 8.3 and 9.0 (classic and SBE
 *   plans: `queryPlan`, `inputStage(s)`, `$cursor`).
 */

import type { NewDocument } from "../document/document-types.ts";
import { TypemoError, type TypemoErrorOptions } from "../errors/typemo-error.ts";
import type { CreateInput } from "../types/document-forms.ts";

/**
 * What `build`, `buildMany`, `create` and `createMany` of a {@link Factory} take to change the documents they
 * build: some fields of the create input, or a function that gets the sequence number of the document being built
 * (1 for the first one after `defineFactory` or `reset()`) and returns them. The fields are merged over the
 * factory's defaults one level deep: a nested object or an array given here replaces the default whole. Neither the
 * defaults nor the overrides are mutated.
 *
 * @typeParam T - The entity type.
 * @example
 * ```ts
 * const fixed: FactoryOverrides<User> = { role: "admin" };
 * const numbered: FactoryOverrides<User> = (n) => ({ email: `admin${n}@x.io` });
 * ```
 */
export type FactoryOverrides<T> = Partial<CreateInput<T>> | ((n: number) => Partial<CreateInput<T>>);

/**
 * What {@link defineFactory} needs from a model: the entity class (so `T` is inferred from the model) and `create`,
 * which saves one document. Any `Model<T>` fits, a discriminator model included; a test may also pass its own
 * object with these two members (for example to count the saves).
 *
 * @typeParam T - The entity type.
 * @example
 * ```ts
 * const users: FactoryModel<User> = connection.model(User);
 * ```
 */
export interface FactoryModel<T> {
  /** The entity class the model was made from. */
  readonly entity: abstract new () => T;
  /**
   * Saves one document.
   *
   * @param doc - The data of the document.
   * @returns The saved document.
   */
  create(doc: NoInfer<CreateInput<T>>): Promise<NewDocument<T>>;
}

/**
 * A factory of documents of one entity.
 *
 * @example
 * ```ts
 * const users: Factory<User> = defineFactory(Users, (n) => ({ name: `User ${n}`, email: `user${n}@x.io` }));
 * const draft = users.build({ role: "admin" });
 * const saved = await users.createMany(3);
 * ```
 */
export interface Factory<T> {
  /**
   * The data of one document (defaults, then `overrides`), not saved. The sequence goes up by one per call.
   *
   * @param overrides - Fields to change, or a function of the sequence number.
   * @returns The data.
   */
  build(overrides?: FactoryOverrides<T>): CreateInput<T>;
  /**
   * The data of `count` documents.
   *
   * @param count - How many.
   * @param overrides - Fields to change, or a function of the sequence number.
   * @throws {TypemoError} When `count` is not a non-negative integer.
   */
  buildMany(count: number, overrides?: FactoryOverrides<T>): CreateInput<T>[];
  /**
   * Builds and saves one document (`model.create`).
   *
   * @param overrides - Fields to change, or a function of the sequence number.
   * @returns The saved document.
   */
  create(overrides?: FactoryOverrides<T>): Promise<NewDocument<T>>;
  /**
   * Builds and saves `count` documents one after the other (sequence numbers and `_id`s follow the order).
   *
   * @param count - How many.
   * @param overrides - Fields to change, or a function of the sequence number.
   * @returns The saved documents.
   * @throws {TypemoError} When `count` is not a non-negative integer.
   */
  createMany(count: number, overrides?: FactoryOverrides<T>): Promise<NewDocument<T>[]>;
  /** Puts the sequence back to the start. */
  reset(): void;
}

/**
 * Validates a document count.
 *
 * @param value - The count.
 * @returns The count.
 * @throws {TypemoError} When it is not a non-negative safe integer.
 */
const count = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypemoError(`defineFactory: count must be a non-negative integer, got ${value}`);
  return value;
};

/**
 * A factory for test data: the defaults of an entity once (`(n) => ({ email: \`user${n}@x.io\` })`), then
 * `build()`/`create()` with only what a test cares about. Neither the defaults nor the overrides are
 * mutated: every call builds a new object.
 *
 * @typeParam T - The entity type, from the model.
 * @param model - The model that saves the documents.
 * @param defaults - The defaults of a document, given the sequence number (1, 2, …).
 * @returns The frozen factory.
 * @example
 * ```ts
 * const users = defineFactory(Users, (n) => ({ name: `User ${n}`, email: `user${n}@x.io` }));
 * const admin = await users.create({ role: "admin" });
 * ```
 */
export const defineFactory = <T extends object>(
  model: FactoryModel<T>,
  defaults: (n: number) => CreateInput<T>,
): Factory<T> => {
  let sequence = 0;
  const build = (overrides?: FactoryOverrides<T>): CreateInput<T> => {
    sequence += 1;
    const n = sequence;
    const extra = typeof overrides === "function" ? overrides(n) : overrides;
    return { ...defaults(n), ...extra } as CreateInput<T>;
  };
  return Object.freeze({
    build,
    buildMany: (many: number, overrides?: FactoryOverrides<T>) =>
      Array.from({ length: count(many) }, () => build(overrides)),
    create: (overrides?: FactoryOverrides<T>) => model.create(build(overrides)),
    createMany: async (many: number, overrides?: FactoryOverrides<T>) => {
      const created: NewDocument<T>[] = [];
      for (let index = 0; index < count(many); index++) created.push(await model.create(build(overrides)));
      return created;
    },
    reset: () => {
      sequence = 0;
    },
  });
};

/**
 * Something with a query plan: a `find`/`findOne` query or an aggregation of a model.
 *
 * @example
 * ```ts
 * const query: Explainable = Users.find({ email: "a@x.io" });
 * ```
 */
export interface Explainable {
  /**
   * Asks the server for the query plan.
   *
   * @param verbosity - How much the server reports.
   * @returns The server's explain document.
   */
  explain(verbosity?: "queryPlanner" | "executionStats" | "allPlansExecution"): PromiseLike<unknown>;
}

/**
 * How a query reads the collection, from its plan.
 *
 * @example
 * ```ts
 * const usage: IndexUsage = await explainIndexUsage(Users.find({ email: "a@x.io" }));
 * usage.stages; // ["FETCH", "IXSCAN"]
 * ```
 */
export interface IndexUsage {
  /** The stages of the winning plan, outermost first (`["LIMIT", "FETCH", "IXSCAN"]`). */
  readonly stages: readonly string[];
  /** The indexes the plan scans (`IXSCAN`, `DISTINCT_SCAN`, `COUNT_SCAN`, `EXPRESS_IXSCAN`, …). */
  readonly indexes: readonly string[];
  /** Some stage scans the collection (`COLLSCAN`). */
  readonly collectionScan: boolean;
  /** The plan reads through an index. */
  readonly usesIndex: boolean;
  /** How many documents the server read (`totalDocsExamined`). */
  readonly docsExamined: number;
  /** How many index keys the server read (`totalKeysExamined`). */
  readonly keysExamined: number;
  /** How many documents the query returned (`nReturned`). */
  readonly docsReturned: number;
  /** The result comes from the index alone: no `FETCH` stage and no document read (`docsExamined === 0`). */
  readonly covered: boolean;
}

/**
 * Options of `expectIndexScan`.
 *
 * @example
 * ```ts
 * await expectIndexScan(Users.find({ email }), { index: "email_1", maxDocsExamined: 1, covered: false });
 * ```
 */
export interface ExpectIndexOptions {
  /** The index the plan must use (by name). */
  readonly index?: string;
  /** The most documents the query may examine. */
  readonly maxDocsExamined?: number;
  /** The result must come from the index alone. */
  readonly covered?: boolean;
}

/**
 * A query plan did not meet the expectation of `expectIndexScan`/`expectCollScan`.
 *
 * @example
 * ```ts
 * try {
 *   await expectIndexScan(Users.find({ name: "x" }));
 * } catch (error) {
 *   if (error instanceof IndexUsageError) console.log(error.usage.stages);
 * }
 * ```
 */
export class IndexUsageError extends TypemoError {
  /** The plan that failed the expectation. */
  readonly usage: IndexUsage;

  /**
   * @param message - What was expected and what the plan did.
   * @param usage - The plan.
   * @param options - Optional `cause`.
   */
  constructor(message: string, usage: IndexUsage, options: TypemoErrorOptions = {}) {
    super(message, options);
    this.usage = usage;
  }

  static {
    Object.defineProperty(IndexUsageError.prototype, "name", {
      value: "IndexUsageError",
      writable: true,
      configurable: true,
    });
  }
}

/**
 * A node of an explain document.
 *
 * @example
 * ```ts
 * const node: Node = { stage: "IXSCAN", indexName: "email_1" };
 * ```
 */
type Node = Readonly<Record<string, unknown>>;

/**
 * @param value - Any value.
 * @returns `true` when it is a plain object (an explain node).
 */
const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);

/** Stages that read through an index. */
const SCAN_STAGES: ReadonlySet<string> = new Set(["IXSCAN", "DISTINCT_SCAN", "COUNT_SCAN", "EXPRESS_IXSCAN"]);
/** Stages that scan the whole collection. */
const COLLECTION_STAGES: ReadonlySet<string> = new Set(["COLLSCAN"]);

/** Plan helpers (static, internal to this entry point). */
class PlanReader {
  /**
   * Collects the plan nodes under `plan`, depth first (`inputStage`, `inputStages`, `queryPlan`,
   * `thenStage`, `elseStage`, `shards`).
   *
   * @param plan - The winning plan or any node of it.
   * @param out - The accumulator.
   * @returns The nodes with a `stage`, outermost first.
   */
  static walk(plan: unknown, out: Node[] = []): Node[] {
    if (!isNode(plan)) return out;
    if (typeof plan.stage === "string") out.push(plan);
    for (const key of ["queryPlan", "inputStage", "thenStage", "elseStage", "winningPlan"])
      PlanReader.walk(plan[key], out);
    for (const key of ["inputStages", "shards"]) {
      const children = plan[key];
      if (Array.isArray(children)) for (const child of children) PlanReader.walk(child, out);
    }
    return out;
  }

  /**
   * Finds the winning plan and the execution stats: a find has them at the top, an aggregation under
   * `stages[0].$cursor`.
   *
   * @param explain - The server's explain document.
   * @returns The winning plan and the stats.
   */
  static parts(explain: Node): { readonly plan: unknown; readonly stats: Node } {
    const stages = explain.stages;
    const cursor = Array.isArray(stages)
      ? (stages.find((stage): stage is Node => isNode(stage) && "$cursor" in stage)?.$cursor as Node | undefined)
      : undefined;
    const source = cursor ?? explain;
    const planner = (source.queryPlanner ?? explain.queryPlanner) as Node | undefined;
    const stats = (source.executionStats ?? explain.executionStats ?? {}) as Node;
    return { plan: planner?.winningPlan, stats };
  }
}

/**
 * Reads how a query or aggregation reads the collection (`explain("executionStats")`).
 *
 * @param query - A `find`/`findOne` query or an aggregation.
 * @returns The frozen index usage.
 * @throws {TypemoError} When the server returned no plan.
 */
export const explainIndexUsage = async (query: Explainable): Promise<IndexUsage> => {
  const explain = await query.explain("executionStats");
  if (!isNode(explain)) throw new TypemoError("explainIndexUsage: the server returned no plan");
  const { plan, stats } = PlanReader.parts(explain);
  const nodes = PlanReader.walk(plan);
  const stages = nodes.map((node) => String(node.stage));
  const indexes = nodes
    .filter((node) => SCAN_STAGES.has(String(node.stage)))
    .map((node) => String(node.indexName ?? ""));
  const collectionScan = stages.some((stage) => COLLECTION_STAGES.has(stage));
  const docsExamined = Number(stats.totalDocsExamined ?? 0);
  return Object.freeze({
    stages: Object.freeze(stages),
    indexes: Object.freeze(indexes),
    collectionScan,
    usesIndex: indexes.length > 0,
    docsExamined,
    keysExamined: Number(stats.totalKeysExamined ?? 0),
    docsReturned: Number(stats.nReturned ?? 0),
    /* An express plan (`EXPRESS_IXSCAN`) reads the document without a `FETCH` stage: only a plan that read no
     * document at all is covered. */
    covered: indexes.length > 0 && !stages.includes("FETCH") && !collectionScan && docsExamined === 0,
  });
};

/**
 * @param usage - The plan.
 * @returns A one-line description for error messages.
 */
const describe = (usage: IndexUsage): string =>
  `plan: ${usage.stages.join(" > ") || "none"}; examined ${usage.docsExamined} documents, returned ${usage.docsReturned}`;

/**
 * Fails unless the query is served by an index (and meets the options).
 *
 * @param query - A `find`/`findOne` query or an aggregation.
 * @param options - Extra expectations: a named index, a document budget, covered.
 * @returns The index usage.
 * @throws {IndexUsageError} When the plan does not meet the expectation.
 */
export const expectIndexScan = async (query: Explainable, options: ExpectIndexOptions = {}): Promise<IndexUsage> => {
  const usage = await explainIndexUsage(query);
  const problems: string[] = [];
  if (usage.collectionScan) problems.push("it scans the whole collection (COLLSCAN)");
  else if (!usage.usesIndex) problems.push("it uses no index");
  if (options.index !== undefined && !usage.indexes.includes(options.index))
    problems.push(`it does not use the index "${options.index}" (it uses: ${usage.indexes.join(", ") || "none"})`);
  if (options.maxDocsExamined !== undefined && usage.docsExamined > options.maxDocsExamined)
    problems.push(`it examined ${usage.docsExamined} documents, more than ${options.maxDocsExamined}`);
  if (options.covered === true && !usage.covered)
    problems.push("it is not covered by the index (it fetches documents)");
  if (problems.length > 0)
    throw new IndexUsageError(`the query is not served by an index: ${problems.join("; ")}. ${describe(usage)}`, usage);
  return usage;
};

/**
 * Fails unless the query scans the collection (a test that a query is NOT indexed, on purpose).
 *
 * @param query - A `find`/`findOne` query or an aggregation.
 * @returns The index usage.
 * @throws {IndexUsageError} When the plan does not scan the collection.
 */
export const expectCollScan = async (query: Explainable): Promise<IndexUsage> => {
  const usage = await explainIndexUsage(query);
  if (!usage.collectionScan)
    throw new IndexUsageError(`the query does not scan the collection. ${describe(usage)}`, usage);
  return usage;
};
