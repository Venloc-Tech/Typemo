import { expect, test } from "bun:test";
import { ExprCompiler } from "../../../src/aggregate/expressions/expr-compiler.ts";

/*
 * Regression: a `__proto__` key of user input must stay an own key and must not change the prototype of the copy
 * (objects parsed from JSON can carry such a key).
 */
test("resolveFilter keeps a __proto__ key as a plain own key", () => {
  const input = JSON.parse('{"__proto__": {"polluted": true}, "name": "x"}') as Record<string, unknown>;
  const out = ExprCompiler.resolveFilter(input as never);
  expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  expect(Object.hasOwn(out, "__proto__")).toBe(true);
  expect(out.name).toBe("x");
  expect((out as { polluted?: unknown }).polluted).toBeUndefined();
});
