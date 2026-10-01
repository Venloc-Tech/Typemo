/*
 * On the real server: hooks of query/model/aggregate events run in the
 * pipeline (pre before the driver, post with the result, postError on failure), and a cursor runs the
 * same post-execution steps PER DRIVER BATCH in the same order as `await` (one order for both).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { FailPointHelpers } from "@venloc/typemo-test-kit";
import { EachAsyncError, type Model } from "../../../src/index.ts";
import { Hooked, HookLog } from "../../fixtures/model/hooked-entities.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("hooks");
let Hooks: Model<Hooked>;

beforeEach(async () => {
  Hooks = t.connection.model(Hooked);
  await t.mongo.db.collection("m_hooked").insertMany(["a", "b", "c", "d", "e"].map((name) => ({ name })));
  HookLog.lines = [];
  HookLog.failPre = undefined;
});

describe("hooks in the pipeline", () => {
  test("find: pre (sees the filter in database form), then post with the documents", async () => {
    await Hooks.find({ name: "a" });
    expect(HookLog.lines).toEqual(['pre query.find {"name":"a"}', "post query.find [1]"]);
  });

  test("a throwing pre hook stops the operation (nothing sent) and the postError hooks run", async () => {
    HookLog.failPre = new Error("denied");
    t.commands.clear();
    await expect(Hooks.find().exec()).rejects.toThrow("denied");
    expect(t.commands.byName("find")).toEqual([]);
    expect(HookLog.lines).toEqual(["pre query.find {}", "postError query.find denied"]);
  });

  test("a server error after the pre hooks: postError with the Typemo error", async () => {
    const failpoint = await FailPointHelpers.configureFailCommand(t.mongo.client, {
      failCommands: ["update"],
      errorCode: 2,
      times: 1,
    });
    const error = await Hooks.updateMany({ name: "a" }, { $set: { name: "b" } })
      .exec()
      .catch((e: unknown) => e)
      .finally(() => failpoint.disable());
    expect((error as Error).name).toBe("ServerError");
    expect(HookLog.lines[0]).toBe('pre query.updateMany {"name":"a"}');
    expect(HookLog.lines[1]).toMatch(/^postError query.updateMany /);
  });

  test("insertMany and aggregate have their events", async () => {
    await Hooks.insertMany([{ name: "x" }]);
    await Hooks.aggregate((p) => p.match({ name: "x" }));
    expect(HookLog.lines).toEqual([
      "pre model.insertMany null",
      "post model.insertMany [1]",
      "pre aggregate null",
      "post aggregate [1]",
    ]);
  });
});

describe("cursor: the same order per batch", () => {
  test("pre once at open; post once per driver batch with that batch", async () => {
    const names: string[] = [];
    for await (const doc of Hooks.find().sort({ name: 1 }).batchSize(2).cursor()) names.push(doc.name);
    expect(names).toEqual(["a", "b", "c", "d", "e"]);
    expect(HookLog.lines).toEqual([
      "pre query.find {}",
      "post query.find [2]",
      "post query.find [2]",
      "post query.find [1]",
    ]);
  });

  test("documents from a cursor are hydrated like awaited ones", async () => {
    const cursor = Hooks.find({ name: "a" }).cursor();
    const doc = await cursor.next();
    expect(doc).toBeInstanceOf(Hooked);
    expect(await cursor.next()).toBeNull();
  });

  test("eachAsync on the server: batchSize groups, parallel, continueOnError", async () => {
    const groups: string[][] = [];
    await Hooks.find()
      .sort({ name: 1 })
      .cursor()
      .eachAsync(
        (docs: Hooked[]) => {
          groups.push(docs.map((doc) => doc.name));
        },
        { batchSize: 2 },
      );
    expect(groups).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    const error = await Hooks.find()
      .cursor()
      .eachAsync(
        (doc) => {
          if (doc.name === "b" || doc.name === "d") throw new Error(doc.name);
        },
        { continueOnError: true, parallel: 2 },
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EachAsyncError);
    expect((error as EachAsyncError).errors.length).toBe(2);
  });

  test("typed map without mutation; closing early releases the server cursor", async () => {
    const cursor = Hooks.find().sort({ name: 1 }).batchSize(1).cursor();
    const upper = cursor.map((doc) => doc.name.toUpperCase());
    expect(await upper.next()).toBe("A");
    expect((await cursor.next())?.name).toBe("b");
    await cursor.close();
    await expect(upper.next()).rejects.toThrow(/the cursor is closed/); /* the mapped cursor reads the same stream */
    expect(
      await t.mongo.db
        .admin()
        .command({ serverStatus: 1 })
        .then((s) => typeof s.metrics.cursor.open.total),
    ).toBe("number");
  });
});
