/* Tests `OracleHarness`: the same scenario through Mongoose and the raw driver is compared. */
import { expect, test } from "bun:test";
import mongoose from "mongoose";
import { MongoLifecycle } from "../../src/db/lifecycle.ts";
import { MongoHarness } from "../../src/db/mongo-harness.ts";
import { OracleHarness, type OracleScenario } from "../../src/oracle/oracle-harness.ts";

/*
 * Only needs the shared mongod to be up; OracleHarness manages its own
 * databases, so there's no need for MongoLifecycle's per-file db/client here.
 */
MongoLifecycle.useMongo("oracle_demo_unused");

/** The document the scenario stores. */
interface Widget {
  /** Widget name. */
  name: string;
  /** Quantity. */
  qty: number;
}

test("Mongoose and the raw driver agree on insertOne + find", async () => {
  await MongoHarness.ensureStarted();
  const uri = MongoHarness.getUri();

  const scenario: OracleScenario<{ name: string; qty: number }[]> = {
    name: "insertOne + find",
    collectionNames: ["widgets"],
    async runMongoose(connection) {
      const Widget = connection.model<Widget>(
        "Widget",
        new mongoose.Schema<Widget>({ name: String, qty: Number }, { versionKey: false }),
      );
      await Widget.create({ name: "bolt", qty: 5 });
      const docs = await Widget.find().lean();
      return docs.map((doc) => ({ name: doc.name, qty: doc.qty }));
    },
    async runExecutor(db) {
      await db.collection("widgets").insertOne({ name: "bolt", qty: 5 });
      const docs = await db.collection("widgets").find().toArray();
      return docs.map((doc) => ({ name: doc.name as string, qty: doc.qty as number }));
    },
  };

  const report = await OracleHarness.compare(uri, scenario);

  expect(report.resultsMatch).toBe(true);
  /* Documents are equal in content but differ in generated _id — expected. */
  expect(report.stateMatches).toBe(false);
  expect(report.mongooseResult).toEqual([{ name: "bolt", qty: 5 }]);
  expect(report.executorResult).toEqual([{ name: "bolt", qty: 5 }]);
});
