import type { Document } from "mongodb";
import type { ContestantOps } from "../adapters/ops.ts";
import { FLAT, MEDIUM, MEDIUM_STATUSES, type ShapeDef } from "../data/shapes/index.ts";
import { OpScenario, WRITERS } from "../harness/op-scenario.ts";
import type { Scenario, ScenarioEnv } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { Outcomes } from "../harness/verify.ts";

/* Group F: updates — $set, $inc, updateMany, findOneAndUpdate, replaceOne, array operators and upsert. */

/** Profiles that run the heavier scenarios. */
const STANDARD: readonly ProfileName[] = ["standard", "full"];
/** Every profile. */
const EVERY: readonly ProfileName[] = ["quick", "standard", "full"];
/**
 * Deterministic spread of iteration → document index.
 *
 * @param i - The iteration.
 * @param n - The number of documents.
 * @returns An index in `[0, n)`.
 */
const spread = (i: number, n: number): number => (i * 7919 + 13) % n;

/**
 * Updates on the seeded dataset. The dataset is shared by the update scenarios of a shape: every update only
 * touches fields that are set to an iteration-determined value, so the checked document is deterministic.
 * Verification reads the touched document back (untimed) and checks the update's matched count.
 */
abstract class UpdateScenario extends OpScenario<object> {
  /** Fields this scenario writes: verification compares only them (other F scenarios touch other fields). */
  abstract readonly fields: readonly string[];
  readonly group = "F" as const;
  override readonly scope = "write" as const;
  override readonly contestants: readonly ContestantId[] = WRITERS;
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];

  /**
   * The index of the document an iteration touches.
   *
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The document index.
   */
  target(i: number, env: ScenarioEnv): number {
    return spread(i, this.countOf(env));
  }

  /**
   * Reads the touched document back and combines it with the update result.
   *
   * @param result - The update result.
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The outcome.
   */
  override async outcome(result: unknown, ops: ContestantOps, i: number, env: ScenarioEnv): Promise<Outcome> {
    const doc = await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .findOne(
        { _id: this.def.id(this.target(i, env)) },
        { projection: Object.fromEntries(this.fields.map((k) => [k, 1])) },
      );
    const touched = typeof result === "number" ? result : result === null || result === undefined ? 0 : 1;
    return Outcomes.value({ touched, doc }, touched);
  }
}

/** `updateOne` with `$set` of two fields. */
class SetById extends UpdateScenario {
  readonly id = "F.updateOne.set";
  readonly title = "updateOne $set двух полей по _id (flat)";
  readonly fields = ["score", "active"];
  readonly profiles = EVERY;
  readonly def = FLAT as unknown as ShapeDef<object>;
  /**
   * Sets two fields of one document.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which determines the values.
   * @param env - The scenario environment.
   * @returns The touched count.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.updateOne(
      { _id: this.def.id(this.target(i, env)) },
      { $set: { score: (i % 1000) + 0.25, active: i % 2 === 0 } },
    );
  }
}

/** `updateOne` with `$inc` on a field that has min/max validators. */
class IncWithRange extends UpdateScenario {
  readonly id = "F.updateOne.incRange";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly title = "updateOne $inc поля с min/max (medium.priority 0..10)";
  readonly fields = ["priority"];
  readonly profiles = STANDARD;
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Resets the priority to a known value (untimed).
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<void> {
    await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .updateOne({ _id: this.def.id(this.target(i, env)) }, { $set: { priority: 4 } });
  }
  /**
   * Increments the priority.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The touched count.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.updateOne({ _id: this.def.id(this.target(i, env)) }, { $inc: { priority: 1 } });
  }
}

/** `updateMany` over a third of the collection. */
class UpdateMany extends UpdateScenario {
  readonly id = "F.updateMany";
  readonly title = "updateMany $set по индексу (medium, треть коллекции)";
  readonly fields = ["category"];
  readonly profiles = STANDARD;
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * The sizes to run under a profile; `standard` runs S and M.
   *
   * @param profile - The profile.
   * @returns The sizes.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return profile === "standard" ? ["S", "M"] : super.sizesFor(profile);
  }
  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns About a third of the collection.
   */
  override unitsPerOp(size: SizeName): number {
    return Math.round(MEDIUM.countFor(size) / 3);
  }
  /**
   * Sets the category of every document of one status.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the status and the category.
   * @returns The touched count.
   */
  op(ops: ContestantOps, i: number): Promise<unknown> {
    const status = MEDIUM_STATUSES[i % 3] ?? "draft";
    return ops.updateMany({ status }, { $set: { category: `c${i % 5}` } });
  }
  /**
   * The matched count together with the categories now stored for the status.
   *
   * @param result - The touched count.
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The outcome.
   */
  override async outcome(result: unknown, ops: ContestantOps, i: number, env: ScenarioEnv): Promise<Outcome> {
    const status = MEDIUM_STATUSES[i % 3] ?? "draft";
    const categories = await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .distinct("category", { status });
    return Outcomes.value({ matched: result, categories: categories.map(String).sort() }, Number(result));
  }
}

/** `findOneAndUpdate` returning the document after the update. */
class FindOneAndUpdate extends UpdateScenario {
  readonly id = "F.findOneAndUpdate";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly title = "findOneAndUpdate (after) по _id, возврат документа (medium)";
  readonly fields = ["rating", "notes"];
  readonly profiles = EVERY;
  override readonly contestants: readonly ContestantId[] = [
    "driver",
    "mongoose",
    "mongoose-safe",
    "typemo",
    "typemo-lean",
  ];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Updates one document and returns it.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The updated document.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.findOneAndUpdate({ _id: this.def.id(this.target(i, env)) }, { $set: { rating: i % 6, notes: `n${i}` } });
  }
  /**
   * The returned document, reduced to the stable fields.
   *
   * @param result - The returned document.
   * @returns The outcome.
   */
  override async outcome(result: unknown): Promise<Outcome> {
    /* The returned document also carries fields other F scenarios changed: compare the stable ones. */
    return Outcomes.doc(result, { fields: ["_id", "slug", "title", "rating", "notes", "author"] });
  }
}

/** `replaceOne` of a whole document. */
class ReplaceOne extends UpdateScenario {
  readonly id = "F.replaceOne";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly title = "replaceOne целого документа (medium)";
  readonly fields = ["slug", "title", "notes", "author", "address", "tags", "status", "priority"];
  readonly profiles = STANDARD;
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Replaces one document.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The touched count.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    const k = this.target(i, env);
    const base = ops.kind === "driver" ? this.def.stored(k) : this.def.input(k);
    const { _id, ...rest } = base;
    return ops.replaceOne({ _id }, { ...rest, notes: `replaced ${i}` });
  }
}

/** `$push` into an array of strings. */
class ArrayPush extends UpdateScenario {
  readonly id = "F.array.push";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly title = "updateOne $push в массив строк (medium.tags)";
  readonly fields = ["tags"];
  readonly profiles = STANDARD;
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Resets the tags to a known value (untimed).
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<void> {
    await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .updateOne({ _id: this.def.id(this.target(i, env)) }, { $set: { tags: ["alpha", "bravo"] } });
  }
  /**
   * Pushes two tags.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The touched count.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.updateOne(
      { _id: this.def.id(this.target(i, env)) },
      { $push: { tags: { $each: [`t${i % 7}`, "zulu"] } } },
    );
  }
}

/** `$pull` and `$addToSet` on one array. */
class ArrayPullAddToSet extends UpdateScenario {
  readonly id = "F.array.pullAddToSet";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly title = "updateOne $pull + $addToSet (medium.tags)";
  readonly fields = ["tags"];
  readonly profiles = STANDARD;
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Resets the tags to a known value (untimed).
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<void> {
    await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .updateOne({ _id: this.def.id(this.target(i, env)) }, { $set: { tags: ["alpha", "bravo", "charlie"] } });
  }
  /**
   * Pulls one tag, then adds another.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The sum of both touched counts.
   */
  async op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    const filter = { _id: this.def.id(this.target(i, env)) };
    /* Two operators on one array path in one update is a server error (code 40): two updates. */
    const a = await ops.updateOne(filter, { $pull: { tags: "bravo" } });
    const b = await ops.updateOne(filter, { $addToSet: { tags: "delta" } });
    return a + b;
  }
}

/** `updateOne` with `upsert`, inserting a new document. */
class Upsert extends UpdateScenario {
  readonly id = "F.upsert";
  readonly title = "updateOne upsert: вставка нового документа ($setOnInsert + $set)";
  readonly fields = ["rating"];
  readonly profiles = STANDARD;
  readonly def = MEDIUM as unknown as ShapeDef<object>;
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
   * The slug of the document an iteration upserts.
   *
   * @param i - The iteration.
   * @returns The slug.
   */
  slug(i: number): string {
    return `upsert-${i % 500}`;
  }
  /**
   * Removes the document so the upsert inserts (untimed).
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<void> {
    await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .deleteOne({ slug: this.slug(i) });
  }
  /**
   * Upserts a new document.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @returns The touched count.
   */
  op(ops: ContestantOps, i: number): Promise<unknown> {
    const insert: Document = {
      title: `upsert ${i % 500}`,
      status: "draft",
      priority: 1,
      published: false,
      author: { first: "up" },
      tags: [],
    };
    /* Defaults on insert: Mongoose/Typemo apply them; the driver user writes them. */
    const setOnInsert = ops.kind === "driver" ? { ...insert, views: 0, language: "en" } : insert;
    return ops.updateOne({ slug: this.slug(i) }, { $setOnInsert: setOnInsert, $set: { rating: 3 } }, { upsert: true });
  }
  /**
   * The upsert result together with the stored document.
   *
   * @param result - The touched count.
   * @param ops - The contestant's operations.
   * @param i - The iteration.
   * @param env - The scenario environment.
   * @returns The outcome.
   */
  override async outcome(result: unknown, ops: ContestantOps, i: number, env: ScenarioEnv): Promise<Outcome> {
    const doc = await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .findOne({ slug: this.slug(i) }, { projection: { _id: 0 } });
    return Outcomes.value({ result, doc }, Number(result));
  }
  /**
   * Removes every upserted document.
   *
   * @param env - The scenario environment.
   */
  override async cleanup(env: ScenarioEnv): Promise<void> {
    for (const c of this.contestants) {
      await this.ctxOf(env)
        .dbOf(c)
        .collection(this.def.collection)
        .deleteMany({ slug: { $regex: "^upsert-" } });
    }
  }
}

/** The scenarios of group F. */
export const SCENARIOS: readonly Scenario[] = [
  new SetById(),
  new IncWithRange(),
  new UpdateMany(),
  new FindOneAndUpdate(),
  new ReplaceOne(),
  new ArrayPush(),
  new ArrayPullAddToSet(),
  new Upsert(),
];
