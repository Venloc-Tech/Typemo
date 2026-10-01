import { describe, expect, test } from "bun:test";
import { StrictModeError } from "../../../src/errors/strict-mode-error.ts";
import { CastError, Entity, ModelOperations, Prop, SanitizePolicy, Schema, untrusted } from "../../../src/internal.ts";
import { PlanCapture, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * Ported from Mongoose `sanitizeFilter` tests. Typemo has no `trusted()` and no opt-in option: the policy
 * is always on and operator objects are part of the TYPED filter grammar, so Mongoose's rule
 * "every object with $-keys from the caller is data (`$eq`-wrapped)" is not Typemo's. Instead, the application
 * marks the data from OUTSIDE with `untrusted(value)` — a dollar key anywhere inside it is refused
 * (StrictModeError "sanitize") — and operators it writes itself are the typed grammar. The tests whose logic
 * depended on Mongoose's rule check this one (divergences: DIVERGENCES.md, INDEX.md).
 */

@Schema({ collection: "ported_sanitize" })
class Credentials extends Entity {
  @Prop(() => String)
  username?: string;

  @Prop(() => String)
  pwd?: string;
}

const capture = new PlanCapture();
const Model = new ModelOperations(Credentials, capture);
// biome-ignore lint/suspicious/noExplicitAny: ported tests pass untyped filters like the originals.
const loose = (value: unknown): any => value;
const cast = async (query: PromiseLike<unknown>) => (await StepHarness.full(await capture.plan(query))).filter;

describe("sanitizeFilter (ported)", () => {
  // ported from mongoose test/helpers/query.sanitizeFilter.test.js:8 "throws when filter includes a query selector"
  test("throws when filter includes a query selector", async () => {
    expect(await cast(Model.find({ username: "val", pwd: "my secret" }))).toEqual({
      username: "val",
      pwd: "my secret",
    });
    // Mongoose: `{ $ne: null }` becomes `{ $eq: { $ne: null } }` and fails the cast. Typemo: `pwd` is not
    // nullable, so `$ne: null` fails the cast — same outcome, different reason.
    await expect(cast(Model.find(loose({ username: "val", pwd: { $ne: null } })))).rejects.toBeInstanceOf(CastError);
  });

  // ported from mongoose test/helpers/query.sanitizeFilter.test.js:19 "ignores explicitly defined query selectors"
  test("ignores explicitly defined query selectors — divergence: selectors the app writes are kept, untrusted() marks the others", async () => {
    // Mongoose: `trusted({ $ne: "x" })` keeps the selector. Typemo: a selector written by the application is kept.
    expect(await cast(Model.find({ username: "val", pwd: { $ne: "my secret" } }))).toEqual({
      username: "val",
      pwd: { $ne: "my secret" },
    });
    // The same object from outside, marked untrusted: refused before anything is built.
    expect(() => Model.find({ username: "val", pwd: untrusted<string>(loose({ $ne: "my secret" })) })).toThrow(
      StrictModeError,
    );
  });

  // ported from mongoose test/helpers/query.sanitizeFilter.test.js:29 "handles $and, $or, $nor"
  test("handles $and, $or, $nor — divergence: an app-written $ne is kept; untrusted data with dollar keys is refused inside them", async () => {
    expect(await cast(Model.find({ $and: [{ username: "val" }, { pwd: { $ne: "my secret" } }] }))).toEqual({
      $and: [{ username: "val" }, { pwd: { $ne: "my secret" } }],
    });
    for (const operator of ["$and", "$or", "$nor"] as const) {
      expect(() =>
        Model.find(
          loose({ [operator]: [{ username: "val" }, { pwd: untrusted<string>(loose({ $ne: "my secret" })) }] }),
        ),
      ).toThrow(StrictModeError);
    }
  });

  // ported from mongoose test/helpers/query.sanitizeFilter.test.js:43 "handles $not"
  test("handles $not — divergence: $not of $ne written by the app is a typed filter; from outside it is refused", async () => {
    expect(await cast(Model.find({ pwd: { $not: { $ne: "x" } } }))).toEqual({ pwd: { $not: { $ne: "x" } } });
    expect(() => Model.find({ pwd: untrusted<string>(loose({ $not: { $ne: "x" } })) })).toThrow(StrictModeError);
  });

  // ported from mongoose test/helpers/query.sanitizeFilter.test.js:49 "handles $jsonSchema"
  test("handles $jsonSchema — divergence: a typed root operator when the app writes it; refused inside untrusted data", async () => {
    expect(await cast(Model.find({ $jsonSchema: { required: ["username"] } }))).toEqual({
      $jsonSchema: { required: ["username"] },
    });
    expect(() => Model.find(untrusted(loose({ $jsonSchema: { required: ["username"] } })))).toThrow(StrictModeError);
  });

  // ported from mongoose test/helpers/query.sanitizeFilter.test.js:73 "handles $where"
  test("handles $where", () => {
    expect(() => SanitizePolicy.filter({ $where: "true" }, "filter")).toThrow(StrictModeError);
    // Mongoose allows a trusted $where function; Typemo never runs JavaScript on the server.
    expect(() => SanitizePolicy.filter({ $where: () => true }, "filter")).toThrow(/JavaScript/);
  });

  // ported from mongoose test/helpers/query.sanitizeFilter.test.js:87 "handles $expr"
  test("handles $expr: an $expr with $function is refused", () => {
    expect(() => SanitizePolicy.filter({ $expr: { $function: { body: "return true" } } }, "filter")).toThrow(
      /JavaScript/,
    );
  });

  // ported from mongoose test/helpers/query.sanitizeFilter.test.js:104 "handles $text"
  test("handles $text — divergence: a typed root operator when the app writes it; refused inside untrusted data", async () => {
    expect(await cast(Model.find({ $text: { $search: "val" } }))).toEqual({ $text: { $search: "val" } });
    expect(() => Model.find(untrusted(loose({ $text: { $search: "val" } })))).toThrow(StrictModeError);
  });

  // ported from mongoose test/query.test.js:3512 "sanitizeFilter option (gh-3944)"
  test("sanitizeFilter option (gh-3944)", async () => {
    expect(await cast(Model.find({ username: "val", pwd: "my secret" }))).toEqual({
      username: "val",
      pwd: "my secret",
    });
    await expect(cast(Model.find(loose({ username: "val", pwd: { $ne: null } })))).rejects.toBeInstanceOf(CastError);
  });

  // ported from mongoose test/query.test.js:3533 "sanitizeFilter disables implicit $in (gh-14657)"
  test("sanitizeFilter disables implicit $in (gh-14657)", async () => {
    await expect(cast(Model.find(loose({ username: ["foobar"] })))).rejects.toBeInstanceOf(CastError);
  });

  // ported from mongoose test/model.countDocuments.test.js:37 "applies sanitizeFilter (gh-15720)"
  test("countDocuments applies sanitizeFilter (gh-15720)", async () => {
    expect(await cast(Model.countDocuments({ username: "val", pwd: "my secret" }))).toEqual({
      username: "val",
      pwd: "my secret",
    });
    await expect(cast(Model.countDocuments(loose({ username: "val", pwd: { $ne: null } })))).rejects.toBeInstanceOf(
      CastError,
    );
  });

  // ported from mongoose test/model.countDocuments.test.js:60 "sanitizeFilter rejects $where (gh-15720)"
  test("countDocuments: sanitizeFilter rejects $where (gh-15720)", async () => {
    await expect(cast(Model.countDocuments(loose({ $where: 'this.username === "val"' })))).rejects.toMatchObject({
      reason: "sanitize",
    });
  });

  // ported from mongoose test/query.cursor.test.js:997 "applies sanitizeFilter (gh-15720)"
  test("cursor applies sanitizeFilter (gh-15720)", async () => {
    const plan = await capture.plan(Model.find(loose({ username: { $ne: null } })));
    await expect(StepHarness.full(loose({ ...plan, mode: { kind: "cursor" } }))).rejects.toBeInstanceOf(CastError);
  });

  // ported from mongoose test/query.cursor.test.js:1019 "sanitizeFilter rejects $where (gh-15720)"
  test("cursor: sanitizeFilter rejects $where (gh-15720)", async () => {
    const plan = await capture.plan(Model.find(loose({ $where: 'this.name === "Axl"' })));
    await expect(StepHarness.full(loose({ ...plan, mode: { kind: "cursor" } }))).rejects.toMatchObject({
      reason: "sanitize",
    });
  });
});
