import { describe, expect, test } from "bun:test";
import { Binary, ObjectId } from "mongodb";
import {
  ArrayCaster,
  CastError,
  ConfigurationError,
  DateCaster,
  Int32Caster,
  MapCaster,
  NullableCaster,
  NumberCaster,
  ObjectIdCaster,
  StringCaster,
  SubdocumentCaster,
  VectorCaster,
} from "../../../src/internal.ts";

/* Container casters, the null / undefined / '' rules, and vectors (Binary subtype 9). */

/** Runs `run` and returns the `CastError` it throws; anything else fails the test. */
const failure = (run: () => unknown): CastError => {
  try {
    run();
  } catch (error) {
    if (error instanceof CastError) return error;
    throw error;
  }
  throw new Error("expected a CastError");
};

describe("NullableCaster and the null / undefined / '' rules", () => {
  const nullableInt = NullableCaster.of(Int32Caster);

  test("null passes only through NullableCaster", () => {
    expect(nullableInt.cast(null)).toBeNull();
    expect(failure(() => Int32Caster.cast(null)).reason).toBe("null");
  });

  test("undefined is an error even on a nullable path", () => {
    expect(failure(() => nullableInt.cast(undefined, "age")).reason).toBe("undefined");
  });

  test("'' is never null: a string on a string path, an error elsewhere", () => {
    expect(NullableCaster.of(StringCaster).cast("")).toBe("");
    expect(failure(() => nullableInt.cast("")).reason).toBe("type");
    expect(failure(() => NullableCaster.of(DateCaster).cast("")).reason).toBe("format");
    expect(failure(() => NullableCaster.of(ObjectIdCaster).cast("")).reason).toBe("format");
  });

  test("encode keeps null and encodes the rest with the inner caster", () => {
    expect(nullableInt.encode(null)).toBeNull();
    expect((nullableInt.encode(5) as { _bsontype: string })._bsontype).toBe("Int32");
    expect(nullableInt.expected).toBe("Int32 | null");
  });
});

describe("ArrayCaster", () => {
  const tags = ArrayCaster.of(StringCaster);

  test("casts every element into a new array", () => {
    const input = ["a", "b"];
    const result = tags.cast(input);
    expect(result).toEqual(["a", "b"]);
    expect(result).not.toBe(input);
  });

  test("a scalar is not wrapped into an array (no castNonArrays)", () => {
    expect(failure(() => tags.cast("a", "tags")).reason).toBe("type");
  });

  test("the failing element is reported with its index in the path", () => {
    const error = failure(() => tags.cast(["a", 1, "c"], "tags"));
    expect(error.path).toBe("tags.1");
    expect(error.expected).toBe("string");
    expect(error.value).toBe(1);
  });

  test("holes and undefined elements are errors, not nulls", () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test.
    expect(failure(() => tags.cast(["a", , "c"], "tags")).path).toBe("tags.1");
    expect(failure(() => tags.cast(["a", undefined], "tags")).reason).toBe("undefined");
  });

  test("nested arrays and element encoding", () => {
    const matrix = ArrayCaster.of(ArrayCaster.of(Int32Caster));
    expect(matrix.cast([[1, 2], [3]])).toEqual([[1, 2], [3]]);
    expect(failure(() => matrix.cast([[1], [2.5]], "m")).path).toBe("m.1.0");
    const encoded = matrix.encode([[1]]) as { _bsontype: string }[][];
    expect(encoded[0]?.[0]?._bsontype).toBe("Int32");
    expect(matrix.expected).toBe("Array<Array<Int32>>");
  });
});

describe("MapCaster", () => {
  const scores = MapCaster.of(Int32Caster);

  test("casts values into a new Map; encode gives a plain object", () => {
    const input = new Map([["math", 5]]);
    const result = scores.cast(input);
    expect(result).toEqual(new Map([["math", 5]]));
    expect(result).not.toBe(input);
    const encoded = scores.encode(result) as Record<string, { _bsontype: string; value: number }>;
    expect(Object.keys(encoded)).toEqual(["math"]);
    expect(encoded.math?._bsontype).toBe("Int32");
  });

  test("a literal object is accepted as entries and becomes a Map", () => {
    const input = { math: 5, art: 3 };
    const result = scores.cast(input, "scores");
    expect(result).toBeInstanceOf(Map);
    expect([...result]).toEqual([
      ["math", 5],
      ["art", 3],
    ]);
    expect(scores.cast(Object.assign(Object.create(null), { math: 1 })).get("math")).toBe(1);
  });

  test("keys of a literal object are checked like Map keys (JSON __proto__ included)", () => {
    expect(failure(() => scores.cast({ "a.b": 1 }, "scores")).reason).toBe("key");
    expect(failure(() => scores.cast({ $gt: 1 }, "scores")).reason).toBe("key");
    expect(failure(() => scores.cast({ "": 1 }, "scores")).reason).toBe("key");
    expect(failure(() => scores.cast(JSON.parse('{"__proto__": 1}'), "scores")).reason).toBe("key");
    expect(failure(() => scores.cast({ [Symbol("s")]: 1 }, "scores")).reason).toBe("key");
    expect(failure(() => scores.cast({ math: "5" }, "scores")).path).toBe("scores.math");
  });

  test("class instances and arrays are not records of entries", () => {
    class Scores {
      math = 5;
    }
    expect(failure(() => scores.cast(new Scores(), "scores")).reason).toBe("type");
    expect(failure(() => scores.cast([["math", 5]], "scores")).reason).toBe("type");
  });

  test.each([["a.b"], ["$set"], [""], ["__proto__"]])("key %j is refused", (key) => {
    const error = failure(() => scores.cast(new Map([[key, 1]]), "scores"));
    expect(error.reason).toBe("key");
  });

  test("a non-string key is refused", () => {
    expect(failure(() => scores.cast(new Map([[1, 1]]), "scores")).reason).toBe("key");
  });

  test("the failing value is reported as map.key", () => {
    const error = failure(() => scores.cast(new Map([["math", "5"]]), "scores"));
    expect(error.path).toBe("scores.math");
  });
});

describe("SubdocumentCaster", () => {
  const address = SubdocumentCaster.of({ city: StringCaster, zip: NullableCaster.of(StringCaster) });

  test("casts the present fields into a new plain object; absent fields stay absent", () => {
    const input = { city: "Riga" };
    const result = address.cast(input);
    expect(result).toEqual({ city: "Riga" });
    expect(result).not.toBe(input);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect("zip" in result).toBe(false);
  });

  test("an unknown field is an error (strict), not silently dropped", () => {
    const error = failure(() => address.cast({ city: "Riga", country: "LV" }, "address"));
    expect(error.reason).toBe("unknown-key");
    expect(error.path).toBe("address.country");
  });

  test("an own undefined field is an error; null only where nullable", () => {
    expect(failure(() => address.cast({ city: undefined })).reason).toBe("undefined");
    expect(address.cast({ city: "x", zip: null })).toEqual({ city: "x", zip: null });
    expect(failure(() => address.cast({ city: null }, "a")).path).toBe("a.city");
  });

  test("a class instance is accepted by its own fields", () => {
    class Address {
      city = "Riga";
      get label(): string {
        return this.city;
      }
    }
    expect(address.cast(new Address())).toEqual({ city: "Riga" });
  });

  test("primitives, arrays, Maps, Dates and BSON values are not subdocuments", () => {
    for (const input of ["x", 1, [], new Map(), new Date(), new ObjectId(), null]) {
      expect(["type", "null"]).toContain(failure(() => address.cast(input)).reason);
    }
  });

  test("an own __proto__ key is an unknown field and never touches the prototype", () => {
    const input = JSON.parse('{"city":"x","__proto__":{"polluted":true}}') as unknown;
    expect(failure(() => address.cast(input)).reason).toBe("unknown-key");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test("nested subdocuments report the full path and encode recursively", () => {
    const user = SubdocumentCaster.of({ address, visits: Int32Caster });
    expect(failure(() => user.cast({ address: { city: 5 } }, "user")).path).toBe("user.address.city");
    const encoded = user.encode(user.cast({ visits: 3 })) as { visits: { _bsontype: string } };
    expect(encoded.visits._bsontype).toBe("Int32");
  });
});

describe("VectorCaster (Binary subtype 9)", () => {
  test("number[] → int8 / float32 / packedBit vector", () => {
    const int8 = VectorCaster.of({ dtype: "int8", dimensions: 3 }).cast([-128, 0, 127]);
    expect(int8.sub_type).toBe(9);
    expect(Array.from(int8.toInt8Array())).toEqual([-128, 0, 127]);

    const float32 = VectorCaster.of({ dtype: "float32" }).cast([1.5, 0.1]);
    expect(Array.from(float32.toFloat32Array())).toEqual([1.5, Math.fround(0.1)]);

    const bits = VectorCaster.of({ dtype: "packedBit", dimensions: 10 }).cast([1, 0, 1, 1, 0, 0, 0, 0, 1, 1]);
    expect(Array.from(bits.toBits())).toEqual([1, 0, 1, 1, 0, 0, 0, 0, 1, 1]);
  });

  test("element errors carry the element path and reason", () => {
    const int8 = VectorCaster.of({ dtype: "int8" });
    expect(failure(() => int8.cast([1, 128], "v")).path).toBe("v.1");
    expect(failure(() => int8.cast([1, 128], "v")).reason).toBe("range");
    expect(failure(() => int8.cast([1.5])).reason).toBe("integer");
    expect(failure(() => int8.cast(["1"])).reason).toBe("type");
    expect(failure(() => VectorCaster.of({ dtype: "float32" }).cast([Number.NaN])).reason).toBe("finite");
    expect(failure(() => VectorCaster.of({ dtype: "float32" }).cast([1e39])).reason).toBe("range");
    expect(failure(() => VectorCaster.of({ dtype: "packedBit" }).cast([2])).reason).toBe("range");
  });

  test("dimensions must match exactly, and a vector is never empty", () => {
    expect(failure(() => VectorCaster.of({ dtype: "int8", dimensions: 3 }).cast([1, 2])).reason).toBe("dimensions");
    expect(failure(() => VectorCaster.of({ dtype: "int8" }).cast([])).reason).toBe("dimensions");
  });

  test("a native vector Binary of the same dtype passes as a copy; another dtype or subtype does not", () => {
    const source = Binary.fromInt8Array(new Int8Array([1, 2]));
    const result = VectorCaster.of({ dtype: "int8", dimensions: 2 }).cast(source);
    expect(result).not.toBe(source);
    expect(Array.from(result.toInt8Array())).toEqual([1, 2]);
    expect(failure(() => VectorCaster.of({ dtype: "float32" }).cast(source)).reason).toBe("subtype");
    expect(failure(() => VectorCaster.of({ dtype: "int8" }).cast(new Binary(new Uint8Array([3, 0, 1])))).reason).toBe(
      "subtype",
    );
  });

  test("a broken vector header is a format error with the bson error as cause", () => {
    const broken = new Binary(new Uint8Array([Binary.VECTOR_TYPE.Int8, 5, 1]), 9); /* int8 with padding 5 */
    const error = failure(() => VectorCaster.of({ dtype: "int8" }).cast(broken));
    expect(error.reason).toBe("format");
    expect(error.cause).toBeInstanceOf(Error);
  });

  test("the typed array of the dtype is accepted (Float32Array → float32, Int8Array → int8)", () => {
    const float32 = VectorCaster.of({ dtype: "float32", dimensions: 2 }).cast(new Float32Array([1.5, 0.25]));
    expect(Array.from(float32.toFloat32Array())).toEqual([1.5, 0.25]);
    const int8 = VectorCaster.of({ dtype: "int8" }).cast(new Int8Array([-1, 2]));
    expect(Array.from(int8.toInt8Array())).toEqual([-1, 2]);
  });

  test("typed-array elements are checked; another element type is refused", () => {
    expect(failure(() => VectorCaster.of({ dtype: "float32" }).cast(new Float32Array([Number.NaN]))).reason).toBe(
      "finite",
    );
    expect(failure(() => VectorCaster.of({ dtype: "float32" }).cast(new Float32Array([Infinity]))).reason).toBe(
      "finite",
    );
    expect(failure(() => VectorCaster.of({ dtype: "int8" }).cast(new Float32Array([1]))).reason).toBe("type");
    expect(failure(() => VectorCaster.of({ dtype: "float32" }).cast(new Int8Array([1]))).reason).toBe("type");
    expect(failure(() => VectorCaster.of({ dtype: "packedBit" }).cast(new Uint8Array([1]))).reason).toBe("type");
    expect(failure(() => VectorCaster.of({ dtype: "int8", dimensions: 3 }).cast(new Int8Array(2))).reason).toBe(
      "dimensions",
    );
  });

  test("bad definitions are configuration errors", () => {
    expect(() => VectorCaster.of({ dtype: "int8", dimensions: 0 })).toThrow(ConfigurationError);
    expect(() => VectorCaster.of({ dtype: "int8", dimensions: 1.5 })).toThrow(ConfigurationError);
    expect(() => VectorCaster.of({ dtype: "int4" as "int8" })).toThrow(ConfigurationError);
  });

  test("expected text names dtype and dimensions", () => {
    expect(VectorCaster.of({ dtype: "float32", dimensions: 768 }).expected).toBe("Vector<float32, 768>");
    expect(NumberCaster.expected).toBe("number");
  });
});
