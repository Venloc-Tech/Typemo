/*
 * The ops in CODE form (code names, plain values) go through the model's
 * update pipeline (normalize → cast → validate → encode, with the database names) and give the same stored
 * state as the DATABASE form sent by the driver.
 */
import { describe, expect, test } from "bun:test";
import type { StrictArray, Subdocument, SubdocumentArray, TypedMap } from "../../../src/index.ts";
import {
  type Circle,
  Doc,
  IDS,
  type Revision,
  type Square,
  seed,
} from "../../fixtures/collections/collection-entities.ts";
import { TrackedRoot } from "../../fixtures/collections/tracked-root.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

const t = ModelLifecycle.useTypemo("c_pipeline");

const scenarios: readonly (readonly [string, (root: TrackedRoot) => void])[] = [
  ["$push", (r) => void r.get<StrictArray<string>>("tags").push("d")],
  ["$push $position", (r) => void r.get<StrictArray<number>>("nums").unshift(0)],
  ["$addToSet", (r) => void r.get<StrictArray<string>>("tags").addToSet("a", "q")],
  ["$pullAll", (r) => void r.get<StrictArray<number>>("nums").pull(2)],
  ["$pop", (r) => void r.get<StrictArray<string>>("tags").shift()],
  ["$pull by _id", (r) => void r.get<SubdocumentArray<Revision>>("revisions").pull(IDS.rev[0])],
  ["$set path.i", (r) => void r.get<StrictArray<Date>>("dates").set(0, new Date("2030-01-01T00:00:00Z"))],
  [
    "$set path.i.field",
    (r) => {
      (r.get<SubdocumentArray<Revision>>("revisions")[2] as Subdocument<Revision>).lines = 99;
    },
  ],
  [
    "$set of an aliased field inside an element (dbName)",
    (r) => {
      (r.get<SubdocumentArray<Revision>>("revisions")[0] as Subdocument<Revision>).comment = "c";
    },
  ],
  ["$push into an aliased array (dbName)", (r) => void r.get<StrictArray<string>>("labels").push("l")],
  ["$set whole array of subdocuments", (r) => void r.get<SubdocumentArray<Revision>>("revisions").reverse()],
  [
    "$push a discriminator element",
    (r) => void r.get<SubdocumentArray<Circle | Square>>("shapes").push({ kind: "circle", radius: 4 } as Circle),
  ],
  [
    "Map $set / $unset",
    (r) => {
      r.get<TypedMap<number>>("scores").set("x", 1);
      r.get<TypedMap<number>>("scores").delete("math");
    },
  ],
  ["Map of arrays $push", (r) => void r.get<TypedMap<StrictArray<number>>>("series").get("a")?.push(3)],
  [
    "nested object field",
    (r) => {
      r.get<Subdocument<{ first: string }>>("fullName").first = "Anna";
    },
  ],
];

describe("code-form ops through Model.updateOne = database-form ops through the driver", () => {
  for (const [name, mutate] of scenarios) {
    test(name, async () => {
      const Docs = t.connection.model(Doc);
      const docs = t.mongo.db.collection("c_docs");
      await docs.insertOne({ ...seed(), lb: ["l0"] });
      const viaPipeline = await TrackedRoot.load(docs, IDS.doc);
      mutate(viaPipeline);
      const code = viaPipeline.ops("code");
      await Docs.updateOne({ _id: IDS.doc }, code as never);
      const afterPipeline = await docs.findOne({ _id: IDS.doc });
      viaPipeline.reset();
      expect(afterPipeline as unknown).toEqual(viaPipeline.plain());

      await docs.deleteMany({});
      await docs.insertOne({ ...seed(), lb: ["l0"] });
      const viaDriver = await TrackedRoot.load(docs, IDS.doc);
      mutate(viaDriver);
      await viaDriver.save(docs);
      expect(await docs.findOne({ _id: IDS.doc })).toEqual(afterPipeline);
    });
  }
});
