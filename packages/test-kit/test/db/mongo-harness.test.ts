/*
 * Tests the channel and version resolution of `MongoHarness`. Pure logic — no mongod involved, so this
 * doesn't need to download anything or share the process-wide shared instance.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { MongoHarness } from "../../src/db/mongo-harness.ts";

/** The value of `TYPEMO_MONGO` before the tests, restored afterwards. */
const originalEnv = process.env.TYPEMO_MONGO;

beforeEach(() => {
  delete process.env.TYPEMO_MONGO;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.TYPEMO_MONGO;
  } else {
    process.env.TYPEMO_MONGO = originalEnv;
  }
});

test("defaults to the upcoming channel/version", () => {
  expect(MongoHarness.resolveChannel()).toBe("upcoming");
  expect(MongoHarness.resolveVersion()).toBe("9.0.0-rc0");
});

test("TYPEMO_MONGO=stable selects the stable channel/version", () => {
  process.env.TYPEMO_MONGO = "stable";
  expect(MongoHarness.resolveChannel()).toBe("stable");
  expect(MongoHarness.resolveVersion()).toBe("8.3.11");
});

test("any other TYPEMO_MONGO value falls back to upcoming", () => {
  process.env.TYPEMO_MONGO = "nightly";
  expect(MongoHarness.resolveChannel()).toBe("upcoming");
});
