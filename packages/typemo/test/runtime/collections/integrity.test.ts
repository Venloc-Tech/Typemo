/*
 * Collection integrity: writes around the methods are REFUSED at save
 * (`DirectWriteError`, the shadow copy is always on), partially loaded arrays are never overwritten
 * (`PartialArrayError`), and the journals survive a transaction retry: snapshot /
 * restore keep `$pop`/`$pull` (a Mongoose bug), revertReset keeps in-flight changes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { type FailPointHandle, FailPointHelpers } from "@venloc/typemo-test-kit";
import {
  type CollectionSnapshot,
  Collections,
  DirectWriteError,
  PartialArrayError,
  type StrictArray,
  type Subdocument,
  type SubdocumentArray,
  type TypedMap,
} from "../../../src/index.ts";
import { Doc, IDS, Owner, type Revision, seed } from "../../fixtures/collections/collection-entities.ts";
import { ScenarioRunner } from "../../fixtures/collections/scenario-runner.ts";
import { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("c_integrity");
let failpoint: FailPointHandle | undefined;
afterEach(async () => {
  await failpoint?.disable();
  failpoint = undefined;
});

/**
 * The `tags` array of a tracked root.
 * @param r The tracked root.
 * @returns The strict array field.
 */
const tags = (r: TrackedRoot) => r.get<StrictArray<string>>("tags");
/**
 * The `revisions` array of a tracked root.
 * @param r The tracked root.
 * @returns The subdocument array field.
 */
const revisions = (r: TrackedRoot) => r.get<SubdocumentArray<Revision>>("revisions");

describe("DirectWriteError: a write around the methods is refused, never guessed", () => {
  const cases: readonly (readonly [string, (root: TrackedRoot) => void])[] = [
    [
      "an index write through a cast",
      (r) => {
        /* cast: bypasses the type to test the runtime guard — index assignment, which StrictArray refuses */
        (tags(r) as unknown as string[])[0] = "X";
      },
    ],
    [
      "a length write through a cast",
      (r) => {
        /* cast: bypasses the type to test the runtime guard — length assignment, which StrictArray refuses */
        (tags(r) as unknown as string[]).length = 0;
      },
    ],
    ["Array.prototype.push.call", (r) => void Array.prototype.push.call(tags(r), "d")],
    [
      "an element of a subdocument array replaced",
      (r) => {
        /* cast: bypasses the type to test the runtime guard — index assignment on a subdocument array */
        (revisions(r) as unknown as unknown[])[1] = {};
      },
    ],
    [
      "an index write in a nested array",
      (r) => {
        const matrix = r.get<StrictArray<StrictArray<number>>>("matrix");
        /* cast: bypasses the type to test the runtime guard — index assignment on a nested array */
        (matrix[0] as unknown as number[])[0] = 9;
      },
    ],
    [
      "a subdocument's array replaced by a plain array",
      (r) => {
        /* cast: bypasses the type to test the runtime guard — a container field assigned directly */
        (revisions(r)[0] as unknown as { tags: string[] }).tags = ["plain"];
      },
    ],
  ];
  for (const [name, write] of cases) {
    test(name, async () => {
      const root = await ScenarioRunner.load(t.mongo);
      write(root);
      expect(root.hasChanges()).toBe(true);
      expect(() => root.ops()).toThrow(DirectWriteError);
    });
  }

  test("the error names the path and the method to use", async () => {
    const root = await ScenarioRunner.load(t.mongo);
    /* cast: bypasses the type to test the runtime guard — index assignment, which StrictArray refuses */
    (tags(root) as unknown as string[])[1] = "X";
    let caught: unknown;
    try {
      root.ops();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DirectWriteError);
    expect((caught as DirectWriteError).path).toBe("tags");
    expect((caught as DirectWriteError).message).toContain("set(1, value)");
  });

  test("modifiedPaths reports the path instead of throwing", async () => {
    const root = await ScenarioRunner.load(t.mongo);
    /* cast: bypasses the type to test the runtime guard — index assignment, which StrictArray refuses */
    (tags(root) as unknown as string[])[1] = "X";
    expect(Collections.modifiedPaths(root.fields.tags)).toEqual(["tags"]);
  });
});

describe("PartialArrayError: a partially loaded array is never overwritten", () => {
  const load = () => ScenarioRunner.load(t.mongo, ["tags", "revisions"]);

  test.each([
    ["set(i)", (r: TrackedRoot) => void tags(r).set(0, "A")],
    ["pop", (r: TrackedRoot) => void tags(r).pop()],
    ["splice", (r: TrackedRoot) => void tags(r).splice(0, 1)],
    ["clear", (r: TrackedRoot) => void tags(r).clear()],
    [
      "a field of an element (positional)",
      (r: TrackedRoot) => {
        (revisions(r)[0] as Subdocument<Revision>).note = "x";
      },
    ],
  ])("%s → PartialArrayError", async (_name, mutate) => {
    const root = await load();
    mutate(root);
    expect(() => root.ops()).toThrow(PartialArrayError);
  });

  test("push / addToSet / pull stay allowed", async () => {
    const root = await load();
    tags(root).push("d");
    revisions(root).pull(IDS.rev[0]);
    expect(root.ops()).toEqual({
      $push: { tags: { $each: ["d"] } },
      $pull: { revisions: { _id: { $in: [IDS.rev[0]] } } },
    });
  });
});

describe("snapshot / restore / revertReset", () => {
  const mutate = (root: TrackedRoot): void => {
    tags(root).pop();
    revisions(root).pull(IDS.rev[1]);
    root.get<TypedMap<number>>("scores").delete("art");
    const address = root.get<Subdocument<{ city: string }>>("address");
    address.city = "Bergen";
  };
  const expected = {
    $pop: { tags: 1 },
    $pull: { revisions: { _id: { $in: [IDS.rev[1]] } } },
    $unset: { "scores.art": "" },
    $set: { "address.city": "Bergen" },
  };
  const snapshotAll = (root: TrackedRoot): Map<string, CollectionSnapshot> =>
    new Map(Object.entries(root.fields).map(([key, value]) => [key, Collections.snapshot(value)]));

  test("restore after reset brings back every op kind ($pop, $pull, $unset, fields)", async () => {
    const root = await ScenarioRunner.load(t.mongo);
    mutate(root);
    expect(root.ops() as unknown).toEqual(expected);
    const snapshots = snapshotAll(root);
    root.reset();
    expect(root.ops()).toEqual({});
    for (const [key, value] of Object.entries(root.fields))
      Collections.restore(value, snapshots.get(key) ?? { node: undefined });
    expect(root.ops() as unknown).toEqual(expected);
  });

  test("restore also puts back the content and the links (a mutation after the snapshot is undone)", async () => {
    const root = await ScenarioRunner.load(t.mongo);
    const pulled = revisions(root)[0] as Subdocument<Revision>;
    const snapshots = snapshotAll(root);
    revisions(root).pull(pulled);
    tags(root).push("later");
    pulled.note = "changed while detached";
    for (const [key, value] of Object.entries(root.fields))
      Collections.restore(value, snapshots.get(key) ?? { node: undefined });
    expect(root.hasChanges()).toBe(false);
    expect(revisions(root)[0]).toBe(pulled);
    expect(pulled.$fullPath()).toBe("revisions.0");
    expect(pulled.note).toBe("n0");
    expect([...tags(root)]).toEqual(["a", "b", "c"]);
  });

  test("revertReset without in-flight changes: the same ops again", async () => {
    const root = await ScenarioRunner.load(t.mongo);
    mutate(root);
    const snapshots = snapshotAll(root);
    root.reset();
    for (const [key, value] of Object.entries(root.fields))
      Collections.revertReset(value, snapshots.get(key) ?? { node: undefined });
    expect(root.ops() as unknown).toEqual(expected);
  });

  test("revertReset with an in-flight change: that array is written whole, nothing is lost", async () => {
    const root = await ScenarioRunner.load(t.mongo);
    mutate(root);
    const snapshots = snapshotAll(root);
    root.reset();
    tags(root).push("in flight");
    for (const [key, value] of Object.entries(root.fields))
      Collections.revertReset(value, snapshots.get(key) ?? { node: undefined });
    expect(root.ops() as unknown).toEqual({
      ...expected,
      $pop: undefined,
      $set: { "address.city": "Bergen", tags: ["a", "b", "in flight"] },
    });
  });

  test("a real transaction retry through the model pipeline (code form): $pop/$pull are not lost", async () => {
    const Docs = t.connection.model(Doc);
    const Owners = t.connection.model(Owner);
    await t.mongo.db.collection("c_docs").insertOne(seed());
    const root = await TrackedRoot.load(t.mongo.db.collection("c_docs"), IDS.doc);
    mutate(root);
    failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["insert"],
      errorCode: 112,
      errorLabels: ["TransientTransactionError"],
      times: 1,
    });
    const sent: unknown[] = [];
    await t.connection.transaction(async (scope) => {
      const snapshots = snapshotAll(root);
      const ops = root.ops("code");
      sent.push(ops);
      await Docs.updateOne({ _id: IDS.doc }, ops as never);
      root.reset();
      scope.enlist({
        onRetry: () => {
          for (const [key, value] of Object.entries(root.fields)) {
            Collections.restore(value, snapshots.get(key) ?? { node: undefined });
          }
        },
      });
      await Owners.create({ name: "x" }); /* attempt 1 fails here: the update above is rolled back */
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    const stored = await t.mongo.db.collection("c_docs").findOne({ _id: IDS.doc });
    expect(stored as unknown).toEqual(root.plain());
    expect(stored?.tags).toEqual(["a", "b"]);
    expect(((stored?.revisions ?? []) as unknown[]).length).toBe(2);
  });
});
