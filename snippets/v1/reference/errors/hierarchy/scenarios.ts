import { ErrorClassifier, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);
// ---cut---
export const openAccount = async (title: string): Promise<"created" | "taken" | "later"> => {
  try {
    await Accounts.create({ title });
    return "created";
  } catch (error) {
    if (ErrorClassifier.isDuplicateKey(error)) return "taken";
    if (ErrorClassifier.isRetryable(error)) return "later";
    throw error;
  }
};
