import { Entity, EntityWithId, Prop, Schema, TypemoClient, Types, type Ref } from "@venloc/typemo";
import { UUID } from "mongodb";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema({ collection: "countries" })
class Country extends EntityWithId(() => String) {
  @Prop(() => String, { required: true }) name!: string;
}
@Schema({ collection: "sessions" })
class Session extends EntityWithId(() => Types.UUID, { default: () => new UUID() }) {
  @Prop(() => String, { required: true }) user!: string;
}
// ---cut---
@Schema({ collection: "cities" })
class City extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { ref: () => Country }) // [!code highlight]
  country?: Ref<Country, string>;

  @Prop(() => [Types.UUID], { ref: () => Session }) // [!code highlight]
  visitors!: Ref<Session, UUID>[];
}

const Countries = client.db().model(Country);
const Sessions = client.db().model(Session);
const Cities = client.db().model(City);
const visitor = await Sessions.create({ user: "ann" });
await Cities.create({ name: "Paris", country: "FR", visitors: [visitor._id] });

const city = await Cities.findOne({ name: "Paris" }).populate("country").populate("visitors").orFail();
console.log(city.country?.name, city.visitors[0]?.user);
// → France ann
