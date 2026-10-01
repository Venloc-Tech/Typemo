/*
 * One rule for the document hooks: whatever creates a document fires `document.validate` and `document.save`.
 * A plugin records every hook event of every phase; `create`, `insertOne`, `insertMany` and `bulkSave` of new
 * documents must leave the same document events per document. `insertMany` keeps its own `model.insertMany`
 * event around them, its unordered mode and its `BulkWriteError`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  BulkWriteError,
  Entity,
  HOOK_EVENTS,
  type HookEvent,
  Plugin,
  Pre,
  Prop,
  QueryError,
  Schema,
  type SchemaPlugin,
  ValidationError,
} from "../../../src/index.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("ih_hooks");

/** The recorded `phase event` lines. */
const seen: string[] = [];

/** A plugin subscribed to every hook event in every phase. */
const recorder: SchemaPlugin = {
  name: "recorder",
  apply: (builder) => {
    for (const phase of ["pre", "post", "postError"] as const) {
      for (const event of HOOK_EVENTS) {
        builder.addHook(phase, [event] as HookEvent[], () => {
          seen.push(`${phase} ${event}`);
        });
      }
    }
  },
};

@Plugin(recorder)
@Schema({ collection: "ih_accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => Number, { min: 0 }) balance?: number;
  @Prop(() => String) stamp?: string;

  @Pre("document.save") mark(this: Account): void {
    this.stamp = `saved:${this.owner}`;
  }
}

/** The document events one created document leaves. */
const CREATED = ["pre document.save", "pre document.validate", "post document.validate", "post document.save"];

/**
 * The model under test.
 * @returns The model of `Account`.
 */
const accounts = () => t.connection.model(Account);

beforeEach(async () => {
  await t.mongo.db.collection("ih_accounts").deleteMany({});
  seen.length = 0;
});

describe("the document hooks of everything that creates a document", () => {
  test("create fires document.save and document.validate", async () => {
    await accounts().create({ owner: "a" });
    expect(seen).toEqual(CREATED);
  });

  test("insertOne fires exactly what create fires, and a pre hook's change is stored", async () => {
    const doc = await accounts().insertOne({ owner: "b" });
    expect(seen).toEqual(CREATED);
    expect(doc.stamp).toBe("saved:b");
    expect(doc.$isNew()).toBe(false);
    expect(await t.mongo.db.collection("ih_accounts").findOne({ _id: doc._id })).toMatchObject({
      owner: "b",
      stamp: "saved:b",
    });
  });

  test("insertOne of something that is not a plain object is still a QueryError", async () => {
    await expect(accounts().insertOne([] as never)).rejects.toBeInstanceOf(QueryError);
  });

  test("insertOne of an invalid document: ValidationError, the hooks end in postError, nothing is stored", async () => {
    await expect(accounts().insertOne({ owner: "c", balance: -1 })).rejects.toBeInstanceOf(ValidationError);
    expect(seen).toEqual([
      "pre document.save",
      "pre document.validate",
      "postError document.validate",
      "postError document.save",
    ]);
    expect(await t.mongo.db.collection("ih_accounts").countDocuments()).toBe(0);
  });

  test("insertMany fires them for every document, inside its own model.insertMany event", async () => {
    const docs = await accounts().insertMany([{ owner: "d" }, { owner: "e" }]);
    expect(seen.filter((line) => line.includes("document.save"))).toEqual([
      "pre document.save",
      "pre document.save",
      "post document.save",
      "post document.save",
    ]);
    expect(seen.filter((line) => line.includes("document.validate"))).toEqual([
      "pre document.validate",
      "post document.validate",
      "pre document.validate",
      "post document.validate",
    ]);
    expect(seen.filter((line) => line.includes("model.insertMany"))).toEqual([
      "pre model.insertMany",
      "post model.insertMany",
    ]);
    expect(docs.map((doc) => [doc.stamp, doc.$isNew()])).toEqual([
      ["saved:d", false],
      ["saved:e", false],
    ]);
    const stored = await t.mongo.db.collection("ih_accounts").find().sort({ owner: 1 }).toArray();
    expect(stored.map((row) => row.stamp)).toEqual(["saved:d", "saved:e"]);
  });

  test("bulkSave of new documents fires them for every document", async () => {
    const Accounts = accounts();
    await Accounts.bulkSave([Accounts.new({ owner: "f" }), Accounts.new({ owner: "g" })]);
    expect(seen.filter((line) => line.includes("document.save"))).toEqual([
      "pre document.save",
      "pre document.save",
      "post document.save",
      "post document.save",
    ]);
    expect(seen.filter((line) => line.includes("document.validate")).length).toBe(4);
  });

  test("unordered insertMany: the invalid document ends in postError, the others are stored and end in post", async () => {
    const error = await accounts()
      .insertMany([{ owner: "h" }, { owner: "i", balance: -5 }, { owner: "j" }], { ordered: false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BulkWriteError);
    expect((error as BulkWriteError).writeErrors.map((failure) => [failure.index, failure.error.name])).toEqual([
      [1, "ValidationError"],
    ]);
    expect(seen.filter((line) => line.endsWith("document.save")).sort()).toEqual([
      "post document.save",
      "post document.save",
      "postError document.save",
      "pre document.save",
      "pre document.save",
      "pre document.save",
    ]);
    expect(seen.filter((line) => line.includes("model.insertMany"))).toEqual([
      "pre model.insertMany",
      "postError model.insertMany",
    ]);
    expect(await t.mongo.db.collection("ih_accounts").countDocuments()).toBe(2);
  });

  test("ordered insertMany with an invalid document: nothing is stored, every attempted document ends in postError", async () => {
    const error = await accounts()
      .insertMany([{ owner: "k" }, { owner: "l", balance: -5 }, { owner: "m" }])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(seen.filter((line) => line.endsWith("document.save"))).toEqual([
      "pre document.save",
      "pre document.save",
      "postError document.save",
      "postError document.save",
    ]);
    expect(await t.mongo.db.collection("ih_accounts").countDocuments()).toBe(0);
  });

  test("an empty insertMany fires only its model event", async () => {
    expect(await accounts().insertMany([])).toEqual([]);
    expect(seen).toEqual(["pre model.insertMany", "post model.insertMany"]);
  });
});
