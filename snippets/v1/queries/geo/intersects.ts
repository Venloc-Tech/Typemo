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
const hit = await Places.find({
  location: {
    $geoIntersects: {
      $geometry: {
        type: "Polygon",
        coordinates: [[[2.3, 48.8], [2.4, 48.8], [2.4, 48.9], [2.3, 48.9], [2.3, 48.8]]],
      },
    },
  },
}).plain();
console.log(hit.map((place) => place.name));
// → ["Louvre"]
