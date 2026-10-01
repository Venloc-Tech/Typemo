/*
 * Runs one mutation scenario end to end on the real mongod: load the seed, mutate the tracked values,
 * save through `TrackedRoot` (raw driver), and check (1) the exact update sent (`CommandRecorder`),
 * (2) the stored document equals the in-memory state, (3) a second save sends nothing.
 */
import { expect } from "bun:test";
import { CommandRecorder, type MongoTestContext } from "@venloc/typemo-test-kit";
import type { UpdateParts } from "../../../src/index.ts";
import { IDS, seed } from "./collection-entities.ts";
import { TrackedRoot } from "./tracked-root.ts";

/** Static helpers that run mutation scenarios on the tracked collections. */
export class ScenarioRunner {
  /**
   * Runs one scenario and asserts the update, the stored state and the idempotent second save.
   *
   * @param mongo - the test database context
   * @param mutate - changes the tracked root
   * @param expected - the exact update the save must send
   * @returns the tracked root after the save
   */
  static async run(
    mongo: MongoTestContext,
    mutate: (root: TrackedRoot) => void,
    expected: UpdateParts,
  ): Promise<TrackedRoot> {
    const docs = mongo.db.collection("c_docs");
    await docs.insertOne(seed());
    const root = await TrackedRoot.load(docs, IDS.doc);
    mutate(root);
    expect(root.hasChanges()).toBe(true);
    const recorder = CommandRecorder.attach(mongo.client);
    const sent = await root.save(docs);
    recorder.detach();
    expect(sent).toEqual(expected);
    const updates = recorder.byName("update");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.updates[0]?.update).toEqual(expected);
    const stored = await docs.findOne({ _id: IDS.doc });
    expect(stored as unknown).toEqual(root.plain());
    expect(root.hasChanges()).toBe(false);
    expect(await root.save(docs)).toBeUndefined();
    return root;
  }

  /**
   * Loads the seed and returns the hydrated root without saving.
   *
   * @param mongo - the test database context
   * @param partial - the keys to hydrate as partially loaded
   * @returns the tracked root
   */
  static async load(mongo: MongoTestContext, partial: readonly string[] = []): Promise<TrackedRoot> {
    const docs = mongo.db.collection("c_docs");
    await docs.insertOne(seed());
    return TrackedRoot.load(docs, IDS.doc, partial);
  }
}
