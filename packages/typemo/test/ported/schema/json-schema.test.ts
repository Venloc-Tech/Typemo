/*
 * Ported from mongoose test/schema.test.js "jsonSchema() (gh-11162)" onto JsonSchemaGenerator.
 * Divergences (L2-8): no "null" unless the path is nullable, `additionalProperties: false` (strict),
 * the `number` alias is spelled int/double/long, no function `required`, no Mixed, no Ajv JSON variant.
 */
import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { type Binary, Decimal128, ObjectId, UUID } from "mongodb";
import {
  BsonOptions,
  Entity,
  JsonSchemaGenerator,
  Prop,
  Schema,
  SchemaCompiler,
  Spec,
  Types,
} from "../../../src/internal.ts";

const mongo = MongoLifecycle.useMongo("ported_json", BsonOptions.apply({}));
const NUMBER = ["int", "double", "long"];

const install = async (target: Parameters<typeof SchemaCompiler.compile>[0], name: string) => {
  await mongo.db
    .collection(name)
    .drop()
    .catch(() => undefined);
  const { validator } = JsonSchemaGenerator.validator(SchemaCompiler.compile(target));
  await mongo.db.createCollection(name, { validator });
  return mongo.db.collection(name);
};

describe("jsonSchema() (ported)", () => {
  // ported from mongoose test/schema.test.js:3749 "handles basic example with only top-level keys"
  test("handles basic example with only top-level keys", async () => {
    @Schema()
    class Basic extends Entity {
      @Prop(() => String, { required: true }) name!: string;
      @Prop(() => Number, { nullable: true }) age!: number | null;
      @Prop(() => String, { nullable: true, enum: ["document", "self-reported"] }) ageSource!:
        | "document"
        | "self-reported"
        | null;
    }
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(Basic))).toEqual({
      bsonType: "object",
      required: ["_id", "name"],
      properties: {
        _id: { bsonType: "objectId" },
        name: { bsonType: "string" },
        age: { bsonType: [...NUMBER, "null"] },
        ageSource: { bsonType: ["string", "null"], enum: ["document", "self-reported", null] },
      },
      additionalProperties: false,
    });
    const collection = await install(Basic, "gh11162");
    await collection.insertOne({ name: "Taco" });
    await collection.insertOne({ name: "Billy", age: null, ageSource: null });
    await collection.insertOne({ name: "John", age: 30, ageSource: "document" });
    await expect(
      collection.insertOne({ name: "Foobar", age: null, ageSource: "something else" }),
    ).rejects.toMatchObject({ code: 121 });
    await expect(collection.insertOne({})).rejects.toMatchObject({ code: 121 });
  });

  // ported from mongoose test/schema.test.js:3937 "handles all primitive data types"
  test("handles all primitive data types", async () => {
    @Schema()
    class Primitives extends Entity {
      @Prop(() => Number) num?: number;
      @Prop(() => String) str?: string;
      @Prop(() => Boolean) bool?: boolean;
      @Prop(() => Date) date?: Date;
      @Prop(() => ObjectId) id?: ObjectId;
      @Prop(() => Decimal128) decimal?: Decimal128;
      @Prop(() => Types.Binary) buf?: Binary;
      @Prop(() => UUID) uuid?: UUID;
      @Prop(() => BigInt) bigint?: bigint;
      @Prop(() => Types.Double) double?: number;
      @Prop(() => Types.Int32) int32?: number;
    }
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(Primitives)).properties).toEqual({
      _id: { bsonType: "objectId" },
      num: { bsonType: NUMBER },
      str: { bsonType: "string" },
      bool: { bsonType: "bool" },
      date: { bsonType: "date" },
      id: { bsonType: "objectId" },
      decimal: { bsonType: "decimal" },
      buf: { bsonType: "binData" },
      uuid: { bsonType: "binData" },
      bigint: { bsonType: "long" },
      double: { bsonType: "double" },
      int32: { bsonType: "int" },
    });
    const collection = await install(Primitives, "gh11162_primitives");
    await collection.insertOne({ num: 1, str: "x", bool: true, date: new Date(), bigint: 1n, uuid: new UUID() });
    await expect(collection.insertOne({ bigint: "1" })).rejects.toMatchObject({ code: 121 });
  });

  // ported from mongoose test/schema.test.js:4040 "handles arrays and document arrays"
  test("handles arrays and document arrays", () => {
    @Schema()
    class Field {
      @Prop(() => Date) field?: Date;
    }
    @Schema()
    class Arrays extends Entity {
      @Prop(() => [String]) tags?: string[];
      @Prop(() => [[Number]]) coordinates?: number[][];
      @Prop(() => [Field]) docArr?: Field[];
    }
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(Arrays)).properties).toEqual({
      _id: { bsonType: "objectId" },
      tags: { bsonType: "array", items: { bsonType: "string" } },
      coordinates: { bsonType: "array", items: { bsonType: "array", items: { bsonType: NUMBER } } },
      docArr: {
        bsonType: "array",
        items: { bsonType: "object", properties: { field: { bsonType: "date" } }, additionalProperties: false },
      },
    });
  });

  // ported from mongoose test/schema.test.js:4097 "handles nested paths and subdocuments"
  test("handles nested paths and subdocuments", () => {
    @Schema({ nested: true })
    class Name {
      @Prop(() => String) first?: string;
      @Prop(() => String, { required: true }) last!: string;
    }
    @Schema()
    class Sub {
      @Prop(() => Number) prop?: number;
    }
    @Schema()
    class Nested extends Entity {
      @Prop(() => Name) name?: Name;
      @Prop(() => Sub) subdoc?: Sub;
    }
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(Nested)).properties).toEqual({
      _id: { bsonType: "objectId" },
      name: {
        bsonType: "object",
        required: ["last"],
        properties: { first: { bsonType: "string" }, last: { bsonType: "string" } },
        additionalProperties: false,
      },
      subdoc: { bsonType: "object", properties: { prop: { bsonType: NUMBER } }, additionalProperties: false },
    });
  });

  // ported from mongoose test/schema.test.js:4172 "handles maps"
  test("handles maps", async () => {
    @Schema()
    class Maps extends Entity {
      @Prop(() => Spec.map(String)) props?: Map<string, string>;
    }
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(Maps)).properties?.props).toEqual({
      bsonType: "object",
      additionalProperties: { bsonType: "string" },
    });
    const collection = await install(Maps, "gh11162_maps");
    await collection.insertOne({ props: { a: "b" } });
    await expect(collection.insertOne({ props: { a: 1 } })).rejects.toMatchObject({ code: 121 });
  });

  // ported from mongoose test/schema.test.js:4378 "handles required enums"
  test("handles required enums", () => {
    @Schema()
    class Racoon extends Entity {
      @Prop(() => String, { enum: ["Edwald", "Tobi"], required: true }) name!: "Edwald" | "Tobi";
    }
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(Racoon))).toEqual({
      bsonType: "object",
      required: ["_id", "name"],
      properties: { _id: { bsonType: "objectId" }, name: { bsonType: "string", enum: ["Edwald", "Tobi"] } },
      additionalProperties: false,
    });
  });

  // ported from mongoose test/schema.test.js:4438 "puts enums on array elements rather than on the array (gh-16443)"
  test("puts enums on array elements rather than on the array (gh-16443)", () => {
    @Schema()
    class Tags extends Entity {
      @Prop(() => [String], { enum: ["funny", "sad"] }) tags?: ("funny" | "sad")[];
      @Prop(() => [Number], { enum: [1, 2] }) scores?: (1 | 2)[];
    }
    const properties = JsonSchemaGenerator.generate(SchemaCompiler.compile(Tags)).properties;
    expect(properties?.tags).toEqual({ bsonType: "array", items: { bsonType: "string", enum: ["funny", "sad"] } });
    expect(properties?.scores).toEqual({ bsonType: "array", items: { bsonType: NUMBER, enum: [1, 2] } });
  });

  // ported from mongoose test/schema.test.js:4497 "supports enums declared as an object or set with enum() (gh-16443)"
  test("supports enums declared as an object (gh-16443)", async () => {
    enum Status {
      On = "on",
      Off = "off",
    }
    enum Level {
      One = 1,
      Two = 2,
    }
    @Schema()
    class Enums extends Entity {
      @Prop(() => String, { enum: Status, nullable: true }) status!: Status | null;
      @Prop(() => Number, { required: true, enum: Level }) level!: Level;
    }
    const properties = JsonSchemaGenerator.generate(SchemaCompiler.compile(Enums)).properties;
    expect(properties?.status).toEqual({ bsonType: ["string", "null"], enum: ["on", "off", null] });
    expect(properties?.level).toEqual({ bsonType: NUMBER, enum: [1, 2] });
    const collection = await install(Enums, "gh16443");
    await collection.insertOne({ level: 1, status: null });
    await expect(collection.insertOne({ level: 1, status: "maybe" })).rejects.toMatchObject({ code: 121 });
    await expect(collection.insertOne({ level: 3 })).rejects.toMatchObject({ code: 121 });
  });
});
