import { DriverError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
const session = await client.startSession();
await session.endSession();

try {
  await Accounts.countDocuments().session(session);
} catch (error) {
  if (error instanceof DriverError) {
    console.log(error.driverError, error.message);
    // → "MongoExpiredSessionError" "Use of expired sessions is not permitted"
  }
}
