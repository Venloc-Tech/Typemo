import { describe, test } from "bun:test";
import { expectShapeMatches, MongoLifecycle } from "@venloc/typemo-test-kit";
import { BsonOptions, type HydratedFields } from "../../../src/index.ts";
import type { Doc } from "../../fixtures/collections/collection-entities.ts";
import { ScenarioRunner } from "../../fixtures/collections/scenario-runner.ts";

/*
 * The type the compiler gives to the hydrated fields (`HydratedFields<Doc>`) and to their plain forms
 * (`$toObject()`) is compared with the shape of the real values hydrated from the database.
 */

const mongo = MongoLifecycle.useMongo("c_shapes", BsonOptions.apply({}));
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;

/** The shape-harness target: the type of `expression` on a hydrated `Doc`. */
const target = (expression: string) => ({
  code: `
import type { HydratedFields } from "../../src/index.ts";
import type { Doc } from "./collections/collection-entities.ts";
declare const doc: HydratedFields<Doc>;
const value = ${expression};
export type Shape = NonNullable<typeof value>;
`,
  type: "Shape",
  dir: FIXTURES,
});

type Fields = HydratedFields<Doc>;

describe("shape: hydrated collections vs the values hydrated from the database", () => {
  /*
   * A TypedMap itself is not compared: the harness describes Map instances by class name (`TrackedMap`) and the
   * `TypedMap` interface structurally; its plain form (`$toObject()`, a `Map`) is compared instead.
   * The same expression twice: as source for the compiler, as a function for the runtime value.
   */
  const rows: readonly (readonly [string, (doc: Fields) => unknown])[] = [
    ["doc.tags", (doc) => doc.tags],
    ["doc.owners", (doc) => doc.owners],
    ["doc.matrix", (doc) => doc.matrix],
    ["doc.revisions![0]", (doc) => doc.revisions?.[0]],
    ["doc.shapes![1]", (doc) => doc.shapes?.[1]],
    ["doc.address", (doc) => doc.address],
    ["doc.fullName", (doc) => doc.fullName],
    ["doc.badges!.get('gold')", (doc) => doc.badges?.get("gold")],
    ["doc.revisions!.$toObject()[0]", (doc) => doc.revisions?.$toObject()[0]],
    ["doc.address!.$toObject()", (doc) => doc.address?.$toObject()],
    ["doc.series!.$toObject()", (doc) => doc.series?.$toObject()],
  ];
  for (const [expression, read] of rows) {
    test(expression, async () => {
      const root = await ScenarioRunner.load(mongo);
      expectShapeMatches(target(expression), read(root.doc));
    });
  }
});
