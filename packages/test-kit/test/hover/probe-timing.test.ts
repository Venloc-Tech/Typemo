/*
 * Timing of the `TypeProbe`. A fresh, non-shared probe is used so the cold number includes creating the
 * language service and loading lib + mongodb types. The bound is deliberately loose: this documents the cost,
 * it is not a benchmark gate.
 */
import { expect, test } from "bun:test";
import { TypeProbe } from "../../src/hover/type-probe.ts";

/**
 * A snippet that differs per index, so the probe cannot reuse a cached answer.
 *
 * @param i - Makes the snippet unique.
 * @returns The snippet text.
 */
const SNIPPET = (i: number): string => `
import type { Collection, ObjectId } from "mongodb";
interface User { _id: ObjectId; name: string; n${i}: number }
declare const users: Collection<User>;
const found = await users.findOne({ name: "a" });
//    ^?
`;

test("probe timing: cold first query vs warm queries", () => {
  const probe = new TypeProbe();
  let started = performance.now();
  probe.check(SNIPPET(0)).hover();
  const cold = performance.now() - started;

  const warmRuns = 20;
  started = performance.now();
  for (let i = 1; i <= warmRuns; i++) probe.check(SNIPPET(i)).hover();
  const warm = (performance.now() - started) / warmRuns;

  started = performance.now();
  for (let i = 1; i <= warmRuns; i++) probe.check(SNIPPET(i)).diagnostics();
  const warmDiagnostics = (performance.now() - started) / warmRuns;

  console.log(
    `[probe-timing] cold ${cold.toFixed(0)} ms; warm hover ${warm.toFixed(1)} ms/query; ` +
      `warm diagnostics ${warmDiagnostics.toFixed(1)} ms/query (${warmRuns} runs each)`,
  );
  expect(warm).toBeLessThan(cold);
  expect(warm).toBeLessThan(500);
});
