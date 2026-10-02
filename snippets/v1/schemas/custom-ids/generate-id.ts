import { EntityWithId, Prop, Schema, Timestamped, TypemoClient, Types, Versioned } from "@venloc/typemo";
import { UUID } from "mongodb";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "sessions" })
class Session extends Versioned(Timestamped(EntityWithId(() => Types.UUID, { default: () => new UUID() }))) { // [!code highlight]
  @Prop(() => String, { required: true })
  user!: string;
}

const Sessions = client.db().model(Session);
const created = await Sessions.create({ user: "ann" });
console.log(created._id instanceof UUID, created.__v, created.createdAt instanceof Date);
// → true 0 true

const own = new UUID();
const explicit = await Sessions.create({ _id: own, user: "bob" });
console.log(explicit._id.equals(own));
// → true
