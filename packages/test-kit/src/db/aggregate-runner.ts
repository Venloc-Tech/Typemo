import type { AggregateOptions, Document, MongoClient } from "mongodb";

/**
 * The structural form of an aggregation plan (Typemo's `AggregatePlan`), without a dependency
 * on `@venloc/typemo`: where the pipeline runs and its stages.
 *
 * @example
 * ```ts
 * const plan: RunnableAggregate = {
 *   target: { kind: "collection", collection: "users" },
 *   pipeline: [{ $match: {} }],
 * };
 * ```
 */
export interface RunnableAggregate {
  /** A collection, the database itself (`admin` selects the admin database), or `config.system.sessions`. */
  readonly target:
    | { readonly kind: "collection"; readonly collection: string }
    | { readonly kind: "database"; readonly admin: boolean }
    | { readonly kind: "sessions" };
  /** The pipeline stages. */
  readonly pipeline: readonly Document[];
  /** Driver `aggregate` options. */
  readonly options?: object;
}

/**
 * Runs a built pipeline through the RAW driver (`collection.aggregate` / `db.aggregate`):
 * tests prove that the server accepts what the builder types, and compare the rows
 * with the computed type (shape harness).
 */
export class AggregateRunner {
  /**
   * All rows of the plan.
   *
   * @param client - Connected client.
   * @param dbName - The test database (`admin` plans run on `admin`).
   * @param plan - The plan to run.
   * @returns Every result row.
   */
  static async run(client: MongoClient, dbName: string, plan: RunnableAggregate): Promise<Document[]> {
    const options = (plan.options ?? {}) as AggregateOptions;
    const pipeline = plan.pipeline.map((stage) => ({ ...stage }));
    if (plan.target.kind === "collection") {
      return client.db(dbName).collection(plan.target.collection).aggregate(pipeline, options).toArray();
    }
    if (plan.target.kind === "sessions") {
      return client.db("config").collection("system.sessions").aggregate(pipeline, options).toArray();
    }
    return client
      .db(plan.target.admin ? "admin" : dbName)
      .aggregate(pipeline, options)
      .toArray();
  }

  /**
   * The server error of a plan that must fail (a stage the deployment does not support), or `undefined`.
   *
   * @param client - Connected client.
   * @param dbName - The test database.
   * @param plan - The plan expected to fail.
   * @returns The error code and message, or `undefined` when the plan succeeded.
   */
  static async errorOf(
    client: MongoClient,
    dbName: string,
    plan: RunnableAggregate,
  ): Promise<{ readonly code: number | undefined; readonly message: string } | undefined> {
    try {
      await AggregateRunner.run(client, dbName, plan);
      return undefined;
    } catch (error) {
      const e = error as { code?: number; message?: string };
      return { code: e.code, message: String(e.message) };
    }
  }
}
