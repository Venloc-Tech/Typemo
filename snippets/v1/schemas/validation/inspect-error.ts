import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, minLength: 3 }) login!: string;
  @Prop(() => Number, { min: 18 }) age?: number;
}
const Users = client.connection.model(User);
// ---cut---
import { ValidationError } from "@venloc/typemo";

try {
  await Users.create({ login: "a", age: 3 });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.issues.map((issue) => `${issue.path.join(".")}:${issue.reason}`));
    // → ["login:minLength", "age:min"]
    console.log(Object.keys(error.errors));
    // → ["login", "age"]
  }
}
