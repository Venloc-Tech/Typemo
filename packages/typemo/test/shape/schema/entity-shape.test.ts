import { describe, expect, test } from "bun:test";
import { expectShapeMatches, MongoLifecycle, ShapeCompare } from "@venloc/typemo-test-kit";
import { type Document, ObjectId } from "mongodb";
import { BsonOptions, SchemaCompiler, SchemaWalker, StandardSchema } from "../../../src/internal.ts";
import { Person } from "../../fixtures/schema-entities.ts";

/*
 * The entity type (its stored data: `DataKeys`, through `LeanValue`) is compared with the shape of a document
 * written through the compiled schema and read back from the server.
 */

const mongo = MongoLifecycle.useMongo("schema_shape", BsonOptions.apply({}));
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;

const SOURCE = `
import type { DataKeys, LeanValue } from "@venloc/typemo";
import type { Person } from "./schema-entities.ts";
export type Stored = LeanValue<Pick<Person, DataKeys<Person>>>;
`;

/** Validates `input` by the compiled schema, stores it, and returns the document read back. */
const writeAndRead = async (input: Record<string, unknown>): Promise<Document | null> => {
  const schema = SchemaCompiler.compile(Person);
  const result = await StandardSchema.of(schema)["~standard"].validate(input);
  if (result.issues !== undefined) throw new Error(JSON.stringify(result.issues));
  const collection = mongo.db.collection(schema.collection);
  const encoded = SchemaWalker.encodeDocument(schema, result.value as Record<string, unknown>);
  await collection.insertOne(encoded as Document);
  return collection.findOne({ _id: encoded._id as ObjectId });
};

const FULL = {
  /* Filled by the document layer on save; here by hand. */
  createdAt: new Date("2020-01-01T00:00:00Z"),
  updatedAt: new Date("2020-01-02T00:00:00Z"),
  __v: 0,
  name: { first: "Ann", last: "Lee" },
  email: "ann@example.com",
  addresses: [{ city: "Oslo", zip: null }],
  scores: { math: 5 },
  manager: new ObjectId(),
  externalId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  balance: "10.50",
  visits: 3n,
  passwordHash: "x",
  shapes: [],
};

describe("shape: entity type vs stored document", () => {
  test("a full document matches the type both ways (defaults filled by the schema)", async () => {
    expectShapeMatches({ code: SOURCE, type: "Stored", dir: FIXTURES }, await writeAndRead(FULL));
  });

  test("a minimal document matches too: optional fields are absent, defaulted ones present", async () => {
    const read = await writeAndRead({
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
      name: { first: "B" },
      manager: null,
    });
    expect(read?.age).toBe(0);
    expect(read?.role).toBe("user");
    expect(read?.tags).toEqual([]);
    expectShapeMatches({ code: SOURCE, type: "Stored", dir: FIXTURES }, read);
  });

  test("an embedded discriminator's fields are in the field type `(Circle | Square)[]`", async () => {
    /* `@Prop(() => [Shape]) shapes?: (Circle | Square)[]`: the stored subclass fields match the type. */
    const read = await writeAndRead({
      ...FULL,
      shapes: [
        { kind: "circle", radius: 1 },
        { kind: "square", side: 2 },
      ],
    });
    const check = ShapeCompare.check({ code: SOURCE, type: "Stored", dir: FIXTURES }, read);
    expect(check.mismatches).toEqual([]);
  });

  test("negative: a document missing a required-by-type field does not match", async () => {
    const read = await writeAndRead({
      createdAt: new Date(),
      updatedAt: new Date(),
      name: { first: "C" },
      manager: null,
    });
    const check = ShapeCompare.check({ code: SOURCE, type: "Stored", dir: FIXTURES }, read);
    expect(check.ok).toBe(false);
    expect(check.mismatches.map((mismatch) => mismatch.path)).toEqual(["$.__v"]);
  });
});
