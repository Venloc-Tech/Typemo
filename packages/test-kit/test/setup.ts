/*
 * Preloaded once for the whole `bun test` process (see bunfig.toml). Its
 * hooks run at global scope, so this is the process-wide teardown for the
 * single shared mongod started by MongoHarness (one mongod per
 * test process, not per file).
 */
import { afterAll } from "bun:test";
import { MongoHarness } from "../src/db/mongo-harness.ts";

afterAll(async () => {
  await MongoHarness.stop();
});
