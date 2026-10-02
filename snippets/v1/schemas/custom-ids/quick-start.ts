import { EntityWithId, Prop, Schema, Timestamped, TypemoClient, Types, type Defaulted } from "@venloc/typemo";
import { UUID } from "mongodb";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "countries" })
class Country extends EntityWithId(() => String) { // [!code highlight]
  @Prop(() => String, { required: true })
  name!: string;
}

@Schema({ collection: "sessions" })
class Session extends EntityWithId(() => Types.UUID, { default: () => new UUID() }) { // [!code highlight]
  @Prop(() => String, { required: true })
  user!: string;
}

@Schema({ collection: "counters" })
class Counter extends EntityWithId(() => Number) { // [!code highlight]
  @Prop(() => Number, { required: true, default: 0 })
  hits!: Defaulted<number>;
}

const Countries = client.db().model(Country);
const Sessions = client.db().model(Session);
const france = await Countries.create({ _id: "FR", name: "France" });
const session = await Sessions.create({ user: "ann" });
console.log(france._id, session._id instanceof UUID);
// → FR true
