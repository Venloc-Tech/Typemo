/*
 * `StrictArray.splice` once copied the whole array after every call — O(n) per call even at the end of the array
 * (1 260× slower than Mongoose on 1e5 elements, 16 800× on 1e6). A complexity check so it does not come back: the
 * same number of operations on a 100× larger array must NOT take ~100× longer. Timing-based, so the bound is
 * loose (10×, the fixed version is ~1×) and every case takes the best of 3 runs.
 */
import { describe, expect, test } from "bun:test";
import {
  Collections,
  Entity,
  Prop,
  Schema,
  SchemaCompiler,
  Spec,
  type StrictArray,
  type SubdocumentArray,
  type TypedMap,
} from "../../../src/internal.ts";

@Schema()
class Item {
  @Prop(() => Number, { required: true }) n!: number;
}

@Schema({ collection: "c10_complexity" })
class Holder extends Entity {
  @Prop(() => [Number]) nums!: number[];
  @Prop(() => [Item]) items!: Item[];
  @Prop(() => Spec.map(Number)) scores!: Map<string, number>;
}

const schema = SchemaCompiler.compile(Holder);
const field = (key: string) => {
  const node = schema.field(key);
  if (node === undefined) throw new Error(key);
  return node;
};
const OPS = 2_000;
const SMALL = 1_000;
const LARGE = 100_000;

/** Best of 3: milliseconds of `OPS` operations on a fresh collection of `size` elements. */
const time = (size: number, make: (size: number) => unknown, run: (target: never, i: number) => void): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = make(size) as never;
    const started = performance.now();
    for (let i = 0; i < OPS; i++) run(target, i);
    best = Math.min(best, performance.now() - started);
  }
  return Math.max(best, 0.05);
};

const numbers = (size: number) =>
  Collections.fromStored(
    field("nums"),
    Array.from({ length: size }, (_, i) => i),
    {},
    "nums",
  ) as StrictArray<number>;
const items = (size: number) =>
  Collections.fromStored(
    field("items"),
    Array.from({ length: size }, (_, i) => ({ n: i })),
    {},
    "items",
  ) as SubdocumentArray<Item>;
const scores = (size: number) =>
  Collections.fromStored(
    field("scores"),
    Object.fromEntries(Array.from({ length: size }, (_, i) => [`k${i}`, i])),
    {},
    "scores",
  ) as TypedMap<number>;

const ratio = (make: (size: number) => unknown, run: (target: never, i: number) => void): number =>
  time(LARGE, make, run) / time(SMALL, make, run);

describe("collections: the cost of one operation does not grow with the size", () => {
  test("StrictArray: splice at the end, push, pop, set", () => {
    expect(ratio(numbers, (a: StrictArray<number>, i) => void a.splice(a.length - 1, 1, i))).toBeLessThan(10);
    expect(ratio(numbers, (a: StrictArray<number>, i) => void a.push(i))).toBeLessThan(10);
    expect(ratio(numbers, (a: StrictArray<number>) => void a.pop())).toBeLessThan(10);
    expect(ratio(numbers, (a: StrictArray<number>, i) => void a.set(i % 10, i))).toBeLessThan(10);
  });

  test("SubdocumentArray: splice at the end, push", () => {
    expect(ratio(items, (a: SubdocumentArray<Item>, i) => void a.splice(a.length - 1, 1, { n: i }))).toBeLessThan(10);
    expect(ratio(items, (a: SubdocumentArray<Item>, i) => void a.push({ n: i }))).toBeLessThan(10);
  });

  test("TypedMap: set, delete", () => {
    expect(ratio(scores, (m: TypedMap<number>, i) => void m.set(`n${i}`, i))).toBeLessThan(10);
    expect(ratio(scores, (m: TypedMap<number>, i) => void m.delete(`k${i}`))).toBeLessThan(10);
  });
});
