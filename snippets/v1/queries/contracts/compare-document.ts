import { Contract, Entity, type Hidden, Prop, Schema, type SelectedJson, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String) note?: string;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
type AccountJson = SelectedJson<Account, "owner" | "title" | "balance" | "note">;

export const getAccountJson = async (owner: string) => {
  const account = await Accounts.findOne({ owner }).orFail();
  const json = Contract.check<AccountJson>()(account.$toJSON());
  //    ^?
  return json;
};
