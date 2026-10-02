import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) login!: string;
  @Prop(() => Number, { min: 18, max: 120 }) age?: number;
}
const Users = client.connection.model(User);
await Users.create({ login: "ann", age: 20 });
// ---cut---
const user = await Users.findOne({ login: "ann" }).orFail();
user.age = 3;
try {
  await user.$validate();
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "age": must be at least 18 [min]
