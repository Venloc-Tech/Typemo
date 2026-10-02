import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, trim: true, lowercase: true, minLength: 3 }) login!: string;
  @Prop(() => Number, { min: 18, max: 120 }) age?: number;
}
const Users = client.connection.model(User);
await Users.create({ login: "ann", age: 20 });
// ---cut---
try {
  await Users.updateOne({ login: "ann" }, { $set: { age: 5 } });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "age": must be at least 18 [min]
try {
  await Users.updateOne({ login: "ann" }, { $inc: { age: 200 } });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "age": $inc 200 on 20 gives 220, above the maximum 120; nothing was written [max]
await Users.updateOne({ login: "ann" }, { $set: { login: "  NEWANN " } });
console.log((await Users.findOne({ login: "newann" }).plain())?.login);
// → newann
