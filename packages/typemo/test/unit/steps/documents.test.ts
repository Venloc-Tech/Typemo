import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import { ModelOperations, ValidationError } from "../../../src/internal.ts";
import { Account, SEEN_CONTEXTS } from "../../fixtures/steps/step-entities.ts";
import { PlanCapture, StepHarness } from "../../fixtures/steps/step-harness.ts";

/*
 * Inserts and replacements through the operation steps: strict cast, defaults/timestamps/version, whole-document
 * validation (required, validators with a document context), unordered insertMany rejects one document and keeps
 * the others (contract `ctx.reject`).
 */

const capture = new PlanCapture();
const Accounts = new ModelOperations(Account, capture);
/** A plain object of unknown values. */
type Loose = Record<string, unknown>;
const base = { name: "A", email: "A@X.TEST", tags: [], items: [] };

describe("inserts", () => {
  test("defaults, _id, timestamps from one clock, __v = 0, schema key order", async () => {
    const ctx = await StepHarness.cast(StepHarness.insert(Account, [base]));
    await StepHarness.run(ctx);
    const [document] = ctx.documents as Loose[];
    expect(document?._id).toBeInstanceOf(ObjectId);
    expect(document?.createdAt).toBeInstanceOf(Date);
    expect(document?.createdAt).toEqual(document?.updatedAt);
    expect(document).toMatchObject({ __v: 0, plan: "free", email: "a@x.test", nm: "A" });
  });

  test("a missing required field and a failing validator are reported together (document context)", async () => {
    SEEN_CONTEXTS.length = 0;
    const error = await StepHarness.full(
      StepHarness.insert(Account, [{ email: "e", tags: [], items: [], age: 200 }]),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues.map((issue) => `${issue.path.join(".")}:${issue.reason}`)).toEqual([
      "age:max",
      "name:required",
    ]);
    await expect(StepHarness.full(StepHarness.insert(Account, [{ ...base, name: "forbidden" }]))).rejects.toThrow(
      /forbidden/,
    );
    expect(SEEN_CONTEXTS.at(-1)).toEqual({ kind: "document", operation: "insertOne", path: "name" });
  });

  test("the user's own createdAt is kept on insert (Defaulted), updatedAt too", async () => {
    const at = new Date(0);
    const ctx = await StepHarness.full(StepHarness.insert(Account, [{ ...base, createdAt: at }]));
    expect((ctx.documents as Loose[])[0]?.createdAt).toEqual(at);
  });

  test("unordered insertMany: an invalid document is rejected, the others are ready", async () => {
    const ctx = StepHarness.context(
      StepHarness.insert(Account, [base, { ...base, age: "x" }, { ...base, name: "B" }], false),
    );
    await StepHarness.run(ctx);
    expect(ctx.rejected.map((entry) => entry.index)).toEqual([1]);
    const documents = ctx.documents as Loose[];
    expect(documents[0]?.nm).toBe("A");
    expect(documents[2]?.nm).toBe("B");
  });

  test("ordered insertMany: the first invalid document stops the operation", async () => {
    await expect(StepHarness.full(StepHarness.insert(Account, [base, { ...base, age: "x" }]))).rejects.toThrow(/age/);
  });
});

describe("replacements", () => {
  /*
   * The service fields are the core's — a replacement carries none of them (the executor keeps createdAt/__v and
   * bumps updatedAt with an update pipeline, ReplacementPipeline).
   */
  test("defaults filled; no _id, no __v, no timestamps (the executor's pipeline keeps and bumps them)", async () => {
    const ctx = await StepHarness.full(await capture.plan(Accounts.replaceOne({ name: "A" }, base)));
    const replacement = ctx.replacement as Loose;
    expect(replacement._id).toBeUndefined();
    expect(replacement.__v).toBeUndefined();
    expect(replacement.createdAt).toBeUndefined();
    expect(replacement.updatedAt).toBeUndefined();
    expect(replacement.plan).toBe("free");
  });

  test("a replacement carrying a service field is refused", async () => {
    const plan = await capture.plan(
      // biome-ignore lint/suspicious/noExplicitAny: a runtime replacement with the service field.
      Accounts.replaceOne({ name: "A" }, { ...base, createdAt: new Date(0) } as any),
    );
    await expect(StepHarness.full(plan)).rejects.toThrow(/service field "createdAt"/);
  });
});
