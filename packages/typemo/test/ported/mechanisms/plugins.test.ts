/*
 * Mongoose plugin tests ported to Typemo's plugin registries: connection plugins apply to
 * the models of their connection only; global plugins to every schema compiled afterwards, subdocuments
 * included. Global plugins run in their own process (the global registry is process-wide and sealed).
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { MongoHarness } from "@venloc/typemo-test-kit";
import { Entity, Prop, Schema, type SchemaPlugin } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const PACKAGE_DIR = resolve(import.meta.dir, "../../..");
const t = ModelLifecycle.useTypemo("ported_plugins");

describe("plugins (ported)", () => {
  // ported from mongoose test/connection.test.js:128 "connection plugins (gh-7378)"
  test("connection plugins (gh-7378)", () => {
    const conn1 = t.client.db(`${t.mongo.dbName}_c1`);
    const conn2 = t.client.db(`${t.mongo.dbName}_c2`);
    const called: string[] = [];
    const plugin: SchemaPlugin = { name: "gh7378", apply: (builder) => void called.push(builder.target.name) };
    conn1.plugins.use(plugin);

    @Schema({ collection: "gh7378_a" })
    class TestA extends Entity {
      @Prop(() => String) name?: string;
    }
    @Schema({ collection: "gh7378_b" })
    class TestB extends Entity {
      @Prop(() => String) name?: string;
    }
    conn2.model(TestA);
    expect(called.length).toBe(0);
    conn1.model(TestB);
    expect(called).toEqual(["TestB"]);
  });

  // ported from mongoose test/index.test.js:340 "declaring global plugins (gh-5690)"
  test("declaring global plugins (gh-5690): applied to the schema and its subdocuments", async () => {
    const run = Bun.spawn(["bun", "run", "test/fixtures/scripts/global-plugins-ported.ts"], {
      cwd: PACKAGE_DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TYPEMO_TEST_URI: MongoHarness.getUri(), TYPEMO_TEST_DB: t.mongo.dbName },
    });
    const [out, err, code] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
      run.exited,
    ]);
    expect(err).toBe("");
    expect(code).toBe(0);
    const result = JSON.parse(out) as { called: number; calls: string[]; before: number; preSaveCalls: number };
    expect(result.called).toBe(1);
    expect(result.calls).toEqual(["GlobalPlugins", "Sub"]);
    expect(result.before).toBe(0);
    expect(result.preSaveCalls).toBe(2);
  });
});
