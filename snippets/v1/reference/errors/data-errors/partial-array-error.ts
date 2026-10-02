import { Entity, Prop, Schema, TypemoClient, PartialArrayError } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [String]) tags!: string[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
const id = (await Accounts.findOne().orFail())._id;
// ---cut---
const account = await Accounts.findById(id).select({ tags: { $slice: 1 } }).orFail();
account.tags.set(0, "Z");

try {
  await account.$save();
} catch (error) {
  if (error instanceof PartialArrayError) {
    console.log(error.message);
    // → "tags" was loaded partially (projection); a positional $set would overwrite the elements that were not loaded
    console.log(error.path);
    // → "tags"
  }
}
