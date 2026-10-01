/*
 * Group O — YCSB-like load: workloads A (50/50 read/update), B (95/5), C (read only), E (95% short scans /
 * 5% inserts), F (50% read / 50% read-modify-write) over a `usertable` (10 fields × 100 chars), zipfian keys,
 * N concurrent async clients in one process sharing each contestant's pool (maxPoolSize 10 for everyone).
 * Self-timed: ONE measured run per contestant (warmup + fixed duration); throughput and latency percentiles
 * are reported as `metrics`. The harness' extra verify/commands runs (iteration ≥ 1e6) run a SHORT load that is
 * verified: no errors, the op mix matches the workload, scans returned rows, and the table holds exactly the
 * seeded records plus the inserts the run reported.
 * standard: records 10k, 10/100 clients, 2 s (+0.5 s warmup) per contestant; full: 100k, 10/100/1000, 60 s.
 */
import "reflect-metadata";
import { Entity, Prop, Schema } from "@venloc/typemo";
import type { Db, Document, ObjectId } from "mongodb";
import type { Model as MModel } from "mongoose";
import type { MongooseHandle, TypemoHandle } from "../adapters/bench-context.ts";
import { Loose } from "../adapters/loose.ts";
import { MongooseTrust } from "../adapters/ops.ts";
import { Rng } from "../data/rng.ts";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import { CONTESTANTS, type ContestantId, type Outcome, type ProfileName, type SizeName } from "../harness/types.ts";
import { ISeed } from "./support-bb/populate-models.ts";
import {
  type LoadResult,
  LoadRunner,
  YCSB_FIELDS,
  YCSB_MIX,
  type YcsbOps,
  type YcsbWorkload,
} from "./support-bb/ycsb.ts";
import { YcsbValues } from "./support-bb/ycsb-values.ts";

/** The YCSB table. */
const USERTABLE = "bb_o_usertable";
/** The collection that records how many users are seeded. */
const O_MARKER = "bb_o_marker";
/** The id namespace of the users. */
const KEY_CODE = 0x60;
/** The iteration index from which the harness runs verification. */
const VERIFY_ITERATION = 1_000_000;

/** A YCSB user: ten string fields. */
@Schema({ collection: USERTABLE })
export class YcsbUser extends Entity {
  @Prop(() => String, { required: true }) field0!: string;
  @Prop(() => String, { required: true }) field1!: string;
  @Prop(() => String, { required: true }) field2!: string;
  @Prop(() => String, { required: true }) field3!: string;
  @Prop(() => String, { required: true }) field4!: string;
  @Prop(() => String, { required: true }) field5!: string;
  @Prop(() => String, { required: true }) field6!: string;
  @Prop(() => String, { required: true }) field7!: string;
  @Prop(() => String, { required: true }) field8!: string;
  @Prop(() => String, { required: true }) field9!: string;
}

/** Seeded users per dataset size. */
const RECORDS_OF: Readonly<Record<SizeName, number>> = { T: 1_000, S: 10_000, M: 100_000, L: 100_000, XL: 100_000 };

/**
 * How long a load runs.
 *
 * @example
 * ```ts
 * const timing: Timing = { durationMs: 2_000, warmupMs: 500 };
 * ```
 */
interface Timing {
  /** The measured duration, ms. */
  readonly durationMs: number;
  /** The warmup before measuring, ms. */
  readonly warmupMs: number;
}

/** The measured run per profile; the verify/commands runs and `--size T` smoke runs are short. */
const TIMING: Readonly<Record<ProfileName | "short", Timing>> = {
  quick: { durationMs: 1_000, warmupMs: 200 },
  standard: { durationMs: 2_000, warmupMs: 500 },
  full: { durationMs: 60_000, warmupMs: 5_000 },
  heavy: { durationMs: 60_000, warmupMs: 5_000 },
  short: { durationMs: 300, warmupMs: 100 },
};

/**
 * The id of a user.
 *
 * @param key - The key number.
 * @returns The deterministic id.
 */
const keyOf = (key: number): ObjectId => ISeed.oid(KEY_CODE, key);
/**
 * A user document.
 *
 * @param key - The key number.
 * @param fields - The ten field values.
 * @returns The document.
 */
const docOf = (key: number, fields: readonly string[]): Document => {
  const doc: Document = { _id: keyOf(key) };
  fields.forEach((value, i) => {
    doc[`field${i}`] = value;
  });
  return doc;
};

/** The YCSB table: seeding, reset and the operations of each contestant. */
export class YcsbTable {
  /**
   * Seeds `records` users (idempotent) — shared by groups O and Q.
   *
   * @param db - The database.
   * @param records - How many users.
   */
  static async seed(db: Db, records: number): Promise<void> {
    const marker = db.collection<{ _id: string; records: number }>(O_MARKER);
    const table = db.collection(USERTABLE);
    if ((await marker.findOne({ _id: "usertable" }))?.records === records) return;
    await marker.deleteMany({});
    await table.deleteMany({});
    const rng = new Rng(0x7c5b);
    for (let start = 0; start < records; start += 5_000) {
      const batch = Array.from({ length: Math.min(5_000, records - start) }, (_, k) =>
        docOf(start + k, YcsbValues.record(rng)),
      );
      await table.insertMany(batch, { ordered: false });
    }
    await marker.insertOne({ _id: "usertable", records });
  }

  /**
   * Removes the rows inserted by workload E (keys ≥ records).
   *
   * @param db - The database.
   * @param records - The number of seeded users.
   */
  static async reset(db: Db, records: number): Promise<void> {
    await db.collection(USERTABLE).deleteMany({ _id: { $gte: keyOf(records) } });
  }

  /**
   * The number of rows in the table.
   *
   * @param db - The database.
   * @returns The count.
   */
  static count(db: Db): Promise<number> {
    return db.collection(USERTABLE).countDocuments();
  }

  /**
   * The Mongoose model of the table.
   *
   * @param handle - The Mongoose contestant.
   * @returns The model.
   */
  static mongoose(handle: MongooseHandle): MModel<Document> {
    return handle.model(USERTABLE, USERTABLE, (m) => {
      const definition: Record<string, unknown> = {};
      for (let i = 0; i < YCSB_FIELDS; i++) definition[`field${i}`] = { type: String, required: true };
      return new m.Schema(definition);
    });
  }

  /**
   * The four YCSB operations of each contestant.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns Read, update, scan and insert.
   */
  static ops(contestant: ContestantId, env: ScenarioEnv): YcsbOps {
    const set = (field: number, value: string): Document => ({ $set: { [`field${field}`]: value } });
    if (contestant === "driver") {
      const table = env.ctx.driver.db.collection(USERTABLE);
      return {
        read: (key) => table.findOne({ _id: keyOf(key) }),
        update: (key, field, value) => table.updateOne({ _id: keyOf(key) }, set(field, value)),
        scan: (from, count) =>
          table
            .find({ _id: { $gte: keyOf(from) } })
            .sort({ _id: 1 })
            .limit(count)
            .toArray(),
        insert: (key, fields) => table.insertOne(docOf(key, fields)),
      };
    }
    if (contestant === "mongoose" || contestant === "mongoose-safe") {
      const handle = contestant === "mongoose" ? env.ctx.mongoose : env.ctx.mongooseSafe;
      const Users = YcsbTable.mongoose(handle);
      return {
        read: (key) => Users.findOne({ _id: keyOf(key) }).exec(),
        update: (key, field, value) => Users.updateOne({ _id: keyOf(key) }, set(field, value)).exec(),
        scan: (from, count) =>
          Users.find(MongooseTrust.filter(handle, { _id: { $gte: keyOf(from) } }))
            .sort({ _id: 1 })
            .limit(count)
            .exec(),
        insert: (key, fields) => Users.create(docOf(key, fields)),
      };
    }
    const handle: TypemoHandle = contestant === "typemo" ? env.ctx.typemo : env.ctx.typemoLean;
    const Users = Loose.typemo(handle.model(YcsbUser));
    const read = handle.lean ? (q: ReturnType<typeof Users.find>) => q.lean() : (q: ReturnType<typeof Users.find>) => q;
    return {
      read: (key) => read(Users.findOne({ _id: keyOf(key) })).exec(),
      update: async (key, field, value) => Users.updateOne({ _id: keyOf(key) }, set(field, value)),
      scan: async (from, count) =>
        (await read(
          Users.find({ _id: { $gte: keyOf(from) } })
            .sort({ _id: 1 })
            .limit(count),
        ).exec()) as readonly unknown[],
      insert: (key, fields) => Users.insertOne(docOf(key, fields)),
    };
  }
}

/** One YCSB workload at one client count. */
class LoadScenario extends Scenario {
  readonly id: string;
  readonly group = "O" as const;
  readonly title: string;
  readonly profiles: readonly ProfileName[];
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  override readonly contestants: readonly ContestantId[] = CONTESTANTS;
  override readonly iterations = { warmup: 0, minSamples: 1, maxSamples: 1, repeats: 1 };
  override readonly notes: string;

  /**
   * @param workload - The YCSB workload.
   * @param clients - The number of concurrent clients.
   */
  constructor(
    private readonly workload: YcsbWorkload,
    private readonly clients: number,
  ) {
    super();
    this.id = `O.ycsb.${workload}.c${clients}`;
    this.title = `YCSB ${workload} (${Object.entries(YCSB_MIX[workload])
      .map(([op, share]) => `${op} ${share * 100}%`)
      .join(", ")}), ${clients} clients`;
    this.profiles = clients === 1000 ? ["full"] : ["standard", "full"];
    this.notes =
      "Self-timed: the time column is the whole run; see metrics (opsPerSec, p50/p95/p99/max ms). " +
      "standard: 10k records, 2 s measured after 0.5 s warmup; full: 100k records, 60 s after 5 s. " +
      "Pool maxPoolSize 10 for every contestant: with 100+ clients requests queue in the pool.";
  }

  /**
   * The sizes to run under a profile.
   *
   * @param profile - The profile.
   * @returns M for `full`, S otherwise; none when the profile does not run the scenario.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    if (!this.profiles.includes(profile)) return [];
    return profile === "full" ? ["M"] : ["S"];
  }

  /**
   * Units per operation: the whole run counts as one.
   *
   * @returns `1`.
   */
  override unitsPerOp(): number {
    return 1;
  }

  /**
   * Seeds the table of every contestant.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    for (const contestant of this.contestants) await YcsbTable.seed(env.ctx.dbOf(contestant), RECORDS_OF[env.size]);
  }

  /**
   * Builds a contestant that runs the load and verifies the result.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const records = RECORDS_OF[env.size];
    const db = env.ctx.dbOf(contestant);
    const ops = YcsbTable.ops(contestant, env);
    let measured: LoadResult | undefined;
    const timing = (iteration: number): Timing =>
      iteration >= VERIFY_ITERATION || env.size === "T" ? TIMING.short : TIMING[env.profile];
    return ScenarioKit.impl<LoadResult>({
      setup: () => YcsbTable.reset(db, records),
      before: () => YcsbTable.reset(db, records),
      run: async (iteration) => {
        const result = await LoadRunner.run(ops, {
          workload: this.workload,
          records,
          clients: this.clients,
          ...timing(iteration),
          seed: 0x5eed + iteration,
          insertStart: records,
        });
        if (iteration < VERIFY_ITERATION) measured = result;
        return result;
      },
      verify: async (result): Promise<Outcome> => {
        if (result.errors > 0) throw new Error(`${contestant}: ${result.errors} errors, first: ${result.firstError}`);
        if (result.ops === 0) throw new Error(`${contestant}: no operations completed`);
        for (const [op, share] of Object.entries(YCSB_MIX[this.workload])) {
          const got = (result.byOp[op as keyof LoadResult["byOp"]] ?? 0) / result.ops;
          if (result.ops >= 200 && Math.abs(got - share) > 0.1)
            throw new Error(`${contestant}: ${op} is ${(got * 100).toFixed(1)}% of ops, expected ${share * 100}%`);
        }
        if (this.workload === "E" && result.scannedRows === 0) throw new Error(`${contestant}: scans returned nothing`);
        const rows = await YcsbTable.count(db);
        if (rows !== records + result.inserted)
          throw new Error(`${contestant}: ${rows} rows, expected ${records} + ${result.inserted} inserted`);
        const m = measured ?? result;
        const round = (x: number): number => Math.round(x * 1000) / 1000;
        return {
          count: 1,
          checksum: "",
          metrics: {
            clients: this.clients,
            opsPerSec: Math.round(m.opsPerSec),
            ops: m.ops,
            p50Ms: round(m.p50),
            p95Ms: round(m.p95),
            p99Ms: round(m.p99),
            maxMs: round(m.max),
            errors: m.errors,
          },
        };
      },
    });
  }
}

/** The workloads that are run. */
const WORKLOADS: readonly YcsbWorkload[] = ["A", "B", "C", "E", "F"];

/** The scenarios of group O. */
export const SCENARIOS: readonly Scenario[] = WORKLOADS.flatMap((workload) =>
  [10, 100, 1000].map((clients) => new LoadScenario(workload, clients)),
);
