/*
 * Same reasoning as packages/test-kit/test/setup.ts: stop the process-wide
 * shared mongod once after this package's whole `bun test` run, since the
 * ported demo test (packages/typemo/test/ported/demo) also starts it via
 * MongoLifecycle.useMongo().
 */
import { afterAll } from "bun:test";
import { MongoHarness } from "@venloc/typemo-test-kit";

afterAll(async () => {
  await MongoHarness.stop();
});
