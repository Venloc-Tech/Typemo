import { Entity, EntityWithId, fn, Prop, Schema, TypemoClient } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema({ collection: "cities" })
class City extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) country!: string;
}
// ---cut---
@Schema({ collection: "country_totals" })
class CountryTotal extends EntityWithId(() => String) { // [!code highlight]
  @Prop(() => Number, { required: true })
  cities!: number;
}

const Cities = client.db().model(City);
const Totals = client.db().model(CountryTotal);
await Cities.insertMany([
  { name: "Lyon", country: "FR" },
  { name: "Berlin", country: "DE" },
]);
await Cities.aggregate((p) => p.group((f) => ({ _id: f.country, cities: fn.sum(1) })).out(CountryTotal)); // [!code highlight]

const totals = await Totals.find().sort({ _id: 1 }).lean();
console.log(totals.map((row) => [row._id, row.cities]));
// → [["DE", 1], ["FR", 2]]
