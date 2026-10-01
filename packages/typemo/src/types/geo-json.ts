/*
 * GeoJSON operand types of the geospatial query operators. MongoDB accepts exactly these shapes
 * (https://www.mongodb.com/docs/manual/reference/geojson/). Positions are `[longitude, latitude]`.
 */

/**
 * A position: `[longitude, latitude]` (an optional altitude is ignored by MongoDB's 2dsphere).
 *
 * @example
 * const p: GeoPosition = [13.4, 52.5];
 */
export type GeoPosition = readonly [longitude: number, latitude: number] | readonly [number, number, number];

/**
 * A legacy coordinate pair of a `2d` index: `[x, y]`.
 *
 * @example
 * const p: LegacyPair = [10, 20];
 */
export type LegacyPair = readonly [x: number, y: number];

/**
 * GeoJSON `Point`.
 *
 * @example
 * const p: GeoJsonPoint = { type: "Point", coordinates: [13.4, 52.5] };
 */
export interface GeoJsonPoint {
  /** The geometry discriminant. */
  readonly type: "Point";
  /** The position of the point. */
  readonly coordinates: GeoPosition;
}

/**
 * GeoJSON `LineString` (at least two positions).
 *
 * @example
 * const l: GeoJsonLineString = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
 */
export interface GeoJsonLineString {
  /** The geometry discriminant. */
  readonly type: "LineString";
  /** The positions of the line, two at least. */
  readonly coordinates: readonly [GeoPosition, GeoPosition, ...GeoPosition[]];
}

/**
 * A closed linear ring (first position = last position, at least four positions).
 *
 * @example
 * const r: GeoLinearRing = [[0, 0], [1, 0], [1, 1], [0, 0]];
 */
export type GeoLinearRing = readonly [GeoPosition, GeoPosition, GeoPosition, GeoPosition, ...GeoPosition[]];

/**
 * GeoJSON `Polygon`: an exterior ring and optional holes.
 *
 * @example
 * const p: GeoJsonPolygon = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
 */
export interface GeoJsonPolygon {
  /** The geometry discriminant. */
  readonly type: "Polygon";
  /** The exterior ring followed by the rings of the holes. */
  readonly coordinates: readonly [GeoLinearRing, ...GeoLinearRing[]];
}

/**
 * GeoJSON `MultiPoint`.
 *
 * @example
 * const m: GeoJsonMultiPoint = { type: "MultiPoint", coordinates: [[0, 0], [1, 1]] };
 */
export interface GeoJsonMultiPoint {
  /** The geometry discriminant. */
  readonly type: "MultiPoint";
  /** The positions of the points. */
  readonly coordinates: readonly GeoPosition[];
}

/**
 * GeoJSON `MultiLineString`.
 *
 * @example
 * const m: GeoJsonMultiLineString = { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] };
 */
export interface GeoJsonMultiLineString {
  /** The geometry discriminant. */
  readonly type: "MultiLineString";
  /** The position lists of the lines. */
  readonly coordinates: readonly (readonly [GeoPosition, GeoPosition, ...GeoPosition[]])[];
}

/**
 * GeoJSON `MultiPolygon`.
 *
 * @example
 * const m: GeoJsonMultiPolygon = { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] };
 */
export interface GeoJsonMultiPolygon {
  /** The geometry discriminant. */
  readonly type: "MultiPolygon";
  /** The ring lists of the polygons. */
  readonly coordinates: readonly (readonly [GeoLinearRing, ...GeoLinearRing[]])[];
}

/**
 * GeoJSON `GeometryCollection`.
 *
 * @example
 * const c: GeoJsonGeometryCollection = { type: "GeometryCollection", geometries: [] };
 */
export interface GeoJsonGeometryCollection {
  /** The geometry discriminant. */
  readonly type: "GeometryCollection";
  /** The member geometries (collections do not nest). */
  readonly geometries: readonly GeoJsonSimpleGeometry[];
}

/**
 * Every geometry but a collection.
 *
 * @example
 * const g: GeoJsonSimpleGeometry = { type: "Point", coordinates: [0, 0] };
 */
export type GeoJsonSimpleGeometry =
  | GeoJsonPoint
  | GeoJsonLineString
  | GeoJsonPolygon
  | GeoJsonMultiPoint
  | GeoJsonMultiLineString
  | GeoJsonMultiPolygon;

/**
 * Any GeoJSON geometry.
 *
 * @example
 * const g: GeoJsonGeometry = { type: "GeometryCollection", geometries: [] };
 */
export type GeoJsonGeometry = GeoJsonSimpleGeometry | GeoJsonGeometryCollection;

/**
 * The "big polygon" CRS of `$geoWithin`/`$geoIntersects` (a single-ringed polygon larger than a hemisphere).
 *
 * @example
 * const crs: GeoBigPolygonCrs = {
 *   type: "name",
 *   properties: { name: "urn:x-mongodb:crs:strictwinding:EPSG:4326" },
 * };
 */
export interface GeoBigPolygonCrs {
  /** The CRS kind; always `"name"`. */
  readonly type: "name";
  /** The named CRS. */
  readonly properties: { readonly name: "urn:x-mongodb:crs:strictwinding:EPSG:4326" };
}

/**
 * `$geometry` of `$geoWithin`: a (multi)polygon, optionally with the big-polygon CRS.
 *
 * @example
 * const g: GeoWithinGeometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
 */
export type GeoWithinGeometry = (GeoJsonPolygon | GeoJsonMultiPolygon) & { readonly crs?: GeoBigPolygonCrs };

/**
 * `$geoWithin`: a GeoJSON (multi)polygon or one of the legacy shapes of a `2d` index.
 *
 * @example
 * const a: GeoWithinOperand = { $center: [[0, 0], 5] };
 */
export type GeoWithinOperand =
  | { readonly $geometry: GeoWithinGeometry }
  | { readonly $box: readonly [bottomLeft: LegacyPair, upperRight: LegacyPair] }
  | { readonly $polygon: readonly [LegacyPair, LegacyPair, LegacyPair, ...LegacyPair[]] }
  | { readonly $center: readonly [center: LegacyPair, radius: number] }
  | { readonly $centerSphere: readonly [center: LegacyPair, radiansRadius: number] };

/**
 * `$geoIntersects` takes every GeoJSON geometry (a big polygon may carry the CRS).
 *
 * @example
 * const a: GeoIntersectsOperand = { $geometry: { type: "Point", coordinates: [0, 0] } };
 */
export interface GeoIntersectsOperand {
  /** The geometry to intersect with. */
  readonly $geometry: GeoJsonGeometry & { readonly crs?: GeoBigPolygonCrs };
}

/**
 * `$near` / `$nearSphere`: a GeoJSON point with distances in meters, or a legacy pair.
 *
 * @example
 * const a: GeoNearOperand = { $geometry: { type: "Point", coordinates: [0, 0] }, $maxDistance: 500 };
 */
export type GeoNearOperand =
  | {
      /** The center point. */
      readonly $geometry: GeoJsonPoint;
      /** The minimum distance from the center, in meters. */
      readonly $minDistance?: number;
      /** The maximum distance from the center, in meters. */
      readonly $maxDistance?: number;
    }
  | LegacyPair;

/**
 * A stored value the geo operators apply to: a GeoJSON object (`{ type, coordinates }`).
 *
 * @example
 * const v: GeoJsonLike = { type: "Point", coordinates: [0, 0] };
 */
export interface GeoJsonLike {
  /** The GeoJSON type name. */
  readonly type: string;
  /** The coordinates, in the shape the type requires. */
  readonly coordinates: readonly unknown[];
}
