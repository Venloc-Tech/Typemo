import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import mongoose from "mongoose";
import { DbSnapshot, type DbSnapshotDiff } from "../db/db-snapshot.ts";

/**
 * A scenario-as-data: the same logical operation, expressed once
 * for Mongoose and once for a "supplied executor" (the raw driver today,
 * eventually Typemo itself). `collectionNames` lists what to snapshot for
 * the final-state comparison.
 *
 * Both branches run on the same shared mongod but each gets its own database
 * name: running Mongoose's connection and a raw `MongoClient` against literally
 * one database at the same time would make the two branches interfere with each
 * other (shared `_id` collisions, connection-level state). Both databases are
 * dropped after comparison.
 *
 * @example
 * ```ts
 * const scenario: OracleScenario<number> = {
 *   name: "count",
 *   collectionNames: ["users"],
 *   runMongoose: async (connection) => connection.collection("users").countDocuments(),
 *   runExecutor: async (db) => db.collection("users").countDocuments(),
 * };
 * ```
 */
export interface OracleScenario<Result> {
  /** Scenario name, echoed in the report. */
  readonly name: string;
  /** Collections whose final state is compared. */
  readonly collectionNames: readonly string[];
  /**
   * Runs the operation through Mongoose.
   *
   * @param connection - A connection on the Mongoose branch's database.
   * @returns The operation result.
   */
  runMongoose(connection: mongoose.Connection): Promise<Result>;
  /**
   * Runs the operation through the executor under test.
   *
   * @param db - The executor branch's database.
   * @returns The operation result.
   */
  runExecutor(db: Db): Promise<Result>;
  /**
   * Defaults to identity. Use this to strip non-deterministic fields (e.g. generated `_id`s).
   *
   * @param result - A raw result.
   * @returns The comparable form.
   */
  normalizeResult?(result: Result): unknown;
}

/**
 * The outcome of `OracleHarness.compare`.
 *
 * @example
 * ```ts
 * const report: OracleComparisonReport = await OracleHarness.compare(uri, scenario);
 * expect(report.resultsMatch && report.stateMatches).toBe(true);
 * ```
 */
export interface OracleComparisonReport {
  /** The scenario name. */
  readonly scenarioName: string;
  /** The normalized results are equal. */
  readonly resultsMatch: boolean;
  /** The final database states are equal. */
  readonly stateMatches: boolean;
  /** The normalized Mongoose result. */
  readonly mongooseResult: unknown;
  /** The normalized executor result. */
  readonly executorResult: unknown;
  /** Documents present in only one final state. */
  readonly stateDiff: DbSnapshotDiff;
}

/** Runs one scenario through Mongoose and an executor and compares both. */
export class OracleHarness {
  /**
   * Runs the scenario on both branches and compares results and final state.
   *
   * @param uri - Connection string of the shared mongod.
   * @param scenario - The scenario to run.
   * @returns The comparison report.
   */
  static async compare<Result>(uri: string, scenario: OracleScenario<Result>): Promise<OracleComparisonReport> {
    const suffix = Math.random().toString(16).slice(2, 8);
    const mongooseDbName = `oracle_mongoose_${suffix}`;
    const executorDbName = `oracle_executor_${suffix}`;

    const connection = await mongoose.createConnection(uri, { dbName: mongooseDbName }).asPromise();
    const executorClient = new MongoClient(uri);
    await executorClient.connect();
    const executorDb = executorClient.db(executorDbName);

    try {
      const mongooseResult = await scenario.runMongoose(connection);
      const executorResult = await scenario.runExecutor(executorDb);

      const normalize = scenario.normalizeResult ?? ((value: Result): unknown => value);
      const normalizedMongoose = normalize(mongooseResult);
      const normalizedExecutor = normalize(executorResult);
      const resultsMatch = OracleHarness.#deepEqualJson(normalizedMongoose, normalizedExecutor);

      const mongooseDb = connection.db as unknown as Db;
      const mongooseSnapshot = await DbSnapshot.capture(mongooseDb, scenario.collectionNames);
      const executorSnapshot = await DbSnapshot.capture(executorDb, scenario.collectionNames);
      const stateDiff = DbSnapshot.diff(mongooseSnapshot, executorSnapshot);

      return {
        scenarioName: scenario.name,
        resultsMatch,
        stateMatches: stateDiff.equal,
        mongooseResult: normalizedMongoose,
        executorResult: normalizedExecutor,
        stateDiff,
      };
    } finally {
      await connection.dropDatabase();
      await connection.close();
      await executorDb.dropDatabase();
      await executorClient.close();
    }
  }

  /**
   * Compares normalized, EJSON-safe values by structural equality; a full
   * BSON-aware deep-equal is out of scope for this minimal harness.
   *
   * @param a - The first value.
   * @param b - The second value.
   * @returns `true` when both serialize to the same JSON.
   */
  static #deepEqualJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
