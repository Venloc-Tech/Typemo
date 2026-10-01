import { describe, expect, test } from "bun:test";
import { type Binary, Decimal128, Double, Int32, ObjectId, UUID } from "mongodb";
import {
  type ArrayNode,
  CastError,
  type CompiledSchema,
  Entity,
  type MapNode,
  Prop,
  type ScalarNode,
  Schema,
  SchemaCompiler,
  SchemaWalker,
  SearchIndex,
  Spec,
  type SubdocumentNode,
  Types,
  type Vector,
} from "../../../src/internal.ts";
import { Address, Circle, Person, PersonName, Post, Shape } from "../../fixtures/schema-entities.ts";

/*
 * The compiled schema is ONE immutable paths tree (fields, nested objects inlined, array elements `$`, map values
 * `$*`), with positional resolution, aliases and casters.
 */

/** The compiled schema of the `Person` fixture. */
const person = (): CompiledSchema => SchemaCompiler.compile(Person);

describe("paths tree", () => {
  test("snapshot of the compiled fixture (paths, indexes, virtuals, hooks)", () => {
    expect(person().describe()).toMatchSnapshot();
    expect(SchemaCompiler.compile(Post).describe()).toMatchSnapshot();
  });

  test("describe() lists the search and vector search indexes, top to bottom", () => {
    @Schema({ collection: "described_search" })
    @SearchIndex({ name: "vectors", type: "vectorSearch", definition: { fields: [] } })
    @SearchIndex({ name: "default", definition: { mappings: { dynamic: true } } })
    class Described extends Entity {
      @Prop(() => String) text?: string;
    }
    /* Top to bottom, as written above the class. */
    expect(SchemaCompiler.compile(Described).describe().searchIndexes).toEqual([
      { name: "vectors", type: "vectorSearch", definition: { fields: [] } },
      { name: "default", definition: { mappings: { dynamic: true } } },
    ]);
    expect(person().describe().searchIndexes).toEqual([]);
  });

  test("service fields come from the base classes, base first (D13)", () => {
    expect(
      person()
        .fields.map((field) => field.key)
        .slice(0, 4),
    ).toEqual(["_id", "createdAt", "updatedAt", "__v"]);
    expect(person().field("_id")?.service).toBe("id");
    expect(person().field("createdAt")?.service).toBe("createdAt");
    expect(person().field("__v")?.service).toBe("version");
  });

  test("nested objects are inlined into the parent paths (Q-PLAN-1)", () => {
    const paths = person().paths;
    expect(paths.name?.kind).toBe("nested");
    expect(paths["name.first"]?.kind).toBe("scalar");
    expect(paths["name.first"]?.required).toBe(true);
    expect(paths["name.last"]?.path).toBe("name.last");
  });

  test("array elements are `$`, map values are `$*`", () => {
    const paths = person().paths;
    expect((paths.tags as ArrayNode).element.path).toBe("tags.$");
    expect(paths["tags.$"]?.kind).toBe("scalar");
    expect((paths.scores as MapNode).value.path).toBe("scores.$*");
    expect((paths["scores.$*"] as ScalarNode).type).toBe("number");
    expect(paths["addresses.$"]?.kind).toBe("subdocument");
  });

  test("allPaths walks into subdocuments; the subdocument's own paths stay in its schema", () => {
    expect(person().allPaths["addresses.$.city"]?.path).toBe("addresses.$.city");
    expect(person().paths["addresses.$.city"]).toBeUndefined();
    expect((person().paths["addresses.$"] as SubdocumentNode).schema.paths.city?.path).toBe("city");
  });

  test.each([
    ["addresses.3.city", "addresses.$.city"],
    ["addresses.$.city", "addresses.$.city"],
    ["addresses.$[].city", "addresses.$.city"],
    ["addresses.$[elem].city", "addresses.$.city"],
    ["scores.math", "scores.$*"],
    ["scores.$*", "scores.$*"],
    ["tags.0", "tags.$"],
    ["name.first", "name.first"],
    ["shapes.1.kind", "shapes.$.kind"],
  ])("resolve(%s) → %s", (input, canonical) => {
    expect(person().canonicalPath(input)).toBe(canonical);
    expect(person().resolve(input)?.path).toBe(canonical);
  });

  test.each([
    "nope",
    "addresses.city", // no positional segment: an array is not an object
    "addresses.x.city",
    "name.middle",
    "tags.0.x",
    "constructor",
    "__proto__",
    "toString",
    "scores.math.x",
  ])("resolve(%s) → undefined (never an inherited property, H030)", (input) => {
    expect(person().resolve(input)).toBeUndefined();
  });

  test("resolving positional paths caches nothing (no growth on read, H347)", () => {
    const schema = person();
    const before = Object.keys(schema.allPaths).length;
    for (let index = 0; index < 1000; index++) schema.resolve(`addresses.${index}.city`);
    expect(Object.keys(schema.allPaths).length).toBe(before);
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.paths)).toBe(true);
    expect(Object.isFrozen(schema.fields[0])).toBe(true);
  });

  test("flags: required, nullable, immutable, hidden, default, ref", () => {
    const schema = person();
    expect(schema.field("manager")?.nullable).toBe(true);
    expect(schema.field("manager")?.ref?.()).toBe(Person);
    expect(schema.field("externalId")?.immutable).toBe(true);
    expect(schema.field("passwordHash")?.hidden).toBe(true);
    expect(schema.field("age")?.defaultValue?.()).toBe(0);
    expect(schema.field("tags")?.defaultValue?.()).toEqual([]);
  });

  test("a static default is a fresh copy per call", () => {
    const tags = person().field("tags")?.defaultValue;
    const a = tags?.() as string[];
    const b = tags?.() as string[];
    expect(a).not.toBe(b);
  });

  test("getters are native virtuals, @Virtual is a populate virtual", () => {
    expect(person().virtuals).toEqual([
      expect.objectContaining({ kind: "populate", key: "posts" }),
      { kind: "getter", key: "displayName", settable: false },
    ]);
  });

  test("collection: explicit or lowercase + plural (D19)", () => {
    expect(person().collection).toBe("people");
    expect(SchemaCompiler.compile(Post).collection).toBe("posts");
    expect(SchemaCompiler.compile(Shape).collection).toBe("shapes");
    expect(SchemaCompiler.compile(Circle).collection).toBe("shapes");
  });

  test("compile is cached per class and context; another context compiles again", () => {
    expect(SchemaCompiler.compile(Person)).toBe(person());
    const other = SchemaCompiler.compile(Person, { naming: (name) => `x_${name}` });
    expect(other).not.toBe(person());
    expect(other.collection).toBe("people"); // explicit collection wins over the naming function
    expect(SchemaCompiler.compile(Post, { naming: (name) => `x_${name}` }).collection).toBe("x_Post");
  });

  test("compileModel requires _id and a document", () => {
    expect(SchemaCompiler.compileModel(Person).hasId).toBe(true);
    expect(() => SchemaCompiler.compileModel(Address)).toThrow(/needs an _id field/);
    expect(() => SchemaCompiler.compileModel(PersonName)).toThrow(/nested object .* cannot be a model/);
  });
});

describe("types of paths", () => {
  @Schema()
  class AllTypes extends Entity {
    @Prop(() => String) s?: string;
    @Prop(() => Number) n?: number;
    @Prop(() => Types.Double) d?: number;
    @Prop(() => Types.Int32) i?: number;
    @Prop(() => BigInt) l?: bigint;
    @Prop(() => Types.Decimal128) dec?: Decimal128;
    @Prop(() => Boolean) b?: boolean;
    @Prop(() => Date) at?: Date;
    @Prop(() => ObjectId) oid?: ObjectId;
    @Prop(() => UUID) uuid?: UUID;
    @Prop(() => Types.Binary) bin?: Binary;
    @Prop(() => Spec.binary({ subtype: 5 })) md5?: Binary;
    @Prop(() => Spec.vector({ dtype: "float32", dimensions: 3 })) vec?: Vector;
    @Prop(() => RegExp) re?: RegExp;
    @Prop(() => Types.Timestamp) ts?: InstanceType<typeof Types.Timestamp>;
    @Prop(() => Spec.union(String, Number)) either?: string | number;
    @Prop(() => [[Number]]) matrix?: number[][];
    @Prop(() => Spec.map([String])) groups?: Map<string, string[]>;
  }

  test("every spec resolves to its node type", () => {
    const schema = SchemaCompiler.compile(AllTypes);
    const type = (key: string): string | undefined => {
      const node = schema.field(key);
      return node?.kind === "scalar" ? node.type : node?.kind;
    };
    expect(
      [
        "s",
        "n",
        "d",
        "i",
        "l",
        "dec",
        "b",
        "at",
        "oid",
        "uuid",
        "bin",
        "md5",
        "vec",
        "re",
        "ts",
        "either",
        "matrix",
        "groups",
      ].map(type),
    ).toEqual([
      "string",
      "number",
      "double",
      "int32",
      "long",
      "decimal128",
      "boolean",
      "date",
      "objectId",
      "uuid",
      "binary",
      "binary",
      "vector",
      "regex",
      "timestamp",
      "union",
      "array",
      "map",
    ]);
    expect(schema.paths["matrix.$.$"]?.kind).toBe("scalar");
    expect(schema.paths["groups.$*.$"]?.kind).toBe("scalar");
  });

  test("casting a document uses the L1 casters (wire types by encode)", () => {
    const schema = SchemaCompiler.compile(AllTypes);
    const cast = SchemaWalker.castDocument(schema, {
      s: "x",
      d: 2,
      i: 3,
      l: 4,
      dec: "1.50",
      oid: "5f8d0d55b54764421b7156c3",
      vec: new Float32Array([1, 2, 3]),
      md5: new Uint8Array([1]),
      either: 5,
      matrix: [[1, 2], [3]],
      groups: { a: ["x"] },
    });
    expect(cast.l).toBe(4n);
    expect(cast.dec).toBeInstanceOf(Decimal128);
    expect(cast.oid).toBeInstanceOf(ObjectId);
    expect((cast.md5 as Binary).sub_type).toBe(5);
    expect(cast.groups).toEqual(new Map([["a", ["x"]]]));
    const wire = SchemaWalker.encodeDocument(schema, cast);
    expect(wire.d).toBeInstanceOf(Double);
    expect(wire.i).toBeInstanceOf(Int32);
    expect(wire.groups).toEqual({ a: ["x"] });
  });

  test("casting: unknown keys, undefined and null are errors (D8) with the full path", () => {
    const schema = person();
    const failure = (input: unknown): CastError => {
      try {
        SchemaWalker.castDocument(schema, input);
      } catch (error) {
        if (error instanceof CastError) return error;
        throw error;
      }
      throw new Error("no error");
    };
    expect(failure({ name: { first: "a" }, nope: 1 }).reason).toBe("unknown-key");
    expect(failure({ name: { first: "a" }, age: undefined }).reason).toBe("undefined");
    expect(failure({ name: { first: "a" }, age: null }).reason).toBe("null");
    expect(failure({ name: { first: "a" }, addresses: [{ city: 5 }] }).path).toBe("addresses.0.city");
    expect(failure({ name: { first: "a" }, shapes: [{ kind: "triangle" }] }).reason).toBe("discriminator");
  });

  test("string transforms and setters run after the caster, nullable wraps them", () => {
    const schema = person();
    expect(SchemaWalker.castDocument(schema, { name: { first: "  Ann " }, email: "A@B.C" })).toEqual({
      name: { first: "Ann" },
      email: "a@b.c",
    });
    expect(SchemaWalker.castDocument(schema, { manager: null })).toEqual({ manager: null });
  });

  test("embedded discriminators are cast by value (key default filled)", () => {
    const schema = person();
    const cast = SchemaWalker.castDocument(schema, {
      shapes: [
        { kind: "circle", radius: 2 },
        { kind: "square", side: 1 },
      ],
    });
    expect(cast.shapes).toEqual([
      { kind: "circle", radius: 2 },
      { kind: "square", side: 1 },
    ]);
    const circle = SchemaCompiler.compile(Circle);
    expect(SchemaWalker.castDocument(circle, { radius: 1 })).toEqual({ radius: 1, kind: "circle" });
  });
});
