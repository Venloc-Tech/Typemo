import { Entity, Prop, Schema, TypemoClient, DirectWriteError } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [String]) tags!: string[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
const id = (await Accounts.findOne().orFail())._id;
// ---cut---
const account = await Accounts.findById(id).orFail();
(account.tags as unknown as string[])[0] = "hack";

try {
  await account.$save();
} catch (error) {
  if (error instanceof DirectWriteError) {
    console.log(error.message);
    // → "tags" was changed around its methods: position 0 was assigned directly (use set(0, value))
    console.log(error.path);
    // → "tags"
  }
}
