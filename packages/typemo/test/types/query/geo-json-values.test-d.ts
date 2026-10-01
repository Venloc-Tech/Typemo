/*
 * `GeoJson` builders return the exact GeoJSON types: a value kept in a variable without an annotation fits every
 * geo filter operator. The same object literal without the builder widens `coordinates` to `number[]`.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import type { GeoJsonLineString, GeoJsonPoint, GeoJsonPolygon } from "../../../src/index.ts";
import { GeoJson } from "../../../src/query/geo-json-values.ts";
import { Members } from "./setup.ts";

// ---- positive ---------------------------------------------------------------------------------------
const here = GeoJson.point(13.4, 52.5);
expectTypeOf(here).toEqualTypeOf<GeoJsonPoint>();
const route = GeoJson.lineString([0, 0], [1, 1]);
expectTypeOf(route).toEqualTypeOf<GeoJsonLineString>();
const area = GeoJson.polygon([
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 0],
]);
expectTypeOf(area).toEqualTypeOf<GeoJsonPolygon>();

Members.find({ "profile.address.geo": { $near: { $geometry: here, $maxDistance: 10 } } });
Members.find({ "profile.address.geo": { $nearSphere: { $geometry: here, $minDistance: 1 } } });
Members.find({ "profile.address.geo": { $geoIntersects: { $geometry: here } } });
Members.find({ "profile.address.geo": { $geoIntersects: { $geometry: route } } });
Members.find({ "profile.address.geo": { $geoIntersects: { $geometry: area } } });
Members.find({ "profile.address.geo": { $geoWithin: { $geometry: area } } });

// ---- negative ---------------------------------------------------------------------------------------
const literal = { type: "Point", coordinates: [13.4, 52.5] };
// @ts-expect-error — without the builder `type` widens to string and `coordinates` to number[]
Members.find({ "profile.address.geo": { $near: { $geometry: literal } } });
// @ts-expect-error — $geoWithin takes a (multi)polygon, not a point
Members.find({ "profile.address.geo": { $geoWithin: { $geometry: here } } });
// @ts-expect-error — a line string has two positions at least
GeoJson.lineString([0, 0]);
// @ts-expect-error — a ring has four positions at least
GeoJson.polygon([
  [0, 0],
  [1, 0],
  [0, 0],
]);
