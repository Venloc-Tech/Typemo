import { EntityWithId, Prop, Schema, TypemoClient, Types } from "@venloc/typemo";
import { UUID } from "mongodb";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
@Schema({ collection: "sessions" })
class Session extends EntityWithId(() => Types.UUID, { default: () => new UUID() }) {
  @Prop(() => String, { required: true }) user!: string;
}
const Sessions = client.db().model(Session);
const created = await Sessions.create({ user: "cid" });
const id = created._id.toHexString();
// ---cut---
const session = await Sessions.findById(id).orFail().plain();
console.log(session.user, typeof session._id);
// → cid string
