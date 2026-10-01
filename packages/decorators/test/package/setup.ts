/* Stops the process-wide shared mongod once after this package's `bun test` run (as in packages/typemo). */
import { afterAll } from "bun:test";
import { MongoHarness } from "../../../test-kit/src/index.ts";

afterAll(async () => {
  await MongoHarness.stop();
});
