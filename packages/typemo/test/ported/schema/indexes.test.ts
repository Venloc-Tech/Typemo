/*
 * Ported from mongoose test/schema.test.js ("indexes") and test/model.indexes.test.js onto Typemo's
 * field options and @Index. Server checks use real createIndexes + listIndexes.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { ObjectId } from "mongodb";
import {
  BsonOptions,
  type CompiledSchema,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Index,
  IndexHelpers,
  MetadataBuilder,
  Prop,
  Schema,
  SchemaCompiler,
} from "../../../src/internal.ts";

const mongo = MongoLifecycle.useMongo("ported_indexes", BsonOptions.apply({}));

const listed = async (schema: CompiledSchema) => {
  const collection = mongo.db.collection(schema.collection);
  await collection.drop().catch(() => undefined);
  await mongo.db.createCollection(schema.collection);
  if (schema.indexes.length > 0) await collection.createIndexes(schema.indexes.map(IndexHelpers.toDescription));
  return collection.listIndexes().toArray();
};

const pairs = (schema: CompiledSchema) => schema.indexes.map((index) => [index.keys, index.options]);

describe("schema indexes (ported)", () => {
  // ported from mongoose test/schema.test.js:759 "basic"
  test("basic", () => {
    @Schema()
    class A extends Entity {
      @Prop(() => String, { index: true }) name?: string;
    }
    expect(pairs(SchemaCompiler.compile(A))).toEqual([[{ name: 1 }, {}]]);
    @Schema()
    class B extends Entity {
      @Prop(() => String, { unique: true, sparse: true }) name?: string;
      @Prop(() => Date, { expires: 200 }) at?: Date;
    }
    expect(pairs(SchemaCompiler.compile(B))).toEqual([
      [{ name: 1 }, { unique: true, sparse: true }],
      [{ at: 1 }, { expireAfterSeconds: 200 }],
    ]);
    // Mongoose also accepted `expires: '1.5m'` and `index: { unique, expires: '24h' }`: Typemo takes
    // seconds as a number only, and the index options of a field are flat (divergence L2-5).
  });

  // ported from mongoose test/schema.test.js:824 "compound"
  test("compound", () => {
    @Index({ firstname: 1, last: 1 }, { unique: true })
    @Index({ firstname: 1, nope: 1 }, { unique: true })
    @Schema()
    class Tobi extends Entity {
      @Prop(() => String, { index: true }) name?: string;
      @Prop(() => Number, { sparse: true, index: true }) last?: number;
      @Prop(() => String, { index: true }) nope?: string;
      @Prop(() => String) firstname?: string;
    }
    expect(pairs(SchemaCompiler.compile(Tobi))).toEqual([
      [{ name: 1 }, {}],
      [{ last: 1 }, { sparse: true }],
      [{ nope: 1 }, {}],
      [{ firstname: 1, last: 1 }, { unique: true }],
      [{ firstname: 1, nope: 1 }, { unique: true }],
    ]);
  });

  // ported from mongoose test/schema.test.js:846 "compound based on name (gh-6499)"
  test("compound based on name (gh-6499) — divergence L2-5: a compound index is an @Index, not field options sharing a name", () => {
    @Index({ prop1: 1, prop3: 1 }, { name: "test1" })
    @Schema()
    class Named extends Entity {
      @Prop(() => String) prop1?: string;
      @Prop(() => Number, { index: true }) prop2?: number;
      @Prop(() => String) prop3?: string;
    }
    expect(SchemaCompiler.compile(Named).indexes.map((index) => index.keys)).toEqual([
      { prop2: 1 },
      { prop1: 1, prop3: 1 },
    ]);
  });

  // ported from mongoose test/schema.test.js:859 "using \"ascending\" and \"descending\" for order (gh-13725)"
  test("using ascending and descending for order (gh-13725) — divergence L2-5: directions are 1 / -1 only (H309)", () => {
    class Words {}
    MetadataBuilder.for(Words).addField("prop1", () => String, { index: "ascending" });
    MetadataBuilder.for(Words).setSchema({});
    expect(() => SchemaCompiler.compile(Words)).toThrow(/"index" must be true, 1, -1 or "hashed"/);
  });

  // ported from mongoose test/schema.test.js:874 "with single nested doc (gh-6113)"
  test("with single nested doc (gh-6113)", () => {
    @Schema()
    class Point {
      @Prop(() => String) type?: string;
      @Prop(() => [[Number]]) coordinates?: number[][];
    }
    @Index({ point: "2dsphere" })
    @Schema()
    class Holder extends Entity {
      @Prop(() => Point) point?: Point;
    }
    expect(pairs(SchemaCompiler.compile(Holder))).toEqual([[{ point: "2dsphere" }, {}]]);
  });

  // ported from mongoose test/schema.test.js:893 "with embedded discriminator (gh-6485)"
  test("with embedded discriminator (gh-6485)", () => {
    @Schema({ discriminatorKey: "kind" })
    class EventDoc {
      @Prop(() => String) kind!: string;
      @Prop(() => String, { index: true }) message?: string;
    }
    @Discriminator("gh6485_Clicked")
    class Clicked extends EventDoc {
      declare readonly kind: DiscriminatorValue<"gh6485_Clicked">;
      @Prop(() => String, { index: true }) element?: string;
    }
    @Discriminator("gh6485_Purchased")
    class Purchased extends EventDoc {
      declare readonly kind: DiscriminatorValue<"gh6485_Purchased">;
      @Prop(() => String, { index: true }) product?: string;
    }
    @Schema()
    class Batch extends Entity {
      @Prop(() => [EventDoc]) events?: EventDoc[];
    }
    expect(SchemaCompiler.compile(Batch).indexes.map((index) => [index.keys, index.options])).toEqual([
      [{ "events.message": 1 }, {}],
      [{ "events.element": 1 }, { partialFilterExpression: { "events.kind": "gh6485_Clicked" } }],
      [{ "events.product": 1 }, { partialFilterExpression: { "events.kind": "gh6485_Purchased" } }],
    ]);
    void Clicked;
    void Purchased;
  });
});

describe("model indexes (ported)", () => {
  // ported from mongoose test/model.indexes.test.js:36 "are created when model is compiled"
  test("are created when model is compiled", async () => {
    @Index({ last: 1, email: 1 }, { unique: true })
    @Index({ date: 1 }, { expireAfterSeconds: 10 })
    @Schema({ collection: "indexed" })
    class Indexed extends Entity {
      @Prop(() => String, { index: true }) name?: string;
      @Prop(() => String) last?: string;
      @Prop(() => String) email?: string;
      @Prop(() => Date) date?: Date;
    }
    const indexes = await listed(SchemaCompiler.compile(Indexed));
    expect(indexes.map((index) => index.name).sort()).toEqual(["_id_", "date_1", "last_1_email_1", "name_1"]);
    expect(indexes.find((index) => index.name === "date_1")?.expireAfterSeconds).toBe(10);
  });

  // ported from mongoose test/model.indexes.test.js:71 "of embedded documents"
  test("of embedded documents", async () => {
    @Schema()
    class BlogPost {
      @Prop(() => ObjectId, { index: true }) _id?: ObjectId;
      @Prop(() => String, { index: true }) title?: string;
      @Prop(() => String) desc?: string;
    }
    @Schema({ collection: "embedded_users" })
    class User extends Entity {
      @Prop(() => String, { index: true }) name?: string;
      @Prop(() => [BlogPost]) blogposts?: BlogPost[];
    }
    const names = (await listed(SchemaCompiler.compile(User))).map((index) => Object.keys(index.key)[0]);
    expect(names).toEqual(["_id", "name", "blogposts._id", "blogposts.title"]);
  });

  // ported from mongoose test/model.indexes.test.js:107 "of embedded documents unless excludeIndexes (gh-5575) (gh-8343)"
  test("of embedded documents unless excludeIndexes (gh-5575) (gh-8343)", async () => {
    @Schema()
    class BlogPost {
      @Prop(() => String, { index: true }) title?: string;
    }
    @Schema({ collection: "excluded_users" })
    class User extends Entity {
      @Prop(() => String, { index: true }) name?: string;
      @Prop(() => [BlogPost], { excludeIndexes: true }) blogposts?: BlogPost[];
      @Prop(() => BlogPost, { excludeIndexes: true }) blogpost?: BlogPost;
    }
    expect((await listed(SchemaCompiler.compile(User))).map((index) => index.name).sort()).toEqual(["_id_", "name_1"]);
  });

  // ported from mongoose test/model.indexes.test.js:141 "of multiple embedded documents with same schema"
  test("of multiple embedded documents with same schema", () => {
    @Schema()
    class BlogPosts {
      @Prop(() => ObjectId, { unique: true, required: true }) _id!: ObjectId;
      @Prop(() => String, { index: true }) title?: string;
    }
    @Schema()
    class User extends Entity {
      @Prop(() => String, { index: true }) name?: string;
      @Prop(() => [BlogPosts]) blogposts?: BlogPosts[];
      @Prop(() => [BlogPosts]) featured?: BlogPosts[];
    }
    expect(SchemaCompiler.compile(User).indexes.map((index) => Object.keys(index.keys)[0])).toEqual([
      "name",
      "blogposts._id",
      "blogposts.title",
      "featured._id",
      "featured.title",
    ]);
  });

  // ported from mongoose test/model.indexes.test.js:186 "compound: on embedded docs"
  test("compound: on embedded docs", async () => {
    @Index({ title: 1, desc: 1 })
    @Schema()
    class BlogPosts {
      @Prop(() => String) title?: string;
      @Prop(() => String) desc?: string;
    }
    @Schema({ collection: "compound_embedded" })
    class User extends Entity {
      @Prop(() => String, { index: true }) name?: string;
      @Prop(() => [BlogPosts]) blogposts?: BlogPosts[];
    }
    const names = (await listed(SchemaCompiler.compile(User))).map((index) => index.name);
    expect(names).toContain("name_1");
    expect(names).toContain("blogposts.title_1_blogposts.desc_1");
  });

  // ported from mongoose test/model.indexes.test.js:218 "nested embedded docs (gh-5199)"
  test("nested embedded docs (gh-5199)", () => {
    @Index({ nested2: 1 })
    @Schema()
    class SubSub {
      @Prop(() => String) nested2?: string;
    }
    @Index({ nested1: 1 })
    @Schema()
    class Sub {
      @Prop(() => String) nested1?: string;
      @Prop(() => SubSub) subSub?: SubSub;
    }
    @Index({ nested0: 1 })
    @Schema()
    class Container extends Entity {
      @Prop(() => String) nested0?: string;
      @Prop(() => Sub) sub?: Sub;
    }
    // Order: the class's own indexes, then its subdocuments' (Mongoose listed the subdocuments first).
    expect(SchemaCompiler.compile(Container).indexes.map((index) => index.keys)).toEqual([
      { nested0: 1 },
      { "sub.nested1": 1 },
      { "sub.subSub.nested2": 1 },
    ]);
  });

  // ported from mongoose test/model.indexes.test.js:246 "primitive arrays (gh-3347)"
  test("primitive arrays (gh-3347)", () => {
    @Schema()
    class Arr extends Entity {
      @Prop(() => [String], { unique: true, required: true }) arr!: string[];
    }
    expect(pairs(SchemaCompiler.compile(Arr))).toEqual([[{ arr: 1 }, { unique: true }]]);
  });

  // ported from mongoose test/model.indexes.test.js:316 "creates descending indexes from schema definition(gh-8895)"
  test("creates descending indexes from schema definition (gh-8895)", async () => {
    @Schema({ collection: "descending" })
    class User extends Entity {
      @Prop(() => String, { index: -1 }) name?: string;
      @Prop(() => String, { index: -1 }) address?: string;
    }
    const names = (await listed(SchemaCompiler.compile(User))).map((index) => index.name);
    expect(names).toContain("name_-1");
    expect(names).toContain("address_-1");
  });

  // ported from mongoose test/model.indexes.test.js:419 "sets correct partialFilterExpression for document array (gh-9091)"
  test("sets correct partialFilterExpression for document array (gh-9091)", async () => {
    @Index({ name: 1 }, { partialFilterExpression: { name: { $exists: true } } })
    @Schema()
    class Child {
      @Prop(() => String) name?: string;
    }
    @Schema({ collection: "gh9091" })
    class Parent extends Entity {
      @Prop(() => [Child]) arr?: Child[];
    }
    const indexes = await listed(SchemaCompiler.compile(Parent));
    expect(indexes.length).toBe(2);
    expect(indexes[1]?.partialFilterExpression).toEqual({ "arr.name": { $exists: true } });
  });

  // ported from mongoose test/model.indexes.test.js:461 "converts to partial unique index (gh-6347)"
  test("converts to partial unique index (gh-6347)", async () => {
    @Schema({ discriminatorKey: "kind", collection: "gh6347" })
    class Base extends Entity {
      @Prop(() => String) kind!: string;
    }
    @Discriminator("User")
    class User extends Base {
      declare readonly kind: DiscriminatorValue<"User">;
      @Prop(() => String, { unique: true, required: true }) emailId!: string;
      @Prop(() => String) firstName?: string;
    }
    @Discriminator("Device")
    class Device extends Base {
      declare readonly kind: DiscriminatorValue<"Device">;
      @Prop(() => String, { unique: true, required: true }) name!: string;
      @Prop(() => String, { index: true }) other?: string;
      @Prop(() => String) model?: string;
    }
    const indexes = await listed(SchemaCompiler.compile(Base));
    const index = indexes.find((candidate) => candidate.key.other !== undefined);
    expect(index?.key).toEqual({ other: 1 });
    expect(index?.partialFilterExpression).toEqual({ kind: "Device" });
    void User;
    void Device;
  });

  // ported from mongoose test/model.indexes.test.js:514 "uses schema-level collation by default (gh-9912)"
  test("uses schema-level collation by default (gh-9912) — divergence L2-6: the collection's default collation applies, not a copy on each index", async () => {
    @Index({ username: 1 }, { unique: true })
    @Schema({ collection: "gh9912", collation: { locale: "en", strength: 2 } })
    class User extends Entity {
      @Prop(() => String) username?: string;
    }
    const schema = SchemaCompiler.compile(User);
    expect(schema.indexes[0]?.options.collation).toBeUndefined();
    // Created with the collection's collation (the collection is created first), the index inherits it.
    const collection = mongo.db.collection(schema.collection);
    await collection.drop().catch(() => undefined);
    await mongo.db.createCollection(schema.collection, { collation: schema.options.collation ?? { locale: "simple" } });
    await collection.createIndexes(schema.indexes.map(IndexHelpers.toDescription));
    const indexes = await collection.listIndexes().toArray();
    expect(indexes[1]?.collation?.strength).toBe(2);
  });
});
