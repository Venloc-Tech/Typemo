import { CastError, GeoJson } from "@venloc/typemo";
// ---cut---
const route = GeoJson.lineString([2.29, 48.85], [2.33, 48.86]);
console.log(route.coordinates.length);
// → 2
