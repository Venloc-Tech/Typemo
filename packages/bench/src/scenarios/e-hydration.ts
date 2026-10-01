import type { Document } from "mongodb";
import type mongoose from "mongoose";
import { Loose } from "../adapters/loose.ts";
import type { ContestantOps } from "../adapters/ops.ts";
import {
  ALL_BSON,
  BIG_ARRAY,
  BIG_MAP,
  DEEP7,
  EVENTS,
  FLAT,
  LARGE,
  MEDIUM,
  type ShapeDef,
  VECTOR,
} from "../data/shapes/index.ts";
import { OpScenario } from "../harness/op-scenario.ts";
import type { Scenario, ScenarioEnv } from "../harness/scenario.ts";
import type { ContestantId, MeasureKind, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { Outcomes } from "../harness/verify.ts";

/* Group E: hydration, serialization and the memory of big results. */

/** Profiles that run the heavier scenarios. */
const STANDARD: readonly ProfileName[] = ["standard", "full"];
/** The contestants that hydrate documents. */
const ODMS: readonly ContestantId[] = ["mongoose", "typemo"];

/**
 * A hydrated Mongoose document with the conversion methods the scenarios call.
 *
 * @example
 * ```ts
 * const plain = (doc as MongooseDoc).toObject();
 * ```
 */
type MongooseDoc = mongoose.Document & { toObject(o?: Document): unknown; toJSON(o?: Document): unknown };

/**
 * Pure in-memory work on raw documents read once (untimed): `Model.hydrate(raw)` of Mongoose against Typemo's
 * `model.hydrate(raw)`. The driver and lean do not hydrate (not contestants here).
 */
class HydrateShape extends OpScenario<object> {
  readonly group = "E" as const;
  override readonly contestants = ODMS;
  /** The raw documents each contestant hydrates. */
  readonly #raw = new Map<string, Document[]>();
  /**
   * @param id - The scenario id.
   * @param title - The report title.
   * @param def - The shape to hydrate.
   * @param profiles - The profiles that run it.
   * @param docs - How many documents one operation hydrates.
   */
  constructor(
    readonly id: string,
    readonly title: string,
    readonly def: ShapeDef<object>,
    readonly profiles: readonly ProfileName[],
    readonly docs: number,
  ) {
    super();
  }
  override readonly sizes: readonly SizeName[] = ["S"];
  /**
   * Documents per operation.
   *
   * @returns The number of documents hydrated.
   */
  override unitsPerOp(): number {
    return this.docs;
  }
  /**
   * Reads the raw documents once, outside the timed part.
   *
   * @param ops - The contestant's operations.
   * @param env - The scenario environment.
   */
  override async setup(ops: ContestantOps, env: ScenarioEnv): Promise<void> {
    const n = Math.min(this.docs, this.def.countFor(env.size));
    /* Raw documents as each ODM's own client deserializes them (Typemo forces its BSON options). */
    this.#raw.set(
      ops.contestant,
      await env.ctx.dbOf(ops.contestant).collection(this.def.collection).find({}).sort({ _id: 1 }).limit(n).toArray(),
    );
    if (ops.kind === "mongoose" && this.def === (EVENTS as unknown as ShapeDef<object>))
      EVENTS.mongoose(ops.mongooseHandle);
  }
  /**
   * Hydrates the raw documents.
   *
   * @param ops - The contestant's operations.
   * @returns The hydrated documents.
   */
  async op(ops: ContestantOps): Promise<unknown> {
    const raw = this.#raw.get(ops.contestant) ?? [];
    const out: unknown[] = new Array(raw.length);
    if (ops.kind === "mongoose") for (let k = 0; k < raw.length; k++) out[k] = ops.mongoose.hydrate(raw[k]);
    else for (let k = 0; k < raw.length; k++) out[k] = ops.typemo.hydrate(raw[k] as Document);
    return out;
  }
}

/**
 * The serialization form a scenario measures.
 *
 * @example
 * ```ts
 * const form: Form = "toJSON";
 * ```
 */
type Form = "toObject" | "toJSON" | "stringify";

/** Serialization of documents loaded once (untimed). */
class Serialize extends OpScenario<object> {
  readonly group = "E" as const;
  /** The documents each contestant serializes. */
  readonly #loaded = new Map<ContestantId, unknown[]>();
  /**
   * @param id - The scenario id.
   * @param title - The report title.
   * @param def - The shape to serialize.
   * @param profiles - The profiles that run it.
   * @param form - The serialization form.
   * @param contestants - The contestants that take part.
   * @param comparable - Whether the results are compared in full, or only counted.
   */
  constructor(
    readonly id: string,
    readonly title: string,
    readonly def: ShapeDef<object>,
    readonly profiles: readonly ProfileName[],
    readonly form: Form,
    override readonly contestants: readonly ContestantId[],
    readonly comparable: boolean,
  ) {
    super();
  }
  override readonly sizes: readonly SizeName[] = ["S"];
  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns At most 1000.
   */
  override unitsPerOp(size: SizeName): number {
    return Math.min(1_000, this.def.countFor(size));
  }
  /**
   * Loads the documents once, outside the timed part.
   *
   * @param ops - The contestant's operations.
   * @param env - The scenario environment.
   */
  override async setup(ops: ContestantOps, env: ScenarioEnv): Promise<void> {
    this.#loaded.set(ops.contestant, await ops.find({ sort: { _id: 1 }, limit: this.unitsPerOp(env.size) }));
  }
  /**
   * Serializes the loaded documents.
   *
   * @param ops - The contestant's operations.
   * @returns The serialized form.
   */
  async op(ops: ContestantOps): Promise<unknown> {
    const docs = this.#loaded.get(ops.contestant) ?? [];
    switch (this.form) {
      case "stringify":
        return JSON.stringify(docs);
      case "toObject":
        return ops.kind === "mongoose"
          ? docs.map((d) => (d as MongooseDoc).toObject())
          : Loose.docs(docs).map((d) => d.$toObject());
      case "toJSON":
        return ops.kind === "mongoose"
          ? docs.map((d) => (d as MongooseDoc).toJSON())
          : Loose.docs(docs).map((d) => d.$toJSON());
    }
  }
  /**
   * The outcome of the serialized documents.
   *
   * @param result - The serialized form.
   * @returns The documents, or only their count when the forms are not comparable.
   */
  override outcome(result: unknown): Outcome {
    if (typeof result === "string") {
      const parsed = JSON.parse(result) as unknown[];
      return this.comparable ? Outcomes.docs(parsed) : Outcomes.count(parsed.length);
    }
    /* toJSON forms differ in representation only (Mongoose keeps ObjectId/Date objects until stringify, Typemo
       returns strings): compare the JSON text each form produces. */
    const list =
      this.form === "toJSON" && this.comparable
        ? (JSON.parse(JSON.stringify(result)) as unknown[])
        : (result as unknown[]);
    return this.comparable ? Outcomes.docs(list) : Outcomes.count(list.length);
  }
}

/** Memory of a big result set, hydrated against lean, in a separate process. */
class FindMemory extends OpScenario<object> {
  readonly group = "E" as const;
  override readonly kind: MeasureKind = "memory";
  /**
   * @param id - The scenario id.
   * @param title - The report title.
   * @param def - The shape to read.
   * @param profiles - The profiles that run it.
   * @param sizes - The sizes it supports.
   */
  constructor(
    readonly id: string,
    readonly title: string,
    readonly def: ShapeDef<object>,
    readonly profiles: readonly ProfileName[],
    override readonly sizes: readonly SizeName[],
  ) {
    super();
  }
  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns The whole collection.
   */
  override unitsPerOp(size: SizeName): number {
    return this.def.countFor(size);
  }
  /**
   * Reads the whole collection.
   *
   * @param ops - The contestant's operations.
   * @returns The documents.
   */
  op(ops: ContestantOps): Promise<unknown> {
    return ops.find({ sort: { _id: 1 } });
  }
}

/**
 * Loosens a shape's type.
 *
 * @param def - A shape.
 * @returns The same shape, typed for generic scenarios.
 */
const s = <E extends object>(def: ShapeDef<E>): ShapeDef<object> => def as unknown as ShapeDef<object>;
/** Every contestant. */
const ALL: readonly ContestantId[] = ["driver", "mongoose", "mongoose-safe", "typemo", "typemo-lean"];

/** The scenarios of group E. */
export const SCENARIOS: readonly Scenario[] = [
  new HydrateShape("E.hydrate.flat", "hydrate 1000 плоских документов", s(FLAT), ["quick", "standard", "full"], 1_000),
  new HydrateShape("E.hydrate.medium", "hydrate 1000 документов medium (вложенные)", s(MEDIUM), STANDARD, 1_000),
  new HydrateShape(
    "E.hydrate.large",
    "hydrate 100 документов large (~100 КБ, 180 поддокументов)",
    s(LARGE),
    STANDARD,
    100,
  ),
  new HydrateShape("E.hydrate.deep7", "hydrate 1000 документов вложенности 7", s(DEEP7), STANDARD, 1_000),
  new HydrateShape("E.hydrate.bigArray", "hydrate 50 документов с массивом 10 000 чисел", s(BIG_ARRAY), STANDARD, 50),
  new HydrateShape("E.hydrate.bigMap", "hydrate 100 документов с Map на 1000 ключей", s(BIG_MAP), STANDARD, 100),
  new HydrateShape("E.hydrate.allBson", "hydrate 1000 документов со всеми типами BSON", s(ALL_BSON), STANDARD, 1_000),
  new HydrateShape("E.hydrate.vector", "hydrate 1000 документов с вектором 1536×float32", s(VECTOR), STANDARD, 1_000),
  new HydrateShape("E.hydrate.discriminators", "hydrate 1000 событий 5 дискриминаторов", s(EVENTS), STANDARD, 1_000),
  new Serialize(
    "E.toObject.medium",
    "toObject 1000 документов medium",
    s(MEDIUM),
    ["quick", "standard", "full"],
    "toObject",
    ODMS,
    true,
  ),
  new Serialize("E.toJSON.medium", "toJSON 1000 документов medium", s(MEDIUM), STANDARD, "toJSON", ODMS, true),
  new Serialize(
    "E.stringify.medium",
    "JSON.stringify 1000 документов medium",
    s(MEDIUM),
    STANDARD,
    "stringify",
    ALL,
    true,
  ),
  /* JSON forms of BSON values differ by design (bigint → number, Decimal128 → string): only counts compared. */
  new Serialize(
    "E.toJSON.allBson",
    "toJSON 1000 документов со всеми типами BSON",
    s(ALL_BSON),
    STANDARD,
    "toJSON",
    ODMS,
    false,
  ),
  new FindMemory("E.memory.find", "память выборки всей коллекции flat (hydrated против lean)", s(FLAT), STANDARD, [
    "S",
    "M",
    "L",
  ]),
];
