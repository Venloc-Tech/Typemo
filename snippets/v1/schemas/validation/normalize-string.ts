import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3, match: /^[a-z0-9_]+$/ })
  login!: string;
  @Prop(() => String, { uppercase: true, minLength: 3, maxLength: 3 })
  country?: string;
}
const Users = client.connection.model(User);
const user = await Users.create({ login: "  Ann_1 ", country: "pln" });
console.log(user.login, user.country);
// → ann_1 PLN
try {
  await Users.create({ login: "  ab  " });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "login": must be at least 3 characters long [minLength]
