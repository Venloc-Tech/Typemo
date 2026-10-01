import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import { Decimal128, type Document, ObjectId } from "mongodb";
import {
  BsonOptions,
  type CompiledSchema,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  JsonSchemaGenerator,
  Prop,
  Schema,
  SchemaCompiler,
  SchemaWalker,
} from "../../../src/internal.ts";
import { Person } from "../../fixtures/schema-entities.ts";

/*
 * The generated $jsonSchema, installed as a collection validator on a real server,
 * accepts documents written through the schema and REJECTS bad documents written around it.
 */

const mongo = MongoLifecycle.useMongo("schema_json", BsonOptions.apply({}));
/** The server error code of a document that fails collection validation. */
const DOCUMENT_FAILED_VALIDATION = 121;

/**
 * Recreates a collection with the validator generated from a schema.
 * @param schema The compiled schema.
 * @param name The collection name.
 * @returns The new collection.
 */
const collectionFor = async (schema: CompiledSchema, name: string) => {
  await mongo.db
    .collection(name)
    .drop()
    .catch(() => undefined);
  const { validator, validationLevel, validationAction } = JsonSchemaGenerator.validator(schema);
  await mongo.db.createCollection(name, { validator, validationLevel, validationAction });
  return mongo.db.collection(name);
};

/**
 * Casts and encodes an input the way a save does.
 * @param schema The compiled schema.
 * @param input The plain input.
 * @returns The stored form.
 */
const encode = (schema: CompiledSchema, input: Record<string, unknown>): Document =>
  SchemaWalker.encodeDocument(schema, SchemaWalker.castDocument(schema, input)) as Document;

/**
 * A valid person input that uses every kind of field.
 * @returns The plain input.
 */
const personInput = (): Record<string, unknown> => ({
  _id: new ObjectId(),
  name: { first: "Ann", last: "Lee" },
  age: 30,
  role: "admin",
  tags: ["a"],
  addresses: [{ city: "Oslo", zip: null }],
  scores: { math: 5 },
  manager: null,
  balance: "10.50",
  visits: 3n,
  shapes: [{ kind: "circle", radius: 1 }, { kind: "square", side: 2 }, { label: "plain" }],
});

describe("$jsonSchema on the server", () => {
  test("a document written through the schema is accepted", async () => {
    const schema = SchemaCompiler.compile(Person);
    const people = await collectionFor(schema, "people_valid");
    await people.insertOne(encode(schema, personInput()));
    expect(await people.countDocuments()).toBe(1);
  });

  const CORRUPTIONS: readonly (readonly [string, (doc: Document) => Document])[] = [
    ["an unknown field (strict, D8)", (doc: Document) => ({ ...doc, extra: 1 })],
    ["a missing required nested field", (doc: Document) => ({ ...doc, name: { last: "x" } })],
    ["a wrong type", (doc: Document) => ({ ...doc, age: "30" })],
    ["a value outside the enum", (doc: Document) => ({ ...doc, role: "root" })],
    ["a number below the minimum", (doc: Document) => ({ ...doc, age: -1 })],
    ["null on a non-nullable path", (doc: Document) => ({ ...doc, email: null })],
    ["a wrong element type in an array", (doc: Document) => ({ ...doc, tags: [1] })],
    ["a wrong map value type", (doc: Document) => ({ ...doc, scores: { math: "five" } })],
    ["a decimal stored as a string", (doc: Document) => ({ ...doc, balance: "10.50" })],
    [
      "a subdocument with an unknown field",
      (doc: Document) => ({ ...doc, addresses: [{ city: "x", zip: null, extra: 1 }] }),
    ],
    [
      "a discriminator variant with the other's field",
      (doc: Document) => ({ ...doc, shapes: [{ kind: "circle", side: 1 }] }),
    ],
    ["an unknown discriminator value", (doc: Document) => ({ ...doc, shapes: [{ kind: "triangle" }] })],
    ["no _id type (a string id)", (doc: Document) => ({ ...doc, _id: "x" })],
  ];

  test.each(CORRUPTIONS)("rejects %s (code 121)", async (_name, corrupt) => {
    const schema = SchemaCompiler.compile(Person);
    const people = await collectionFor(schema, "people_invalid");
    const good = encode(schema, personInput());
    await expect(people.insertOne(corrupt(good))).rejects.toMatchObject({ code: DOCUMENT_FAILED_VALIDATION });
  });

  test("a discriminated root collection: each variant by its key, the root without a key", async () => {
    @Schema({ discriminatorKey: "kind", collection: "figures" })
    class Figure extends Entity {
      @Prop(() => String) kind!: string;
      @Prop(() => String) label?: string;
    }
    @Discriminator("circle")
    class Round extends Figure {
      declare readonly kind: DiscriminatorValue<"circle">;
      @Prop(() => Number, { required: true }) radius!: number;
    }
    @Discriminator("square")
    class Boxy extends Figure {
      declare readonly kind: DiscriminatorValue<"square">;
      @Prop(() => Number, { required: true }) side!: number;
    }
    const schema = SchemaCompiler.compile(Figure);
    const shapes = await collectionFor(schema, "shapes_valid");
    await shapes.insertOne(encode(SchemaCompiler.compile(Round), { _id: new ObjectId(), radius: 2 }));
    await shapes.insertOne(encode(SchemaCompiler.compile(Boxy), { _id: new ObjectId(), side: 2 }));
    await shapes.insertOne({ _id: new ObjectId(), label: "root" });
    await expect(shapes.insertOne({ kind: "circle" })).rejects.toMatchObject({ code: DOCUMENT_FAILED_VALIDATION });
    await expect(shapes.insertOne({ kind: "square", radius: 1, side: 1 })).rejects.toMatchObject({
      code: DOCUMENT_FAILED_VALIDATION,
    });
    await expect(shapes.insertOne({ _id: new ObjectId(), kind: "triangle" })).rejects.toMatchObject({
      code: DOCUMENT_FAILED_VALIDATION,
    });
    expect(await shapes.countDocuments()).toBe(3);
  });

  test("Decimal128 and int64 pass as their BSON types", async () => {
    const schema = SchemaCompiler.compile(Person);
    const people = await collectionFor(schema, "people_bson");
    const doc = encode(schema, { ...personInput(), balance: Decimal128.fromString("1"), visits: 2n ** 40n });
    await people.insertOne(doc);
    const read = await people.findOne({});
    expect(read?.visits).toBe(2n ** 40n);
  });
});
