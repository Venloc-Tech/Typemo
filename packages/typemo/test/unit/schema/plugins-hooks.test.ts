import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { ObjectId } from "mongodb";
import {
  type ClassRef,
  ConfigurationError,
  Entity,
  HOOK_EVENTS,
  type OperationHookContext,
  Plugin,
  PluginRegistry,
  Post,
  PostError,
  Pre,
  Prop,
  Schema,
  SchemaCompiler,
  type SchemaPlugin,
} from "../../../src/internal.ts";

/* Hooks and plugins. */

const PACKAGE_DIR = resolve(import.meta.dir, "../../..");

describe("hooks", () => {
  test("the hook table has every event and every phase; decorators land in the right cell", () => {
    @Schema()
    class Hooked extends Entity {
      @Pre("document.save") a(): void {}
      @Post("document.save") b(): void {}
      @PostError("document.save") c(): void {}
      @Pre(["query.find", "query.findOne"]) d(this: OperationHookContext<Hooked>): void {}
      @Pre("document.updateOne") e(): void {}
      @Pre("query.updateOne") f(this: OperationHookContext<Hooked>): void {}
    }
    const hooks = SchemaCompiler.compile(Hooked).hooks;
    expect(Object.keys(hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(hooks["document.save"].pre.length).toBe(1);
    expect(hooks["document.save"].post.length).toBe(1);
    expect(hooks["document.save"].postError.length).toBe(1);
    expect(hooks["query.find"].pre.length).toBe(1);
    expect(hooks["query.findOne"].pre.length).toBe(1);
    /* The document and the query updateOne are different events. */
    expect(hooks["document.updateOne"].pre.length).toBe(1);
    expect(hooks["query.updateOne"].pre.length).toBe(1);
    expect(Object.isFrozen(hooks["document.save"].pre)).toBe(true);
  });

  test("inherited hooks run base first", () => {
    const calls: string[] = [];
    @Schema()
    class A extends Entity {
      @Pre("document.validate") one(): void {
        calls.push("A");
      }
    }
    @Schema()
    class B extends A {
      @Pre("document.validate") two(): void {
        calls.push("B");
      }
    }
    for (const hook of SchemaCompiler.compile(B).hooks["document.validate"].pre) hook.call(undefined);
    expect(calls).toEqual(["A", "B"]);
  });
});

describe("plugins", () => {
  const tracer = (name: string, log: string[]): SchemaPlugin => ({
    name,
    apply: (builder) => {
      log.push(`${name}:${builder.target.name}`);
    },
  });

  test("a plugin adds fields, indexes, hooks and virtuals on a draft (the class metadata is untouched)", () => {
    const stamp: SchemaPlugin<{ readonly field: string }> = {
      name: "stamp",
      apply: (builder, options) => {
        builder.addField(options.field, () => Date, { index: true });
        builder.addHook("pre", "document.save", function (this: unknown) {
          void this;
        });
      },
    };
    @Plugin(stamp, { field: "stampedAt" })
    @Schema()
    class Stamped extends Entity {
      @Prop(() => String) name?: string;
    }
    const schema = SchemaCompiler.compile(Stamped);
    expect(schema.field("stampedAt")?.kind).toBe("scalar");
    expect(schema.indexes.map((index) => index.keys)).toEqual([{ stampedAt: 1 }]);
    expect(schema.hooks["document.save"].pre.length).toBe(1);
  });

  test("order: global → connection → model (base first, source order); duplicates once", () => {
    const log: string[] = [];
    const shared = tracer("shared", log);
    const connection = new PluginRegistry("connection").use(tracer("conn", log)).use(shared);
    @Plugin(tracer("base", log))
    @Schema()
    class Base extends Entity {}
    @Plugin(tracer("first", log))
    @Plugin(shared)
    @Plugin(tracer("third", log))
    @Schema()
    class Model extends Base {}
    SchemaCompiler.compile(Model, { plugins: connection });
    expect(log).toEqual(["conn:Model", "shared:Model", "base:Model", "first:Model", "third:Model"]);
  });

  test("the same plugin with different options, or two plugins with one name, is an error", () => {
    const configurable: SchemaPlugin<{ readonly n: number }> = { name: "cfg", apply: () => undefined };
    const connection = new PluginRegistry("connection").use(configurable, { n: 1 });
    @Plugin(configurable, { n: 2 })
    @Schema()
    class Conflicting extends Entity {}
    expect(() => SchemaCompiler.compile(Conflicting, { plugins: connection })).toThrow(
      /plugin "cfg" is registered twice \(connection and model\) with different options/,
    );
    @Plugin({ name: "same", apply: () => undefined })
    @Plugin({ name: "same", apply: () => undefined })
    @Schema()
    class TwoSameNames extends Entity {}
    expect(() => SchemaCompiler.compile(TwoSameNames)).toThrow(/two different plugins are named "same"/);
  });

  test("a plugin may not change schema options, add plugins or declare discriminators", () => {
    const bad: SchemaPlugin = {
      name: "bad",
      /* cast: bypasses the type to test the runtime guard — a plugin calling a builder method it lacks (JS caller) */
      apply: (builder) => (builder as unknown as { setSchema: (o: object) => void }).setSchema({}),
    };
    @Plugin(bad)
    @Schema()
    class Target extends Entity {}
    expect(() => SchemaCompiler.compile(Target)).toThrow(
      /Target \(plugin "bad"\): a plugin cannot change schema options/,
    );
  });

  test("a plugin that throws is wrapped with its name and cause", () => {
    @Plugin({
      name: "boom",
      apply: () => {
        throw new TypeError("oops");
      },
    })
    @Schema()
    class Exploding extends Entity {}
    try {
      SchemaCompiler.compile(Exploding);
      throw new Error("no error");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toBe('Exploding: plugin "boom" threw');
      expect((error as Error).cause).toBeInstanceOf(TypeError);
    }
  });

  test("connection plugins apply to subdocuments but not to nested objects (no own hooks)", () => {
    const seen: string[] = [];
    const hooking: SchemaPlugin = {
      name: "hooking",
      apply: (builder) => {
        seen.push(builder.target.name);
        builder.addHook("pre", "document.save", function (this: unknown) {
          void this;
        });
      },
    };
    @Schema({ nested: true })
    class Group {
      @Prop(() => String) a?: string;
    }
    @Schema()
    class Sub {
      @Prop(() => String) b?: string;
    }
    @Schema()
    class Root extends Entity {
      @Prop(() => Group) group?: Group;
      @Prop(() => Sub) sub?: Sub;
    }
    expect(() =>
      SchemaCompiler.compile(Root, { plugins: new PluginRegistry("connection").use(hooking) }),
    ).not.toThrow();
    expect(seen.sort()).toEqual(["Root", "Sub"]);
  });

  test("the same class under two contexts gets independent plugin sets (wrapper gotcha #36)", () => {
    const withField: SchemaPlugin = { name: "extra", apply: (builder) => builder.addField("extra", () => ObjectId) };
    @Schema()
    class Shared extends Entity {}
    const plain = SchemaCompiler.compile(Shared);
    const extended = SchemaCompiler.compile(Shared, { plugins: new PluginRegistry("connection").use(withField) });
    expect(plain.field("extra")).toBeUndefined();
    expect(extended.field("extra")?.kind).toBe("scalar");
    void (Shared as ClassRef);
  });

  test("global plugins (own process): first in order, deduplicated, sealed after the first successful compile", async () => {
    const run = Bun.spawn(["bun", "run", "test/fixtures/scripts/global-plugins.ts"], {
      cwd: PACKAGE_DIR,
      stdout: "pipe",
      stderr: "pipe",
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
      late: string;
      lateConnection: string;
      failedCompile: string;
      afterFailed: number;
    };
    /* A failed compile seals nothing: the global plugins below and the connection registry stay open. */
    expect(result.failedCompile).toContain("notRegistered");
    expect(result.afterFailed).toBe(1);
    expect(result.order).toEqual(["global-one:Account", "global-two:Account", "connection:Account"]);
    expect(result.late).toMatch(
      /plugin "late": the global plugins are fixed once a schema is compiled \(Account was\)/,
    );
    expect(result.lateConnection).toMatch(/the connection plugins are fixed once a schema is compiled/);
  });
});
