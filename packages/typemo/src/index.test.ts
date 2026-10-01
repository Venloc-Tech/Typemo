import { expect, test } from "bun:test";
import { VERSION } from "./index.ts";

test("core package loads", () => {
  expect(VERSION).toBe("0.0.0");
});
