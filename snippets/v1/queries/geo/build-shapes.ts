import { Entity, GeoJson, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema()
class GeoPoint {
  @Prop(() => String, { enum: ["Point"], required: true }) type!: "Point";
  @Prop(() => [Number], { required: true }) coordinates!: number[];
}
@Index({ location: "2dsphere" })
@Schema({ collection: "places" })
class Place extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => GeoPoint, { required: true }) location!: GeoPoint;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Places = client.db().model(Place);
// ---cut---
const created = await Places.create({ name: "Notre-Dame", location: GeoJson.point(2.3499, 48.8530) });
console.log(created.location);
// → GeoPoint { type: "Point", coordinates: [2.3499, 48.853] }

const route = GeoJson.lineString([2.29, 48.85], [2.33, 48.86]);
console.log(route);
// → { type: "LineString", coordinates: [[2.29, 48.85], [2.33, 48.86]] }

const district = GeoJson.polygon([[2.0, 48.7], [2.6, 48.7], [2.6, 49.0], [2.0, 49.0], [2.0, 48.7]]);
const inside = await Places.find({ location: { $geoWithin: { $geometry: district } } }).sort({ name: 1 }).plain();
console.log(inside.map((place) => place.name));
// → ["Eiffel Tower", "Louvre", "Notre-Dame"]
