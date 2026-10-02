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
const session = await Sessions.create({ user: "ann" });
console.log(session._id instanceof UUID, session.__v, session.createdAt instanceof Date);
// → true 0 true
