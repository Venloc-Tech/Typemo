import { describe, expect, test } from "bun:test";
import { Entity, JsonSchemaGenerator, Prop, Schema, SchemaCompiler, Spec } from "../../../src/internal.ts";
import { Person, Shape } from "../../fixtures/schema-entities.ts";

/* CompiledSchema → $jsonSchema (bsonType). The server-side behavior is in runtime/schema. */

describe("JsonSchemaGenerator", () => {
  test("snapshot of the fixture", () => {
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(Person))).toMatchSnapshot();
  });

  test("types, nullability only where declared, required from the option and _id, strict objects", () => {
    @Schema()
    class Doc extends Entity {
      @Prop(() => String, { required: true, minLength: 1, maxLength: 3, match: /^a/ }) code!: string;
      @Prop(() => String, { nullable: true, enum: ["x", "y"] }) choice!: "x" | "y" | null;
      @Prop(() => Number, { min: 0, max: 9 }) digit?: number;
      @Prop(() => [String], { enum: ["a", "b"] }) letters?: ("a" | "b")[];
      @Prop(() => Spec.map(BigInt)) counters?: Map<string, bigint>;
      @Prop(() => String, { match: /x/i }) caseless?: string;
      @Prop(() => String, { dbName: "n" }) name?: string;
    }
    expect(JsonSchemaGenerator.generate(SchemaCompiler.compile(Doc))).toEqual({
      bsonType: "object",
      properties: {
        _id: { bsonType: "objectId" },
        code: { bsonType: "string", minLength: 1, maxLength: 3, pattern: "^a" },
        choice: { bsonType: ["string", "null"], enum: ["x", "y", null] },
        digit: { bsonType: ["int", "double", "long"], minimum: 0, maximum: 9 },
        letters: { bsonType: "array", items: { bsonType: "string", enum: ["a", "b"] } } /* enum on elements */,
        counters: { bsonType: "object", additionalProperties: { bsonType: "long" } },
        caseless: { bsonType: "string" }, // a flagged RegExp cannot be a JSON Schema pattern
        n: { bsonType: "string" }, // database names
      },
      required: ["_id", "code"],
      additionalProperties: false,
    });
  });

  test("discriminators: oneOf over the root (no key) and each discriminator (key = its value)", () => {
    const schema = JsonSchemaGenerator.generate(SchemaCompiler.compile(Shape));
    expect(schema.oneOf?.length).toBe(3);
    expect(schema.oneOf?.[0]?.properties?.kind).toBeUndefined();
    expect(schema.oneOf?.[1]?.properties?.kind).toEqual({ bsonType: "string", enum: ["circle"] });
    expect(schema.oneOf?.[1]?.required).toEqual(["kind", "radius"]);
  });

  test("validator options default to strict / error", () => {
    @Schema({ validator: { validationAction: "warn" } })
    class Warned extends Entity {}
    expect(JsonSchemaGenerator.validator(SchemaCompiler.compile(Warned))).toMatchObject({
      validationLevel: "strict",
      validationAction: "warn",
    });
  });
});
