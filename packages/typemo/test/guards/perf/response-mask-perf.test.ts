/*
 * `.mask()` is the last step, on the result only. Without it no mask code runs (the query is the same object
 * path as without masking); with it, 1000 lean rows are masked through a path tree compiled once. The thresholds
 * are generous (a slow CI machine); the numbers go to the report.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { Entity, Mask, type Model, Prop, Schema } from "../../../src/index.ts";
import { ResponseMask } from "../../../src/query/response-mask.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

@Schema()
class PerfAddress {
  @Prop(() => String, { required: true }) street!: string;
  @Prop(() => String, { required: true }) city!: string;
}

@Schema({ collection: "perf_masked_rows" })
class PerfMasked extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => [PerfAddress]) addresses!: PerfAddress[];
}

const ROWS = 1000;
const ROUNDS = 20;
const t = ModelLifecycle.useTypemo("perf_mask116b");
let Rows: Model<PerfMasked>;

/** The mask spec under test. */
const SPEC = { email: Mask.email(), "addresses.street": "mask" } as const;

/** A raw row of the model for `index`. */
const row = (index: number) => ({
  name: `user-${index}`,
  email: `user${index}@example.com`,
  addresses: [
    { street: `Main ${index}`, city: "Oslo" },
    { street: `Side ${index}`, city: "Rome" },
  ],
});

/** The mean wall time of `run` over `ROUNDS` rounds, after one warm-up call (ms). */
const time = async (run: () => Promise<unknown>): Promise<number> => {
  await run();
  const started = performance.now();
  for (let round = 0; round < ROUNDS; round++) await run();
  return (performance.now() - started) / ROUNDS;
};

beforeAll(async () => {
  Rows = t.connection.model(PerfMasked);
});

describe("perf: .mask() on 1000 rows", () => {
  test("the mask pass alone (in memory): 1000 rows far under the threshold", () => {
    const rows = Array.from({ length: ROWS }, (_, index) => ({ _id: index, ...row(index) }));
    const tree = ResponseMask.compile(SPEC);
    for (let index = 0; index < 5; index++) ResponseMask.apply(tree, rows, "PerfMasked");
    const started = performance.now();
    for (let round = 0; round < ROUNDS; round++) ResponseMask.apply(tree, rows, "PerfMasked");
    const perPass = (performance.now() - started) / ROUNDS;
    console.log(`[perf] ResponseMask.apply: ${ROWS} rows in ${perPass.toFixed(2)} ms per pass`);
    expect(perPass).toBeLessThan(50);
  });

  test("find().lean() with and without .mask() on the real server", async () => {
    await Rows.insertMany(Array.from({ length: ROWS }, (_, index) => row(index)));
    const plain = await time(() => Rows.find().lean().exec());
    const masked = await time(() => Rows.find().lean().mask(SPEC).exec());
    console.log(
      `[perf] find().lean() ${ROWS} rows: ${plain.toFixed(2)} ms; with .mask(): ${masked.toFixed(2)} ms (+${(masked - plain).toFixed(2)} ms)`,
    );
    const rows = await Rows.find().lean().mask(SPEC);
    expect(rows).toHaveLength(ROWS);
    expect(rows[0]?.addresses[0]?.street).toBe("?");
    /* Generous: the mask may cost at most as much again as the query itself, plus 50 ms of noise. */
    expect(masked).toBeLessThan(plain * 2 + 50);
  });
});
