import { CastError } from "../errors/cast-error.ts";
import type { GeoJsonLineString, GeoJsonPoint, GeoJsonPolygon, GeoLinearRing, GeoPosition } from "../types/geo-json.ts";

/**
 * Builders of typed GeoJSON values. An object literal kept in a variable without a type annotation widens its
 * `coordinates` to `number[]`, which no geo operator accepts; a builder returns the exact GeoJSON type, so the
 * value fits `$near`, `$nearSphere`, `$geoIntersects` and (a polygon) `$geoWithin` and a GeoJSON field on
 * create. Positions are checked the way a `2dsphere` index checks them: finite, longitude in [-180, 180],
 * latitude in [-90, 90].
 *
 * @example
 * ```ts
 * @Schema()
 * class GeoPoint {
 *   @Prop(() => String, { enum: ["Point"], required: true }) type!: "Point";
 *   @Prop(() => [Number], { required: true }) coordinates!: number[];
 * }
 * @Index({ location: "2dsphere" })
 * @Schema({ collection: "places" })
 * class Place extends Entity {
 *   @Prop(() => GeoPoint, { required: true }) location!: GeoPoint;
 * }
 * const Places = connection.model(Place);
 * const here = GeoJson.point(13.4, 52.5);
 * await Places.find({ location: { $near: { $geometry: here, $maxDistance: 500 } } });
 * ```
 */
export class GeoJson {
  /**
   * A GeoJSON `Point`.
   *
   * @param longitude - The longitude, in [-180, 180].
   * @param latitude - The latitude, in [-90, 90].
   * @returns The point `{ type: "Point", coordinates: [longitude, latitude] }`.
   * @throws {CastError} When a coordinate is not a finite number or is out of its range.
   * @example
   * ```ts
   * const berlin = GeoJson.point(13.4, 52.5);
   * ```
   */
  static point(longitude: number, latitude: number): GeoJsonPoint {
    return { type: "Point", coordinates: GeoJson.position([longitude, latitude], "coordinates") };
  }

  /**
   * A GeoJSON `LineString` of two positions at least.
   *
   * @param positions - The positions, `[longitude, latitude]` each.
   * @returns The line string.
   * @throws {CastError} When a position is invalid or there are fewer than two positions.
   * @example
   * ```ts
   * const route = GeoJson.lineString([0, 0], [1, 1]);
   * ```
   */
  static lineString(...positions: readonly [GeoPosition, GeoPosition, ...GeoPosition[]]): GeoJsonLineString {
    if (positions.length < 2) {
      /* The type needs two positions; a caller without types would get the server's refusal at write time. */
      throw new CastError({
        path: "coordinates",
        value: positions,
        expected: "GeoJSON line string",
        reason: "format",
        detail: "a line string has two positions at least",
      });
    }
    const coordinates = positions.map((position, index) => GeoJson.position(position, `coordinates.${index}`));
    return { type: "LineString", coordinates: coordinates as unknown as GeoJsonLineString["coordinates"] };
  }

  /**
   * A GeoJSON `Polygon`: the exterior ring, then the rings of the holes. Every ring is closed (its last position
   * equals the first) and has four positions at least.
   *
   * @param rings - The exterior ring followed by the holes.
   * @returns The polygon.
   * @throws {CastError} When a position is invalid or a ring is not closed.
   * @example
   * ```ts
   * const square = GeoJson.polygon([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
   * ```
   */
  static polygon(...rings: readonly [GeoLinearRing, ...GeoLinearRing[]]): GeoJsonPolygon {
    const coordinates = rings.map((ring, index) => GeoJson.ring(ring, `coordinates.${index}`));
    return { type: "Polygon", coordinates: coordinates as unknown as GeoJsonPolygon["coordinates"] };
  }

  /**
   * A checked copy of a ring.
   *
   * @param ring - The ring.
   * @param path - Dotted path of the ring, used in error messages.
   * @returns The copied ring.
   * @throws {CastError} When a position is invalid, the ring is shorter than four positions or not closed.
   */
  private static ring(ring: readonly GeoPosition[], path: string): readonly GeoPosition[] {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new CastError({
        path,
        value: ring,
        expected: "GeoJSON linear ring",
        reason: "format",
        detail: "a ring has four positions at least",
      });
    }
    const copy = ring.map((position, index) => GeoJson.position(position, `${path}.${index}`));
    const first = copy[0] as GeoPosition;
    const last = copy[copy.length - 1] as GeoPosition;
    if (first.length !== last.length || first.some((value, index) => value !== last[index])) {
      throw new CastError({
        path,
        value: ring,
        expected: "GeoJSON linear ring",
        reason: "format",
        detail: "a ring is closed: its last position equals the first",
      });
    }
    return copy;
  }

  /**
   * A checked copy of a position.
   *
   * @param position - The position.
   * @param path - Dotted path of the position, used in error messages.
   * @returns The copied position.
   * @throws {CastError} When the position has not two or three finite numbers or is out of range.
   */
  private static position(position: GeoPosition, path: string): GeoPosition {
    const valid =
      Array.isArray(position) &&
      (position.length === 2 || position.length === 3) &&
      position.every((value) => typeof value === "number" && Number.isFinite(value));
    if (!valid) {
      throw new CastError({
        path,
        value: position,
        expected: "GeoJSON position",
        reason: "type",
        detail: "a position is [longitude, latitude] (an optional altitude), finite numbers",
      });
    }
    const [longitude, latitude] = position;
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new CastError({
        path,
        value: position,
        expected: "GeoJSON position",
        reason: "range",
        detail: "the longitude is in [-180, 180] and the latitude in [-90, 90] (longitude first)",
      });
    }
    return [...position] as unknown as GeoPosition;
  }
}
