import { describe, expect, test } from "bun:test";
import { CollectionNaming, ConfigurationError } from "../../../src/index.ts";

/*
 * Automatic names like Mongoose (lowercase + English plural) with its bugs fixed. The "mongoose" column was
 * produced by running `references/mongoose-master/lib/helpers/pluralize.js`.
 */

const TABLE: readonly (readonly [word: string, mongoose: string, typemo: string])[] = [
  ["user", "users", "users"],
  ["userprofile", "userprofiles", "userprofiles"],
  ["person", "people", "people"],
  ["woman", "women", "women"],
  ["human", "humans", "humans"],
  ["child", "children", "children"],
  ["ox", "oxen", "oxen"],
  ["axis", "axes", "axes"],
  ["test", "tests", "tests"],
  ["octopus", "octopi", "octopi"],
  ["cactus", "cacti", "cacti"],
  ["alias", "aliases", "aliases"],
  ["virus", "viruses", "viruses"],
  ["bus", "buses", "buses"],
  ["potato", "potatoes", "potatoes"],
  ["medium", "media", "media"],
  ["datum", "data", "data"],
  ["analysis", "analyses", "analyses"],
  ["wife", "wives", "wives"],
  ["knife", "knives", "knives"],
  ["hive", "hives", "hives"],
  ["category", "categories", "categories"],
  ["company", "companies", "companies"],
  ["key", "keys", "keys"],
  ["day", "days", "days"],
  ["box", "boxes", "boxes"],
  ["address", "addresses", "addresses"],
  ["complex", "complexes", "complexes"] /* "complices" was expected once: Mongoose does not produce it */,
  ["index", "indexes", "indexes"],
  ["matrix", "matrixes", "matrixes"],
  ["vertex", "vertexes", "vertexes"],
  ["mouse", "mice", "mice"],
  ["louse", "lice", "lice"],
  ["quiz", "quizzes", "quizzes"],
  ["goose", "geese", "geese"],
  ["news", "news", "news"],
  ["fish", "fish", "fish"],
  ["status", "status", "status"],
  ["log2", "log2", "log2"],
  ["hero", "heros", "heros"],
  ["leaf", "leafs", "leafs"],
  ["canvas", "canvas", "canvas"],
  // Fixed bugs:
  ["data", "datas", "data"],
  ["metadata", "metadatas", "metadata"],
  ["criterion", "criterions", "criteria"],
  ["phenomenon", "phenomenons", "phenomena"],
  ["matrixcell", "matricescell", "matrixcells"], // unanchored `(matr|vert|ind)ix|ex$`
  ["indixa", "indicesa", "indixas"],
];

describe("CollectionNaming.pluralize", () => {
  test.each(TABLE)("%s → %s (Mongoose) → %s (Typemo)", (word, _mongoose, typemo) => {
    expect(CollectionNaming.pluralize(word)).toBe(typemo);
  });

  test("the fixes are exactly the rows where the columns differ", () => {
    const fixed = TABLE.filter(([, mongoose, typemo]) => mongoose !== typemo).map(([word]) => word);
    expect(fixed).toEqual(["data", "metadata", "criterion", "phenomenon", "matrixcell", "indixa"]);
  });
});

describe("CollectionNaming.default and check", () => {
  test("lowercase + plural, like Mongoose (no word separation)", () => {
    expect(CollectionNaming.default("User")).toBe("users");
    expect(CollectionNaming.default("UserProfile")).toBe("userprofiles");
    expect(CollectionNaming.default("Person")).toBe("people");
  });

  test.each([
    ["", /non-empty/],
    ["a$b", /cannot contain "\$"/],
    ["a\0b", /null character/],
    ["system.users", /reserved/],
  ])("%j is not a collection name", (name, message) => {
    expect(() => CollectionNaming.check(name, "X")).toThrow(ConfigurationError);
    expect(() => CollectionNaming.check(name, "X")).toThrow(message);
  });
});
