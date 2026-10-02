import { Entity, Prop, Schema, TypemoClient, Versioned, VersionError } from "@venloc/typemo";
@Schema({ collection: "accounts", optimisticConcurrency: true })
class Account extends Versioned(Entity) {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
const id = (await Accounts.findOne().orFail())._id;
// ---cut---
const mine = await Accounts.findById(id).orFail();
const theirs = await Accounts.findById(id).orFail();

theirs.balance = 10;
await theirs.$save();

mine.balance = 20;
try {
  await mine.$save();
} catch (error) {
  if (error instanceof VersionError) {
    console.log(error.message);
    // → Account: no document at version 0 (it was changed or deleted since it was read); modified: balance
    console.log(error.model, error.version, error.modifiedPaths);
    // → "Account" 0 ["balance"]
  }
}
