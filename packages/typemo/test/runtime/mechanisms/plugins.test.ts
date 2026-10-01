/*
 * Plugins at the three levels — global (own process), connection, model —
 * in a deterministic order without duplicates, sealed after the first compile; what a plugin may add:
 * fields (runtime), hooks (after the class's), policies (`enablePolicy`), statics (`statics` / `addStatic`,
 * typed on a model by `model.statics(plugin)`).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { MongoHarness } from "@venloc/typemo-test-kit";
import {
  ConfigurationError,
  Entity,
  MetadataBuilder,
  type Model,
  ModelInternals,
  Plugin,
  PluginRegistry,
  Prop,
  Schema,
  SchemaCompiler,
  type SchemaPlugin,
} from "../../../src/internal.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const PACKAGE_DIR = resolve(import.meta.dir, "../../..");
const t = ModelLifecycle.useTypemo("m9_plugins");
const order: string[] = [];

/**
 * A plugin that records which model it was applied to.
 * @param name The plugin name.
 * @returns The plugin.
 */
const tracer = (name: string): SchemaPlugin => ({
  name,
  apply: (builder) => void order.push(`${name}:${builder.target.name}`),
});

const connectionPlugin = tracer("connection-one");
const shared = tracer("shared");

/** The typed statics the `tools` plugin adds. */
interface Tools {
  byName(this: Model<Widget>, name: string): Promise<number>;
}
const tools: SchemaPlugin<{ readonly field: string }, Tools> = {
  name: "tools",
  apply: (builder, options) => {
    builder.addField(options.field, () => String);
    /* An addStatic function may declare its `this` (the model it is called on; `this: never` accepts it). */
    builder.addStatic("countAll", function (this: Model<object>) {
      return this.countDocuments().exec();
    });
  },
  statics: {
    byName(this: Model<Widget>, name: string): Promise<number> {
      return this.countDocuments({ name }).exec();
    },
  },
};

const softly: SchemaPlugin = { name: "softly", apply: (builder) => builder.enablePolicy("softDelete", true) };

/** An entity with three model-level plugins. */
@Plugin(tools, { field: "tag" })
@Plugin(shared)
@Plugin(softly)
@Schema({ collection: "m9_widgets" })
class Widget extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}

/** An entity that has only the connection-level plugins. */
@Schema({ collection: "m9_gadgets" })
class Gadget extends Entity {
  @Prop(() => String, { required: true }) name!: string;
}

let Widgets: Model<Widget>;

beforeAll(() => {
  /* Connection plugins: before the first model of the connection (they seal with it). */
  t.connection.plugins.use(connectionPlugin).use(shared);
  Widgets = t.connection.model(Widget);
  t.connection.model(Gadget);
});

describe("levels, order, duplicates, sealing", () => {
  test("connection → model, the same plugin at both levels once (at its first position)", () => {
    expect(order.filter((line) => line.endsWith(":Widget"))).toEqual(["connection-one:Widget", "shared:Widget"]);
    /* Model level in source order (top to bottom: tools, shared — already applied —, softly). */
    expect(ModelInternals.schema(Widgets).plugins).toEqual(["connection-one", "shared", "tools", "softly"]);
    expect(order).toContain("connection-one:Gadget");
  });

  test("a connection plugin registered after the first compile: ConfigurationError", () => {
    expect(() => t.connection.plugins.use(tracer("late"))).toThrow(/fixed once a schema is compiled/);
  });

  test("the same plugin with other options, or two plugins with one name: ConfigurationError", () => {
    @Plugin(tools, { field: "a" })
    @Schema()
    class Twice extends Entity {}
    expect(() =>
      SchemaCompiler.compile(Twice, {
        plugins: new PluginRegistry("connection").use(tools, { field: "b" }),
      }),
    ).toThrow(/registered twice .* with different options/);
  });

  test("global plugins (own process, real server): hook after the class's, policy, static, sealed", async () => {
    const run = Bun.spawn(["bun", "run", "test/fixtures/scripts/global-plugins-runtime.ts"], {
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
    const result = JSON.parse(out) as {
      order: string[];
      live: string[];
      all: number;
      plugins: string[];
      late: string;
    };
    /* plugin hooks run after the class's */
    expect(result.order).toEqual(["class pre query.find", "global pre query.find"]);
    expect(result.live).toEqual(["b"]); /* the soft delete the global plugin enabled */
    expect(result.all).toBe(2); /* its static */
    expect(result.plugins).toEqual(["stamped"]);
    expect(result.late).toMatch(/global plugins are fixed once a schema is compiled/);
  });
});

describe("what a plugin adds", () => {
  test("a field (runtime: stored, cast, validated)", async () => {
    await Widgets.insertOne({ name: "w", tag: "t1" } as never);
    const raw = await t.mongo.db.collection("m9_widgets").findOne({ name: "w" });
    expect(raw?.tag).toBe("t1");
    expect(ModelInternals.schema(Widgets).field("tag")?.kind).toBe("scalar");
  });

  test("statics: typed by model.statics(plugin); addStatic ones exist untyped; a model without the plugin refuses", async () => {
    await Widgets.insertMany([{ name: "x" }, { name: "x" }, { name: "y" }]);
    expect(await Widgets.statics(tools).byName("x")).toBe(2);
    /* cast: addStatic statics are untyped by design (typed through model.statics(plugin)); they exist at run time */
    expect(await (Widgets as unknown as { countAll(): Promise<number> }).countAll()).toBe(3);
    expect(() => t.connection.model(Gadget).statics(tools)).toThrow(ConfigurationError);
  });

  test("a static named like a model member: ConfigurationError when the model is made", () => {
    const clash: SchemaPlugin = { name: "clash", apply: (builder) => builder.addStatic("find", () => 1) };
    @Plugin(clash)
    @Schema({ collection: "m9_clash" })
    class Clash extends Entity {}
    expect(() => t.connection.model(Clash)).toThrow(/would shadow a member of the model/);
  });

  test("policies: enablePolicy works like @Schema; conflicting options with @Schema are an error", async () => {
    await Widgets.insertOne({ name: "gone" });
    await Widgets.deleteOne({ name: "gone" });
    expect(await Widgets.findOne({ name: "gone" })).toBeNull();
    expect(ModelInternals.schema(Widgets).options.softDelete).toBe(true);
    const other: SchemaPlugin = {
      name: "other",
      apply: (builder) => builder.enablePolicy("softDelete", { field: "removedAt" }),
    };
    @Plugin(other)
    @Schema({ softDelete: true })
    class Conflict extends Entity {
      @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
    }
    expect(() => SchemaCompiler.compile(Conflict)).toThrow(/declared by @Schema and enabled by plugin "other"/);
  });

  test("statics and policies are for plugins: the decorators' builder refuses them", () => {
    class Bare {}
    expect(() => MetadataBuilder.for(Bare).addStatic("x", () => 1)).toThrow(/statics are added by plugins/);
    expect(() => MetadataBuilder.for(Bare).enablePolicy("audit", true)).toThrow(/enablePolicy is for plugins/);
  });
});
