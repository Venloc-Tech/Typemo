/*
 * On the real server: `dryRun` of `syncAll` writes nothing — no collection, no index, no view — in every mode the
 * runner has (`sync` for `syncAll`, `init` for `connection.init()`), and the report says what would be created.
 * The mode is not part of the public `SyncAll.run`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { Entity, Index, Prop, Schema, SyncAll, SyncRunner } from "../../../src/internal.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/** A collection with a declared index. */
@Schema({ collection: "sd_items" })
@Index({ code: 1 }, { name: "code_1" })
class Item extends Entity {
  @Prop(() => String) code?: string;
}

/** A capped collection. */
@Schema({ collection: "sd_logs", capped: { size: 4096 } })
class Log extends Entity {
  @Prop(() => String) line?: string;
}

const t = ModelLifecycle.useTypemo("sd");

/**
 * The names of the collections that exist.
 * @returns The sorted names.
 */
const existing = async (): Promise<string[]> =>
  (await t.mongo.db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name).sort();

beforeEach(async () => {
  t.connection.model(Item);
  t.connection.model(Log);
  for (const name of await existing()) await t.mongo.db.dropCollection(name);
});

describe("dryRun writes nothing", () => {
  test("syncAll({ dryRun: true }) on an empty database: nothing is created, the report says what would be", async () => {
    const report = await SyncAll.run(t.connection, { dryRun: true });
    expect(await existing()).toEqual([]);
    const items = report.collections.find((entry) => entry.collection === "sd_items");
    expect(items?.options?.result).toBe("created");
    expect(items?.indexes).toMatchObject({ toCreate: ["code_1"], dryRun: true });
    expect(report.inSync).toBe(false);
    expect((await t.connection.syncAll({ dryRun: true })).inSync).toBe(false);
    expect(await existing()).toEqual([]);
  });

  test("the init mode with dryRun: nothing is created either (the collection is not created by an index)", async () => {
    const report = await SyncRunner.run(t.connection, { dryRun: true }, "init");
    expect(await existing()).toEqual([]);
    const items = report.collections.find((entry) => entry.collection === "sd_items");
    expect(items?.options?.result).toBe("created");
    expect(items?.indexes).toMatchObject({ toCreate: ["code_1"], dryRun: true });
    expect(report.failed).toBe(false);
    /* A dry run reports what WOULD be created and is not in sync (nothing was done). */
    expect(report.inSync).toBe(false);
    expect(report.created).toContain("collection sd_items");
    expect(report.created).toContain("index sd_items.code_1");
  });

  test("without dryRun both modes create what is missing", async () => {
    await SyncRunner.run(t.connection, {}, "init");
    expect(await existing()).toEqual(["sd_items", "sd_logs"]);
    expect((await t.mongo.db.collection("sd_items").indexes()).map((index) => index.name)).toContain("code_1");
    expect((await SyncAll.run(t.connection)).inSync).toBe(true);
  });

  test("the mode is not a parameter of the public SyncAll.run", () => {
    // @ts-expect-error — SyncAll.run takes the connection and the options only
    void (() => SyncAll.run(t.connection, {}, "init"));
    expect(SyncAll.run.length).toBeLessThanOrEqual(2);
  });
});
