import { describe, expect, test } from "bun:test";
import { expectTypeError } from "@venloc/typemo-test-kit";

/*
 * The compile errors of the calls that used to bury their message: each is ONE diagnostic whose text carries the
 * message at once — not "No overload matches this call" with the useful line inside one overload, not an
 * intersection of a value's type with the error — and the same on every model.
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const QUERY_HEAD = `
import type { ModelOperations } from "../../src/index.ts";
import type { Member, Article, Note } from "./query/query-entities.ts";
declare const Members: ModelOperations<Member>;
declare const Articles: ModelOperations<Article>;
declare const Notes: ModelOperations<Note>;
`;
const POPULATE_HEAD = `
import type { HydratedDoc, ModelOperations } from "../../src/index.ts";
import type { Person } from "./populate/populate-entities.ts";
declare const People: ModelOperations<Person>;
declare const person: HydratedDoc<Person>;
`;
const AGGREGATE_HEAD = `import { fn, Pipeline } from "@venloc/typemo";
import { Order, StatusTotal } from "./aggregate-entities.ts";
`;

/**
 * The diagnostics of a snippet, each as code and text.
 * @param code - The snippet.
 * @returns The diagnostics.
 */
const errorsOf = (code: string) =>
  expectTypeError(code, { dir: FIXTURES }).diagnostics.map((d) => ({ code: d.code, message: d.message }));

describe("populate: one signature, the message in the error", () => {
  test.each([
    [
      "a path that does not exist",
      `${POPULATE_HEAD}People.find().populate("compny");`,
      'Invalid populate path \\"compny\\": unknown field \\"compny\\"',
    ],
    [
      "a path that is not a reference",
      `${POPULATE_HEAD}People.find().populate("name");`,
      'Invalid populate path \\"name\\": \\"name\\" is not a reference',
    ],
    [
      "a list with a wrong path",
      `${POPULATE_HEAD}People.find().populate(["company", "compny"]);`,
      'invalid populate path \\"compny\\": unknown field \\"compny\\"',
    ],
    [
      "an object with a rule broken",
      `${POPULATE_HEAD}People.find().populate({ path: "postCount", select: { title: 1 } });`,
      'a count virtual \\"postCount\\" takes no \\"select\\"',
    ],
    [
      "$populate with a path that does not exist",
      `${POPULATE_HEAD}person.$populate("compny");`,
      'Invalid populate path \\"compny\\": unknown field \\"compny\\"',
    ],
    [
      "$populate of a path below one populated already",
      `${POPULATE_HEAD}(async () => { const doc = await person.$populate("mentor"); doc.$populate("mentor.company"); })();`,
      '\\"mentor\\" is populated already: $depopulate(\\"mentor\\") first',
    ],
    [
      "$assertPopulated with a path that does not exist",
      `${POPULATE_HEAD}person.$assertPopulated("compny");`,
      'Invalid populate path \\"compny\\": unknown field \\"compny\\"',
    ],
  ])("%s", (_name, code, message) => {
    const errors = errorsOf(code);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain(message);
    expect(errors[0]?.message).not.toContain("No overload matches");
    expect(errors[0]?.message).not.toContain("Overload 1 of");
  });

  test("a populate object with a typo in an option keeps the compiler's suggestion", () => {
    const errors = errorsOf(`${POPULATE_HEAD}People.find().populate({ path: "company", selct: { name: 1 } });`);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("Did you mean to write 'select'?");
  });
});

describe("$group, $bucket and $bucketAuto: the message first", () => {
  test("a value that is not an accumulator: the error is PathError alone, not an intersection with the value", () => {
    const errors = errorsOf(
      `${AGGREGATE_HEAD}Pipeline.from(Order).group((f) => ({ _id: null, x: fn.add(f.total, 1) }));`,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(2741);
    expect(errors[0]?.message).toContain(
      'required in type \'PathError<"$group field \\"x\\" needs an accumulator (fn.sum, fn.avg, fn.push, fn.first, fn.count, ...)">\'',
    );
    expect(errors[0]?.message).not.toContain("& PathError");
  });

  test("two values: the messages are listed, not the name of a helper type", () => {
    const errors = errorsOf(
      `${AGGREGATE_HEAD}Pipeline.from(Order).group((f) => ({ _id: null, x: fn.add(f.total, 1), y: f.total }));`,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('$group field \\"x\\" needs an accumulator');
    expect(errors[0]?.message).toContain('$group field \\"y\\" needs an accumulator');
    expect(errors[0]?.message).not.toContain("AccumulatorProblems");
  });

  test("$bucket and $bucketAuto output name their stage", () => {
    const bucket = errorsOf(
      `${AGGREGATE_HEAD}Pipeline.from(Order).bucket({ groupBy: (f) => f.total, boundaries: [0, 10], output: (f) => ({ x: fn.add(f.total, 1) }) });`,
    );
    expect(bucket.map((e) => e.message).join("\n")).toContain('$bucket field \\"x\\" needs an accumulator');
    const auto = errorsOf(
      `${AGGREGATE_HEAD}Pipeline.from(Order).bucketAuto({ groupBy: (f) => f.total, buckets: 2, output: (f) => ({ x: fn.add(f.total, 1) }) });`,
    );
    expect(auto.map((e) => e.message).join("\n")).toContain('$bucketAuto field \\"x\\" needs an accumulator');
  });
});

describe("a typo in the _id of a group: one error, not two", () => {
  test("f.custmer in _id gives the unknown-field error alone (the accumulator check stays silent)", () => {
    const errors = errorsOf(
      `${AGGREGATE_HEAD}Pipeline.from(Order).group((f) => ({ _id: f.custmer, spent: fn.sum(f.total) }));`,
    );
    expect(errors.map((e) => e.code)).toEqual([2551]);
    expect(errors[0]?.message).toContain("Did you mean 'customer'?");
  });

  test("a typo in an accumulator argument is still one error, and a real mistake in the accumulators is still reported", () => {
    expect(
      errorsOf(`${AGGREGATE_HEAD}Pipeline.from(Order).group((f) => ({ _id: f.status, spent: fn.sum(f.totl) }));`).map(
        (e) => e.code,
      ),
    ).toEqual([2551]);
    const wrong = errorsOf(`${AGGREGATE_HEAD}Pipeline.from(Order).group((f) => ({ _id: f.status, spent: f.total }));`);
    expect(wrong[0]?.message).toContain("needs an accumulator");
  });
});

describe("$out and $merge: the target mismatch names the target model", () => {
  test("rows that miss a field of the target: PathError with the field, no view wording", () => {
    const errors = errorsOf(
      `${AGGREGATE_HEAD}Pipeline.from(Order).group((f) => ({ _id: f.status, total: fn.sum(f.total) })).out(StatusTotal);`,
    );
    const text = errors.map((e) => e.message).join("\n");
    expect(text).toContain('PathError<"the pipeline rows do not match the target model: check the field');
    expect(text).toContain('check the field \\"revenue\\"');
    expect(text).not.toContain("view class");
  });

  test("the same for the merge target", () => {
    const errors = errorsOf(
      `${AGGREGATE_HEAD}Pipeline.from(Order).group((f) => ({ _id: f.status, total: fn.sum(f.total) })).merge({ into: StatusTotal });`,
    );
    expect(errors.map((e) => e.message).join("\n")).toContain("the pipeline rows do not match the target model");
  });
});

describe("Pipeline.view: the message first", () => {
  test("project({ _id: 0 }) when the view class has an _id: one line naming the field", () => {
    const errors = errorsOf(
      `${AGGREGATE_HEAD}Pipeline.view(StatusTotal, { on: Order, pipeline: (p) => p.group((f) => ({ _id: f.status, revenue: fn.sum(f.total), orders: fn.count() })).project({ _id: 0, revenue: 1, orders: 1 }) });`,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(2741);
    expect(errors[0]?.message).toContain(
      'required in type \'PathError<"the pipeline result does not match the fields of the view class: check the field \\"_id\\"">\'',
    );
    expect(errors[0]?.message).not.toContain("& {");
  });

  test("rows that miss several fields: one message per field", () => {
    const errors = errorsOf(`${AGGREGATE_HEAD}Pipeline.view(StatusTotal, { on: Order, pipeline: (p) => p.limit(1) });`);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('check the field \\"revenue\\"');
    expect(errors[0]?.message).toContain('check the field \\"orders\\"');
  });
});

describe("select: the same message on every model, with Hidden fields or without", () => {
  const SELECT_MESSAGE =
    'Argument of type \'{ nope: 1; }\' is not assignable to parameter of type \'{ readonly nope: 1; } & { readonly "projection error": "unknown field \\"nope\\""; }\'.\n' +
    '  Property \'"projection error"\' is missing in type \'{ nope: 1; }\' but required in type \'{ readonly "projection error": "unknown field \\"nope\\""; }\'.';

  test.each([
    ["Members (has Hidden fields)", "Members.find()"],
    ["Articles (none)", "Articles.find()"],
    ["Notes (none)", "Notes.find()"],
    ["Members.findOne", "Members.findOne()"],
  ])("select({ nope: 1 }) on %s", (_name, start) => {
    const errors = errorsOf(`${QUERY_HEAD}${start}.select({ nope: 1 });`);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(2345);
    expect(errors[0]?.message).toBe(SELECT_MESSAGE);
  });

  test("a dotted path that does not exist, a mixed projection and a wrong flag", () => {
    expect(errorsOf(`${QUERY_HEAD}Members.find().select({ "profile.nope": 1 });`)[0]?.message).toContain(
      'unknown field \\"profile.nope\\"',
    );
    expect(errorsOf(`${QUERY_HEAD}Members.find().select({ name: 1, age: 0 });`)[0]?.message).toContain(
      'cannot mix inclusion (\\"name\\") and exclusion (\\"age\\") in one projection',
    );
    const flag = errorsOf(`${QUERY_HEAD}Members.find().select({ name: 2 });`);
    expect(flag[0]?.code).toBe(2322);
    expect(flag[0]?.message).toContain("Type '2' is not assignable to type 'ProjectionFlag'");
  });
});

describe("an empty filter literal in a write that changes or removes documents", () => {
  /** The text of a One form (one document at most) and of a Many form, the same words as the run-time error. */
  const ONE =
    "an empty filter would change or remove an arbitrary document; pass a filter, or Filters.all() to mean every document on purpose";
  const MANY =
    "an empty filter would affect every document; pass a filter, or Filters.all() to mean every document on purpose";
  test.each([
    ["updateOne", `Members.updateOne({}, { $set: { name: "a" } });`, ONE],
    ["updateMany", `Members.updateMany({}, { $set: { name: "a" } });`, MANY],
    ["deleteOne", "Members.deleteOne({});", ONE],
    ["deleteMany", "Members.deleteMany({});", MANY],
    ["replaceOne", `Members.replaceOne({}, { name: "a", email: "a@b.test" } as never);`, ONE],
    ["findOneAndUpdate", `Members.findOneAndUpdate({}, { $set: { name: "a" } });`, ONE],
    ["findOneAndReplace", `Members.findOneAndReplace({}, { name: "a", email: "a@b.test" } as never);`, ONE],
    ["findOneAndDelete", "Members.findOneAndDelete({});", ONE],
  ])("%s({}) says what it would do and what to write instead", (_name, call, message) => {
    const errors = errorsOf(`${QUERY_HEAD}${call}`);
    expect(errors.length).toBeGreaterThan(0);
    const text = errors.map((e) => e.message).join("\n");
    expect(text).toContain(message);
    expect(text).not.toContain(message === ONE ? MANY : ONE);
  });

  test("a read, a non-empty literal and Filters.all() compile", () => {
    expect(
      errorsOf(
        `${QUERY_HEAD}import { Filters } from "../../src/index.ts";\nMembers.find({});\nMembers.updateOne({ name: "a" }, { $set: { name: "b" } });\nMembers.deleteMany(Filters.all());`,
      ),
    ).toEqual([]);
  });
});
