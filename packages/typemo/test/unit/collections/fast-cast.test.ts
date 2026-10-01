/*
 * The fast cast path of the collection methods (scalar elements and Map values go straight to their caster). It
 * must be indistinguishable from the general path: the same values (transforms and `set` applied once), the same
 * `CastError`s with the same paths and reasons, the same `null` rules.
 */
import { describe, expect, test } from "bun:test";
import {
  CastError,
  Collections,
  Entity,
  Prop,
  Schema,
  SchemaCompiler,
  Spec,
  type StrictArray,
  type TypedMap,
  Types,
} from "../../../src/internal.ts";

@Schema({ collection: "k11_fast" })
class Fast extends Entity {
  @Prop(() => [String], { trim: true, lowercase: true }) tags!: string[];
  @Prop(() => [Number], { set: (v: number[]) => v }) nums!: number[];
  @Prop(() => [Types.ObjectId]) ids!: Types.ObjectId[];
  @Prop(() => [Spec.union(String, Number)]) mixed!: (string | number)[];
  @Prop(() => Spec.map(Number)) scores!: Map<string, number>;
  @Prop(() => Spec.map(String, { nullable: true })) notes!: Map<string, string | null>;
}

const schema = SchemaCompiler.compile(Fast);
const node = (key: string) => {
  const found = schema.field(key);
  if (found === undefined) throw new Error(key);
  return found;
};
const array = <T>(key: string, values: readonly unknown[] = []) =>
  Collections.fromStored(node(key), values, {}, key) as StrictArray<T>;
const map = <V>(key: string) => Collections.fromStored(node(key), {}, {}, key) as TypedMap<V>;

const castError = (run: () => unknown): CastError => {
  try {
    run();
  } catch (error) {
    if (error instanceof CastError) return error;
    throw error;
  }
  throw new Error("expected a CastError");
};

describe("the fast cast path of scalar elements", () => {
  test("transforms of the caster apply (trim, lowercase)", () => {
    const tags = array<string>("tags");
    tags.push("  A ", "B");
    expect([...tags]).toEqual(["a", "b"]);
    tags.set(0, " C ");
    expect(tags[0]).toBe("c");
  });

  test("errors keep the element path and reason of the general path", () => {
    const nums = array<number>("nums", [1, 2]);
    const pushed = castError(() => nums.push(3, "4" as never));
    expect(pushed.path).toBe("nums.3");
    expect(pushed.reason).toBe("type");
    expect([...nums]).toEqual([1, 2]); /* nothing was appended */
    expect(castError(() => nums.set(1, Number.NaN)).path).toBe("nums.1");
    expect(castError(() => nums.set(1, Number.NaN)).reason).toBe("finite");
    expect(castError(() => nums.push(null as never)).reason).toBe("null");
    expect(castError(() => nums.push(undefined as never)).reason).toBe("undefined");
  });

  test("already cast BSON values pass as they are; a hex string is cast", () => {
    const ids = array<Types.ObjectId>("ids");
    const id = new Types.ObjectId();
    /* A 24-hex string is on the safe list; the type takes an ObjectId only. */
    ids.push(id, id.toHexString() as never);
    expect(ids[0]).toBe(id);
    expect(ids[1]?.equals(id)).toBe(true);
    expect(castError(() => ids.push("nope" as never)).reason).toBe("format");
  });

  test("a union element picks its member by the value's type", () => {
    const mixed = array<string | number>("mixed");
    mixed.push("a", 1);
    expect([...mixed]).toEqual(["a", 1]);
    expect(castError(() => mixed.push(true as never)).path).toBe("mixed.2");
  });

  test("the journal of a scalar array is unchanged by the fast path", () => {
    const nums = array<number>("nums", [1]);
    nums.push(2, 3);
    expect(Collections.toUpdateOps(nums, "code").ops).toEqual({ $push: { nums: { $each: [2, 3] } } });
  });
});

describe("the fast cast path of Map values", () => {
  test("a valid key and a scalar value", () => {
    const scores = map<number>("scores");
    scores.set("a", 1);
    expect(scores.get("a")).toBe(1);
    expect(Collections.toUpdateOps(scores, "code").ops).toEqual({ $set: { "scores.a": 1 } });
  });

  test("bad keys and bad values report as before", () => {
    const scores = map<number>("scores");
    const dotted = castError(() => scores.set("a.b", 1));
    expect(dotted.reason).toBe("key");
    expect(castError(() => scores.set("$x", 1)).reason).toBe("key");
    const value = castError(() => scores.set("k", "1" as never));
    expect(value.path).toBe("scores.k");
    expect(value.reason).toBe("type");
    expect(castError(() => scores.set("k", null as never)).reason).toBe("null");
  });

  test("null on a nullable-value map", () => {
    const notes = map<string | null>("notes");
    notes.set("a", null);
    expect(notes.get("a")).toBeNull();
    expect(notes.has("a")).toBe(true);
  });
});
