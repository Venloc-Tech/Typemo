/* Stops the shared mongod once after this package's `bun test` run (as in packages/typemo/test/setup.ts). */
import { afterAll } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";

afterAll(async () => {
  await MongoHarness.stop();
});
