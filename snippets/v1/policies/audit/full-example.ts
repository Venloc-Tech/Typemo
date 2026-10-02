import { Entity, Prop, Schema, TypemoClient, PolicyContext } from "@venloc/typemo";
@Schema({ collection: "transfers", audit: true })
class Transfer extends Entity {
  @Prop(() => String, { required: true }) from!: string;
  @Prop(() => Number, { required: true }) amount!: number;
  @Prop(() => String, { sensitive: "mask" }) card?: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Transfers = client.connection.model(Transfer);
// ---cut---
// a transfer on behalf of a user: the actor goes to the log
export const makeTransfer = (userId: string, from: string, amount: number, card: string) =>
  PolicyContext.run({ actor: userId }, () => Transfers.create({ from, amount, card }));

// report: who changed what on the account
export const historyOf = (account: string) =>
  client.unsafeDriver().db("app").collection("transfers_audit").find({ "documents.from": account }).toArray();
