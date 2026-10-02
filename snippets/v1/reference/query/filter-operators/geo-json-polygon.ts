import { CastError, GeoJson } from "@venloc/typemo";
// ---cut---
const square = GeoJson.polygon([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
const withHole = GeoJson.polygon(
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  [[1, 1], [2, 1], [2, 2], [1, 1]],
);
console.log(square.coordinates.length, withHole.coordinates.length);
// → 1 2
