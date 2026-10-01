/*
 * `GuardScan.clean` is one walk standing in for the four walking guards of `normalize` (undefined, sanitize,
 * empty logical, limit). The rule it must keep: it never says "clean" for input one of the four refuses (then the
 * step would skip them and let the input through). It may say "not clean" for input they accept — the step then
 * runs the guards, which decide. Checked by a differential run over generated input (a fixed seed: deterministic)
 * and by one hand-written case per rule of each guard.
 */
import { describe, expect, test } from "bun:test";
import { ObjectId } from "mongodb";
import {
  InstrumentationHub,
  OperationContext,
  type OperationEnvironment,
  SchemaCompiler,
  StrictModeError,
} from "../../../src/internal.ts";
import type { ExecutionPlan } from "../../../src/operation/pipeline/execution-plan.ts";
import { EmptyLogicalPolicy } from "../../../src/policies/empty-logical-policy.ts";
import { type GuardPosition, GuardScan } from "../../../src/policies/guard-scan.ts";
import { LimitPolicy } from "../../../src/policies/limit-policy.ts";
import { SanitizePolicy } from "../../../src/policies/sanitize-policy.ts";
import { UndefinedPolicy } from "../../../src/policies/undefined-policy.ts";
import { Person } from "../../fixtures/model/model-entities.ts";

const environment: OperationEnvironment = {
  ready: () => undefined,
  driver: {} as OperationEnvironment["driver"],
  instrumentation: new InstrumentationHub(undefined),
  connectionName: "unit",
  owner: {},
  linksDriverCommands: () => false,
  validateReads: false,
  schemaOfCollection: () => undefined,
};
const target = {
  entity: Person,
  schema: SchemaCompiler.compileModel(Person),
  collection: "m_people",
  database: "unit",
};
/** The four walking guards `GuardScan` stands in for. */
const guards = [new UndefinedPolicy(), new SanitizePolicy(), new EmptyLogicalPolicy(), new LimitPolicy()] as const;

/** An `OperationContext` over the raw `plan`. */
const context = (plan: Record<string, unknown>): OperationContext =>
  new OperationContext({
    /* cast: generated plans on purpose, including shapes the builders would refuse */
    plan: { entity: Person, options: {}, ...plan } as unknown as ExecutionPlan,
    mode: "run",
    target,
    environment,
  });

/** What the four guards say: `undefined` when they accept, else the error they throw. */
const verdict = (ctx: OperationContext): unknown => {
  try {
    for (const guard of guards) guard.run(ctx);
    return undefined;
  } catch (error) {
    return error;
  }
};

// ---- a small seeded generator of raw input ------------------------------------------------------------------------

let seed = 20_260_928;
/** A deterministic pseudo-random number in [0, 1). */
const random = (): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};
/** A random element of `items`. */
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
/** True with probability `p`. */
const chance = (p: number): boolean => random() < p;

const FIELDS = ["name", "age", "tags", "address.city", "pets"];
const FIELD_OPS = [
  "$eq",
  "$ne",
  "$gt",
  "$in",
  "$nin",
  "$all",
  "$exists",
  "$not",
  "$elemMatch",
  "$regex",
  "$size",
  "$near",
];
const ODD_OPS = ["$where", "$function", "$accumulator", "$and", "$expr", "$foo", "$literal", "$text"];

/** A random scalar value, sometimes `undefined`. */
const scalar = (): unknown =>
  pick<() => unknown>([
    () => 1,
    () => "s",
    () => null,
    () => true,
    () => new Date(0),
    () => new ObjectId(),
    () => (chance(0.3) ? undefined : 2),
  ])();

/** A random literal: a scalar, an array, a Map or an object that may hold odd operator keys. */
const literal = (depth: number): unknown => {
  if (depth <= 0 || chance(0.6)) return scalar();
  if (chance(0.3)) return Array.from({ length: Math.floor(random() * 3) }, () => literal(depth - 1));
  if (chance(0.1)) return new Map([["k", literal(depth - 1)]]);
  const out: Record<string, unknown> = {};
  for (let i = 0; i < 1 + Math.floor(random() * 2); i++)
    out[chance(0.15) ? pick(ODD_OPS) : pick(["x", "y"])] = literal(depth - 1);
  return out;
};

/** A random field condition: a literal or an object of field operators. */
const condition = (depth: number): unknown => {
  if (chance(0.4)) return literal(depth);
  const out: Record<string, unknown> = {};
  for (let i = 0; i < 1 + Math.floor(random() * 2); i++) {
    const op = chance(0.12) ? pick(ODD_OPS) : pick(FIELD_OPS);
    out[op] =
      op === "$in" || op === "$nin" || op === "$all"
        ? chance(0.8)
          ? Array.from({ length: Math.floor(random() * 3) }, () =>
              op === "$all" && chance(0.3) ? { $elemMatch: filter(depth - 1) } : literal(depth - 1),
            )
          : literal(depth - 1)
        : op === "$not"
          ? chance(0.5)
            ? condition(depth - 1)
            : /x/
          : op === "$elemMatch"
            ? chance(0.5)
              ? filter(depth - 1)
              : condition(depth - 1)
            : literal(depth - 1);
  }
  if (chance(0.08)) out.mixed = 1;
  return out;
};

/** A random filter, sometimes malformed. */
const filter = (depth: number): unknown => {
  if (chance(0.03)) return pick([1, "x", null, undefined]);
  const out: Record<string, unknown> = {};
  for (let i = 0; i < Math.floor(random() * 3); i++) {
    const roll = random();
    if (roll < 0.15 && depth > 0) {
      out[pick(["$and", "$or", "$nor"])] = chance(0.15)
        ? chance(0.5)
          ? []
          : literal(1)
        : Array.from({ length: 1 + Math.floor(random() * 2) }, () => filter(depth - 1));
    } else if (roll < 0.25) {
      const key = pick(["$expr", "$comment", "$where", "$text", "$eq"]);
      out[key] = key === "$expr" ? { $gt: [chance(0.1) ? { $function: {} } : "$age", 1] } : literal(1);
    } else {
      out[pick(FIELDS)] = condition(depth);
    }
  }
  return out;
};

/** A random aggregation pipeline. */
const stages = (depth: number): unknown[] =>
  Array.from({ length: Math.floor(random() * 4) }, () => {
    const kind = random();
    if (kind < 0.25) return { $match: filter(2) };
    if (kind < 0.35) return { $limit: pick([1, 5, 0, -1, 1.5, "2"]) };
    if (kind < 0.42) return { $skip: pick([0, 3, -1, 0.5]) };
    if (kind < 0.52)
      return { $addFields: { x: chance(0.15) ? { $function: { body: "" } } : { $add: ["$age", literal(1)] } } };
    if (kind < 0.6 && depth > 0) return { $lookup: { from: "m_pets", as: "p", pipeline: stages(depth - 1) } };
    if (kind < 0.66 && depth > 0) return { $facet: { a: stages(depth - 1), b: chance(0.1) ? 1 : stages(depth - 1) } };
    if (kind < 0.72) return { $geoNear: { near: [0, 0], key: "loc", distanceField: "d", query: filter(1) } };
    if (kind < 0.78)
      return {
        $graphLookup: {
          from: "m_people",
          startWith: "$a",
          connectFromField: "a",
          connectToField: "b",
          as: "g",
          restrictSearchWithMatch: filter(1),
        },
      };
    if (kind < 0.84 && depth > 0) return { $unionWith: { coll: "m_pets", pipeline: stages(depth - 1) } };
    if (kind < 0.9) return { $group: { _id: "$name", n: { $sum: chance(0.1) ? undefined : 1 } } };
    return chance(0.1) ? { $where: "1" } : { $project: { name: 1 } };
  });

/** A random update document or update pipeline. */
const update = (): unknown => {
  const roll = random();
  if (roll < 0.15) return stages(1);
  const out: Record<string, unknown> = {};
  out[pick(["$set", "$inc", "$push", "$pull", "$where", "$unset"])] = {
    [pick(FIELDS)]: chance(0.5) ? condition(1) : literal(1),
  };
  return out;
};

/** A random raw operation plan. */
const plan = (): Record<string, unknown> => {
  switch (pick(["find", "updateOne", "aggregate", "insertMany", "bulkWrite"] as const)) {
    case "find":
      return {
        op: "find",
        filter: filter(3),
        populate: chance(0.3)
          ? [{ path: "pets", match: filter(1), options: { limit: pick([1, 0, undefined]) }, populate: [] }]
          : [],
        ...(chance(0.2) ? { limit: pick([1, 0, -2, 2.5]) } : {}),
        ...(chance(0.2) ? { skip: pick([0, 1, -1]) } : {}),
        ...(chance(0.2) ? { projection: { name: chance(0.1) ? undefined : 1 } } : {}),
      };
    case "updateOne":
      return {
        op: "updateOne",
        filter: filter(2),
        update: update(),
        upsert: false,
        ...(chance(0.2) ? { arrayFilters: [filter(1), ...(chance(0.1) ? [undefined] : [])] } : {}),
      };
    case "aggregate":
      return { op: "aggregate", pipeline: stages(2), aggregateOptions: {} };
    case "insertMany":
      return { op: "insertMany", documents: [literal(3), literal(2)], ordered: true };
    default:
      return {
        op: "bulkWrite",
        operations: [
          { updateOne: { filter: filter(2), update: update() } },
          { deleteMany: { filter: filter(2) } },
          { insertOne: { document: literal(2) } },
        ],
        ordered: true,
      };
  }
};

describe("GuardScan never passes what a walking guard refuses", () => {
  test("differential run over 20 000 generated operations", () => {
    let clean = 0;
    let refused = 0;
    const misses: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const ctx = context(plan());
      const scan = GuardScan.clean(ctx);
      const error = verdict(ctx);
      if (scan) clean++;
      if (error !== undefined) refused++;
      if (scan && error !== undefined) misses.push(`${ctx.op}: ${(error as Error).message}`);
    }
    expect(misses).toEqual([]);
    /* The run is meaningful: both outcomes are common. */
    expect(clean).toBeGreaterThan(2_000);
    expect(refused).toBeGreaterThan(2_000);
  });

  const refusedCases: readonly (readonly [string, Record<string, unknown>])[] = [
    ["undefined in a filter", { op: "find", filter: { name: undefined }, populate: [] }],
    ["undefined in a document", { op: "insertMany", documents: [{ a: { b: [undefined] } }], ordered: true }],
    ["undefined in a projection", { op: "find", filter: {}, projection: { name: undefined }, populate: [] }],
    ["undefined in a Map", { op: "insertMany", documents: [{ m: new Map([["k", undefined]]) }], ordered: true }],
    ["$where at the top", { op: "find", filter: { $where: "1" }, populate: [] }],
    ["$function inside $expr", { op: "find", filter: { $expr: { $function: { body: "" } } }, populate: [] }],
    ["a field operator at the top", { op: "find", filter: { $eq: 1 }, populate: [] }],
    ["operators mixed with fields", { op: "find", filter: { name: { $ne: 1, x: 1 } }, populate: [] }],
    ["an operator inside a value", { op: "find", filter: { name: { $eq: { $ne: null } } }, populate: [] }],
    ["an operator inside $in", { op: "find", filter: { name: { $in: [{ $gt: "" }] } }, populate: [] }],
    ["a $-key inside a literal", { op: "find", filter: { address: { city: { $ne: 1 } } }, populate: [] }],
    ["an unknown operator", { op: "find", filter: { name: { $foo: 1 } }, populate: [] }],
    ["an empty $or", { op: "find", filter: { $or: [] }, populate: [] }],
    ["an empty $and in $elemMatch", { op: "find", filter: { pets: { $elemMatch: { $and: [] } } }, populate: [] }],
    ["a non-object clause", { op: "find", filter: { $or: [1] }, populate: [] }],
    ["limit 0", { op: "find", filter: {}, limit: 0, populate: [] }],
    ["skip -1", { op: "find", filter: {}, skip: -1, populate: [] }],
    ["populate limit 0", { op: "find", filter: {}, populate: [{ path: "p", options: { limit: 0 }, populate: [] }] }],
    [
      "populate match $where",
      { op: "find", filter: {}, populate: [{ path: "p", match: { $where: "1" }, populate: [] }] },
    ],
    [
      "$limit 0 in a $lookup",
      {
        op: "aggregate",
        pipeline: [{ $lookup: { from: "x", as: "y", pipeline: [{ $limit: 0 }] } }],
        aggregateOptions: {},
      },
    ],
    [
      "$function in $addFields",
      { op: "aggregate", pipeline: [{ $addFields: { x: { $function: {} } } }], aggregateOptions: {} },
    ],
    [
      "an empty $nor in $facet",
      { op: "aggregate", pipeline: [{ $facet: { a: [{ $match: { $nor: [] } }] } }], aggregateOptions: {} },
    ],
    [
      "a bad $geoNear query",
      { op: "aggregate", pipeline: [{ $geoNear: { query: { $where: "1" } } }], aggregateOptions: {} },
    ],
    [
      "a $pull condition with $where",
      { op: "updateOne", filter: { name: "a" }, update: { $pull: { tags: { $where: "1" } } }, upsert: false },
    ],
    ["an update with $where", { op: "updateOne", filter: { name: "a" }, update: { $where: {} }, upsert: false }],
    [
      "arrayFilters with undefined",
      {
        op: "updateOne",
        filter: { name: "a" },
        update: { $set: { name: "b" } },
        arrayFilters: [undefined],
        upsert: false,
      },
    ],
  ];
  for (const [what, input] of refusedCases) {
    test(`refused by a guard, not clean: ${what}`, () => {
      const ctx = context(input);
      expect(verdict(ctx)).toBeInstanceOf(StrictModeError);
      expect(GuardScan.clean(ctx)).toBe(false);
    });
  }

  test("the typed shapes of the builders are clean (the fast path is taken)", () => {
    const find = context({
      op: "find",
      filter: {
        name: { $in: ["a", "b"] },
        age: { $gte: 18, $lt: 65 },
        $or: [{ tags: "x" }, { pets: { $elemMatch: { name: "rex" } } }],
      },
      populate: [{ path: "pets", match: { name: { $ne: null } }, options: { limit: 5 }, populate: [] }],
      limit: 10,
      skip: 0,
    });
    const aggregate = context({
      op: "aggregate",
      pipeline: [
        { $match: { age: { $gte: 1 } } },
        { $addFields: { net: { $multiply: ["$age", 2] } } },
        { $group: { _id: "$name", n: { $sum: 1 } } },
        {
          $lookup: {
            from: "m_pets",
            as: "p",
            pipeline: [{ $match: { $expr: { $eq: ["$a", "$$b"] } } }, { $limit: 3 }],
          },
        },
        { $facet: { a: [{ $skip: 1 }], b: [{ $sort: { n: -1 } }] } },
      ],
      aggregateOptions: {},
    });
    const write = context({
      op: "updateOne",
      filter: { _id: new ObjectId() },
      update: { $set: { name: "b" }, $inc: { age: 1 } },
      upsert: false,
    });
    for (const ctx of [find, aggregate, write]) {
      expect(verdict(ctx)).toBeUndefined();
      expect(GuardScan.clean(ctx)).toBe(true);
    }
  });
});

/*
 * Each guard declares the positions it checks; `GuardScan` must follow every one. The cases are typed by the
 * guard's `POSITIONS`: a position added to a guard does not compile until it has a case here, and the case must
 * be refused by THAT guard and not be clean for `GuardScan`.
 */
describe("every position a guard declares is followed by GuardScan", () => {
  /** A raw operation plan. */
  type Plan = Record<string, unknown>;
  /** One case per position `P` a guard declares. */
  type Cases<P extends readonly GuardPosition[]> = { readonly [K in P[number]]: Plan };

  const find = (extra: Plan): Plan => ({ op: "find", filter: {}, populate: [], ...extra });
  const update = (extra: Plan): Plan => ({ op: "updateOne", filter: { name: "a" }, upsert: false, ...extra });
  const aggregate = (...pipeline: unknown[]): Plan => ({ op: "aggregate", pipeline, aggregateOptions: {} });
  const geoNear = (query: unknown) => ({ $geoNear: { near: [0, 0], key: "loc", distanceField: "d", query } });
  const graphLookup = (restrictSearchWithMatch: unknown) => ({
    $graphLookup: {
      from: "m_people",
      startWith: "$a",
      connectFromField: "a",
      connectToField: "b",
      as: "g",
      restrictSearchWithMatch,
    },
  });
  const lookup = (...pipeline: unknown[]) => ({ $lookup: { from: "m_pets", as: "p", pipeline } });
  const unionWith = (...pipeline: unknown[]) => ({ $unionWith: { coll: "m_pets", pipeline } });
  const facet = (...pipeline: unknown[]) => ({ $facet: { a: pipeline } });
  const populate = (entry: Plan): Plan => find({ populate: [{ path: "pets", populate: [], ...entry }] });
  const nested = (entry: Plan): Plan =>
    find({ populate: [{ path: "pets", populate: [{ path: "owner", populate: [], ...entry }] }] });

  /** An operator inside a value (sanitize), an empty logical list, a zero limit. */
  const injected = { name: { $eq: { $ne: null } } };
  const empty = { $or: [] };

  const sanitize: Cases<typeof SanitizePolicy.POSITIONS> = {
    filter: find({ filter: injected }),
    arrayFilters: update({ update: { $set: { name: "b" } }, arrayFilters: [injected] }),
    update: update({ update: { $where: {} } }),
    "update.$pull": update({ update: { $pull: { tags: { $where: "1" } } } }),
    updatePipeline: update({ update: [{ $set: { x: { $function: { body: "" } } } }] }),
    pipeline: aggregate({ $addFields: { x: { $function: { body: "" } } } }),
    "pipeline.$match": aggregate({ $match: injected }),
    "pipeline.$geoNear.query": aggregate(geoNear(injected)),
    "pipeline.$graphLookup.restrictSearchWithMatch": aggregate(graphLookup(injected)),
    "pipeline.$lookup.pipeline": aggregate(lookup({ $match: injected })),
    "pipeline.$unionWith.pipeline": aggregate(unionWith({ $match: injected })),
    "pipeline.$facet": aggregate(facet({ $match: injected })),
    "populate.match": populate({ match: injected }),
    "populate.populate": nested({ match: injected }),
  };
  const undefinedCases: Cases<typeof UndefinedPolicy.POSITIONS> = {
    filter: find({ filter: { name: undefined } }),
    arrayFilters: update({ update: { $set: { name: "b" } }, arrayFilters: [{ x: undefined }] }),
    update: update({ update: { $set: { name: undefined } } }),
    updatePipeline: update({ update: [{ $set: { name: undefined } }] }),
    replacement: { op: "replaceOne", filter: { name: "a" }, replacement: { name: undefined }, upsert: false },
    document: { op: "insertMany", documents: [{ name: undefined }], ordered: true },
    pipeline: aggregate({ $project: { name: undefined } }),
    projection: find({ projection: { name: undefined } }),
  };
  const emptyLogical: Cases<typeof EmptyLogicalPolicy.POSITIONS> = {
    filter: find({ filter: empty }),
    arrayFilters: update({ update: { $set: { name: "b" } }, arrayFilters: [empty] }),
    "update.$pull": update({ update: { $pull: { tags: empty } } }),
    "pipeline.$match": aggregate({ $match: empty }),
    "pipeline.$geoNear.query": aggregate(geoNear(empty)),
    "pipeline.$graphLookup.restrictSearchWithMatch": aggregate(graphLookup(empty)),
    "pipeline.$lookup.pipeline": aggregate(lookup({ $match: empty })),
    "pipeline.$unionWith.pipeline": aggregate(unionWith({ $match: empty })),
    "pipeline.$facet": aggregate(facet({ $match: empty })),
    "populate.match": populate({ match: empty }),
    "populate.populate": nested({ match: empty }),
  };
  const limit: Cases<typeof LimitPolicy.POSITIONS> = {
    limit: find({ limit: 0 }),
    skip: find({ skip: -1 }),
    "populate.limit": populate({ options: { limit: 0 } }),
    "populate.perDocumentLimit": populate({ perDocumentLimit: 0 }),
    "populate.skip": populate({ options: { skip: -1 } }),
    "pipeline.$limit": aggregate({ $limit: 0 }),
    "pipeline.$skip": aggregate({ $skip: -1 }),
    "pipeline.$lookup.pipeline": aggregate(lookup({ $limit: 0 })),
    "pipeline.$unionWith.pipeline": aggregate(unionWith({ $limit: 0 })),
    "pipeline.$facet": aggregate(facet({ $limit: 0 })),
  };

  const matrix = [
    ["SanitizePolicy", new SanitizePolicy(), SanitizePolicy.POSITIONS, sanitize],
    ["UndefinedPolicy", new UndefinedPolicy(), UndefinedPolicy.POSITIONS, undefinedCases],
    ["EmptyLogicalPolicy", new EmptyLogicalPolicy(), EmptyLogicalPolicy.POSITIONS, emptyLogical],
    ["LimitPolicy", new LimitPolicy(), LimitPolicy.POSITIONS, limit],
  ] as const satisfies readonly (readonly [
    string,
    { run(ctx: OperationContext): void },
    readonly GuardPosition[],
    Readonly<Record<string, Plan>>,
  ])[];

  test("every declared position is one GuardScan follows", () => {
    for (const [name, , positions] of matrix) {
      const missing = positions.filter((position) => !GuardScan.POSITIONS.has(position));
      expect({ name, missing }).toEqual({ name, missing: [] });
    }
  });

  for (const [name, guard, positions, cases] of matrix) {
    test(`${name}: at each declared position, input it refuses is not clean for GuardScan`, () => {
      for (const position of positions) {
        const ctx = context((cases as Readonly<Record<string, Plan>>)[position] as Plan);
        let refused: unknown;
        try {
          guard.run(ctx);
        } catch (error) {
          refused = error;
        }
        expect({ position, refused: refused instanceof StrictModeError }).toEqual({ position, refused: true });
        expect({ position, clean: GuardScan.clean(ctx) }).toEqual({ position, clean: false });
      }
    });
  }
});
