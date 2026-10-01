import { describe, expect, test } from "bun:test";
import { getOwnMetadata } from "reflect-metadata/no-conflict";
import {
  ConfigurationError,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Index,
  MetadataBuilder,
  MetadataStore,
  Plugin,
  Post,
  Pre,
  Prop,
  Schema,
  type SchemaPlugin,
  Timestamped,
} from "../../../src/internal.ts";

/* reflect-metadata storage on the constructor, inheritance merge, one builder API. */

describe("MetadataStore", () => {
  test("records are stored on the constructor through reflect-metadata (no-conflict entry)", () => {
    @Schema()
    class Stored {
      @Prop(() => String) name?: string;
    }
    const keys = Reflect.ownKeys(Stored);
    expect(MetadataStore.own(Stored).fields.map((field) => field.key)).toEqual(["name"]);
    /* No own property was added to the class: the metadata lives in reflect-metadata's registry. */
    expect(keys).not.toContain("typemo");
    expect(getOwnMetadata("anything", Stored)).toBeUndefined();
  });

  test("the global Reflect is not patched by Typemo", () => {
    /* cast: a test double / bridge — the GLOBAL Reflect must not be patched: the property is not in its type */
    expect((Reflect as unknown as { getMetadata?: unknown }).getMetadata).toBeUndefined();
    /* cast: a test double / bridge — the same check for defineMetadata */
    expect((Reflect as unknown as { defineMetadata?: unknown }).defineMetadata).toBeUndefined();
  });

  test("inheritance merge: base first, a subclass redeclaration keeps the subclass record", () => {
    @Schema()
    class Base extends Entity {
      @Prop(() => String) a?: string;
      @Prop(() => String) b?: string;
    }
    @Schema()
    class Derived extends Base {
      @Prop(() => String, { required: true }) override b?: string;
      @Prop(() => Number) c?: number;
    }
    const merged = MetadataStore.merged(Derived);
    expect(merged.fields.map((field) => `${field.owner.name}.${field.key}`)).toEqual([
      "Entity._id",
      "Base.a",
      "Derived.b",
      "Derived.c",
    ]);
    expect(merged.overridden.map((field) => `${field.owner.name}.${field.key}`)).toEqual(["Base.b"]);
    expect(merged.chain.map((target) => target.name)).toEqual(["Entity", "Base", "Derived"]);
  });

  test("mixins contribute their service fields", () => {
    @Schema()
    class Stamped extends Timestamped(Entity) {}
    expect(MetadataStore.merged(Stamped).fields.map((field) => [field.key, field.service])).toEqual([
      ["_id", "id"],
      ["createdAt", "createdAt"],
      ["updatedAt", "updatedAt"],
    ]);
  });

  test("records are frozen and replaced on write (copy on write)", () => {
    class Cow {}
    MetadataBuilder.for(Cow).addField("a", () => String);
    const first = MetadataStore.own(Cow);
    MetadataBuilder.for(Cow).addField("b", () => String);
    expect(first.fields.map((field) => field.key)).toEqual(["a"]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.fields[0])).toBe(true);
    expect(MetadataStore.own(Cow).fields.map((field) => field.key)).toEqual(["a", "b"]);
  });

  test("isSchema: only an own @Schema or @Discriminator makes a schema (inheritance alone does not)", () => {
    @Schema()
    class Root {}
    class Plain extends Root {}
    @Discriminator("d")
    class Disc extends Root {
      declare readonly __t: DiscriminatorValue<"d">;
    }
    expect(MetadataStore.isSchema(Root)).toBe(true);
    expect(MetadataStore.isSchema(Plain)).toBe(false);
    expect(MetadataStore.isSchema(Disc)).toBe(true);
    expect(MetadataStore.discriminatorsOf(Root)).toEqual([Disc]);
  });
});

describe("MetadataBuilder (one API for both decorator packages)", () => {
  test("the options object is copied, never kept by reference", () => {
    const options = { required: true };
    class Copied {}
    MetadataBuilder.for(Copied).addField("a", () => String, options);
    options.required = false;
    expect(MetadataStore.own(Copied).fields[0]?.options).toEqual({ required: true });
  });

  test("@Schema twice, @Discriminator without a base, empty @Index are refused", () => {
    class Twice {}
    MetadataBuilder.for(Twice).setSchema({});
    expect(() => MetadataBuilder.for(Twice).setSchema({})).toThrow(/@Schema is applied twice/);
    class Orphan {}
    expect(() => MetadataBuilder.for(Orphan).setDiscriminator("x")).toThrow(/@Discriminator needs a base class/);
    expect(() => MetadataBuilder.for(Orphan).addIndex({})).toThrow(/@Index needs at least one field/);
  });

  test("hooks: events are validated; decorators record phase, events, method", () => {
    @Schema()
    class Hooked extends Entity {
      @Pre("document.save")
      before(): void {}
      @Post(["query.find", "query.findOne"])
      after(this: import("../../../src/index.ts").OperationHookContext<Hooked>): void {}
    }
    expect(MetadataStore.own(Hooked).hooks.map((hook) => [hook.phase, hook.events, hook.key])).toEqual([
      ["pre", ["document.save"], "before"],
      ["post", ["query.find", "query.findOne"], "after"],
    ]);
    class Bad {}
    expect(() => MetadataBuilder.for(Bad).addHook("pre", "save" as "document.save", () => undefined)).toThrow(
      /unknown hook event "save"/,
    );
  });

  test("a static method cannot be a hook", () => {
    /* cast: bypasses the type to test the runtime guard — a hook decorator on a static method */
    const decorate = Pre("document.save") as unknown as (
      target: object,
      key: string,
      descriptor: PropertyDescriptor,
    ) => void;
    class Host {
      static run(): void {}
    }
    expect(() => decorate(Host, "run", { value: Host.run })).toThrow(/a hook must be an instance method/);
  });

  test("@Plugin and @Index are recorded with their owner", () => {
    const plugin: SchemaPlugin<{ readonly n: number }> = { name: "noop", apply: () => undefined };
    @Plugin(plugin, { n: 1 })
    @Index({ a: 1 })
    @Schema()
    class Recorded extends Entity {
      @Prop(() => String) a?: string;
    }
    const own = MetadataStore.own(Recorded);
    expect(own.plugins.map((use) => [use.plugin.name, use.options])).toEqual([["noop", { n: 1 }]]);
    expect(own.indexes.map((index) => index.fields)).toEqual([{ a: 1 }]);
  });

  test("errors are ConfigurationError and name the class", () => {
    class Named {}
    try {
      MetadataBuilder.for(Named).addField("constructor", () => String);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as Error).message).toStartWith("Named: ");
    }
  });
});
