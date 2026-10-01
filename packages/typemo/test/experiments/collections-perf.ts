/*
 * Micro-benchmark of the production typed collections (the early prototype it was derived from is removed).
 * Run from the package: `bun test/experiments/collections-perf.ts`.
 * Median of RUNS runs after WARMUP runs, ms. Numbers, N = 1e5; subdocuments, M = 1e4.
 */
import "reflect-metadata";
import type { ObjectId } from "mongodb";
import {
  Collections,
  Entity,
  Prop,
  Schema,
  SchemaCompiler,
  Spec,
  type StrictArray,
  type Subdocument,
  type SubdocumentArray,
  type TypedMap,
  Types,
} from "../../src/internal.ts";

@Schema()
class Row extends Entity {
  @Prop(() => String) note!: string;
  @Prop(() => Number) lines!: number;
}

@Schema({ collection: "bench" })
class Bench extends Entity {
  @Prop(() => [Number]) nums!: number[];
  @Prop(() => [Row]) rows!: Row[];
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Types.ObjectId]) ids!: ObjectId[];
  @Prop(() => Spec.map(Number)) scores!: Map<string, number>;
}

const N = 100_000;
const M = 10_000;
const RUNS = 7;
const WARMUP = 2;
const schema = SchemaCompiler.compile(Bench);
const numsNode = schema.field("nums");
const rowsNode = schema.field("rows");
const tagsNode = schema.field("tags");
const idsNode = schema.field("ids");
const scoresNode = schema.field("scores");
if (
  numsNode === undefined ||
  rowsNode === undefined ||
  tagsNode === undefined ||
  idsNode === undefined ||
  scoresNode === undefined
)
  throw new Error("schema");
const oids = Array.from({ length: N }, () => new Types.ObjectId());
const strs = Array.from({ length: N }, (_, i) => `s${i}`);
const source = Array.from({ length: N }, (_, i) => i);
const rowSource = Array.from({ length: M }, (_, i) => ({ note: `n${i}`, lines: i }));

const hydrate = (values: readonly number[]): StrictArray<number> =>
  Collections.fromStored(numsNode, values, {}, "nums") as StrictArray<number>;
const hydrateRows = (): SubdocumentArray<Row> =>
  Collections.fromStored(rowsNode, rowSource, {}, "rows") as SubdocumentArray<Row>;

const time = (run: () => void): number => {
  for (let i = 0; i < WARMUP; i++) run();
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? Number.NaN;
};

let sink = 0;
const cases: Record<string, () => number> = {
  "hydrate 1e5": () =>
    time(() => {
      sink += hydrate(source).length;
    }),
  "push ×1e5 (one by one, cast)": () =>
    time(() => {
      const a = hydrate([]);
      for (let i = 0; i < N; i++) a.push(i);
      sink += a.length;
    }),
  "push ×1e5 strings": () =>
    time(() => {
      const a = Collections.fromStored(tagsNode, [], {}, "tags") as StrictArray<string>;
      for (let i = 0; i < N; i++) a.push(strs[i] as string);
      sink += a.length;
    }),
  "push ×1e5 ObjectId (already cast)": () =>
    time(() => {
      const a = Collections.fromStored(idsNode, [], {}, "ids") as StrictArray<ObjectId>;
      for (let i = 0; i < N; i++) a.push(oids[i] as ObjectId);
      sink += a.length;
    }),
  "push(...1e4) numbers in one call": () =>
    time(() => {
      const a = hydrate([]);
      a.push(...source.slice(0, 10_000));
      sink += a.length;
    }),
  "push ×1e4 subdocuments (plain input)": () =>
    time(() => {
      const rows = Collections.fromStored(rowsNode, [], {}, "rows") as SubdocumentArray<Row>;
      for (let i = 0; i < M; i++) rows.push(rowSource[i] as Row);
      sink += rows.length;
    }),
  "Map set ×1e5 numbers": () =>
    time(() => {
      const m = Collections.fromStored(scoresNode, {}, {}, "scores") as TypedMap<number>;
      for (let i = 0; i < N; i++) m.set(strs[i] as string, i);
      sink += m.size;
    }),
  "read a[i] ×1e5": () => {
    const a = hydrate(source);
    return time(() => {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += a[i] ?? 0;
      sink += sum;
    });
  },
  "for…of ×1e5": () => {
    const a = hydrate(source);
    return time(() => {
      let sum = 0;
      for (const x of a) sum += x;
      sink += sum;
    });
  },
  "set(i, v) ×1e5 (cast)": () => {
    const a = hydrate(source);
    let k = 0;
    return time(() => {
      k++;
      for (let i = 0; i < N; i++) a.set(i, i + k);
    });
  },
  "toUpdateOps after 1 push (1e5)": () => {
    const a = hydrate(source);
    a.push(1);
    return time(() => void Collections.toUpdateOps(a, "db"));
  },
  "hydrate 1e4 subdocuments": () =>
    time(() => {
      sink += hydrateRows().length;
    }),
  "toUpdateOps after 1 field change (1e4 subdocs)": () => {
    const rows = hydrateRows();
    (rows[5000] as Subdocument<Row>).lines = -1;
    return time(() => void Collections.toUpdateOps(rows, "db"));
  },
};

const heapOf = (): number => {
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  const keep = Array.from({ length: 20 }, () => hydrate(source));
  Bun.gc(true);
  const after = process.memoryUsage().heapUsed;
  sink += keep.length;
  return (after - before) / 20 / 1024 / 1024;
};

console.log(`| case (ms, median of ${RUNS}) | production StrictArray |`);
console.log("|---|---|");
for (const [name, run] of Object.entries(cases)) console.log(`| ${name} | ${run().toFixed(2)} |`);
console.log(`| heap per 1e5-element array, MB | ${heapOf().toFixed(2)} |`);
console.log(`\n(bun ${Bun.version}, sink ${sink > 0})`);
