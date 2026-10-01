/*
 * A document (hydrated or lean) given where a reference is stored: the reference takes the document's `_id`
 * — on a populated field of a hydrated document, on a plain reference field, in `create`, in an update and
 * in an array of references. Real server.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("pop_ref_assign");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

describe("a document assigned to a reference takes its _id", () => {
  test("a populated single reference: a hydrated document assigned, $save stores its id", async () => {
    const ann = await m.People.findById(P.ann).populate("company").orFail();
    const globex = await m.Companies.findById(P.globex).orFail();
    ann.company = globex;
    await ann.$save();
    const stored = await t.mongo.db.collection("pp_people").findOne({ _id: P.ann });
    expect(stored?.company).toEqual(P.globex);
    /* The document stays in place as the populated value; its id is what is stored. */
    expect(ann.company?.name).toBe("globex");
    expect(ann.$populated("company")).toEqual(P.globex);
    expect(ann.$isModified()).toBe(false);
  });

  test("$set of a document on a reference casts at once: $getChanges shows the id", async () => {
    const bob = await m.People.findById(P.bob).orFail();
    const acme = await m.Companies.findById(P.acme).orFail();
    bob.$set("company", acme);
    expect(bob.$getChanges()).toEqual({ $set: { company: P.acme } });
    await bob.$save();
    const stored = await t.mongo.db.collection("pp_people").findOne({ _id: P.bob });
    expect(stored?.company).toEqual(P.acme);
  });

  test("a populated single reference: $set of a lean document stores its id", async () => {
    const ann = await m.People.findById(P.ann).populate("company").orFail();
    const globex = await m.Companies.findById(P.globex).orFail().lean();
    ann.$set("company", globex);
    await ann.$save();
    const stored = await t.mongo.db.collection("pp_people").findOne({ _id: P.ann });
    expect(stored?.company).toEqual(P.globex);
  });

  test("create and an update take documents for references, arrays of references included", async () => {
    const acme = await m.Companies.findById(P.acme).orFail();
    const bob = await m.People.findById(P.bob).orFail().lean();
    const eve = await m.People.create({ name: "eve", company: acme, friends: [bob, P.cid] });
    const created = await t.mongo.db.collection("pp_people").findOne({ _id: eve._id });
    expect(created?.company).toEqual(P.acme);
    expect(created?.friends).toEqual([P.bob, P.cid]);
    const globex = await m.Companies.findById(P.globex).orFail();
    await m.People.updateOne({ _id: eve._id }, { $set: { company: globex } });
    const updated = await t.mongo.db.collection("pp_people").findOne({ _id: eve._id });
    expect(updated?.company).toEqual(P.globex);
  });

  test("an object without _id is still a cast error", async () => {
    await expect(m.People.create({ name: "eve", company: { name: "x" } as never })).rejects.toThrow(/company/);
  });
});
