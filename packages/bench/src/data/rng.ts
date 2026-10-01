import { ObjectId } from "mongodb";

/** The word list of `Rng.word`. */
const WORDS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "mike",
  "november",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "tango",
  "uniform",
  "victor",
  "whiskey",
  "xray",
  "yankee",
  "zulu",
] as const;

/**
 * Seeded PRNG (mulberry32). Deterministic across runs and machines: the same seed gives the same data, so
 * every contestant gets identical input and checksums are comparable.
 *
 * @example
 * ```ts
 * const rng = new Rng(42);
 * const age: number = rng.int(18, 65);
 * ```
 */
export class Rng {
  /** The generator state. */
  #state: number;

  /**
   * @param seed - The seed; the same seed gives the same sequence.
   */
  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  /**
   * Mixes two numbers into a seed (e.g. dataset seed and document index).
   *
   * @param a - The first number.
   * @param b - The second number.
   * @returns A 32-bit seed.
   */
  static seedOf(a: number, b: number): number {
    let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }

  /**
   * Float in [0, 1).
   *
   * @returns The next number of the sequence.
   */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Integer in [min, max].
   *
   * @param min - The lowest value.
   * @param max - The highest value.
   * @returns A whole number.
   */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * Double with 2 decimals in [min, max). Never an integer value, so it stays a BSON double everywhere.
   *
   * @param min - The lowest value.
   * @param max - The upper bound, exclusive.
   * @returns An amount of money.
   */
  money(min: number, max: number): number {
    return Math.floor((min + this.next() * (max - min)) * 100) / 100 + 0.005;
  }

  /**
   * A fair coin.
   *
   * @returns `true` or `false`.
   */
  bool(): boolean {
    return this.next() < 0.5;
  }

  /**
   * A random element.
   *
   * @param values - A non-empty list.
   * @returns One of the values.
   * @throws Error - When the list is empty.
   */
  pick<T>(values: readonly T[]): T {
    const value = values[Math.floor(this.next() * values.length)];
    if (value === undefined) throw new Error("Rng.pick: empty list");
    return value;
  }

  /**
   * A random word.
   *
   * @returns A word from the built-in list.
   */
  word(): string {
    return this.pick(WORDS);
  }

  /**
   * Several random words.
   *
   * @param count - How many words.
   * @returns The words joined by spaces.
   */
  words(count: number): string {
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(this.word());
    return out.join(" ");
  }

  /**
   * Date between 2020-01-01 and 2026-01-01, millisecond precision.
   *
   * @returns A date.
   */
  date(): Date {
    return new Date(Date.UTC(2020, 0, 1) + Math.floor(this.next() * 6 * 365 * 86_400_000));
  }

  /**
   * Random bytes.
   *
   * @param length - How many bytes.
   * @returns The bytes.
   */
  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 4) {
      const v = (this.next() * 4294967296) >>> 0;
      out[i] = v & 0xff;
      if (i + 1 < length) out[i + 1] = (v >>> 8) & 0xff;
      if (i + 2 < length) out[i + 2] = (v >>> 16) & 0xff;
      if (i + 3 < length) out[i + 3] = (v >>> 24) & 0xff;
    }
    return out;
  }
}

/** Deterministic ObjectIds: `<namespace:4 bytes><index:8 bytes>` so every contestant inserts the same `_id`s. */
export class Ids {
  /**
   * One deterministic id.
   *
   * @param namespace - A 32-bit namespace, unique per shape.
   * @param index - The document index.
   * @returns The `ObjectId`.
   */
  static of(namespace: number, index: number): ObjectId {
    const hex = (namespace >>> 0).toString(16).padStart(8, "0") + index.toString(16).padStart(16, "0");
    return ObjectId.createFromHexString(hex);
  }

  /**
   * A run of deterministic ids.
   *
   * @param namespace - A 32-bit namespace, unique per shape.
   * @param from - The first index.
   * @param count - How many ids.
   * @returns The ids.
   */
  static range(namespace: number, from: number, count: number): ObjectId[] {
    const out: ObjectId[] = [];
    for (let i = 0; i < count; i++) out.push(Ids.of(namespace, from + i));
    return out;
  }
}
