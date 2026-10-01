/*
 * The cost of `$getChanges()` after ONE change in a large array of subdocuments,
 * a nested array inside the elements, and a Map of subdocuments. Every field of every element used to be compared;
 * now only the elements that were accessed are. Also measures the costs this adds: hydration and a full read of
 * the array.
 * Run from the package: `bun test/experiments/getchanges-bench.ts`. Median of RUNS runs, ms.
 */
import "reflect-metadata";
import { ObjectId } from "mongodb";
import { Entity, Prop, Schema, Spec, TypemoClient } from "../../src/index.ts";

@Schema()
class Leaf {
  @Prop(() => String) tag?: string;
  @Prop(() => Number) w?: number;
}

@Schema()
class Item extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number, { required: true }) n!: number;
  @Prop(() => String) a?: string;
  @Prop(() => String) b?: string;
  @Prop(() => Date) at?: Date;
  @Prop(() => [Leaf]) leaves!: Leaf[];
}

@Schema({ collection: "n1_bench" })
class Holder extends Entity {
  @Prop(() => [Item]) items!: Item[];
  @Prop(() => Spec.map(Leaf)) byKey!: Map<string, Leaf>;
}

const RUNS = 5;
const client = new TypemoClient("mongodb://localhost:27017/n1");
const Holders = client.connection.model(Holder);

const raw = (n: number) => ({
  _id: new ObjectId(),
  items: Array.from({ length: n }, (_, i) => ({
    _id: new ObjectId(),
    name: `item ${i}`,
    n: i,
    a: "x",
    b: "y",
    at: new Date(0),
    leaves: [
      { tag: "t1", w: 1 },
      { tag: "t2", w: 2 },
    ],
  })),
  byKey: Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, { tag: `t${i}`, w: i }])),
});

const median = (values: number[]): number => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0;
const ms = (value: number) => value.toFixed(3);

const measure = (n: number) => {
  const data = raw(n);
  const hydrate: number[] = [];
  const oneChange: number[] = [];
  const nestedChange: number[] = [];
  const mapChange: number[] = [];
  const fullRead: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    let started = performance.now();
    const doc = Holders.hydrate(data);
    hydrate.push(performance.now() - started);

    const item = doc.items[Math.floor(n / 2)];
    if (item === undefined) throw new Error("no item");
    item.n = -1;
    started = performance.now();
    const changes = doc.$getChanges();
    oneChange.push(performance.now() - started);
    if (JSON.stringify(changes).indexOf("-1") < 0) throw new Error("the change was not found");

    const other = Holders.hydrate(data);
    const leaf = other.items[n - 1]?.leaves[1];
    if (leaf === undefined) throw new Error("no leaf");
    leaf.w = -2;
    started = performance.now();
    const nested = other.$getChanges();
    nestedChange.push(performance.now() - started);
    if (JSON.stringify(nested).indexOf("-2") < 0) throw new Error("the nested change was not found");

    const third = Holders.hydrate(data);
    const value = third.byKey.get(`k${n - 1}`);
    if (value === undefined) throw new Error("no map value");
    value.w = -3;
    started = performance.now();
    const inMap = third.$getChanges();
    mapChange.push(performance.now() - started);
    if (JSON.stringify(inMap).indexOf("-3") < 0) throw new Error("the map change was not found");

    const fourth = Holders.hydrate(data);
    started = performance.now();
    let sum = 0;
    for (const element of fourth.items) sum += element.n;
    fullRead.push(performance.now() - started);
    if (sum < 0) throw new Error("sum");
  }
  return {
    n,
    hydrate: ms(median(hydrate)),
    oneChange: ms(median(oneChange)),
    nestedChange: ms(median(nestedChange)),
    mapChange: ms(median(mapChange)),
    fullRead: ms(median(fullRead)),
  };
};

console.log(
  "| elements | hydrate ms | $getChanges, 1 element changed ms | … nested array ms | … Map of subdocs ms | full read (for…of) ms |",
);
console.log("|---|---|---|---|---|---|");
for (const n of [1_000, 10_000, 100_000]) {
  const row = measure(n);
  console.log(
    `| ${row.n} | ${row.hydrate} | ${row.oneChange} | ${row.nestedChange} | ${row.mapChange} | ${row.fullRead} |`,
  );
}
await client.close();
