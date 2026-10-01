/*
 * A ready-made mask is a pass over char codes with everything constant computed at factory time. One million
 * calls of email / card / keep must stay far under a generous threshold (a regex or an allocation-heavy
 * code-point split per call would still pass on a fast machine, so the numbers go to the report).
 */
import { describe, expect, test } from "bun:test";
import { Mask } from "../../../src/index.ts";

const CALLS = 1_000_000;
/* Generous: ~1 µs per call on a slow CI machine. */
const THRESHOLD_MS = 1500;

/** Runs `run` `CALLS` times, prints the timing and returns the elapsed milliseconds. */
const measure = (name: string, run: (index: number) => unknown): number => {
  for (let index = 0; index < 10_000; index++) run(index); /* warm-up */
  const started = performance.now();
  let sink = 0;
  for (let index = 0; index < CALLS; index++) if (run(index) !== undefined) sink++;
  const elapsed = performance.now() - started;
  expect(sink).toBe(CALLS);
  console.log(
    `[perf] Mask.${name}: ${CALLS} calls in ${elapsed.toFixed(1)} ms (${((elapsed * 1e6) / CALLS).toFixed(0)} ns/call)`,
  );
  return elapsed;
};

const EMAILS = ["alice@gmail.com", "bob.smith@example.org", "😀user@mail.test", "x@y.z"];
const CARDS = ["4242424242424242", "4242 4242 4242 4242", "5555555555554444", "378282246310005"];
const WORDS = ["abcdefgh", "секретный-пароль", "😀😁abc😂😃", "sk_live_51HxAbCdEf9fQ"];

describe("perf: Mask.* one million calls", () => {
  test("email", () => {
    const mask = Mask.email();
    expect(measure("email", (index) => mask.mask(EMAILS[index & 3] as string))).toBeLessThan(THRESHOLD_MS);
  });
  test("card", () => {
    const mask = Mask.card();
    expect(measure("card", (index) => mask.mask(CARDS[index & 3] as string))).toBeLessThan(THRESHOLD_MS);
  });
  test("keep", () => {
    const mask = Mask.keep();
    expect(measure("keep", (index) => mask.mask(WORDS[index & 3] as string))).toBeLessThan(THRESHOLD_MS);
  });
});
