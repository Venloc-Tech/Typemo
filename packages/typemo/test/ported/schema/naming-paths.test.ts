/*
 * Ported from mongoose test/index.test.js (pluralize), test/utils.test.js (toCollectionName),
 * test/schema.pathType.test.js and test/schema.alias.test.js onto Typemo.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import {
  BsonOptions,
  CollectionNaming,
  ConfigurationError,
  Entity,
  Index,
  MetadataBuilder,
  Prop,
  Schema,
  SchemaCompiler,
  SchemaWalker,
  Spec,
} from "../../../src/internal.ts";

const mongo = MongoLifecycle.useMongo("ported_paths", BsonOptions.apply({}));

describe("pluralize (ported)", () => {
  // ported from mongoose test/index.test.js:41 "legacy pluralize by default (gh-5958)"
  test("legacy pluralize by default (gh-5958)", () => {
    @Schema()
    class User extends Entity {}
    expect(SchemaCompiler.compile(User).collection).toBe("users");
  });

  // ported from mongoose test/index.test.js:49 "returns legacy pluralize function by default"
  test("returns legacy pluralize function by default", () => {
    expect(CollectionNaming.default("User")).toBe(CollectionNaming.pluralize("user"));
  });

  // ported from mongoose test/index.test.js:58 "sets custom pluralize function (gh-5877)"
  test("sets custom pluralize function (gh-5877) — the naming function is a compile context option", () => {
    @Schema()
    class User extends Entity {}
    expect(SchemaCompiler.compile(User, { naming: (name) => name }).collection).toBe("User");
  });

  // ported from mongoose test/utils.test.js:375 "returns the same name for system.profile"
  test("returns the same name for system.profile — divergence L2-7: system.* names are refused", () => {
    expect(() => CollectionNaming.check("system.profile", "X")).toThrow(/"system." collections are reserved/);
  });

  // ported from mongoose test/utils.test.js:383 "throws an error when name is not a string"
  test("throws an error when name is not a string", () => {
    expect(() => CollectionNaming.check(123, "X")).toThrow(ConfigurationError);
  });

  // ported from mongoose test/utils.test.js:389 "throws an error when name is an empty string"
  test("throws an error when name is an empty string", () => {
    expect(() => CollectionNaming.check("", "X")).toThrow(/non-empty/);
  });

  // ported from mongoose test/utils.test.js:395 "uses the pluralize function when provided"
  test("uses the pluralize function when provided", () => {
    @Schema()
    class Test extends Entity {}
    expect(SchemaCompiler.compile(Test, { naming: (name) => `${name.toLowerCase()}s` }).collection).toBe("tests");
  });
});

describe("Schema.prototype.pathType() (ported)", () => {
  // ported from mongoose test/schema.pathType.test.js:7 "treats inherited properties as adhoc or undefined"
  test("treats inherited properties as adhoc or undefined", () => {
    @Schema()
    class Named extends Entity {
      @Prop(() => String) name?: string;
    }
    const schema = SchemaCompiler.compile(Named);
    for (const path of ["__proto__", "constructor", "prototype", "toString"])
      expect(schema.resolve(path)).toBeUndefined();
  });

  @Schema()
  class PersonSub {
    @Prop(() => String) name?: string;
    @Prop(() => Number) age?: number;
  }

  // ported from mongoose test/schema.pathType.test.js:16 "gets paths underneath maps"
  test("gets paths underneath maps", () => {
    @Schema()
    class WithMap extends Entity {
      @Prop(() => Spec.map(String)) myMap?: Map<string, string>;
    }
    const schema = SchemaCompiler.compile(WithMap);
    expect(schema.resolve("myMap")?.kind).toBe("map");
    expect(schema.resolve("myMap.key")?.path).toBe("myMap.$*");
  });

  // ported from mongoose test/schema.pathType.test.js:28 "gets paths underneath maps of subdocuments"
  test("gets paths underneath maps of subdocuments", () => {
    @Schema()
    class WithMap extends Entity {
      @Prop(() => Spec.map(PersonSub)) myMap?: Map<string, PersonSub>;
    }
    const schema = SchemaCompiler.compile(WithMap);
    expect(schema.resolve("myMap.key")?.kind).toBe("subdocument");
    expect(schema.resolve("myMap.key.name")?.path).toBe("myMap.$*.name");
    expect(schema.resolve("myMap.key.age")?.path).toBe("myMap.$*.age");
  });

  // ported from mongoose test/schema.pathType.test.js:43 "treats inherited properties underneath maps of subdocuments as adhoc or undefined"
  test("treats inherited properties underneath maps of subdocuments as adhoc or undefined", () => {
    @Schema()
    class WithMap extends Entity {
      @Prop(() => Spec.map(PersonSub)) myMap?: Map<string, PersonSub>;
    }
    const schema = SchemaCompiler.compile(WithMap);
    for (const key of ["__proto__", "constructor", "prototype", "toString"])
      expect(schema.resolve(`myMap.key.${key}`)).toBeUndefined();
  });

  // ported from mongoose test/schema.pathType.test.js:58 "gets paths underneath maps of maps"
  test("gets paths underneath maps of maps", () => {
    @Schema()
    class WithMaps extends Entity {
      @Prop(() => Spec.map(Spec.map(String))) myMap?: Map<string, Map<string, string>>;
    }
    const schema = SchemaCompiler.compile(WithMaps);
    expect(schema.resolve("myMap")?.kind).toBe("map");
    expect(schema.resolve("myMap.key")?.kind).toBe("map");
    expect(schema.resolve("myMap.key.key2")?.path).toBe("myMap.$*.$*");
  });
});

describe("schema alias option (ported)", () => {
  // ported from mongoose test/schema.alias.test.js:29 "works with all basic schema types"
  test("works with all basic schema types — divergence L2-4: the option is `dbName`, the stored name; the property is the code name", async () => {
    @Schema({ collection: "aliased" })
    class Aliased extends Entity {
      @Prop(() => String, { dbName: "StringAlias" }) string?: string;
      @Prop(() => Number, { dbName: "NumberAlias" }) number?: number;
      @Prop(() => Date, { dbName: "DateAlias" }) date?: Date;
      @Prop(() => Boolean, { dbName: "BooleanAlias" }) boolean?: boolean;
      @Prop(() => [String], { dbName: "ArrayAlias" }) array?: string[];
    }
    const schema = SchemaCompiler.compile(Aliased);
    const input = { string: "hello", number: 1, date: new Date(), boolean: false, array: ["a", "b"] };
    const wire = SchemaWalker.encodeDocument(schema, SchemaWalker.castDocument(schema, input));
    const collection = mongo.db.collection(schema.collection);
    await collection.insertOne(wire);
    const stored = await collection.findOne({ _id: wire._id as never });
    expect(stored).toMatchObject({ StringAlias: "hello", NumberAlias: 1, BooleanAlias: false, ArrayAlias: ["a", "b"] });
    expect(stored?.string).toBeUndefined();
  });

  // ported from mongoose test/schema.alias.test.js:103 "throws when alias option is invalid"
  test("throws when alias option is invalid", () => {
    class Invalid {}
    MetadataBuilder.for(Invalid).addField("foo", () => String, { dbName: 456 });
    MetadataBuilder.for(Invalid).setSchema({});
    expect(() => SchemaCompiler.compile(Invalid)).toThrow(/"dbName" must be a field name/);
  });

  // ported from mongoose test/schema.alias.test.js:121 "nested aliases (gh-6671)"
  test("nested aliases (gh-6671)", () => {
    @Schema()
    class Child {
      @Prop(() => String, { dbName: "n" }) name?: string;
    }
    @Schema({ nested: true })
    class Name {
      @Prop(() => String, { dbName: "f" }) first?: string;
    }
    @Schema()
    class Parent extends Entity {
      @Prop(() => Child, { dbName: "c" }) child?: Child;
      @Prop(() => Name) name?: Name;
    }
    const schema = SchemaCompiler.compile(Parent);
    expect(schema.toDbPath("child.name")).toBe("c.n");
    expect(schema.toDbPath("name.first")).toBe("name.f");
    expect(schema.resolve("name.first")?.dbPath).toBe("name.f");
  });

  // ported from mongoose test/schema.alias.test.js:186 "supports passing the alias name for an index (gh-13276)"
  test("supports passing the alias name for an index (gh-13276) — @Index takes code names, the index uses stored names", () => {
    @Index({ name: 1 })
    @Schema()
    class WithIndex extends Entity {
      @Prop(() => String, { dbName: "n" }) name?: string;
    }
    expect(SchemaCompiler.compile(WithIndex).indexes[0]?.keys).toEqual({ n: 1 });
  });

  // ported from mongoose test/schema.alias.test.js:198 "should disable the id virtual entirely if there's a field with alias `id` gh-13650"
  test("should disable the id virtual entirely if there's a field with alias `id` gh-13650 — n/a: Typemo has no id virtual (H419)", () => {
    @Schema()
    class WithId extends Entity {
      @Prop(() => String, { dbName: "id" }) foo?: string;
    }
    const schema = SchemaCompiler.compile(WithId);
    expect(schema.virtuals).toEqual([]);
    expect(schema.field("foo")?.dbKey).toBe("id");
  });
});
