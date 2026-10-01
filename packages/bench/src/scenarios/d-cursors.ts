import type { Document } from "mongodb";
import type { ContestantOps } from "../adapters/ops.ts";
import { FLAT, MEDIUM, type ShapeDef } from "../data/shapes/index.ts";
import { OpScenario } from "../harness/op-scenario.ts";
import type { Scenario } from "../harness/scenario.ts";
import type { MeasureKind, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { Outcomes } from "../harness/verify.ts";

/* Group D: cursors and streaming — `for await`, `eachAsync`, batch sizes and streaming memory. */

/** Profiles that run the heavier scenarios. */
const STANDARD: readonly ProfileName[] = ["standard", "full"];

/** What a streaming consumer computes per document: cheap and identical for every contestant. */
class Tally {
  /** Documents seen. */
  count = 0;
  /** Sum of a numeric field of the documents seen. */
  sum = 0;
  /**
   * Adds one document.
   *
   * @param doc - A streamed document.
   */
  add(doc: unknown): void {
    this.count++;
    this.sum += Number(
      (doc as { readonly priority?: number; readonly age?: number }).priority ?? (doc as { age?: number }).age ?? 0,
    );
  }
  /** The outcome to compare across contestants. */
  get outcome(): Outcome {
    return Outcomes.value({ count: this.count, sum: this.sum }, this.count);
  }
}

/**
 * How a cursor is consumed.
 *
 * @example
 * ```ts
 * const mode: CursorMode = "eachAsync";
 * ```
 */
type CursorMode = "forAwait" | "eachAsync";

/**
 * Streams the whole collection through a cursor: the driver's `for await`, Mongoose `cursor()` (hydrated) and
 * `eachAsync`, Typemo `cursor()` hydrated and lean. `batchSize` is the same for everyone.
 */
class CursorScan extends OpScenario<object> {
  readonly group = "D" as const;
  /**
   * @param id - The scenario id.
   * @param title - The report title.
   * @param def - The shape to scan.
   * @param profiles - The profiles that run it.
   * @param sizes - The sizes it supports.
   * @param mode - How the cursor is consumed.
   * @param batch - The cursor batch size.
   * @param parallel - Concurrency of `eachAsync`.
   * @param kind - What is measured.
   * @param standardSizes - Sizes in the `standard` profile when they differ.
   */
  constructor(
    readonly id: string,
    readonly title: string,
    readonly def: ShapeDef<object>,
    readonly profiles: readonly ProfileName[],
    override readonly sizes: readonly SizeName[],
    readonly mode: CursorMode,
    readonly batch: number,
    readonly parallel: number,
    override readonly kind: MeasureKind = "time",
    override readonly standardSizes?: readonly SizeName[],
  ) {
    super();
  }

  /**
   * The sizes to run under a profile.
   *
   * @param profile - The profile.
   * @returns The sizes.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    if (profile === "standard" && this.standardSizes !== undefined) return this.standardSizes;
    return super.sizesFor(profile);
  }

  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns The whole collection.
   */
  override unitsPerOp(size: SizeName): number {
    return this.def.countFor(size);
  }

  /**
   * Streams the collection and tallies every document.
   *
   * @param ops - The contestant's operations.
   * @returns The tally.
   */
  async op(ops: ContestantOps): Promise<unknown> {
    const tally = new Tally();
    const sort: Document = { _id: 1 };
    switch (ops.kind) {
      case "driver": {
        /* The driver has no eachAsync: `for await` is what its user writes in both modes. */
        for await (const doc of ops.driver.find({}, { sort, batchSize: this.batch })) tally.add(doc);
        return tally;
      }
      case "mongoose": {
        const cursor = ops.mongoose.find(ops.filter({})).sort({ _id: 1 }).batchSize(this.batch).cursor();
        if (this.mode === "eachAsync") await cursor.eachAsync(tally.add, { parallel: this.parallel });
        else for await (const doc of cursor) tally.add(doc);
        return tally;
      }
      case "typemo": {
        let query = ops.typemo.find({}).sort(sort).batchSize(this.batch);
        if (ops.contestant === "typemo-lean") query = query.lean();
        const cursor = query.cursor();
        if (this.mode === "eachAsync") await cursor.eachAsync(tally.add, { parallel: this.parallel });
        else for await (const doc of cursor) tally.add(doc);
        return tally;
      }
    }
  }

  /**
   * The tally's outcome.
   *
   * @param result - The tally returned by `op`.
   * @returns The outcome.
   */
  override outcome(result: unknown): Outcome {
    return (result as Tally).outcome;
  }
}

/** The flat shape, loosely typed. */
const flat = FLAT as unknown as ShapeDef<object>;
/** The medium shape, loosely typed. */
const medium = MEDIUM as unknown as ShapeDef<object>;

/** The scenarios of group D. */
export const SCENARIOS: readonly Scenario[] = [
  new CursorScan(
    "D.cursor.forAwait",
    "for await по всей коллекции (medium), batchSize 1000",
    medium,
    ["quick", "standard", "full"],
    ["S", "M", "L"],
    "forAwait",
    1_000,
    1,
  ),
  new CursorScan(
    "D.cursor.eachAsync.parallel",
    "eachAsync parallel 8 по всей коллекции (medium)",
    medium,
    STANDARD,
    ["S", "M", "L"],
    "eachAsync",
    1_000,
    8,
  ),
  new CursorScan(
    "D.cursor.batchSize100",
    "for await с batchSize 100 (больше getMore) (flat)",
    flat,
    STANDARD,
    ["S", "M", "L"],
    "forAwait",
    100,
    1,
  ),
  new CursorScan(
    "D.cursor.memory",
    "память стриминга всей коллекции (medium): курсор не должен удерживать документы",
    medium,
    STANDARD,
    ["S", "M", "L"],
    "forAwait",
    1_000,
    1,
    "memory",
    ["M"],
  ),
  new CursorScan(
    "D.stream.heavy",
    "стриминг L/XL (flat) — только профиль heavy",
    flat,
    ["heavy"],
    ["L", "XL"],
    "forAwait",
    1_000,
    1,
    "memory",
  ),
];
