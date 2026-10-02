import { Entity, Index, Prop, Schema, TypemoClient } from "@venloc/typemo";
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
const EARTH_RADIUS_METERS = 6_378_100;

export const countAround = (longitude: number, latitude: number, meters: number) =>
  Places.countDocuments({
    location: { $geoWithin: { $centerSphere: [[longitude, latitude], meters / EARTH_RADIUS_METERS] } },
  });

console.log(await countAround(2.35, 48.86, 5000));
// → 2
