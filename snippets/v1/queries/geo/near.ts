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
export const nearest = (longitude: number, latitude: number, count: number) =>
  Places.find({
    location: { $near: { $geometry: GeoJson.point(longitude, latitude) } },
  })
    .limit(count)
    .plain();

console.log((await nearest(2.35, 48.86, 1)).map((place) => place.name));
// → ["Louvre"]
