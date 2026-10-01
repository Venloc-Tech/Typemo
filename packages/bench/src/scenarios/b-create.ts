import type { AnyBulkWriteOperation, Document } from "mongodb";
import type { ContestantOps } from "../adapters/ops.ts";
import { FLAT, FLAT_STAMPED, LARGE, MEDIUM, type ShapeDef } from "../data/shapes/index.ts";
import { OpScenario, WRITERS } from "../harness/op-scenario.ts";
import type { Scenario, ScenarioEnv } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { Outcomes } from "../harness/verify.ts";

/* Group B: creating documents — single creates, insertMany variants, array create and a mixed bulkWrite. */

/** Profiles that run the heavier scenarios. */
const STANDARD: readonly ProfileName[] = ["standard", "full"];
/** Every profile. */
const EVERY: readonly ProfileName[] = ["quick", "standard", "full"];

/**
 * Inserts into an emptied collection every iteration (the reset is untimed), so every op does the same work and
 * the final state is comparable. The raw driver writes the STORED form (defaults applied by hand, timestamps set
 * in the timed part) — the work the ODMs do for their users.
 */
abstract class InsertScenario extends OpScenario<object> {
  readonly group = "B" as const;
  override readonly scope = "write" as const;
  /* Every sample pays an untimed reset: cap the samples (30 minimum still holds). */
  override readonly iterations = { maxSamples: 40 };
  override readonly seeding = "none" as const;
  override readonly contestants: readonly ContestantId[] = WRITERS;
  /**
   * Documents per operation for a size.
   *
   * @param size - The dataset size.
   * @returns The number of documents.
   */
  abstract batch(size: SizeName): number;
  /** `true` when the model has timestamps. */
  readonly stamped: boolean = false;

  /**
   * Documents per operation, for per-document costs.
   *
   * @param size - The dataset size.
   * @returns The batch size.
   */
  override unitsPerOp(size: SizeName): number {
    return this.batch(size);
  }

  /**
   * The documents one operation writes, in the form the contestant takes.
   *
   * @param ops - The contestant's operations.
   * @param env - The scenario environment.
   * @returns Stored documents for the driver, inputs for the ODMs.
   */
  docsFor(ops: ContestantOps, env: ScenarioEnv): Document[] {
    const n = this.batch(env.size);
    return ops.kind === "driver" ? this.def.storedMany(0, n) : this.def.inputs(0, n);
  }

  /**
   * Empties the collections instead of seeding them.
   *
   * @param env - The scenario environment.
   */
  override async prepare(env: ScenarioEnv): Promise<void> {
    await this.datasetsOf(env).reset(this.def, this.contestants);
  }

  /**
   * Small batches: `deleteMany` (cheap, keeps the collection and its WiredTiger files). Big batches: drop and
   * recreate (faster than deleting 10k+ documents). Dropping on every iteration exhausted mongod's file handles.
   *
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<void> {
    if (this.batch(env.size) >= 10_000) await this.datasetsOf(env).reset(this.def, [ops.contestant]);
    else await this.ctxOf(env).dbOf(ops.contestant).collection(this.def.collection).deleteMany({});
  }

  /**
   * Driver copies (it mutates its argument) plus timestamps when the model has them.
   *
   * @param docs - The documents to write.
   * @returns Fresh copies, stamped when the model has timestamps.
   */
  forDriver(docs: readonly Document[]): Document[] {
    if (!this.stamped) return docs.map((d) => ({ ...d }));
    const now = new Date();
    return docs.map((d) => ({ ...d, createdAt: now, updatedAt: now }));
  }

  /**
   * Fingerprints the final collection state (timestamps by type only).
   *
   * @param _result - Unused.
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   * @returns The state outcome.
   */
  override async outcome(_result: unknown, ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<Outcome> {
    return Outcomes.state(this.ctxOf(env).dbOf(ops.contestant), [this.def.collection], {
      volatile: this.stamped ? ["createdAt", "updatedAt"] : [],
    });
  }
}

/** `insertMany` of a batch, in ordered or unordered mode. */
class InsertManyScenario extends InsertScenario {
  /**
   * @param id - The scenario id.
   * @param title - The report title.
   * @param def - The shape to insert.
   * @param profiles - The profiles that run it.
   * @param sizes - The sizes it supports.
   * @param ordered - Whether the insert is ordered.
   * @param stamped - Whether the model has timestamps.
   * @param batchOf - The batch size per dataset size.
   * @param standardSizes - Sizes in the `standard` profile when they differ.
   */
  constructor(
    readonly id: string,
    readonly title: string,
    readonly def: ShapeDef<object>,
    readonly profiles: readonly ProfileName[],
    override readonly sizes: readonly SizeName[],
    readonly ordered: boolean,
    override readonly stamped: boolean,
    readonly batchOf: (size: SizeName) => number,
    override readonly standardSizes?: readonly SizeName[],
  ) {
    super();
  }

  /**
   * The batch size for a dataset size.
   *
   * @param size - The dataset size.
   * @returns The number of documents.
   */
  batch(size: SizeName): number {
    return this.batchOf(size);
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

  /** The prepared documents of each contestant. */
  #docs = new Map<ContestantId, Document[]>();

  /**
   * Prepares the documents outside the timed part.
   *
   * @param ops - The contestant's operations.
   * @param env - The scenario environment.
   */
  override setup(ops: ContestantOps, env: ScenarioEnv): void {
    this.#docs.set(ops.contestant, this.docsFor(ops, env));
  }

  /**
   * Inserts the prepared documents.
   *
   * @param ops - The contestant's operations.
   * @returns The insert result.
   */
  op(ops: ContestantOps): Promise<unknown> {
    const docs = this.#docs.get(ops.contestant) ?? [];
    if (ops.kind === "driver") {
      return ops.driver.insertMany(this.forDriver(docs), { ordered: this.ordered }).then((r) => r.insertedCount);
    }
    return ops.insertMany(docs, this.ordered);
  }
}

/** Creates one document through the document path of each contestant. */
class CreateOne extends InsertScenario {
  /**
   * @param id - The scenario id.
   * @param title - The report title.
   * @param def - The shape to create.
   * @param profiles - The profiles that run it.
   * @param stamped - Whether the model has timestamps.
   */
  constructor(
    readonly id: string,
    readonly title: string,
    readonly def: ShapeDef<object>,
    readonly profiles: readonly ProfileName[],
    override readonly stamped: boolean = false,
  ) {
    super();
  }

  /**
   * One document per operation.
   *
   * @returns `1`.
   */
  batch(): number {
    return 1;
  }

  /**
   * Runs at size S only.
   *
   * @param profile - The profile.
   * @returns `["S"]` when the profile runs the scenario.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return this.profiles.includes(profile) ? ["S"] : [];
  }

  /**
   * Creates one document.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the document.
   * @returns The create result.
   */
  op(ops: ContestantOps, i: number): Promise<unknown> {
    const n = i % 1000;
    if (ops.kind === "driver") return ops.driver.insertOne(this.forDriver([this.def.stored(n)])[0] ?? {});
    return ops.create(this.def.input(n));
  }
}

/** `create([100 docs])`: Mongoose saves each document (parallel `insertOne`s), Typemo one ordered bulk insert. */
class CreateArray extends InsertScenario {
  readonly id = "B.create.array100";
  readonly title = "create([100 документов]) — путь документа (medium)";
  readonly profiles = STANDARD;
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * One hundred documents per operation.
   *
   * @returns `100`.
   */
  batch(): number {
    return 100;
  }
  /**
   * Runs at size S only.
   *
   * @param profile - The profile.
   * @returns `["S"]` when the profile runs the scenario.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return this.profiles.includes(profile) ? ["S"] : [];
  }
  /** The prepared documents of each contestant. */
  #docs = new Map<ContestantId, Document[]>();
  /**
   * Prepares the documents outside the timed part.
   *
   * @param ops - The contestant's operations.
   * @param env - The scenario environment.
   */
  override setup(ops: ContestantOps, env: ScenarioEnv): void {
    this.#docs.set(ops.contestant, this.docsFor(ops, env));
  }
  /**
   * Creates the prepared documents in one call.
   *
   * @param ops - The contestant's operations.
   * @returns The number of created documents.
   */
  async op(ops: ContestantOps): Promise<unknown> {
    const docs = this.#docs.get(ops.contestant) ?? [];
    switch (ops.kind) {
      case "driver":
        return (await ops.driver.insertMany(this.forDriver(docs))).insertedCount;
      case "mongoose":
        return (await ops.mongoose.create(docs)).length;
      case "typemo":
        return (await ops.typemo.create(docs)).length;
    }
  }
}

/** A mixed bulkWrite over a seeded collection: 500 inserts, 300 `$set` updates, 200 deletes. */
class BulkWriteMixed extends OpScenario<object> {
  readonly id = "B.bulkWrite.mixed";
  readonly group = "B" as const;
  readonly title = "bulkWrite: 500 insertOne + 300 updateOne + 200 deleteOne (flat)";
  readonly profiles = STANDARD;
  override readonly contestants: readonly ContestantId[] = WRITERS;
  override readonly seeding = "none" as const;
  override readonly scope = "write" as const;
  readonly def = FLAT as unknown as ShapeDef<object>;
  override readonly iterations = { maxSamples: 30 };
  /** Documents in the collection before every run. */
  static readonly SEEDED = 1_000;
  /**
   * Runs at size S only.
   *
   * @param profile - The profile.
   * @returns `["S"]` when the profile runs the scenario.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return this.profiles.includes(profile) ? ["S"] : [];
  }
  /**
   * Operations per bulk write.
   *
   * @returns `1000`.
   */
  override unitsPerOp(): number {
    return 1_000;
  }
  /**
   * Resets the collection to the seeded state (untimed).
   *
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<void> {
    const collection = this.ctxOf(env).dbOf(ops.contestant).collection(this.def.collection);
    await collection.deleteMany({});
    await collection.insertMany(this.def.storedMany(0, BulkWriteMixed.SEEDED));
  }
  /**
   * The mixed operation list.
   *
   * @param forDriver - Copy inserted documents, because the driver mutates them.
   * @returns Inserts, updates and deletes.
   */
  operations(forDriver: boolean): Document[] {
    const out: Document[] = [];
    const seeded = BulkWriteMixed.SEEDED;
    for (let k = 0; k < 500; k++) {
      const doc = this.def.input(seeded + k);
      out.push({ insertOne: forDriver ? { document: { ...doc } } : { document: doc } });
    }
    for (let k = 0; k < 300; k++) {
      out.push({ updateOne: { filter: { _id: this.def.id(k) }, update: { $set: { score: k + 0.5, active: true } } } });
    }
    for (let k = 0; k < 200; k++) out.push({ deleteOne: { filter: { _id: this.def.id(300 + k) } } });
    return out;
  }
  /**
   * Runs the bulk write.
   *
   * @param ops - The contestant's operations.
   * @returns The bulk result.
   */
  async op(ops: ContestantOps): Promise<unknown> {
    switch (ops.kind) {
      case "driver":
        return ops.driver.bulkWrite(this.operations(true) as AnyBulkWriteOperation<Document>[]);
      case "mongoose":
        return ops.mongoose.bulkWrite(this.operations(false) as Parameters<typeof ops.mongoose.bulkWrite>[0]);
      case "typemo":
        return ops.typemo.bulkWrite(this.operations(false));
    }
  }
  /**
   * Fingerprints the final collection state.
   *
   * @param _r - Unused.
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   * @returns The state outcome.
   */
  override async outcome(_r: unknown, ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<Outcome> {
    return Outcomes.state(this.ctxOf(env).dbOf(ops.contestant), [this.def.collection]);
  }
}

/**
 * Batch size of the flat insert scenarios.
 *
 * @param size - The dataset size.
 * @returns The number of documents.
 */
const flatBatch = (size: SizeName): number => ({ T: 100, S: 1_000, M: 100_000, L: 1_000_000, XL: 1_000_000 })[size];
/**
 * Batch size of the heavier insert scenarios.
 *
 * @param size - The dataset size.
 * @returns The number of documents.
 */
const smallBatch = (size: SizeName): number => ({ T: 100, S: 1_000, M: 10_000, L: 100_000, XL: 100_000 })[size];

/** The scenarios of group B. */
export const SCENARIOS: readonly Scenario[] = [
  new CreateOne("B.create.flat", "create одного документа (flat)", FLAT as unknown as ShapeDef<object>, EVERY),
  new CreateOne(
    "B.create.medium",
    "create одного документа с валидацией, дефолтами и вложенными объектами (medium)",
    MEDIUM as unknown as ShapeDef<object>,
    STANDARD,
  ),
  new CreateOne(
    "B.create.stamped",
    "create одного документа с timestamps (flat)",
    FLAT_STAMPED as unknown as ShapeDef<object>,
    STANDARD,
    true,
  ),
  new CreateArray(),
  new InsertManyScenario(
    "B.insertMany.ordered",
    "insertMany ordered (flat)",
    FLAT as unknown as ShapeDef<object>,
    EVERY,
    ["S", "M", "L"],
    true,
    false,
    flatBatch,
    /* 100k documents per operation: in full only (about 5 min alone in standard). */
    ["S"],
  ),
  new InsertManyScenario(
    "B.insertMany.unordered",
    "insertMany unordered (flat)",
    FLAT as unknown as ShapeDef<object>,
    STANDARD,
    ["S", "M", "L"],
    false,
    false,
    flatBatch,
    ["S"],
  ),
  new InsertManyScenario(
    "B.insertMany.validated",
    "insertMany с валидацией и дефолтами (medium)",
    MEDIUM as unknown as ShapeDef<object>,
    STANDARD,
    ["S", "M", "L"],
    true,
    false,
    smallBatch,
  ),
  new InsertManyScenario(
    "B.insertMany.timestamps",
    "insertMany с timestamps (flat)",
    FLAT_STAMPED as unknown as ShapeDef<object>,
    STANDARD,
    ["S", "M"],
    true,
    true,
    smallBatch,
    ["S"],
  ),
  new InsertManyScenario(
    "B.insertMany.subdocs",
    "insertMany больших документов с 180 поддокументами (large)",
    LARGE as unknown as ShapeDef<object>,
    STANDARD,
    ["S", "M"],
    true,
    false,
    (size) => LARGE.countFor(size),
    ["S"],
  ),
  new BulkWriteMixed(),
];
