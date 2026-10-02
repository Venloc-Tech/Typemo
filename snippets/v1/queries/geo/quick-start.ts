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
const near = await Places.find({
  location: { $near: { $geometry: { type: "Point", coordinates: [2.35, 48.86] }, $maxDistance: 5000 } },
}).plain();
console.log(near.map((place) => place.name));
// → ["Louvre", "Eiffel Tower"]
