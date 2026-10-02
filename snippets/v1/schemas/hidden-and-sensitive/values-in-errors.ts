import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { sensitive: "mask", unique: true, sparse: true }) passport?: string;
  @Prop(() => String, { sensitive: "hide" }) resetToken?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Users = client.db().model(User);
// ---cut---
try {
  await Users.create({ resetToken: 5 as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string failed at path "resetToken" for "[hidden]" (string): expected a string [type]

await client.db().init();
await Users.create({ passport: "P123" });
try {
  await Users.create({ passport: "P123" });
} catch (error) {
  console.log((error as Error).message);
}
// → duplicate key on passport_1: { passport: "?" } (code 11000 DuplicateKey)
