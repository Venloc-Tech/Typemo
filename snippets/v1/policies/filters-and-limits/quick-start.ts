import { Entity, Prop, Schema, TypemoClient, Filters, StrictModeError } from "@venloc/typemo";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Users = client.connection.model(User);
// ---cut---
try {
  await Users.deleteMany(JSON.parse("{}"));
} catch (error) {
  if (error instanceof StrictModeError) console.log(error.reason);
  // → "empty-filter"
}
await Users.updateMany(Filters.all(), { $set: { age: 1 } });
