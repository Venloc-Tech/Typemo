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
// wrong: coordinates inferred as number[]
const wrong = { type: "Point" as const, coordinates: [2.35, 48.86] };
// @errors: 2322
await Places.find({ location: { $near: { $geometry: wrong } } }).plain();
// compiler: … Type 'number[]' is not assignable to type 'GeoPosition'. Target requires 3 element(s) but source may have fewer.

// right: the exact type, the range checked
const center = GeoJson.point(2.35, 48.86);
await Places.find({ location: { $near: { $geometry: center } } }).plain();
