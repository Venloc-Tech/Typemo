import { describe, expect, test } from "bun:test";
import {
  Discriminator,
  type DiscriminatorValue,
  Entity,
  Index,
  IndexHelpers,
  Prop,
  Schema,
  SchemaCompiler,
} from "../../../src/internal.ts";
import { Person } from "../../fixtures/schema-entities.ts";

/*
 * Field-level and @Index indexes, subdocument prefixing without breaking $or/$and (a Mongoose bug), text merge,
 * TTL, discriminator scoping.
 */

const keysOf = (target: Parameters<typeof SchemaCompiler.compile>[0]) =>
  SchemaCompiler.compile(target).indexes.map((index) => [Object.keys(index.keys).join(","), index.options]);

describe("IndexHelpers", () => {
  test("mapFilter prefixes fields, never operators, and walks $and/$or", () => {
    const filter = { $or: [{ a: { $exists: true } }, { $and: [{ b: 1 }, { c: { $gt: 2 } }] }], d: 5 };
    expect(IndexHelpers.mapFilter(filter, IndexHelpers.prefix("sub"))).toEqual({
      $or: [{ "sub.a": { $exists: true } }, { $and: [{ "sub.b": 1 }, { "sub.c": { $gt: 2 } }] }],
      "sub.d": 5,
    });
    expect(IndexHelpers.filterPaths(filter)).toEqual(["a", "b", "c", "d"]);
  });

  test("the server's default name, key order kept", () => {
    expect(IndexHelpers.defaultName({ b: 1, a: -1 })).toBe("b_1_a_-1");
    expect(IndexHelpers.defaultName({ title: "text" })).toBe("title_text");
    expect(IndexHelpers.sameKeys({ a: 1, b: 1 }, { b: 1, a: 1 })).toBe(false); /* order matters */
  });

  test("scopeToDiscriminator combines an existing partial filter with $and", () => {
    expect(IndexHelpers.scopeToDiscriminator({ unique: true }, "kind", "a")).toEqual({
      unique: true,
      partialFilterExpression: { kind: "a" },
    });
    expect(IndexHelpers.scopeToDiscriminator({ partialFilterExpression: { x: 1 } }, "kind", "a")).toEqual({
      partialFilterExpression: { $and: [{ kind: "a" }, { x: 1 }] },
    });
  });

  test("toDescription is the driver's createIndexes form", () => {
    expect(
      IndexHelpers.toDescription({
        keys: { a: 1 },
        options: { unique: true, name: "u" },
        source: "class",
        owner: Person,
      }),
    ).toEqual({
      key: { a: 1 },
      unique: true,
      name: "u",
    });
  });
});

describe("compiled indexes", () => {
  test("field options: index, unique (+required), sparse, expires, hashed", () => {
    @Schema()
    class Fields extends Entity {
      @Prop(() => String, { index: true }) a?: string;
      @Prop(() => String, { unique: true, required: true }) b!: string;
      @Prop(() => String, { unique: true, sparse: true }) c?: string;
      @Prop(() => Date, { expires: 60 }) d?: Date;
      @Prop(() => String, { index: "hashed" }) e?: string;
      @Prop(() => Number, { index: -1 }) f?: number;
    }
    expect(keysOf(Fields)).toEqual([
      ["a", {}],
      ["b", { unique: true }],
      ["c", { unique: true, sparse: true }],
      ["d", { expireAfterSeconds: 60 }],
      ["e", {}],
      ["f", {}],
    ]);
    expect(SchemaCompiler.compile(Fields).indexes[4]?.keys).toEqual({ e: "hashed" });
  });

  test("text: true on several fields → ONE text index", () => {
    @Schema()
    class Article extends Entity {
      @Prop(() => String, { text: true }) title?: string;
      @Prop(() => String, { text: true }) body?: string;
      @Prop(() => [String], { text: true }) tags?: string[];
    }
    const texts = SchemaCompiler.compile(Article).indexes.filter((index) => IndexHelpers.isText(index.keys));
    expect(texts.length).toBe(1);
    expect(Object.keys(texts[0]?.keys ?? {})).toEqual(["title", "body", "tags"]);
  });

  test("subdocument indexes are prefixed; partial filters keep $or/$and intact", () => {
    @Index({ zip: 1 }, { partialFilterExpression: { $or: [{ zip: { $exists: true } }, { city: "x" }] } })
    @Schema()
    class Place {
      @Prop(() => String, { index: true }) city?: string;
      @Prop(() => String) zip?: string;
    }
    @Schema()
    class Holder extends Entity {
      @Prop(() => Place) home?: Place;
      @Prop(() => [Place]) visited?: Place[];
      @Prop(() => Place, { excludeIndexes: true }) ignored?: Place;
    }
    /* Order: field options, then @Index (source order), then subdocuments, then the merged text index. */
    expect(keysOf(Holder)).toEqual([
      ["home.city", {}],
      ["home.zip", { partialFilterExpression: { $or: [{ "home.zip": { $exists: true } }, { "home.city": "x" }] } }],
      ["visited.city", {}],
      [
        "visited.zip",
        { partialFilterExpression: { $or: [{ "visited.zip": { $exists: true } }, { "visited.city": "x" }] } },
      ],
    ]);
  });

  test("aliases: index keys, partial filters and weights use database names, key order kept", () => {
    @Index({ lastName: 1, firstName: 1 }, { partialFilterExpression: { firstName: { $exists: true } } })
    @Schema()
    class Aliased extends Entity {
      @Prop(() => String, { dbName: "fn" }) firstName?: string;
      @Prop(() => String, { dbName: "ln", index: true }) lastName?: string;
    }
    const indexes = SchemaCompiler.compile(Aliased).indexes;
    expect(indexes.map((index) => Object.keys(index.keys))).toEqual([["ln"], ["ln", "fn"]]);
    expect(indexes[1]?.options.partialFilterExpression).toEqual({ fn: { $exists: true } });
  });

  test("@Index on nested object paths and wildcards", () => {
    @Schema({ nested: true })
    class Meta {
      @Prop(() => String, { index: true }) source?: string;
    }
    @Index({ "meta.source": 1, _id: -1 })
    @Index({ "meta.$**": 1 })
    @Index({ "$**": 1 })
    @Schema()
    class WithMeta extends Entity {
      @Prop(() => Meta) meta?: Meta;
    }
    expect(keysOf(WithMeta).map(([keys]) => keys)).toEqual(["meta.source,_id", "meta.$**", "$**", "meta.source"]);
  });

  test("discriminator indexes live on the root collection, scoped by the key (Mongoose gh-6347)", () => {
    @Index({ name: 1 })
    @Schema({ discriminatorKey: "kind" })
    class Animal extends Entity {
      @Prop(() => String) kind!: string;
      @Prop(() => String) name?: string;
    }
    @Discriminator("dog")
    class Dog extends Animal {
      declare readonly kind: DiscriminatorValue<"dog">;
      @Prop(() => String, { unique: true, required: true }) chip!: string;
    }
    const root = SchemaCompiler.compile(Animal);
    expect(root.indexes.map((index) => [index.keys, index.options])).toEqual([
      [{ name: 1 }, {}],
      [{ chip: 1 }, { unique: true, partialFilterExpression: { kind: "dog" } }],
    ]);
    /* The discriminator's own schema lists its indexes unscoped (base indexes inherited). */
    expect(SchemaCompiler.compile(Dog).indexes.map((index) => index.keys)).toEqual([{ chip: 1 }, { name: 1 }]);
  });

  test("identical declarations are deduplicated", () => {
    @Index({ a: 1 })
    @Schema()
    class Dup extends Entity {
      @Prop(() => String, { index: true }) a?: string;
    }
    expect(keysOf(Dup)).toEqual([["a", {}]]);
  });
});
