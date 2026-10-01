import type { ContestantOps } from "../adapters/ops.ts";
import { FLAT, type ShapeDef, SOFT } from "../data/shapes/index.ts";
import { OpScenario, WRITERS } from "../harness/op-scenario.ts";
import type { Scenario, ScenarioEnv } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { Outcomes } from "../harness/verify.ts";

/* Group H: deleting — deleteOne, deleteMany and the soft-delete policy. */

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

/** Deletes in the scratch databases; the deleted documents are put back untimed before each sample. */
abstract class DeleteScenario extends OpScenario<object> {
  readonly group = "H" as const;
  override readonly scope = "write" as const;
  override readonly contestants: readonly ContestantId[] = WRITERS;

  /**
   * The final state plus the delete result.
   *
   * @param result - The delete result.
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   * @returns The outcome.
   */
  override async outcome(result: unknown, ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<Outcome> {
    const state = await Outcomes.state(this.ctxOf(env).dbOf(ops.contestant), [this.def.collection], {
      volatile: ["deletedAt"],
      /* Which documents exist (and are soft-deleted): other scenarios change other fields of this collection. */
      fields: ["_id", "deletedAt"],
    });
    return { ...state, checksum: String(result) };
  }
}

/** `deleteOne` by `_id`. */
class DeleteOne extends DeleteScenario {
  readonly id = "H.deleteOne";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly title = "deleteOne по _id (flat)";
  readonly profiles = EVERY;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = FLAT as unknown as ShapeDef<object>;
  /**
   * Documents deleted by earlier samples, put back before the next one (the final state then differs only by
   * the verified delete).
   */
  readonly #deleted = new Map<ContestantId, Set<number>>();
  /**
   * Restores what earlier samples deleted (untimed).
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the document to delete next.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<void> {
    const pending = this.#deleted.get(ops.contestant) ?? new Set<number>();
    pending.add(spread(i, this.countOf(env)));
    const collection = this.ctxOf(env).dbOf(ops.contestant).collection(this.def.collection);
    for (const k of pending) await collection.replaceOne({ _id: this.def.id(k) }, this.def.stored(k), { upsert: true });
    this.#deleted.set(ops.contestant, new Set([spread(i, this.countOf(env))]));
  }
  /**
   * Deletes one document by id.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the document.
   * @param env - The scenario environment.
   * @returns The number of deleted documents.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.deleteOne({ _id: this.def.id(spread(i, this.countOf(env))) });
  }
}

/** `deleteMany` over an index range. */
class DeleteMany extends DeleteScenario {
  readonly id = "H.deleteMany";
  readonly title = "deleteMany по диапазону индекса (~20% коллекции flat)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  override readonly iterations = { maxSamples: 40 };
  readonly def = FLAT as unknown as ShapeDef<object>;
  /**
   * The sizes to run under a profile; `standard` runs only S.
   *
   * @param profile - The profile.
   * @returns The sizes.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return profile === "standard" ? ["S"] : super.sizesFor(profile);
  }
  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns About a fifth of the collection.
   */
  override unitsPerOp(size: SizeName): number {
    return Math.round(FLAT.countFor(size) / 5);
  }
  /**
   * Restores what the previous sample deleted (untimed).
   *
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<void> {
    /* Put back what the previous sample deleted (age < 20 of the generated data). */
    const collection = this.ctxOf(env).dbOf(ops.contestant).collection(this.def.collection);
    const missing = this.countOf(env) - (await collection.estimatedDocumentCount());
    if (missing <= 0) return;
    const docs = this.def.storedMany(0, this.countOf(env)).filter((d) => (d.age as number) < 20);
    await collection.insertMany(docs, { ordered: false }).catch(() => undefined);
  }
  /**
   * Deletes the documents of an age range.
   *
   * @param ops - The contestant's operations.
   * @returns The number of deleted documents.
   */
  op(ops: ContestantOps): Promise<unknown> {
    return ops.deleteMany({ age: { $lt: 20 } });
  }
}

/**
 * Soft delete: Typemo's policy (`@Schema({ softDelete: true })` turns deleteOne into `$set: { deletedAt }` for live
 * documents) against the explicit update a Mongoose/driver user writes for the same effect.
 */
class SoftDeleteOne extends DeleteScenario {
  readonly id = "H.softDelete";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly title = "мягкое удаление одного документа (политика Typemo против явного $set deletedAt)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = SOFT as unknown as ShapeDef<object>;
  /**
   * Un-deletes every soft-deleted document (untimed).
   *
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   */
  override async before(ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<void> {
    await this.ctxOf(env)
      .dbOf(ops.contestant)
      .collection(this.def.collection)
      .updateMany({ deletedAt: { $ne: null } }, { $set: { deletedAt: null } });
  }
  /**
   * Soft-deletes one document.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the document.
   * @param env - The scenario environment.
   * @returns The write result.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    const _id = this.def.id(spread(i, this.countOf(env)));
    if (ops.kind === "typemo") return ops.deleteOne({ _id });
    return ops.updateOne({ _id, deletedAt: null }, { $set: { deletedAt: new Date() } });
  }
}

/** Reading live documents of a soft-delete model: the policy adds `deletedAt: null`, the others write it. */
class SoftDeleteFind extends OpScenario<object> {
  readonly id = "H.softDelete.find";
  readonly group = "H" as const;
  readonly title = "find живых документов модели с soft delete, limit 100";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = SOFT as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `100`.
   */
  override unitsPerOp(): number {
    return 100;
  }
  /**
   * Finds live documents.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which varies the age bound.
   * @returns The documents.
   */
  op(ops: ContestantOps, i: number): Promise<unknown> {
    const filter = { age: { $gte: i % 50 } };
    return ops.find({
      filter: ops.kind === "typemo" ? filter : { ...filter, deletedAt: null },
      sort: { _id: 1 },
      limit: 100,
    });
  }
}

/** The scenarios of group H. */
export const SCENARIOS: readonly Scenario[] = [
  new DeleteOne(),
  new DeleteMany(),
  new SoftDeleteOne(),
  new SoftDeleteFind(),
];
