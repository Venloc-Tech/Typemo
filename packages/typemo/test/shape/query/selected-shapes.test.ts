import { beforeEach, describe, expect, test } from "bun:test";
import { expectShapeMatches } from "@venloc/typemo-test-kit";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";
import { selectedShapes } from "../../fixtures/query/selected-shapes.ts";

/*
 * A hand-written contract against what the server really returns, in every form — `Selected` (plain) = `.plain()`
 * and `$toPlain()`, `SelectedLean` = `.lean()`, `SelectedJson` = `$toJSON()`. The queries carry
 * `.expect<Contract>()` / `Contract.check` (the compiler proves the contract IS the result type), this test
 * proves that type is the data: together, the contract is the data.
 */

const t = ModelLifecycle.useTypemo("selected_shape");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

/** The shape-harness target: the hand-written contract type `name`. */
const contract = (name: string) => ({
  code: `import type { ${name} } from "./query/selected-shapes.ts";\nexport type Shape = ${name};\n`,
  type: "Shape",
  dir: FIXTURES,
});

describe("shape: SelectedLean vs lean()", () => {
  test("the lean row of a projection (_id included by default)", async () => {
    expectShapeMatches(contract("PersonCardLean"), await selectedShapes(m).card());
  });

  test('"-_id": no _id; a Map as a record, ids as ObjectIds', async () => {
    const row = await selectedShapes(m).noId();
    expect("_id" in row).toBe(false);
    expectShapeMatches(contract("PersonNoIdLean"), row);
  });

  test("nested 2 levels: populate inside populate, with -_id at the bottom", async () => {
    expectShapeMatches(contract("PostWithAuthorLean"), await selectedShapes(m).twoLevels());
  });

  test("a populated virtual (an array of contracts)", async () => {
    const row = await selectedShapes(m).virtual();
    expect(row.posts.length).toBeGreaterThan(0);
    expectShapeMatches(contract("PersonWithPostsLean"), row);
  });

  test("a discriminator: the key as its literal", async () => {
    const row = await selectedShapes(m).discriminator();
    expect(row.__t).toBe("signup");
    expectShapeMatches(contract("SignupRowLean"), row);
  });
});

describe("shape: Selected vs .plain() and $toPlain()", () => {
  test("a projection: _id as a string", async () => {
    const row = await selectedShapes(m).plainCard();
    expect(row._id).toBe(P.ann.toHexString());
    expectShapeMatches(contract("PersonCard"), row);
  });

  test('"-_id": a Map as a Map of id strings, an array of id strings', async () => {
    const row = await selectedShapes(m).plainNoId();
    expect("_id" in row).toBe(false);
    expect(row.tagsByTopic).toBeInstanceOf(Map);
    expect(row.tagsByTopic?.get("color")).toBe(P.red.toHexString());
    expect(row.friends).toEqual([P.bob.toHexString(), P.gone.toHexString(), P.cid.toHexString()]);
    expectShapeMatches(contract("PersonNoId"), row);
  });

  test("populated 2 levels: .plain() and $toPlain() are the same data of the same contract", async () => {
    const shapes = selectedShapes(m);
    const plain = await shapes.plainTwoLevels();
    const fromDocument = await shapes.toPlainTwoLevels();
    expect(typeof plain.author?._id).toBe("string");
    expect(plain).toEqual(fromDocument);
    expectShapeMatches(contract("PostWithAuthor"), plain);
    expectShapeMatches(contract("PostWithAuthor"), fromDocument);
  });

  test("a populated virtual: plain documents", async () => {
    const shapes = selectedShapes(m);
    const plain = await shapes.plainVirtual();
    expect(plain.posts.length).toBeGreaterThan(0);
    expect(plain).toEqual(await shapes.toPlainVirtual());
    expectShapeMatches(contract("PersonWithPosts"), plain);
  });

  test("a discriminator: the key as its literal", async () => {
    const row = await selectedShapes(m).plainDiscriminator();
    expect(row.__t).toBe("signup");
    expectShapeMatches(contract("SignupRow"), row);
  });

  test("the whole document: null kept, a Map, ids as strings — .plain() equals $toPlain()", async () => {
    const shapes = selectedShapes(m);
    const plain = await shapes.plainPerson();
    expect(plain.mentor).toBeNull();
    expect(plain).toEqual(await shapes.toPlainPerson());
    expectShapeMatches(contract("PersonPlain"), plain);
  });
});

describe("shape: SelectedJson vs $toJSON()", () => {
  test("a document (ids as strings, the Map as a record, null kept)", async () => {
    const json = await selectedShapes(m).json();
    expect(typeof json._id).toBe("string");
    expectShapeMatches(contract("PersonJson"), json);
  });

  test("a document populated 2 levels", async () => {
    const json = await selectedShapes(m).jsonPopulated();
    expect(typeof json.author?._id).toBe("string");
    expectShapeMatches(contract("PostJson"), json);
  });
});
