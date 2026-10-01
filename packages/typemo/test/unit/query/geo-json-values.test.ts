import { describe, expect, test } from "bun:test";
import { CastError, type GeoLinearRing, type GeoPosition } from "../../../src/index.ts";
import { GeoJson } from "../../../src/query/geo-json-values.ts";

/*
 * `GeoJson` builders: exact GeoJSON values, positions checked the way a 2dsphere index checks them.
 */

/**
 * The CastError a call throws.
 * @param run The call.
 * @returns The error.
 */
const castError = (run: () => unknown): CastError => {
  try {
    run();
  } catch (error) {
    if (error instanceof CastError) return error;
    throw error;
  }
  throw new Error("expected a CastError");
};

describe("GeoJson", () => {
  test("point, lineString and polygon build the GeoJSON objects (longitude first)", () => {
    expect(GeoJson.point(13.4, 52.5)).toEqual({ type: "Point", coordinates: [13.4, 52.5] });
    expect(GeoJson.lineString([0, 0], [1, 1, 5])).toEqual({
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1, 5],
      ],
    });
    const ring: GeoLinearRing = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const polygon = GeoJson.polygon(ring);
    expect(polygon).toEqual({ type: "Polygon", coordinates: [ring] });
    /* The input is copied, never aliased. */
    expect(polygon.coordinates[0]).not.toBe(ring);
  });

  test("an out-of-range or non-finite coordinate is a CastError with the path", () => {
    expect([castError(() => GeoJson.point(200, 0)).reason, castError(() => GeoJson.point(200, 0)).path]).toEqual([
      "range",
      "coordinates",
    ]);
    expect(castError(() => GeoJson.point(0, 91)).reason).toBe("range");
    expect(castError(() => GeoJson.point(Number.NaN, 0)).reason).toBe("type");
    expect(castError(() => GeoJson.lineString([0, 0], [0, Number.POSITIVE_INFINITY])).path).toBe("coordinates.1");
  });

  test("a line string of fewer than two positions is a CastError", () => {
    /* as never: the type needs two positions; this is the call of a JavaScript caller. */
    const error = castError(() => GeoJson.lineString(...([[0, 0]] as never as [GeoPosition, GeoPosition])));
    expect(error.path).toBe("coordinates");
    expect(error.detail).toMatch(/two positions at least/);
    expect(castError(() => GeoJson.lineString(...([] as never as [GeoPosition, GeoPosition]))).path).toBe(
      "coordinates",
    );
  });

  test("a ring that is not closed or too short is a CastError", () => {
    const open = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      /* cast: an invalid ring passed on purpose to test the run-time ring check */
    ] as unknown as GeoLinearRing;
    expect(castError(() => GeoJson.polygon(open)).detail).toMatch(/closed/);
    const short = [
      [0, 0],
      [1, 0],
      [0, 0],
      /* cast: an invalid ring passed on purpose to test the run-time ring check */
    ] as unknown as GeoLinearRing;
    expect(castError(() => GeoJson.polygon(short)).detail).toMatch(/four positions/);
    const bad: GeoPosition = [0, 0];
    expect(castError(() => GeoJson.polygon([bad, [1, 0], [1, 1], [0, -100]])).path).toBe("coordinates.0.3");
  });
});
