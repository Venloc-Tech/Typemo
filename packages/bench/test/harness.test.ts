/*
 * Tests the benchmark harness itself: canonical checksums, outcome comparison, statistics, the deterministic
 * data generator, the runner's detection of a contestant that did less work, and regression detection.
 */
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { Binary, Decimal128, Long, ObjectId } from "mongodb";
import type { BenchContext } from "../src/adapters/bench-context.ts";
import { Ids, Rng } from "../src/data/rng.ts";
import { FLAT, MEDIUM } from "../src/data/shapes/index.ts";
import { Stats } from "../src/harness/measure.ts";
import { Profiles } from "../src/harness/profiles.ts";
import { BenchRunner } from "../src/harness/runner.ts";
import { type ContestantImpl, Scenario, ScenarioKit } from "../src/harness/scenario.ts";
import type { ContestantId, RunResult, ScenarioResult } from "../src/harness/types.ts";
import { Canonical, Checksum, OutcomeComparer, Outcomes } from "../src/harness/verify.ts";
import { RegressionComparator } from "../src/report/regression.ts";

describe("Canonical / Checksum", () => {
  test("should give equal checksums for the same data in different BSON/ODM forms", () => {
    const id = new ObjectId();
    const a = { b: 1, a: new Map([["k", 2n]]), id, d: new Date(0), bin: new Binary(Buffer.from("x")) };
    const b = { id, bin: Buffer.from("x"), d: new Date(0), a: { k: Long.fromNumber(2) }, b: 1, undef: undefined };
    expect(Checksum.of(a)).toBe(Checksum.of(b));
  });

  test("should give different checksums when one value differs", () => {
    expect(Checksum.of({ x: Decimal128.fromString("1.10") })).not.toBe(
      Checksum.of({ x: Decimal128.fromString("1.11") }),
    );
  });

  test("should sort keys and tag BSON values", () => {
    expect(Canonical.of({ b: 1, a: new ObjectId("0123456789abcdef01234567") })).toEqual({
      a: "oid:0123456789abcdef01234567",
      b: 1,
    });
  });
});

describe("OutcomeComparer", () => {
  test("should report a contestant that did less work", () => {
    const problems = OutcomeComparer.compare(
      new Map([
        ["driver", Outcomes.docs([{ a: 1 }, { a: 2 }])],
        ["typemo", Outcomes.docs([{ a: 1 }])],
      ]),
    );
    expect(problems.join(";")).toContain("typemo: count 1");
  });

  test("should report a different final DB state", () => {
    const problems = OutcomeComparer.compare(
      new Map([
        ["driver", { count: 1, checksum: "", state: "c:1:aa" }],
        ["mongoose", { count: 1, checksum: "", state: "c:1:bb" }],
      ]),
    );
    expect(problems).toHaveLength(1);
  });

  test("should accept equal outcomes", () => {
    const o = Outcomes.docs([{ a: 1 }]);
    expect(
      OutcomeComparer.compare(
        new Map([
          ["driver", o],
          ["typemo", o],
        ]),
      ),
    ).toEqual([]);
  });
});

describe("Stats", () => {
  test("should compute median, percentiles and median of medians", () => {
    const s = Stats.of([5, 1, 3, 2, 4]);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.p95).toBeCloseTo(4.8);
    const mm = Stats.medianOfMedians([Stats.of([10]), Stats.of([1]), Stats.of([5])]);
    expect(mm.median).toBe(5);
  });
});

describe("data generator", () => {
  test("should be deterministic for a seed and an index", () => {
    expect(FLAT.input(42)).toEqual(FLAT.input(42));
    expect(new Rng(7).next()).toBe(new Rng(7).next());
    expect(Ids.of(1, 5).toHexString()).toBe("000000010000000000000005");
  });

  test("should apply schema defaults only in the stored form", () => {
    expect(MEDIUM.input(1).views).toBeUndefined();
    expect(MEDIUM.stored(1)).toMatchObject({ views: 0, language: "en" });
  });
});

/** A scenario without a database: the "typemo" contestant deliberately does less work. */
class LazyScenario extends Scenario {
  readonly id = "Z.selftest.lazy";
  readonly group = "A" as const;
  readonly title = "self-test";
  readonly profiles = ["quick"] as const;
  override readonly contestants: readonly ContestantId[] = ["driver", "typemo"];
  override readonly iterations = { warmup: 1, minSamples: 5, maxSamples: 10, repeats: 3 };
  /**
   * Builds a contestant that returns three items for the driver and two for everyone else.
   *
   * @param contestant - Who runs.
   * @returns The implementation.
   */
  build(contestant: ContestantId): ContestantImpl<unknown> {
    return ScenarioKit.impl({
      run: () => (contestant === "driver" ? [1, 2, 3] : [1, 2]),
      verify: (r: number[]) => Outcomes.docs(r),
    });
  }
}

describe("BenchRunner", () => {
  const runner = new BenchRunner(
    { profile: Profiles.get("quick"), commands: false, seed: 1, log: () => {} },
    /* cast: deliberate stub, the test only needs the shape, not a real context */
    undefined as unknown as BenchContext,
    undefined,
  );

  test("should fail a scenario whose contestant does less work", async () => {
    const [result] = await runner.run([{ scenario: new LazyScenario(), size: "T" }]);
    expect(result?.status).toBe("failed");
    expect(result?.contestants.find((c) => c.contestant === "typemo")?.status).toBe("mismatch");
    expect(result?.contestants.find((c) => c.contestant === "driver")?.time?.samples).toBeGreaterThanOrEqual(5);
  });

  test("should plan only the profile's sizes", () => {
    expect(runner.plan([new LazyScenario()]).map((p) => p.size)).toEqual(["S"]);
    const standard = new BenchRunner(
      { profile: Profiles.get("standard"), commands: false, seed: 1, log: () => {} },
      /* cast: deliberate stub, the test only needs the shape, not a real context */
      undefined as unknown as BenchContext,
      undefined,
    );
    expect(standard.plan([new LazyScenario()])).toEqual([]);
  });
});

describe("RegressionComparator", () => {
  const run = (median: number): RunResult =>
    ({
      version: 1,
      scenarios: [
        {
          id: "C.x",
          size: "S",
          contestants: [{ contestant: "typemo", status: "ok", time: { median } }],
          /* cast: deliberate stub, the test only needs the shape */
        } as unknown as ScenarioResult,
      ],
      /* cast: deliberate stub, the test only needs the shape */
    }) as unknown as RunResult;

  test("should flag a slowdown above 10 %", () => {
    expect(RegressionComparator.compare(run(1), run(1.2)).regressions).toHaveLength(1);
    expect(RegressionComparator.compare(run(1), run(1.05)).regressions).toHaveLength(0);
  });
});
