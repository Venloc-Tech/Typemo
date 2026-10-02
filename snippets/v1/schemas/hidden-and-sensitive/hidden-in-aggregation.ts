import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
import { Pipeline } from "@venloc/typemo";
// ---cut---
const hidden = await Users.aggregate(Pipeline.from(User).match({ name: "gina" }).plan());
// → [{ _id: ObjectId("…"), name: "gina" }]

const included = await Users.aggregate(Pipeline.from(User, { include: ["passwordHash"] }).match({ name: "gina" }).plan());
// → [{ _id: ObjectId("…"), name: "gina", passwordHash: "h1" }]
