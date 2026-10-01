/* Smoke test: the package barrel loads. */
import { expect, test } from "bun:test";
import * as testKit from "./index.ts";

test("test-kit package loads", () => {
  expect(testKit).toBeDefined();
});
