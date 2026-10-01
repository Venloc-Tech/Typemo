/*
 * Seeding and plan execution for the aggregation tests. Execution is the raw driver through
 * test-kit's `AggregateRunner`: the row type of a plan is the builder's computed type,
 * and the shape tests are what prove that this cast is honest.
 */
import { AggregateRunner, type MongoTestContext } from "@venloc/typemo-test-kit";
import type { AggregatePlan, PlanRow } from "../../src/index.ts";
import { AggregateSeed } from "./aggregate-entities.ts";

/** Static helpers that seed the aggregation collections and run plans against them. */
export class AggregateFixtures {
  /**
   * Writes every seed collection (and the 2dsphere index `$geoNear` needs).
   *
   * @param mongo - the test database context to seed
   */
  static async seed(mongo: MongoTestContext): Promise<void> {
    const { db } = mongo;
    await db.collection("agg_customers").insertMany(AggregateSeed.customers.map((doc) => ({ ...doc })));
    await db.collection("agg_orders").insertMany(AggregateSeed.orders.map((doc) => ({ ...doc })));
    await db.collection("agg_employees").insertMany(AggregateSeed.employees.map((doc) => ({ ...doc })));
    await db.collection("agg_places").insertMany(AggregateSeed.places.map((doc) => ({ ...doc })));
    await db.collection("agg_places").createIndex({ location: "2dsphere" });
    await db.collection("agg_readings").insertMany(AggregateSeed.readings.map((doc) => ({ ...doc })));
  }

  /**
   * Runs a plan; the rows are typed by the plan.
   *
   * @param mongo - the test database context
   * @param plan - the aggregation plan to execute
   * @returns the rows the server returned
   */
  static run<P extends AggregatePlan<unknown>>(mongo: MongoTestContext, plan: P): Promise<PlanRow<P>[]> {
    /* cast: the raw runner returns documents; the row type is the builder's computed type */
    return AggregateRunner.run(mongo.client, mongo.dbName, plan) as Promise<PlanRow<P>[]>;
  }

  /**
   * The server error of a plan that must fail.
   *
   * @param mongo - the test database context
   * @param plan - the aggregation plan expected to fail
   * @returns the error the server raised
   */
  static errorOf(mongo: MongoTestContext, plan: AggregatePlan<unknown>) {
    return AggregateRunner.errorOf(mongo.client, mongo.dbName, plan);
  }
}
