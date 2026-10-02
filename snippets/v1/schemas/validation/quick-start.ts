import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true, minLength: 3, maxLength: 12 })
  login!: string;

  @Prop(() => Number, { min: 18, max: 120 })
  age?: number;
}

const Users = client.connection.model(User);
try {
  await Users.create({ login: "ab", age: 7 });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "login": must be at least 3 characters long [minLength]; "age": must be at least 18 [min]
