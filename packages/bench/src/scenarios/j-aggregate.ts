/*
 * Group J — aggregations. Two kinds of measurement:
 *  - J.build.*: the cost of BUILDING a 15-stage pipeline (no server): a raw object literal (driver), the
 *    Mongoose `Aggregate` builder, the typed Typemo builder (`Pipeline.from(Entity)…plan()`).
 *  - J.<stage>: build + execute. Driver and Mongoose send a raw pipeline (Mongoose does not cast
 *    aggregations); Typemo builds it with the typed builder and runs it through its operation pipeline
 *    (cast of `$match` literals, policies, Hidden `$unset`). Every pipeline ends in a total `$sort`, the rows
 *    are canonicalised and hashed. `typemo-lean` is skipped: aggregation rows are plain in any mode.
 */
import { fn, type Model, Pipeline, withWindow } from "@venloc/typemo";
import type { Db, Document } from "mongodb";
import type { Model as MModel, PipelineStage } from "mongoose";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { J_COLLECTIONS, JMongoose, JProduct, JSale, JSeed } from "./support-bb/aggregate-models.ts";
import { BbChecksum } from "./support-bb/bb-checksum.ts";

/** Sales documents per dataset size. */
const SALES_OF: Readonly<Record<SizeName, number>> = { T: 200, S: 1_000, M: 100_000, L: 1_000_000, XL: 1_000_000 };

/**
 * One aggregation, written twice: the raw pipeline and the typed builder over the same stages.
 *
 * @example
 * ```ts
 * const pipeline: JPipeline = PIPELINES[0]!;
 * ```
 */
interface JPipeline {
  /** Short key, part of the scenario id. */
  readonly key: string;
  /** Description of the aggregation. */
  readonly title: string;
  /** The raw pipeline the driver and Mongoose send. */
  readonly raw: () => Document[];
  /** The typed Typemo version. */
  readonly typed: (Sales: Model<JSale>) => Promise<readonly unknown[]>;
  /** Sizes per profile (quick only where listed). */
  readonly sizes: Readonly<Partial<Record<ProfileName, readonly SizeName[]>>>;
}

/** The 15-stage pipeline, three ways (shared by J.build and J.pipeline15). */
export class JLong {
  /**
   * The raw pipeline.
   *
   * @returns The stages.
   */
  static raw(): Document[] {
    return [
      { $match: { qty: { $gte: 1 } } },
      { $addFields: { net: { $multiply: ["$amount", "$qty"] } } },
      { $unwind: "$tags" },
      { $match: { tags: { $ne: "x" } } },
      { $group: { _id: { region: "$region", tag: "$tags" }, net: { $sum: "$net" }, n: { $sum: 1 } } },
      { $addFields: { avg: { $divide: ["$net", "$n"] } } },
      { $sort: { net: -1 } },
      { $limit: 1000 },
      { $project: { net: 1, n: 1, avg: 1 } },
      { $set: { bucket: { $cond: [{ $gt: ["$net", 50_000] }, "hi", "lo"] } } },
      { $match: { n: { $gte: 1 } } },
      { $sort: { "_id.region": 1, "_id.tag": 1 } },
      { $skip: 1 },
      { $limit: 500 },
      { $unset: "avg" },
    ];
  }

  /**
   * The same pipeline with the typed Typemo builder.
   *
   * @returns The builder, ready for `plan()`.
   */
  static typed() {
    return Pipeline.from(JSale)
      .match({ qty: { $gte: 1 } })
      .addFields((f) => ({ net: fn.multiply(f.amount, f.qty) }))
      .unwind("$tags")
      .match({ tags: { $ne: "x" } })
      .group((f) => ({ _id: { region: f.region, tag: f.tags }, net: fn.sum(f.net), n: fn.sum(1) }))
      .addFields((f) => ({ avg: fn.divide(f.net, f.n) }))
      .sort({ net: -1 })
      .limit(1000)
      .project({ net: 1, n: 1, avg: 1 })
      .set((f) => ({ bucket: fn.cond(fn.gt(f.net, 50_000), "hi", "lo") }))
      .match({ n: { $gte: 1 } })
      .sort({ "_id.region": 1, "_id.tag": 1 })
      .skip(1)
      .limit(500)
      .unset("avg");
  }

  /**
   * The Mongoose `Aggregate` builder (not executed); stages without a builder method use `append`.
   *
   * @param Sales - The Mongoose model.
   * @returns The aggregate.
   */
  static mongoose(Sales: MModel<Record<string, unknown>>) {
    return Sales.aggregate()
      .match({ qty: { $gte: 1 } })
      .addFields({ net: { $multiply: ["$amount", "$qty"] } })
      .unwind("$tags")
      .match({ tags: { $ne: "x" } })
      .group({ _id: { region: "$region", tag: "$tags" }, net: { $sum: "$net" }, n: { $sum: 1 } })
      .addFields({ avg: { $divide: ["$net", "$n"] } })
      .sort({ net: -1 })
      .limit(1000)
      .project({ net: 1, n: 1, avg: 1 })
      .append({ $set: { bucket: { $cond: [{ $gt: ["$net", 50_000] }, "hi", "lo"] } } })
      .match({ n: { $gte: 1 } })
      .sort({ "_id.region": 1, "_id.tag": 1 })
      .skip(1)
      .limit(500)
      .append({ $unset: "avg" });
  }
}

/** Every executed aggregation. */
const PIPELINES: readonly JPipeline[] = [
  {
    key: "group",
    title: "$group by region (sum, count, avg, max)",
    sizes: { quick: ["S"], standard: ["S", "M"], full: ["S", "M", "L"] },
    raw: () => [
      {
        $group: {
          _id: "$region",
          total: { $sum: "$amount" },
          n: { $sum: 1 },
          avgQty: { $avg: "$qty" },
          maxAmount: { $max: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ],
    typed: (Sales) =>
      Sales.aggregate((p) =>
        p
          .group((f) => ({
            _id: f.region,
            total: fn.sum(f.amount),
            n: fn.sum(1),
            avgQty: fn.avg(f.qty),
            maxAmount: fn.max(f.amount),
          }))
          .sort({ _id: 1 }),
      ).exec(),
  },
  {
    key: "lookup",
    title: "$lookup product + $unwind + $project, one region",
    sizes: { standard: ["S"], full: ["S", "M"] },
    raw: () => [
      { $match: { region: "north" } },
      { $lookup: { from: J_COLLECTIONS.products, localField: "product", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $project: { amount: 1, name: "$p.name", price: "$p.price" } },
      { $sort: { _id: 1 } },
    ],
    typed: (Sales) =>
      Sales.aggregate((p) =>
        p
          .match({ region: "north" })
          .lookup({ from: JProduct, localField: "product", foreignField: "_id", as: "p" })
          .unwind("$p")
          .project((f) => ({ amount: 1, name: f.p.name, price: f.p.price }))
          .sort({ _id: 1 }),
      ).exec(),
  },
  {
    key: "facet",
    title: "$facet: sortByCount(region), top 5 amounts, totals by channel",
    sizes: { standard: ["S"], full: ["S", "M"] },
    raw: () => [
      {
        $facet: {
          byRegion: [{ $sortByCount: "$region" }, { $sort: { count: -1, _id: 1 } }],
          top: [{ $sort: { amount: -1, _id: 1 } }, { $limit: 5 }, { $project: { amount: 1 } }],
          channels: [{ $group: { _id: "$channel", total: { $sum: "$amount" } } }, { $sort: { _id: 1 } }],
        },
      },
    ],
    typed: (Sales) =>
      Sales.aggregate((p) =>
        p.facet({
          byRegion: (b) => b.sortByCount((f) => f.region).sort({ count: -1, _id: 1 }),
          top: (b) => b.sort({ amount: -1, _id: 1 }).limit(5).project({ amount: 1 }),
          channels: (b) => b.group((f) => ({ _id: f.channel, total: fn.sum(f.amount) })).sort({ _id: 1 }),
        }),
      ).exec(),
  },
  {
    key: "window",
    title: "$setWindowFields: rank and running total per region by time",
    sizes: { standard: ["S"], full: ["S", "M"] },
    raw: () => [
      {
        $setWindowFields: {
          partitionBy: "$region",
          sortBy: { at: 1 },
          output: {
            rank: { $rank: {} },
            running: { $sum: "$amount", window: { documents: ["unbounded", "current"] } },
          },
        },
      },
      { $project: { region: 1, rank: 1, running: 1 } },
      { $sort: { _id: 1 } },
    ],
    typed: (Sales) =>
      Sales.aggregate((p) =>
        p
          .setWindowFields({
            partitionBy: (f) => f.region,
            sortBy: { at: 1 },
            output: (f) => ({
              rank: fn.rank(),
              running: withWindow(fn.sum(f.amount), { documents: ["unbounded", "current"] }),
            }),
          })
          .project({ region: 1, rank: 1, running: 1 })
          .sort({ _id: 1 }),
      ).exec(),
  },
  {
    key: "pipeline15",
    title: "15-stage pipeline (match, unwind, group, sort, project, set, skip, limit, unset …)",
    sizes: { standard: ["S"], full: ["S", "M"] },
    raw: JLong.raw,
    typed: (Sales) => Sales.aggregate(JLong.typed().plan()).exec(),
  },
];

/**
 * The outcome of aggregation rows.
 *
 * @param rows - The result rows.
 * @returns The count and a checksum of the rows.
 * @throws Error - When there are no rows.
 */
const rowsOutcome = (rows: readonly unknown[]): Outcome => {
  if (rows.length === 0) throw new Error("no rows: the pipeline matched nothing");
  return { count: rows.length, checksum: BbChecksum.rows(rows) };
};

/** Builds and executes one aggregation. */
class AggregateScenario extends Scenario {
  readonly id: string;
  readonly group = "J" as const;
  readonly title: string;
  readonly profiles: readonly ProfileName[];
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "mongoose-safe", "typemo"];
  override readonly notes =
    "Sizes: sales S = 1k, M = 100k, L = 1M (L only in full). Driver/Mongoose run the raw pipeline (Mongoose does not " +
    "cast aggregations); Typemo builds it with the typed builder every run and runs it through the operation " +
    "pipeline. typemo-lean skipped: aggregation rows are plain in any mode.";

  /**
   * @param pipeline - The aggregation to run.
   */
  constructor(private readonly pipeline: JPipeline) {
    super();
    this.id = `J.aggregate.${pipeline.key}`;
    this.title = `aggregate: ${pipeline.title}`;
    this.profiles = Object.keys(pipeline.sizes) as ProfileName[];
  }

  /**
   * The sizes to run under a profile.
   *
   * @param profile - The profile.
   * @returns The sizes listed for the profile.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return this.pipeline.sizes[profile] ?? [];
  }

  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns The number of sales.
   */
  override unitsPerOp(size: SizeName): number {
    return SALES_OF[size];
  }

  /**
   * Seeds every contestant's database.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    for (const contestant of this.contestants) await JSeed.seed(env.ctx.dbOf(contestant), SALES_OF[env.size]);
  }

  /**
   * Builds a contestant that executes the aggregation.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const impl = (run: () => Promise<readonly unknown[]>): ContestantImpl<unknown> =>
      ScenarioKit.impl<readonly unknown[]>({ run, verify: rowsOutcome });
    const raw = (db: Db) => () => db.collection(J_COLLECTIONS.sales).aggregate(this.pipeline.raw()).toArray();
    const mongoose = (Sales: MModel<Record<string, unknown>>) => () =>
      Sales.aggregate(this.pipeline.raw() as PipelineStage[]).exec();
    return ScenarioKit.pick(
      {
        driver: () => impl(raw(env.ctx.driver.db)),
        mongoose: () => impl(mongoose(JMongoose.sales(env.ctx.mongoose))),
        "mongoose-safe": () => impl(mongoose(JMongoose.sales(env.ctx.mongooseSafe))),
        typemo: () => {
          const Sales = env.ctx.typemo.model(JSale);
          return impl(() => this.pipeline.typed(Sales));
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** Building the 15-stage pipeline only: no server round trip. The checksum is the stage-name sequence. */
class BuildScenario extends Scenario {
  readonly id = "J.build.pipeline15";
  readonly group = "J" as const;
  readonly title = "build a 15-stage pipeline (no execution)";
  readonly profiles: readonly ProfileName[] = ["quick", "standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["driver", "mongoose", "typemo"];
  override readonly notes =
    "Driver: a fresh object literal. Mongoose: the Aggregate builder chain (no exec). Typemo: " +
    "Pipeline.from(Entity) with typed callbacks, `.plan()` (frozen stages). Measures the builder only.";

  /**
   * Builds a contestant that builds the pipeline without running it.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const names = (stages: readonly object[]): Outcome => {
      const list = stages.map((stage) => Object.keys(stage)[0] ?? "?");
      return { count: list.length, checksum: BbChecksum.of(list) };
    };
    return ScenarioKit.pick(
      {
        driver: () => ScenarioKit.impl<Document[]>({ run: JLong.raw, verify: names }),
        mongoose: () => {
          const Sales = JMongoose.sales(env.ctx.mongoose);
          return ScenarioKit.impl<readonly object[]>({
            run: () => JLong.mongoose(Sales).pipeline(),
            verify: names,
          });
        },
        typemo: () =>
          ScenarioKit.impl<readonly object[]>({
            run: () => JLong.typed().plan().pipeline,
            verify: names,
          }),
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** The scenarios of group J. */
export const SCENARIOS: readonly Scenario[] = [new BuildScenario(), ...PIPELINES.map((p) => new AggregateScenario(p))];
