import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true })
  login!: string;
}

const Users = client.connection.model(User);
const user = await Users.create({ login: "ann" });
console.log(user.login, user._id.constructor.name);
// → ann ObjectId
