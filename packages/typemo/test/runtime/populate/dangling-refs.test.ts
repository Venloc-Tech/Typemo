/*
 * Dangling references on the real server, in every form: a single reference becomes `null` (so its type
 * includes `null`), `required: true` makes it an error; an array drops the element from the populated view
 * (`retainNullValues` keeps a `null` in place). `isPresent` narrows them.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { DocumentNotFoundError, isPresent } from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";
import { P, type PopulateModels, seedPopulate } from "../../fixtures/populate/populate-seed.ts";

const t = ModelLifecycle.useTypemo("pop_dangling");
let m: PopulateModels;

beforeEach(async () => {
  m = await seedPopulate(t);
});

describe("dangling references", () => {
  test("single: null in lean, plain and hydrated forms; isPresent is false", async () => {
    const lean = await m.People.findById(P.dan).populate("company").orFail().lean();
    const plain = await m.People.findById(P.dan).populate("company").orFail().plain();
    const hydrated = await m.People.findById(P.dan).populate("company").orFail();
    expect([lean.company, plain.company, hydrated.company]).toEqual([null, null, null]);
    expect(isPresent(lean.company)).toBe(false);
    const found = await m.People.findById(P.ann).populate("company").orFail().lean();
    expect(isPresent(found.company) ? found.company.name : "none").toBe("acme");
  });

  test("single with required: true → DocumentNotFoundError", async () => {
    const error = await m.People.findById(P.dan)
      .populate({ path: "company", required: true })
      .orFail()
      .lean()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DocumentNotFoundError);
  });

  test("array: the dangling element is left out (lean and plain); retainNullValues keeps null, filter(isPresent) drops it", async () => {
    const lean = await m.People.findById(P.ann).populate("friends").orFail().lean();
    expect(lean.friends.map((friend) => friend.name)).toEqual(["bob", "cid"]);
    const plain = await m.People.findById(P.ann).populate("friends").orFail().plain();
    expect(plain.friends.map((friend) => friend.name)).toEqual(["bob", "cid"]);
    const retained = await m.People.findById(P.ann)
      .populate({ path: "friends", retainNullValues: true })
      .orFail()
      .lean();
    expect(retained.friends.length).toBe(3);
    expect(retained.friends.filter(isPresent).map((friend) => friend.name)).toEqual(["bob", "cid"]);
  });
});
