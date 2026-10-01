/*
 * Regressions from research/mongoose/M11-history/history.yaml (areas index, discriminator and
 * schema-related "other" entries), one test per entry, `how_to_test` kept.
 */
import { describe, expect, test } from "bun:test";
import {
  type ArrayNode,
  ConfigurationError,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Index,
  JsonSchemaGenerator,
  MetadataBuilder,
  MetadataStore,
  Pre,
  Prop,
  Schema,
  SchemaCompiler,
  SchemaWalker,
  Spec,
} from "../../../src/internal.ts";

describe("history.yaml: schema, index, discriminator", () => {
  test("H019: JSON Schema puts enum on array elements and understands the object form of enum", () => {
    enum Letter {
      A = "a",
    }
    @Schema()
    class H019 extends Entity {
      @Prop(() => [String], { enum: Letter }) arr?: Letter[];
    }
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(H019)).properties?.arr?.items?.enum).toEqual(["a"]);
  });

  test("H030: path lookups never read inherited properties (constructor, __proto__, under maps)", () => {
    @Schema()
    class H030 extends Entity {
      @Prop(() => Spec.map(String)) m?: Map<string, string>;
    }
    const schema = SchemaCompiler.compile(H030);
    expect(schema.resolve("constructor")).toBeUndefined();
    expect(schema.resolve("__proto__")).toBeUndefined();
    expect(schema.resolve("m.__proto__")?.path).toBe("m.$*"); // a map key is data, and the caster refuses __proto__
    expect(() => SchemaWalker.castDocument(schema, { m: JSON.parse('{"__proto__": "x"}') })).toThrow(
      /"__proto__" is never stored/,
    );
    class Polluted {}
    expect(() => MetadataBuilder.for(Polluted).addField("__proto__", () => String)).toThrow(/this name is forbidden/);
  });

  test("H081: a Number enum has its values like a String enum", () => {
    @Schema()
    class H081 extends Entity {
      @Prop(() => Number, { enum: [1, 2] }) n?: 1 | 2;
    }
    const node = SchemaCompiler.compile(H081).field("n");
    expect(node?.kind === "scalar" && node.enumValues).toEqual([1, 2]);
  });

  test("H095: one property for the content of arrays and maps (element / value), always a node", () => {
    @Schema()
    class H095 extends Entity {
      @Prop(() => [String]) arr?: string[];
    }
    const arr = SchemaCompiler.compile(H095).field("arr") as ArrayNode;
    expect(arr.element.kind).toBe("scalar");
    expect(Object.keys(arr).filter((key) => /caster(Constructor)?$|embedded/i.test(key) && key !== "caster")).toEqual(
      [],
    );
  });

  test("H148: self-referencing discriminator schemas", () => {
    @Schema({ discriminatorKey: "type" })
    class Block {
      @Prop(() => String) type!: string;
      @Prop(() => [Block]) blocks?: Block[];
    }
    @Discriminator("a")
    class BlockA extends Block {
      declare readonly type: DiscriminatorValue<"a">;
    }
    @Discriminator("b")
    class BlockB extends Block {
      declare readonly type: DiscriminatorValue<"b">;
      @Prop(() => Block) main?: Block;
    }
    expect(
      SchemaWalker.castDocument(SchemaCompiler.compile(Block), {
        type: "b",
        main: { type: "a", blocks: [{ type: "b" }] },
      }),
    ).toEqual({
      type: "b",
      main: { type: "a", blocks: [{ type: "b" }] },
    });
    void BlockA;
    void BlockB;
  });

  test("H149: {a:1,b:1} and {b:1,a:1} are different indexes; unique field + the same @Index is a conflict", () => {
    @Index({ a: 1, b: 1 })
    @Index({ b: 1, a: 1 })
    @Schema()
    class H149 extends Entity {
      @Prop(() => String) a?: string;
      @Prop(() => String) b?: string;
    }
    expect(SchemaCompiler.compile(H149).indexes.length).toBe(2);
    @Index({ path: 1 })
    @Schema()
    class H149b extends Entity {
      @Prop(() => String, { unique: true, required: true }) path!: string;
    }
    expect(() => SchemaCompiler.compile(H149b)).toThrow(
      /two indexes named or keyed "path_1" with different definitions/,
    );
  });

  test("H014 / H060: a duplicate index is an error (not a warning) and the message names the class", () => {
    @Index({ path: 1 }, { sparse: true })
    @Schema()
    class H060 extends Entity {
      @Prop(() => String, { index: true }) path?: string;
    }
    expect(() => SchemaCompiler.compile(H060)).toThrow(/^H060: two indexes/);
  });

  test("H154 / H162: hooks and subdocuments that exist only in a discriminator are in its compiled schema", () => {
    @Schema()
    class Part {
      @Pre("document.save") mark(): void {}
    }
    @Schema()
    class Machine extends Entity {}
    @Discriminator("robot")
    class Robot extends Machine {
      declare readonly __t: DiscriminatorValue<"robot">;
      @Prop(() => [Part]) parts?: Part[];
    }
    const robot = SchemaCompiler.compile(Robot);
    const parts = robot.field("parts") as ArrayNode;
    expect(parts.element.kind === "subdocument" && parts.element.schema.hooks["document.save"].pre.length).toBe(1);
  });

  test("H179: compiling a discriminator does not mutate the base's metadata", () => {
    @Schema()
    class Base extends Entity {
      @Prop(() => String) a?: string;
    }
    const before = MetadataStore.own(Base);
    @Discriminator("child")
    class Child extends Base {
      declare readonly __t: DiscriminatorValue<"child">;
      @Prop(() => String) b?: string;
    }
    SchemaCompiler.compile(Child);
    expect(MetadataStore.own(Base)).toBe(before);
    expect(MetadataStore.own(Base).fields.map((field) => field.key)).toEqual(["a"]);
  });

  test("H200: resolve() returns a node, never the string 'nested'", () => {
    @Schema({ nested: true })
    class Inner {
      @Prop(() => String) x?: string;
    }
    @Schema()
    class H200 extends Entity {
      @Prop(() => Inner) inner?: Inner;
    }
    expect(SchemaCompiler.compile(H200).resolve("inner")?.kind).toBe("nested");
  });

  test("H210 / H438: indexes of a base class apply to its subclasses and discriminators", () => {
    @Index({ name: 1 })
    @Schema()
    class Base extends Entity {
      @Prop(() => String) name?: string;
    }
    @Schema()
    class Derived extends Base {}
    @Discriminator("d")
    class Disc extends Base {
      declare readonly __t: DiscriminatorValue<"d">;
    }
    expect(SchemaCompiler.compile(Derived).indexes.map((index) => index.keys)).toEqual([{ name: 1 }]);
    expect(SchemaCompiler.compile(Disc).indexes.map((index) => index.keys)).toEqual([{ name: 1 }]);
  });

  test("H216: aliased index keys keep their order", () => {
    @Index({ b: 1, a: 1 })
    @Schema()
    class H216 extends Entity {
      @Prop(() => String, { dbName: "aliasA" }) a?: string;
      @Prop(() => String, { dbName: "aliasB" }) b?: string;
    }
    expect(Object.keys(SchemaCompiler.compile(H216).indexes[0]?.keys ?? {})).toEqual(["aliasB", "aliasA"]);
  });

  test("H302: a discriminator inherits the root's schema options", () => {
    @Schema({ collection: "h302", discriminatorKey: "_t" })
    class Root extends Entity {
      @Prop(() => String) _t!: string;
    }
    @Discriminator("D")
    class D extends Root {
      declare readonly _t: DiscriminatorValue<"D">;
    }
    expect(SchemaCompiler.compile(D).options).toEqual({ collection: "h302", discriminatorKey: "_t" });
  });

  test("H309: index directions are strict (1 | -1 | 'hashed' on fields)", () => {
    class H309 {}
    MetadataBuilder.for(H309).addField("x", () => String, { index: "desc" });
    MetadataBuilder.for(H309).setSchema({});
    expect(() => SchemaCompiler.compile(H309)).toThrow(ConfigurationError);
  });

  test("H312 / H419: no automatic id virtual (a field may be stored as id)", () => {
    @Schema()
    class H312 extends Entity {
      @Prop(() => String, { dbName: "id" }) foo?: string;
    }
    expect(SchemaCompiler.compile(H312).virtuals.some((virtual) => virtual.key === "id")).toBe(false);
  });

  test("H341 / H158: the discriminator key of an embedded document selects and fills its class", () => {
    @Schema({ discriminatorKey: "kind" })
    class Item {
      @Prop(() => String) kind!: string;
    }
    @Discriminator("B")
    class ItemB extends Item {
      declare readonly kind: DiscriminatorValue<"B">;
      @Prop(() => Number) bField?: number;
    }
    @Schema()
    class Holder extends Entity {
      @Prop(() => [Item]) arr?: Item[];
    }
    expect(SchemaWalker.castDocument(SchemaCompiler.compile(Holder), { arr: [{ kind: "B", bField: 1 }] })).toEqual({
      arr: [{ kind: "B", bField: 1 }],
    });
    expect(SchemaWalker.castDocument(SchemaCompiler.compile(ItemB), { bField: 1 })).toEqual({ bField: 1, kind: "B" });
  });

  test("H347: resolving indexed paths caches nothing", () => {
    @Schema()
    class H347 extends Entity {
      @Prop(() => [String]) arr?: string[];
    }
    const schema = SchemaCompiler.compile(H347);
    for (let index = 0; index < 100_000; index += 997) schema.resolve(`arr.${index}`);
    expect(Object.keys(schema.allPaths)).toEqual(["_id", "arr", "arr.$"]);
  });

  test("H441: base hooks run once for a discriminator", () => {
    @Schema()
    class Base extends Entity {
      @Pre("document.save") once(): void {}
    }
    @Discriminator("x")
    class Child extends Base {
      declare readonly __t: DiscriminatorValue<"x">;
    }
    expect(SchemaCompiler.compile(Child).hooks["document.save"].pre.length).toBe(1);
  });

  test("H507: index/unique on a model's _id is refused", () => {
    class H507 {}
    MetadataBuilder.for(H507).addField("_id", () => String, { unique: true, required: true });
    MetadataBuilder.for(H507).setSchema({});
    expect(() => SchemaCompiler.compileModel(H507)).toThrow(/_id is always uniquely indexed/);
  });
});
