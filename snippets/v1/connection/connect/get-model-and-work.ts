import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
export const openAccount = async (owner: string, title: string) => {
  const Accounts = client.connection.model(Account);
  return Accounts.create({ owner, title });
};

export const listAccounts = async (owner: string) => {
  const Accounts = client.db().model(Account);
  return Accounts.find({ owner }).plain();
};
