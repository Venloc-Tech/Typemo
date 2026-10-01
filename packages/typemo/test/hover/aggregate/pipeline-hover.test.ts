import { describe, test } from "bun:test";
import { expectHover, expectTypeError } from "@venloc/typemo-test-kit";

/*
 * What the IDE shows for the document after each stage (quick info of the row type), and that the errors of the
 * builder are readable (the message names the field and the rule).
 */

const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;
const HEAD = `import { fn, Pipeline, Vars, withWindow, type RowOf } from "@venloc/typemo";
import { Customer, Employee, Order, Place } from "./aggregate-entities.ts";
`;
/** A probe source: the pipeline `chain`, its row type `R`, and the hover marker on it. */
const row = (chain: string): string => `${HEAD}const p = ${chain};\ntype R = RowOf<typeof p>;\n//   ^?`;

describe("hover: the document type after each stage", () => {
  test.each([
    [
      "$match keeps the stored document",
      'Pipeline.from(Customer).match({ tier: "gold" })',
      'type R = { name: string; email?: string; tier: "gold" | "silver"; address?: { city: string; zip: string | null; }; since: Date; _id: ObjectId; }',
    ],
    [
      "$addFields adds typed fields (a field below an optional parent is optional)",
      "Pipeline.from(Customer).addFields((f) => ({ city: f.address.city, n: fn.strLenCP(f.name) }))",
      'type R = { name: string; email?: string; tier: "gold" | "silver"; address?: { city: string; zip: string | null; }; since: Date; _id: ObjectId; n: number; city?: string; }',
    ],
    [
      "$project with a dotted path keeps only that path, optional under an optional parent",
      'Pipeline.from(Customer).project({ name: 1, "address.city": 1 })',
      "type R = { name: string; address?: { city: string; }; _id: ObjectId; }",
    ],
    [
      "$group: _id and accumulators",
      "Pipeline.from(Order).group((f) => ({ _id: f.status, revenue: fn.sum(f.total), n: fn.count() }))",
      'type R = { _id: "paid" | "open"; revenue: number; n: number; }',
    ],
    [
      "$unwind replaces the array by its element",
      'Pipeline.from(Order).unwind("$items").project({ items: 1 })',
      "type R = { items: { sku: string; price: number; qty?: number; tags?: string[]; }; _id: ObjectId; }",
    ],
    [
      "$lookup adds the joined documents under `as`",
      'Pipeline.from(Employee).lookup({ from: Employee, localField: "manager", foreignField: "_id", as: "boss" }).project({ boss: 1 })',
      "type R = { boss: { name: string; manager: Ref<Employee> | null; salary: number; _id: ObjectId; }[]; _id: ObjectId; }",
    ],
    [
      "$setWindowFields adds the outputs",
      'Pipeline.from(Order).project({ total: 1 }).setWindowFields({ sortBy: { total: 1 }, output: (f) => ({ rank: fn.rank(), run: withWindow(fn.sum(f.total), { documents: ["unbounded", "current"] }) }) })',
      "type R = { total: number; _id: ObjectId; rank: number; run: number; }",
    ],
    [
      "$facet: one array per branch",
      'Pipeline.from(Order).facet({ n: (b) => b.count("n"), s: (b) => b.sortByCount((f) => f.status) })',
      'type R = { n: { n: number; }[]; s: { _id: "paid" | "open"; count: number; }[]; }',
    ],
    [
      "$geoNear adds the distance field",
      'Pipeline.from(Place).geoNear({ near: [1, 2], distanceField: "d" }).project({ name: 1, d: 1 })',
      "type R = { name: string; d: number; _id: ObjectId; }",
    ],
  ])("%s", (_name, chain, expected) => {
    expectHover(row(chain), { dir: FIXTURES }).toBe(expected);
  });

  test("a builder shows its row, mode and state; a node shows its value type", () => {
    expectHover(`${HEAD}const p = Pipeline.from(Order).count("n");\n//    ^?`, { dir: FIXTURES }).toBe(
      'const p: PipelineBuilder<{ n: number; }, "collection", "staged">',
    );
    expectHover(`${HEAD}const n = fn.add(Vars.NOW, 1000);\n//    ^?`, { dir: FIXTURES }).toBe("const n: Expr<Date>");
  });
});

describe("readable errors of the builder", () => {
  test.each([
    [
      "a non-accumulator in $group names the field",
      "Pipeline.from(Order).group((f) => ({ _id: null, x: fn.add(f.total, 1) }))",
      '$group field \\"x\\" needs an accumulator',
    ],
    [
      "a window function without sortBy names the field",
      "Pipeline.from(Order).setWindowFields({ output: () => ({ r: fn.rank() }) })",
      '$setWindowFields output \\"r\\" needs sortBy',
    ],
    [
      "$derivative without a window",
      "Pipeline.from(Order).setWindowFields({ sortBy: { total: 1 }, output: (f) => ({ d: fn.derivative({ input: f.total }) }) })",
      "needs an explicit window: withWindow",
    ],
    [
      "a window function nested in an expression names the missing capability",
      "fn.gt(fn.rank(), 1)",
      "Property 'expr' is missing",
    ],
    [
      "a first-stage-only stage after another stage",
      'Pipeline.from(Place).limit(1).geoNear({ near: [1, 2], distanceField: "d" })',
      "'\"staged\"' is not assignable to type '\"empty\"'",
    ],
    [
      "a mixed projection",
      "Pipeline.from(Customer).project({ name: 1, email: 0 })",
      "cannot keep some fields and exclude others",
    ],
    [
      "a dotted write into an array",
      'Pipeline.from(Order).addFields(() => ({ "items.x": 1 }))',
      "is an array: a dotted key would write into every element",
    ],
    [
      "$out rows that do not fit the entity",
      "Pipeline.from(Order).limit(1).out(Customer)",
      "the pipeline rows do not match the target model",
    ],
    ["$count into a path", 'Pipeline.from(Order).count("a.b")', "cannot be empty, start with $ or contain a dot"],
    ["a typo in $sort", "Pipeline.from(Order).sort({ totl: 1 })", "is not a path of the document"],
    [
      "fn.accumulator: server-side JavaScript is a compile error naming the $group accumulators",
      "Pipeline.from(Order).group((f) => ({ _id: null, n: fn.accumulator({ init: () => 0, accumulate: (n: number) => n + 1, accumulateArgs: [f.total], merge: (a: number, b: number) => a + b }) }))",
      "fn.accumulator: server-side JavaScript ($accumulator) is not supported: it runs with the rights of the database and cannot be checked against the schema; use the $group accumulators instead (fn.sum, fn.avg, fn.push, fn.addToSet, fn.top, fn.firstN, fn.mergeObjects, ...)",
    ],
    [
      "fn.function: server-side JavaScript is a compile error naming the $expr operators",
      "Pipeline.from(Order).project((f) => ({ next: fn.function({ body: (n: number) => n + 1, args: [f.total] }) }))",
      "fn.function: server-side JavaScript ($function) is not supported: it runs with the rights of the database and cannot be checked against the schema; use the $expr operators instead (fn.cond, fn.switch, fn.map, fn.filter, fn.reduce, fn.let, ...)",
    ],
  ])("%s", (_name, code, fragment) => {
    expectTypeError(`${HEAD}${code};`, { dir: FIXTURES }).toContain(fragment);
  });
});
