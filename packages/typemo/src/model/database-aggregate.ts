import type { AggregatePlan } from "../aggregate/pipeline/aggregate-plan.ts";
import type { Connection } from "../connection/connection.ts";
import { ConfigurationError } from "../errors/configuration-error.ts";
import { QueryError } from "../errors/query-error.ts";
import { HOOK_EVENTS, type HookEvent, type HookPhase } from "../hooks/hook-events.ts";
import type { AggregateExecutionPlan } from "../operation/pipeline/execution-plan.ts";
import type { DatabaseScope, OperationTarget } from "../operation/pipeline/operation-context.ts";
import { PolicyContext } from "../policies/policy-context.ts";
import type { PlanOptions } from "../query/plan.ts";
import { QuerySpecs } from "../query/query-specs.ts";
import { CompiledSchema, type HookTable } from "../schema/compiler/compiled-schema.ts";
import type { EntityClass } from "../schema/options/type-spec.ts";
import { AggregateQuery } from "./aggregate-query.ts";
import type { ModelAggregateOptions } from "./model.ts";
import { PipelineExecutor } from "./pipeline-executor.ts";

/**
 * Who runs a database-level aggregation: named in messages as `connection.aggregate` or `client.aggregate`.
 *
 * @example
 * ```ts
 * const caller: DatabaseCaller = "client";
 * ```
 */
export type DatabaseCaller = "connection" | "client";

/** The hook table of a database-level operation: every event, no hook (hooks belong to models). */
const NO_HOOKS: HookTable = Object.freeze(
  Object.fromEntries(
    HOOK_EVENTS.map((event) => [
      event,
      Object.freeze({ pre: Object.freeze([]), post: Object.freeze([]), postError: Object.freeze([]) }),
    ]),
  ) as Record<HookEvent, Readonly<Record<HookPhase, readonly never[]>>>,
);

/** The executors of a connection, by caller and scope (built once: the target and its schema are fixed). */
const EXECUTORS = new WeakMap<Connection, Map<string, PipelineExecutor>>();

/**
 * Database-level aggregations — the plans of `Pipeline.database()`, `Pipeline.admin()` and `Pipeline.sessions()` —
 * run by `connection.aggregate(plan)` and `client.aggregate(plan)` through the connection's operation pipeline
 * like a model's aggregation: instrumentation events (`model: null`), the ambient transaction and session guard,
 * `timeoutMS`, the Typemo error hierarchy, and the policies of the collections the pipeline joins (`$lookup`,
 * `$unionWith`, `$graphLookup` of a tenant or soft-delete model). No hooks run: hooks are registered on models,
 * and such an aggregation has none; its target has a synthetic entity (named after the caller, for messages)
 * and an empty schema built directly — not compiled, so no plugin applies to it and no registry is sealed.
 *
 * @example
 * ```ts
 * const rows = await DatabaseAggregate.query(connection, "connection", Pipeline.database().documents([{ n: 1 }]).plan());
 * ```
 */
export class DatabaseAggregate {
  /**
   * The awaitable aggregation of a database-level plan.
   *
   * @typeParam R - The row type of the plan.
   * @param connection - The connection whose pipeline and database run it.
   * @param caller - Who was called, for messages.
   * @param plan - A plan of `Pipeline.database()`, `Pipeline.admin()` or `Pipeline.sessions()`.
   * @param options - Session, timeout and policy.
   * @returns The aggregation query (awaitable, `cursor()`, `explain()`, …).
   * @throws {QueryError} When the argument is not an aggregation plan.
   * @throws {ConfigurationError} When the plan reads a collection (run it with the model's `aggregate`).
   */
  static query<R>(
    connection: Connection,
    caller: DatabaseCaller,
    plan: AggregatePlan<R>,
    options?: ModelAggregateOptions,
  ): AggregateQuery<R> {
    if (plan === null || typeof plan !== "object" || plan.op !== "aggregate" || !Array.isArray(plan.pipeline)) {
      throw new QueryError(
        `${caller}.aggregate: an aggregation plan of Pipeline.database(), Pipeline.admin() or Pipeline.sessions()`,
      );
    }
    const target = plan.target;
    if (target.kind === "collection") {
      throw new ConfigurationError(
        `${caller}.aggregate: the plan reads the collection "${target.collection}"; run it with the model's aggregate()`,
      );
    }
    const scope: DatabaseScope = target.kind === "sessions" ? "sessions" : target.admin ? "admin" : "database";
    const executor = DatabaseAggregate.executor(connection, caller, scope);
    const execution: AggregateExecutionPlan = {
      op: "aggregate",
      entity: executor.schema.target as EntityClass,
      pipeline: plan.pipeline,
      aggregateOptions: plan.options,
      options: DatabaseAggregate.options(options),
    };
    return new AggregateQuery<R>(executor, execution);
  }

  /**
   * The executor of one caller and scope on a connection (created on first use).
   *
   * @param connection - The connection.
   * @param caller - Who was called.
   * @param scope - Where the aggregation runs.
   * @returns The executor.
   */
  private static executor(connection: Connection, caller: DatabaseCaller, scope: DatabaseScope): PipelineExecutor {
    let byKey = EXECUTORS.get(connection);
    if (byKey === undefined) {
      byKey = new Map();
      EXECUTORS.set(connection, byKey);
    }
    const key = `${caller}\u0000${scope}`;
    const known = byKey.get(key);
    if (known !== undefined) return known;
    const collection = scope === "sessions" ? "system.sessions" : "";
    const entity = DatabaseAggregate.entity(caller);
    const target: OperationTarget = Object.freeze({
      entity,
      schema: DatabaseAggregate.schema(entity, collection),
      collection,
      database: scope === "admin" ? "admin" : scope === "sessions" ? "config" : connection.name,
      scope,
    });
    const executor = new PipelineExecutor(connection, target);
    byKey.set(key, executor);
    return executor;
  }

  /**
   * A class named after the caller: the operation's messages read `connection.aggregate: …`.
   *
   * @param caller - Who was called.
   * @returns The synthetic entity class.
   */
  private static entity(caller: DatabaseCaller): EntityClass {
    const entity = class {};
    Object.defineProperty(entity, "name", { value: caller });
    return entity as EntityClass;
  }

  /**
   * An empty schema: no fields, indexes, hooks, plugins or policies.
   *
   * @param entity - The synthetic entity (the schema's class).
   * @param collection - The collection the aggregation reads, `""` for a whole database.
   * @returns The sealed schema.
   */
  private static schema(entity: EntityClass, collection: string): CompiledSchema {
    const schema: CompiledSchema = new CompiledSchema({
      target: entity,
      kind: "document",
      options: Object.freeze({}),
      collection,
      fields: Object.freeze([]),
      paths: Object.freeze({}),
      indexes: Object.freeze([]),
      searchIndexes: Object.freeze([]),
      virtuals: Object.freeze([]),
      hooks: NO_HOOKS,
      statics: new Map(),
      plugins: Object.freeze([]),
      discriminator: undefined,
      discriminatorKey: "__t",
      discriminators: () => new Map(),
      root: () => schema,
    });
    schema.seal(Object.freeze({}));
    return schema;
  }

  /**
   * The operation options: the ambient policy scope with `options.policy` over it, the session and the timeout.
   *
   * @param options - The caller's options.
   * @returns The plan options.
   * @throws {QueryError} When `timeoutMS` is not a positive number.
   */
  private static options(options: ModelAggregateOptions | undefined): PlanOptions {
    const captured = PolicyContext.current() ?? PolicyContext.EMPTY;
    const policy =
      options?.policy === undefined ? captured : PolicyContext.merge(captured, options.policy, "options.policy");
    return Object.freeze({
      ...(policy === undefined ? {} : { policy }),
      ...(options?.session === undefined ? {} : { session: options.session }),
      ...(options?.timeoutMS === undefined ? {} : { timeoutMS: QuerySpecs.timeoutMS(options.timeoutMS) }),
    });
  }
}
