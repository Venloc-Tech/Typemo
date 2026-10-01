/*
 * The input of the collection methods and of the hydration is never mutated — deeply frozen inputs work (a
 * mutation would throw) and stay as they were.
 */
import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  Collections,
  type StrictArray,
  type Subdocument,
  type SubdocumentArray,
  type TypedMap,
} from "../../../src/index.ts";
import type { Badge, Revision } from "../../fixtures/collections/collection-entities.ts";
import { DOC_SCHEMA, TrackedRoot } from "../../fixtures/collections/tracked-root.ts";

/** Freezes `value` and everything reachable from it. */
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

describe("no input mutation (typed collections)", () => {
  test("hydration from frozen stored data", () => {
    const raw = deepFreeze({
      _id: new ObjectId(),
      tags: ["a"],
      revisions: [{ _id: new ObjectId(), note: "n", lines: 1, tags: ["x"] }],
      scores: { a: 1 },
      badges: { gold: { title: "G", marks: [1] } },
    });
    const before = JSON.stringify(raw);
    const root = TrackedRoot.hydrate(raw);
    root.get<StrictArray<string>>("tags").push("b");
    root.get<SubdocumentArray<Revision>>("revisions")[0]?.tags?.push("y");
    root.get<TypedMap<number>>("scores").set("b", 2);
    root.get<TypedMap<Subdocument<Badge>>>("badges").get("gold")?.marks?.push(2);
    expect(JSON.stringify(raw)).toBe(before);
  });

  test("frozen input to push / set / replace / create / Map#set / $set / fromInput", () => {
    const root = TrackedRoot.hydrate({ _id: new ObjectId(), tags: [], revisions: [], badges: {} });
    const values = deepFreeze(["p", "q"]);
    const tags = root.get<StrictArray<string>>("tags");
    tags.push(...values);
    tags.replace(values);
    tags.set(0, values[1] ?? "");
    const input = deepFreeze({ note: "n", lines: 1, tags: ["t"] });
    const revisions = root.get<SubdocumentArray<Revision>>("revisions");
    revisions.push(input);
    revisions.create(input).tags?.push("more");
    revisions[0]?.$set("tags", input.tags);
    root.get<TypedMap<Subdocument<Badge>>>("badges").set("k", deepFreeze({ title: "t", marks: [1] }));
    const node = DOC_SCHEMA.field("matrix");
    if (node === undefined) throw new Error("schema");
    const matrix = deepFreeze([[1], [2]]);
    (Collections.fromInput(node, matrix, root.fields, "matrix") as StrictArray<StrictArray<number>>)[0]?.push(3);
    expect(values).toEqual(["p", "q"]);
    expect(input).toEqual({ note: "n", lines: 1, tags: ["t"] });
    expect(matrix).toEqual([[1], [2]]);
  });
});
