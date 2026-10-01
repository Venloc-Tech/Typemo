import { describe, expect, test } from "bun:test";
import { MongoLifecycle } from "@venloc/typemo-test-kit";
import type { Document, IndexDescriptionInfo } from "mongodb";
import {
  BsonOptions,
  type CompiledSchema,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Index,
  IndexHelpers,
  Prop,
  Schema,
  SchemaCompiler,
  SchemaWalker,
} from "../../../src/internal.ts";
import { Person, Post } from "../../fixtures/schema-entities.ts";

/*
 * The compiled indexes are created on a real server (createIndexes) and read back (listIndexes): every
 * option reaches the server unchanged, and the server accepts what we build.
 */

const mongo = MongoLifecycle.useMongo("schema_indexes", BsonOptions.apply({}));

/**
 * Creates the indexes of a compiled schema and lists what the server stored.
 * @param schema The compiled schema.
 * @param name The collection name; the schema's own by default.
 * @returns The index descriptions the server returned.
 */
const createAndList = async (schema: CompiledSchema, name = schema.collection): Promise<IndexDescriptionInfo[]> => {
  const collection = mongo.db.collection(name);
  await collection.drop().catch(() => undefined);
  await mongo.db.createCollection(name);
  await collection.createIndexes(schema.indexes.map(IndexHelpers.toDescription));
  return (await collection.listIndexes().toArray()) as IndexDescriptionInfo[];
};

/**
 * Drops the default `_id` index from a listing.
 * @param indexes The listed indexes.
 * @returns The indexes without `_id_`.
 */
const withoutId = (indexes: readonly IndexDescriptionInfo[]): IndexDescriptionInfo[] =>
  indexes.filter((index) => index.name !== "_id_");

describe("createIndexes + listIndexes", () => {
  test("Person: partial unique, prefixed subdocument indexes, key order", async () => {
    const listed = withoutId(await createAndList(SchemaCompiler.compile(Person)));
    expect(listed.map((index) => [index.name, index.key])).toEqual([
      ["email_1", { email: 1 }],
      ["addresses.city_1", { "addresses.city": 1 }],
      ["addresses.city_1_addresses.zip_1", { "addresses.city": 1, "addresses.zip": 1 }],
    ]);
    expect(Object.keys(listed[2]?.key ?? {})).toEqual(["addresses.city", "addresses.zip"]);
    expect(listed[0]).toMatchObject({ unique: true, partialFilterExpression: { email: { $exists: true } } });
  });

  test("Post: merged text index with both fields, TTL, single field", async () => {
    const listed = withoutId(await createAndList(SchemaCompiler.compile(Post)));
    const text = listed.find((index) => index.key._fts === "text");
    expect(text?.weights).toEqual({ title: 1, body: 1 });
    expect(listed.find((index) => index.name === "expiresAt_1")?.expireAfterSeconds).toBe(3600);
    expect(listed.find((index) => index.name === "author_1")?.key).toEqual({ author: 1 });
  });

  test("a prefixed partial filter with $or / $and is accepted as is (Mongoose prefixed the operator itself)", async () => {
    @Index(
      { code: 1 },
      {
        unique: true,
        partialFilterExpression: {
          $or: [{ code: { $exists: true } }, { $and: [{ active: true }, { rank: { $gt: 1 } }] }],
        },
      },
    )
    @Schema()
    class Badge {
      @Prop(() => String) code?: string;
      @Prop(() => Boolean) active?: boolean;
      @Prop(() => Number) rank?: number;
    }
    @Schema({ collection: "badge_holders" })
    class Holder extends Entity {
      @Prop(() => Badge) badge?: Badge;
    }
    const listed = withoutId(await createAndList(SchemaCompiler.compile(Holder)));
    expect(listed[0]?.partialFilterExpression).toEqual({
      $or: [{ "badge.code": { $exists: true } }, { $and: [{ "badge.active": true }, { "badge.rank": { $gt: 1 } }] }],
    });
  });

  test("text weights, collation, hidden, hashed", async () => {
    @Index({ title: "text", body: "text" }, { weights: { title: 5 }, default_language: "english", name: "search" })
    @Index({ name: 1 }, { collation: { locale: "en", strength: 2 } })
    @Index({ legacy: 1 }, { hidden: true })
    @Schema({ collection: "misc_indexes" })
    class Misc extends Entity {
      @Prop(() => String) title?: string;
      @Prop(() => String) body?: string;
      @Prop(() => String) name?: string;
      @Prop(() => String) legacy?: string;
      @Prop(() => String, { index: "hashed" }) shard?: string;
    }
    const listed = withoutId(await createAndList(SchemaCompiler.compile(Misc)));
    const byName = new Map(listed.map((index) => [index.name, index]));
    expect(byName.get("search")?.weights).toEqual({ title: 5, body: 1 });
    expect(byName.get("name_1")?.collation).toMatchObject({ locale: "en", strength: 2 });
    expect(byName.get("legacy_1")?.hidden).toBe(true);
    expect(byName.get("shard_hashed")?.key).toEqual({ shard: "hashed" });
  });

  test("discriminator unique index is scoped to its documents (gh-6347)", async () => {
    @Schema({ discriminatorKey: "kind", collection: "animals_idx" })
    class Animal extends Entity {
      @Prop(() => String) kind!: string;
    }
    @Discriminator("dog")
    class Dog extends Animal {
      declare readonly kind: DiscriminatorValue<"dog">;
      @Prop(() => String, { unique: true, required: true }) chip!: string;
    }
    @Discriminator("cat")
    class Cat extends Animal {
      declare readonly kind: DiscriminatorValue<"cat">;
    }
    const root = SchemaCompiler.compile(Animal);
    await createAndList(root);
    const collection = mongo.db.collection(root.collection);
    const insert = async (target: CompiledSchema, input: Record<string, unknown>): Promise<void> => {
      await collection.insertOne(
        SchemaWalker.encodeDocument(target, SchemaWalker.castDocument(target, input)) as Document,
      );
    };
    await insert(SchemaCompiler.compile(Dog), { chip: "A" });
    await insert(SchemaCompiler.compile(Cat), {});
    await insert(SchemaCompiler.compile(Cat), {}); /* cats have no chip: not in the partial index */
    await expect(insert(SchemaCompiler.compile(Dog), { chip: "A" })).rejects.toMatchObject({ code: 11000 });
  });

  test("TTL (field option expires) reaches the server as expireAfterSeconds", async () => {
    @Schema({ collection: "sessions_ttl" })
    class Session extends Entity {
      @Prop(() => Date, { expires: 0 }) until?: Date;
    }
    const listed = withoutId(await createAndList(SchemaCompiler.compile(Session)));
    expect(listed[0]).toMatchObject({ key: { until: 1 }, expireAfterSeconds: 0 });
  });
});
