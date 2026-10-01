/*
 * Group N — cast and validation micro-benchmarks (no server).
 *  - N.cast.filter.<op> / N.cast.update.<op>: request-like input (ids and dates as strings, as JSON gives them)
 *    cast by the schema. Typemo: `CastStep.unit(schema, unit)` — the pure `cast` slot of the operation pipeline
 *    (the policy slots — strict paths, sanitize, undefined — are NOT included). Mongoose: `Query#_castConditions()`
 *    / `Query#_castUpdate()` on a built query (internal methods; the query construction is included, as it is
 *    how Mongoose reaches its cast). Both get a fresh input per run (Mongoose casts in place).
 *  - N.cast.document: `Model.castObject(input)` on both sides (a dirty HTTP body: strings → ObjectId/Date).
 *  - N.validate.{10,100,1000}: a new document with K required numeric fields, each with a `>= 0` validator:
 *    `Model.new(input).$validate()` vs `new Model(input).validate()` (construction = cast, included on both sides).
 * Verification: the cast output is canonicalised (ObjectId → hex, Date → ISO) and must be equal.
 * Bench-only: the cast slot is internal to Typemo; the bench measures it directly.
 */

import type { Model } from "@venloc/typemo";
import type { Document } from "mongodb";
import type { Model as MModel } from "mongoose";
import { CastStep, ModelInternals } from "../../../typemo/src/internal.ts";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName } from "../harness/types.ts";
import { BbChecksum } from "./support-bb/bb-checksum.ts";
import { N_VALIDATED, NCast, NMongoose } from "./support-bb/cast-models.ts";
import { ISeed } from "./support-bb/populate-models.ts";

/**
 * The unit the cast slot of Typemo's operation pipeline takes.
 *
 * @example
 * ```ts
 * const unit: CastUnit = { kind: "find", index: 0, filter: {}, upsert: false };
 * ```
 */
type CastUnit = Parameters<typeof CastStep.unit>[1];

/** The internal Mongoose query methods its own exec uses to cast (not in its public types). */
interface MongooseCastInternals {
  /** Casts the query filter in place. */
  _castConditions(): void;
  /**
   * Casts an update.
   *
   * @param update - The update document.
   * @returns The cast update.
   */
  _castUpdate(update: unknown): unknown;
  /**
   * The error a cast recorded, if any.
   *
   * @returns The error or a falsy value.
   */
  error(): unknown;
  /**
   * The filter after casting.
   *
   * @returns The filter.
   */
  getFilter(): unknown;
  /**
   * The update of the query.
   *
   * @returns The update.
   */
  getUpdate(): unknown;
}

/**
 * A loosely typed document.
 *
 * @example
 * ```ts
 * const doc: Doc = { n: 1 };
 * ```
 */
type Doc = Record<string, unknown>;

/**
 * The hex text of a deterministic id.
 *
 * @param i - The index.
 * @returns A 24-character hex string.
 */
const hex = (i: number): string => ISeed.oid(0x50, i).toHexString();
/**
 * The ISO text of a day of January 2026.
 *
 * @param day - The day of the month.
 * @returns The ISO date string.
 */
const ISO = (day: number): string => new Date(Date.UTC(2026, 0, day)).toISOString();

/**
 * One cast case: a filter or an update given as request-like input.
 *
 * @example
 * ```ts
 * const c: NCastCase = { key: "filter.eq", title: "eq", kind: "filter", input: () => ({ n: 1 }) };
 * ```
 */
interface NCastCase {
  /** Short key, part of the scenario id. */
  readonly key: string;
  /** Description of the input. */
  readonly title: string;
  /** Whether the input is a filter or an update. */
  readonly kind: "filter" | "update";
  /** Builds a fresh input, because Mongoose casts in place. */
  readonly input: () => Doc;
  /** Set when the `quick` profile runs this case too. */
  readonly quick?: true;
}

/** Every cast case. */
const CASES: readonly NCastCase[] = [
  { key: "filter.eq", title: "{ userId: '<hex>' }", kind: "filter", input: () => ({ userId: hex(1) }), quick: true },
  {
    key: "filter.in",
    title: "{ userId: { $in: [20 × '<hex>'] } }",
    kind: "filter",
    input: () => ({ userId: { $in: Array.from({ length: 20 }, (_, i) => hex(i)) } }),
  },
  {
    key: "filter.range",
    title: "date range (ISO strings) + number range",
    kind: "filter",
    input: () => ({ at: { $gte: ISO(1), $lt: ISO(32) }, n: { $gt: 5, $lte: 100 } }),
  },
  {
    key: "filter.regex",
    title: "{ name: { $regex, $options } }",
    kind: "filter",
    input: () => ({ name: { $regex: "^ab", $options: "i" } }),
  },
  {
    key: "filter.elemMatch",
    title: "{ items: { $elemMatch: { sku, qty: { $gte } } } }",
    kind: "filter",
    input: () => ({ items: { $elemMatch: { sku: "s1", qty: { $gte: 2 } } } }),
  },
  {
    key: "filter.logical",
    title: "$or of three branches with a nested $and and dotted paths",
    kind: "filter",
    input: () => ({
      $or: [
        { name: "a" },
        { n: { $in: [1, 2, 3] } },
        { $and: [{ "profile.age": { $gte: 18 } }, { "profile.city": "Oslo" }, { userId: hex(2) }] },
      ],
    }),
  },
  {
    key: "update.set",
    title: "$set of 5 paths (hex id, ISO date, dotted path)",
    kind: "update",
    input: () => ({ $set: { name: "x", n: 5, at: ISO(3), userId: hex(3), "profile.city": "Oslo" } }),
  },
  {
    key: "update.inc",
    title: "$inc of 2 paths",
    kind: "update",
    input: () => ({ $inc: { n: 1, "profile.age": 1 } }),
  },
  {
    key: "update.push",
    title: "$push $each of strings + a subdocument",
    kind: "update",
    input: () => ({ $push: { tags: { $each: ["a", "b"] }, items: { $each: [{ sku: "s", qty: 1 }] } } }),
  },
];

/**
 * The outcome of a cast result.
 *
 * @param value - The cast filter, update or document.
 * @returns The outcome over its canonical form.
 */
const castOutcome = (value: unknown): Outcome => ({ count: 1, checksum: BbChecksum.of([BbChecksum.canonical(value)]) });

/** Casts one filter or update. */
class CastScenario extends Scenario {
  readonly id: string;
  readonly group = "N" as const;
  readonly title: string;
  readonly profiles: readonly ProfileName[];
  override readonly contestants: readonly ContestantId[] = ["mongoose", "typemo"];
  override readonly notes =
    "No server. Typemo: CastStep.unit (cast slot only). Mongoose: Model.find/updateOne(...) + _castConditions/_castUpdate. " +
    "mongoose-safe skipped: sanitizeFilter would wrap the operators of this trusted input in $eq.";

  /**
   * @param c - The case to run.
   */
  constructor(private readonly c: NCastCase) {
    super();
    this.id = `N.cast.${c.key}`;
    this.title = `cast ${c.kind}: ${c.title}`;
    this.profiles = c.quick === true ? ["quick", "standard", "full"] : ["standard", "full"];
  }

  /**
   * Builds a contestant that casts the case's input.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const c = this.c;
    return ScenarioKit.pick(
      {
        typemo: () => {
          const schema = ModelInternals.schema(env.ctx.typemo.model(NCast));
          return ScenarioKit.impl<unknown>({
            run: () => {
              const unit: CastUnit =
                c.kind === "filter"
                  ? { kind: "find", index: 0, filter: c.input(), upsert: false }
                  : { kind: "updateOne", index: 0, filter: {}, update: c.input(), upsert: false };
              const cast = CastStep.unit(schema, unit);
              return c.kind === "filter" ? cast.filter : cast.update;
            },
            verify: castOutcome,
          });
        },
        mongoose: () => {
          const Casts = NMongoose.cast(env.ctx.mongoose);
          return ScenarioKit.impl<unknown>({
            run: () => {
              if (c.kind === "filter") {
                const query = Casts.find(c.input()) as unknown as MongooseCastInternals;
                query._castConditions();
                const error = query.error();
                if (error) throw error;
                return query.getFilter();
              }
              const query = Casts.updateOne({}, c.input()) as unknown as MongooseCastInternals;
              return query._castUpdate(query.getUpdate());
            },
            verify: castOutcome,
          });
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/**
 * A dirty HTTP body for a whole document: ids and dates as strings.
 *
 * @returns A fresh body.
 */
const DIRTY_BODY = (): Doc => ({
  userId: hex(7),
  at: ISO(9),
  n: 42,
  name: "ann",
  tags: ["a", "b", "c"],
  items: [
    { sku: "s1", qty: 1 },
    { sku: "s2", qty: 2 },
  ],
  profile: { age: 31, city: "Oslo" },
});

/** `castObject` of a whole dirty body. */
class CastDocument extends Scenario {
  readonly id = "N.cast.document";
  readonly group = "N" as const;
  readonly title = "castObject of a dirty HTTP body (hex id, ISO date, subdocuments)";
  readonly profiles: readonly ProfileName[] = ["standard", "full"];
  override readonly contestants: readonly ContestantId[] = ["mongoose", "typemo"];

  /**
   * Builds a contestant that casts the dirty body.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    return ScenarioKit.pick(
      {
        typemo: () => {
          const Casts: Model<NCast> = env.ctx.typemo.model(NCast);
          return ScenarioKit.impl<unknown>({ run: () => Casts.castObject(DIRTY_BODY()), verify: castOutcome });
        },
        mongoose: () => {
          const Casts = NMongoose.cast(env.ctx.mongoose);
          return ScenarioKit.impl<unknown>({ run: () => Casts.castObject(DIRTY_BODY()), verify: castOutcome });
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** Constructs a document and validates it, for a number of validated fields. */
class ValidateScenario extends Scenario {
  readonly id: string;
  readonly group = "N" as const;
  readonly title: string;
  readonly profiles: readonly ProfileName[];
  override readonly contestants: readonly ContestantId[] = ["mongoose", "typemo"];
  override readonly notes =
    "Fields added by a Typemo plugin (so K is a parameter) / a generated Mongoose schema. Each field: " +
    "required Number + a synchronous `>= 0` validator. Construction (cast) + validation, both sides.";

  /**
   * @param fields - How many validated fields the document has.
   */
  constructor(private readonly fields: 10 | 100 | 1000) {
    super();
    this.id = `N.validate.${fields}`;
    this.title = `new document + validate, ${fields} validated fields`;
    this.profiles = fields === 100 ? ["quick", "standard", "full"] : ["standard", "full"];
  }

  /**
   * Builds a contestant that constructs and validates a document.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const input: Doc = Object.fromEntries(Array.from({ length: this.fields }, (_, i) => [`f${i}`, i]));
    const outcome = (doc: unknown): Outcome => {
      let sum = 0;
      for (let i = 0; i < this.fields; i++) sum += Number((doc as Document)[`f${i}`]);
      return { count: this.fields, checksum: `sum=${sum}` };
    };
    return ScenarioKit.pick(
      {
        typemo: () => {
          /* Plugin fields are not in the class type, hence the untyped input. */
          const Validated = env.ctx.typemo.model(N_VALIDATED[this.fields]);
          return ScenarioKit.impl<unknown>({
            run: async () => {
              const doc = Validated.new(input as never);
              await doc.$validate();
              return doc;
            },
            verify: outcome,
          });
        },
        mongoose: () => {
          const Validated: MModel<Doc> = NMongoose.validated(env.ctx.mongoose, this.fields);
          return ScenarioKit.impl<unknown>({
            run: async () => {
              const doc = new Validated(input);
              await doc.validate();
              return doc;
            },
            verify: outcome,
          });
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** The scenarios of group N. */
export const SCENARIOS: readonly Scenario[] = [
  ...CASES.map((c) => new CastScenario(c)),
  new CastDocument(),
  new ValidateScenario(10),
  new ValidateScenario(100),
  new ValidateScenario(1000),
];
