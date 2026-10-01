import { beforeEach, describe, test } from "bun:test";
import { expectShapeMatches } from "@venloc/typemo-test-kit";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";
import { type ShapePopulate, shapePopulate } from "../../fixtures/populate/shape-populate.ts";

/*
 * The result type the compiler computes for a populate (`ApplyPopulate`, lean and hydrated, `$toObject`/`$toJSON`
 * of a populated document) against the shape of what the query really returns — one row per populate variant.
 */

const t = ModelLifecycle.useTypemo("pop_shape");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
let queries: ShapePopulate;
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
  queries = shapePopulate(m);
});

/** The shape-harness target: the awaited result type of `name`, or of its first element. */
const target = (name: keyof ShapePopulate, element = false) => ({
  code: `
import type { ShapePopulate } from "./populate/shape-populate.ts";
type Result = Awaited<ReturnType<ShapePopulate["${name}"]>>;
export type Shape = ${element ? "NonNullable<Result>[number]" : "NonNullable<Result>"};
`,
  type: "Shape",
  dir: FIXTURES,
});

describe("shape: populate results vs what the server returns", () => {
  /*
   * A thunk per row: indexing `queries[name]` with the union of names would build the union of every result type
   * (TS2589).
   */
  const rows: readonly (readonly [keyof ShapePopulate, string, boolean, () => PromiseLike<unknown>])[] = [
    ["refLean", "a single reference, lean", false, () => queries.refLean()],
    ["refHydrated", "a single reference, hydrated: a document of the target model", false, () => queries.refHydrated()],
    ["refHydratedPlain", "$toObject() of a populated document", false, () => queries.refHydratedPlain()],
    ["refHydratedJson", "$toJSON() of a populated document", false, () => queries.refHydratedJson()],
    ["refMatched", "match: null (D34)", false, () => queries.refMatched()],
    ["refSelectNoId", "select without _id", false, () => queries.refSelectNoId()],
    ["refPlusHidden", "select +hidden", false, () => queries.refPlusHidden()],
    ["refJustOneFalse", "justOne: false → a list", false, () => queries.refJustOneFalse()],
    ["refNullable", "a nullable reference", false, () => queries.refNullable()],
    ["refNullableNull", "a nullable reference that is null", false, () => queries.refNullableNull()],
    ["refArray", "an array of references", false, () => queries.refArray()],
    ["refArrayHydrated", "an array of references, hydrated (read-only)", false, () => queries.refArrayHydrated()],
    ["refArrayRetain", "retainNullValues", false, () => queries.refArrayRetain()],
    ["refArraySortLimit", "sort + limit per document + select", false, () => queries.refArraySortLimit()],
    ["refArrayJustOne", "justOne on an array", false, () => queries.refArrayJustOne()],
    ["transformSingle", "transform of a single reference", false, () => queries.transformSingle()],
    ["transformArray", "transform of an array", false, () => queries.transformArray()],
    ["transformHydrated", "transform, hydrated", false, () => queries.transformHydrated()],
    ["virtualMany", "a virtual", false, () => queries.virtualMany()],
    ["virtualManyHydrated", "a virtual, hydrated", false, () => queries.virtualManyHydrated()],
    ["virtualJustOne", "a justOne virtual", false, () => queries.virtualJustOne()],
    ["virtualJustOneNone", "a justOne virtual without a document", false, () => queries.virtualJustOneNone()],
    ["virtualCount", "a count virtual", false, () => queries.virtualCount()],
    ["virtualCountHydrated", "a count virtual, hydrated", false, () => queries.virtualCountHydrated()],
    ["virtualMatch", "a virtual with its match and the call's", false, () => queries.virtualMatch()],
    ["virtualPerDocumentLimit", "perDocumentLimit through $lookup", true, () => queries.virtualPerDocumentLimit()],
    ["virtualUuid", "a virtual over UUIDs", false, () => queries.virtualUuid()],
    ["nestedObject", "nested populate (object form)", false, () => queries.nestedObject()],
    ["nestedDotted", "a dotted path through three references", false, () => queries.nestedDotted()],
    ["nestedDottedHydrated", "the same, hydrated", false, () => queries.nestedDottedHydrated()],
    ["subdocumentArray", "references in an array of subdocuments", false, () => queries.subdocumentArray()],
    [
      "subdocumentArrayPlain",
      "the same, $toObject() of the hydrated document",
      false,
      () => queries.subdocumentArrayPlain(),
    ],
    ["nestedObjectRef", "a reference in a nested object", false, () => queries.nestedObjectRef()],
    ["mapOfRefs", "a Map of references (lean: a record)", false, () => queries.mapOfRefs()],
    ["mapOfRefsPlain", "a Map of references, $toObject(): a Map", false, () => queries.mapOfRefsPlain()],
    ["mapOfSubdocuments", "a reference in a Map of subdocuments", false, () => queries.mapOfSubdocuments()],
    ["refPath", "refPath (polymorphic)", false, () => queries.refPath()],
    ["refModel", "refModel (polymorphic)", false, () => queries.refModel()],
    ["rootDiscriminator", "a reference of a root discriminator", false, () => queries.rootDiscriminator()],
    [
      "embeddedDiscriminator",
      "a reference of an embedded discriminator (G4)",
      false,
      () => queries.embeddedDiscriminator(),
    ],
    ["findOneAndUpdate", "findOneAndUpdate(...).populate()", false, () => queries.findOneAndUpdate()],
    ["matchFunction", "match as a function (D36)", false, () => queries.matchFunction()],
    ["documentPopulate", "$populate on a document", false, () => queries.documentPopulate()],
    ["documentDepopulate", "$depopulate: the ids again", false, () => queries.documentDepopulate()],
  ];

  for (const [name, what, element, run] of rows) {
    test(`${name}: ${what}`, async () => {
      const value = await run();
      expectShapeMatches(target(name, element), element ? (value as unknown[])[0] : value);
    });
  }
});
