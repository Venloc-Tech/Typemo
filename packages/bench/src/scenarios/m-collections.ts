/*
 * Group M — typed collections in memory (no server): Typemo `StrictArray` / `TypedMap` / `SubdocumentArray`
 * against `MongooseArray` / `MongooseMap` / Mongoose document arrays, on documents made by `Model.hydrate(raw)`
 * on both sides (a loaded document; the untimed `before`/`setup` hydrates, the timed `run` only operates).
 * Every run is verified by the final content (length, sum) and, for delta scenarios, by the update the
 * document would send (`$getChanges()` on both sides).
 */
import type { HydratedDoc } from "@venloc/typemo";
import type { ObjectId } from "mongodb";
import { type ContestantImpl, Scenario, type ScenarioEnv, ScenarioKit } from "../harness/scenario.ts";
import type { ContestantId, Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { BbChecksum } from "./support-bb/bb-checksum.ts";
import { MBag, MMongoose, MRaw } from "./support-bb/collection-models.ts";

/**
 * The Mongoose side, as used here (MongooseArray / MongooseMap / DocumentArray methods).
 *
 * @example
 * ```ts
 * const nums: MongooseArrayLike<number> = bag.nums;
 * nums.set(0, 1);
 * ```
 */
interface MongooseArrayLike<T> extends Array<T> {
  /**
   * Sets an element, marking the array modified.
   *
   * @param index - The position.
   * @param value - The new value.
   * @returns The array.
   */
  set(index: number, value: T): this;
}

/**
 * A subdocument of `MongooseBag.rows`.
 *
 * @example
 * ```ts
 * const row: MongooseRow = { lines: 3 };
 * ```
 */
interface MongooseRow {
  /** A numeric field. */
  lines: number;
}

/**
 * The Mongoose document of the bag model, as used here.
 *
 * @example
 * ```ts
 * const bag = Bags.hydrate(raw) as unknown as MongooseBag;
 * ```
 */
interface MongooseBag {
  /** An array of numbers. */
  readonly nums: MongooseArrayLike<number>;
  /** An array of subdocuments, searchable by id. */
  readonly rows: MongooseArrayLike<MongooseRow> & { id(id: ObjectId): MongooseRow | null };
  /** A Map of numbers. */
  readonly scores: Map<string, number>;
  /**
   * The update the document would send.
   *
   * @returns The changes.
   */
  $getChanges(): Record<string, unknown>;
}

/**
 * The Typemo document of the bag model.
 *
 * @example
 * ```ts
 * const bag: TypemoBag = Bags.hydrate(raw);
 * ```
 */
type TypemoBag = HydratedDoc<MBag>;

/** Elements per size: 1e5 and 1e6. */
const N_OF: Readonly<Record<SizeName, number>> = { T: 1_000, S: 100_000, M: 1_000_000, L: 1_000_000, XL: 1_000_000 };
/** Subdocuments per bag in the row scenarios. */
const ROWS = 10_000;
/** Lookups per run in the lookup scenarios. */
const LOOKUPS = 100;
/** Splices per run in the splice scenarios. */
const SPLICES = 20;

/**
 * One in-memory operation, written for both contestants.
 *
 * @example
 * ```ts
 * const op: MOp = OPS[0]!;
 * ```
 */
interface MOp {
  /** Short key, part of the scenario id. */
  readonly key: string;
  /** Description of the operation. */
  readonly title: string;
  /** Sizes per profile. */
  readonly sizes: Readonly<Partial<Record<ProfileName, readonly SizeName[]>>>;
  /** The stored bag this operation starts from. */
  readonly raw: (n: number) => Record<string, unknown>;
  /** Re-hydrate before every timed run (the operation changes the document). */
  readonly fresh: boolean;
  /** Untimed, after hydration (e.g. the changes whose delta is measured). */
  readonly prime?: {
    readonly typemo: (doc: TypemoBag, n: number) => void;
    readonly mongoose: (doc: MongooseBag, n: number) => void;
  };
  /** The operation on the Typemo document. */
  readonly typemo: (doc: TypemoBag, n: number, iteration: number) => unknown;
  /** The operation on the Mongoose document. */
  readonly mongoose: (doc: MongooseBag, n: number, iteration: number) => unknown;
  /** The same summary for both contestants (untimed). */
  readonly summary: (doc: TypemoBag | MongooseBag, result: unknown) => string;
}

/**
 * Sum of numbers.
 *
 * @param values - The numbers.
 * @returns Their sum.
 */
const sumOf = (values: Iterable<number>): number => {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
};

/**
 * Length and sum of the bag's number array.
 *
 * @param doc - The document.
 * @returns A summary line.
 */
const arraySummary = (doc: TypemoBag | MongooseBag): string => `len=${doc.nums.length};sum=${sumOf(doc.nums)}`;

/**
 * The `$set` part of a document's update, canonical (Mongoose adds `$inc __v` for arrays: not compared).
 *
 * @param doc - The document.
 * @returns The canonical text.
 */
const setPart = (doc: TypemoBag | MongooseBag): string =>
  BbChecksum.canonical((doc.$getChanges() as { $set?: unknown }).$set ?? {});

/**
 * How many numbers the document's update pushes.
 *
 * @param doc - The document.
 * @returns The count, or `-1` when there is no push.
 */
const pushedCount = (doc: TypemoBag | MongooseBag): number => {
  const push = (doc.$getChanges() as { $push?: { nums?: { $each?: readonly unknown[] } } }).$push;
  return push?.nums?.$each?.length ?? -1;
};

/**
 * The positions a splice scenario touches.
 *
 * @param n - The array length.
 * @returns `SPLICES` positions spread over the array.
 */
const positions = (n: number): number[] => Array.from({ length: SPLICES }, (_, k) => (k * 997) % n);
/** Map keys by count, built once. */
const keys = new Map<number, string[]>();
/**
 * The map keys `k0…k(n-1)`, cached.
 *
 * @param n - How many keys.
 * @returns The keys.
 */
const keysOf = (n: number): string[] => {
  let list = keys.get(n);
  if (list === undefined) {
    list = Array.from({ length: n }, (_, i) => `k${i}`);
    keys.set(n, list);
  }
  return list;
};
/** The row ids the lookup scenarios search for. */
const lookups = Array.from({ length: LOOKUPS }, (_, k) => MRaw.rowId((k * 7919) % ROWS));

/** Sizes of the array scenarios in `standard` and `full`. */
const ARRAYS: Readonly<Partial<Record<ProfileName, readonly SizeName[]>>> = {
  standard: ["S", "M"],
  full: ["S", "M"],
};

/** Every in-memory operation. */
const OPS: readonly MOp[] = [
  {
    key: "array.push",
    title: "push n numbers one by one",
    sizes: { quick: ["S"], ...ARRAYS },
    raw: () => MRaw.bag(0),
    fresh: true,
    typemo: (doc, n) => {
      for (let i = 0; i < n; i++) doc.nums.push(i);
    },
    mongoose: (doc, n) => {
      for (let i = 0; i < n; i++) doc.nums.push(i);
    },
    summary: (doc) => `${arraySummary(doc)};$push=${pushedCount(doc)}`,
  },
  {
    key: "array.set",
    title: "set(i, v) on every element",
    sizes: ARRAYS,
    raw: (n) => MRaw.bag(n),
    fresh: false,
    /* A new value every run: an equal value is "no change" and would make later runs cheaper. */
    typemo: (doc, n, it) => {
      for (let i = 0; i < n; i++) doc.nums.set(i, i + it + 1);
      return it;
    },
    mongoose: (doc, n, it) => {
      for (let i = 0; i < n; i++) doc.nums.set(i, i + it + 1);
      return it;
    },
    /* Normalised by the run index: contestants run different numbers of samples. */
    summary: (doc, it) => `len=${doc.nums.length};norm=${sumOf(doc.nums) - doc.nums.length * (Number(it) + 1)}`,
  },
  {
    key: "array.read",
    title: "read a[i] over the whole array",
    sizes: ARRAYS,
    raw: (n) => MRaw.bag(n),
    fresh: false,
    typemo: (doc, n) => {
      const nums = doc.nums;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += nums[i] ?? 0;
      return sum;
    },
    mongoose: (doc, n) => {
      const nums = doc.nums;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += nums[i] ?? 0;
      return sum;
    },
    summary: (_, sum) => `sum=${String(sum)}`,
  },
  {
    key: "array.forOf",
    title: "for…of over the whole array",
    sizes: ARRAYS,
    raw: (n) => MRaw.bag(n),
    fresh: false,
    typemo: (doc) => {
      let sum = 0;
      for (const x of doc.nums) sum += x;
      return sum;
    },
    mongoose: (doc) => {
      let sum = 0;
      for (const x of doc.nums) sum += x;
      return sum;
    },
    summary: (_, sum) => `sum=${String(sum)}`,
  },
  {
    key: "array.splice",
    title: `${SPLICES}× splice(pos, 1, v) (length kept)`,
    sizes: ARRAYS,
    raw: (n) => MRaw.bag(n),
    fresh: false,
    typemo: (doc, n) => {
      for (const pos of positions(n)) doc.nums.splice(pos, 1, -pos);
    },
    mongoose: (doc, n) => {
      for (const pos of positions(n)) doc.nums.splice(pos, 1, -pos);
    },
    summary: (doc) => arraySummary(doc),
  },
  {
    key: "map.set",
    title: "Map set n keys",
    sizes: { standard: ["S"], full: ["S", "M"] },
    raw: () => MRaw.bag(0),
    fresh: true,
    typemo: (doc, n) => {
      const list = keysOf(n);
      for (let i = 0; i < n; i++) doc.scores.set(list[i] as string, i);
    },
    mongoose: (doc, n) => {
      const list = keysOf(n);
      for (let i = 0; i < n; i++) doc.scores.set(list[i] as string, i);
    },
    summary: (doc) => `size=${doc.scores.size};sum=${sumOf(doc.scores.values())}`,
  },
  {
    key: "map.get",
    title: "Map get n keys",
    sizes: { standard: ["S"], full: ["S", "M"] },
    raw: (n) => MRaw.bag(0, 0, n),
    fresh: false,
    typemo: (doc, n) => {
      const list = keysOf(n);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += doc.scores.get(list[i] as string) ?? 0;
      return sum;
    },
    mongoose: (doc, n) => {
      const list = keysOf(n);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += doc.scores.get(list[i] as string) ?? 0;
      return sum;
    },
    summary: (_, sum) => `sum=${String(sum)}`,
  },
  {
    key: "subdocs.id",
    title: `SubdocumentArray.id(): ${LOOKUPS} lookups in ${ROWS} subdocuments`,
    sizes: { standard: ["S"], full: ["S"] },
    raw: () => MRaw.bag(0, ROWS),
    fresh: false,
    typemo: (doc) => {
      let sum = 0;
      for (const id of lookups) sum += doc.rows.id(id)?.lines ?? Number.NaN;
      return sum;
    },
    mongoose: (doc) => {
      let sum = 0;
      for (const id of lookups) sum += doc.rows.id(id)?.lines ?? Number.NaN;
      return sum;
    },
    summary: (_, sum) => `sum=${String(sum)}`,
  },
  ...[1, 1_000].map(
    (changes): MOp => ({
      key: `delta.subdocs.${changes}`,
      title: `delta ($getChanges) after ${changes} field change(s) in ${ROWS} subdocuments`,
      sizes: { standard: ["S"], full: ["S"] },
      raw: () => MRaw.bag(0, ROWS),
      fresh: false,
      prime: {
        typemo: (doc) => {
          for (let k = 0; k < changes; k++) {
            const row = doc.rows[(k * 7) % ROWS];
            if (row !== undefined) row.lines = -k - 1;
          }
        },
        mongoose: (doc) => {
          for (let k = 0; k < changes; k++) {
            const row = doc.rows[(k * 7) % ROWS];
            if (row !== undefined) row.lines = -k - 1;
          }
        },
      },
      typemo: (doc) => doc.$getChanges(),
      mongoose: (doc) => doc.$getChanges(),
      summary: (doc) => setPart(doc),
    }),
  ),
];

/** One in-memory collection operation as a scenario. */
class CollectionScenario extends Scenario {
  readonly id: string;
  readonly group = "M" as const;
  readonly title: string;
  readonly profiles: readonly ProfileName[];
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  override readonly contestants: readonly ContestantId[] = ["mongoose", "typemo"];
  override readonly iterations = { warmup: 2, minSamples: 5, maxSamples: 30, maxTimeMs: 1500 };
  override readonly notes =
    "No server. S = 1e5, M = 1e6 elements. Documents from Model.hydrate(raw) (untimed). Typemo casts every " +
    "written value (D8, fast path K11); Mongoose casts too (MongooseArray/MongooseMap).";

  /**
   * @param op - The operation to run.
   */
  constructor(private readonly op: MOp) {
    super();
    this.id = `M.${op.key}`;
    this.title = `collections: ${op.title}`;
    this.profiles = Object.keys(op.sizes) as ProfileName[];
  }

  /**
   * The sizes to run under a profile.
   *
   * @param profile - The profile.
   * @returns The sizes listed for the profile.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return this.op.sizes[profile] ?? [];
  }

  /**
   * Elements handled per operation.
   *
   * @param size - The dataset size.
   * @returns The element count for array and map operations, otherwise `1`.
   */
  override unitsPerOp(size: SizeName): number {
    return this.op.key.startsWith("array") || this.op.key.startsWith("map") ? N_OF[size] : 1;
  }

  /**
   * Builds a contestant that hydrates a bag and runs the operation on it.
   *
   * @param contestant - Who runs.
   * @param env - The scenario environment.
   * @returns The implementation.
   */
  build(contestant: ContestantId, env: ScenarioEnv): ContestantImpl<unknown> {
    const n = N_OF[env.size];
    const op = this.op;
    const outcome = (doc: TypemoBag | MongooseBag, result: unknown): Outcome => ({
      count: 1,
      checksum: BbChecksum.of([op.summary(doc, result)]),
    });
    return ScenarioKit.pick(
      {
        typemo: () => {
          const Bags = env.ctx.typemo.model(MBag);
          let doc: TypemoBag | undefined;
          const hydrate = (): void => {
            doc = Bags.hydrate(op.raw(n));
            op.prime?.typemo(doc, n);
          };
          const need = (): TypemoBag => {
            if (doc === undefined) throw new Error("typemo: the bag is not hydrated (setup did not run)");
            return doc;
          };
          return ScenarioKit.impl<unknown>({
            setup: hydrate,
            before: () => {
              if (op.fresh) hydrate();
            },
            run: (i) => op.typemo(need(), n, i),
            verify: (result) => outcome(need(), result),
          });
        },
        mongoose: () => {
          const Bags = MMongoose.bag(env.ctx.mongoose);
          let doc: MongooseBag | undefined;
          const hydrate = (): void => {
            doc = Bags.hydrate(op.raw(n)) as unknown as MongooseBag;
            op.prime?.mongoose(doc, n);
          };
          const need = (): MongooseBag => {
            if (doc === undefined) throw new Error("mongoose: the bag is not hydrated (setup did not run)");
            return doc;
          };
          return ScenarioKit.impl<unknown>({
            setup: hydrate,
            before: () => {
              if (op.fresh) hydrate();
            },
            run: (i) => op.mongoose(need(), n, i),
            verify: (result) => outcome(need(), result),
          });
        },
      },
      contestant,
    ) as ContestantImpl<unknown>;
  }
}

/** The scenarios of group M. */
export const SCENARIOS: readonly Scenario[] = OPS.map((op) => new CollectionScenario(op));
