import { beforeAll, beforeEach, describe, test } from "bun:test";
import { expectShapeMatches } from "@venloc/typemo-test-kit";
import {
  type PlainForms,
  type PlainModels,
  plainForms,
  plainModels,
  seedPlainForms,
} from "../../fixtures/document/plain-forms.ts";
import { ModelLifecycle } from "../../fixtures/model/model-lifecycle.ts";

/*
 * The compiler's type of every form of the same stored document — `$toPlain()` and `.plain()` (with and without
 * their options, populated on two levels, a discriminator, lists, cursors, an aggregation), `.lean()`,
 * `$toObject()`, `$toJSON()` — against the shape of what it really returns.
 */

const t = ModelLifecycle.useTypemo("r21_shape");
const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
let m: PlainModels;
let ops: PlainForms;

beforeAll(() => {
  m = plainModels(t.connection);
  ops = plainForms(m);
});

beforeEach(async () => {
  await seedPlainForms(t.mongo.db);
});

/** The shape-harness target: the awaited result type of the form `name`. */
const target = (name: keyof PlainForms) => ({
  code: `
import type { PlainForms } from "./document/plain-forms.ts";
export type Shape = Awaited<ReturnType<PlainForms["${name}"]>>;
`,
  type: "Shape",
  dir: FIXTURES,
});

describe("shape: every form of one document vs what it returns", () => {
  const rows: readonly (readonly [keyof PlainForms, string, () => PromiseLike<unknown>])[] = [
    ["toPlain", "$toPlain(): the plain form, Hidden out", () => ops.toPlain()],
    ["toPlainHidden", "$toPlain({ hidden: true })", () => ops.toPlainHidden()],
    ["toPlainVirtuals", "$toPlain({ virtuals: true })", () => ops.toPlainVirtuals()],
    ["plain", ".plain(): no hydration, the same form", () => ops.plain()],
    ["plainHidden", ".plain({ hidden: true })", () => ops.plainHidden()],
    ["lean", ".lean(): the driver's values", () => ops.lean()],
    ["toObject", "$toObject(): BSON values, Map kept", () => ops.toObject()],
    ["toJson", "$toJSON(): the JSON forms (R21: int64 and vector)", () => ops.toJson()],
    ["toPlainPopulated", "$toPlain() populated on two levels", () => ops.toPlainPopulated()],
    ["plainPopulated", ".plain() populated on two levels", () => ops.plainPopulated()],
    ["plainPopulatedHidden", ".plain({ hidden: true }) populated", () => ops.plainPopulatedHidden()],
    ["plainVirtual", ".plain() with a populate virtual", () => ops.plainVirtual()],
    ["toPlainVirtual", "$toPlain() with a populate virtual", () => ops.toPlainVirtual()],
    ["plainTransform", ".plain() with a populate transform", () => ops.plainTransform()],
    ["plainPulse", ".plain() of a discriminator", () => ops.plainPulse()],
    ["toPlainPulse", "$toPlain() of a discriminator document", () => ops.toPlainPulse()],
    ["plainList", "find().plain()", () => ops.plainList()],
    ["plainCursor", "find().plain().cursor()", () => ops.plainCursor()],
    ["plainUpdated", "findOneAndUpdate().plain()", () => ops.plainUpdated()],
    ["aggregatePlain", "aggregate().plain()", () => ops.aggregatePlain()],
    ["toPlainMasked", "$toPlain({ mask }) (R39)", () => ops.toPlainMasked()],
    ["toJsonMasked", "$toJSON({ mask }) (R39)", () => ops.toJsonMasked()],
    ["toObjectMasked", "$toObject({ mask }) (R39)", () => ops.toObjectMasked()],
    ["plainMasked", ".plain().mask() (R39)", () => ops.plainMasked()],
    ["aggregatePlainMasked", "aggregate().plain().mask() (R39)", () => ops.aggregatePlainMasked()],
    /* Hidden fields below the root (subdocument, array, Map) and in a populated document selected with +pin */
    ["vaultToPlain", "R26 $toPlain(): nested Hidden out", () => ops.vaultToPlain()],
    ["vaultToPlainHidden", "R26 $toPlain({ hidden: true }): nested Hidden in", () => ops.vaultToPlainHidden()],
    ["vaultToJson", "R26 $toJSON(): nested Hidden out", () => ops.vaultToJson()],
    ["vaultToJsonHidden", "R26 $toJSON({ hidden: true })", () => ops.vaultToJsonHidden()],
    ["vaultPlain", "R26 .plain(): nested Hidden out", () => ops.vaultPlain()],
    ["vaultPlainHidden", "R26 .plain({ hidden: true })", () => ops.vaultPlainHidden()],
    ["vaultToObject", "R26 $toObject(): nested Hidden in", () => ops.vaultToObject()],
    ["vaultToObjectNoHidden", "R26 $toObject({ hidden: false }): nested Hidden out", () => ops.vaultToObjectNoHidden()],
  ];
  for (const [name, what, run] of rows) {
    test(`${name}: ${what}`, async () => {
      /* The vault fixture fills every field, so an optional key the form never returns is a mismatch too. */
      expectShapeMatches(target(name), await run(), { requireOptional: name.startsWith("vault") });
    });
  }
});
