import { Entity, Prop, Schema, TypemoClient, type Hidden, type Selected } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => BigInt, { required: true }) balance!: bigint;
  @Prop(() => Date) openedAt?: Date;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.connection.model(Account);
// ---cut---
const account = await Accounts.findOne({ owner: "ann" }).select({ "+pin": true }).orFail();
//    ^?
const inDocument = account.pin;
//    ^?
const forInternalUse = account.$toPlain({ hidden: true }).pin;
//    ^?
// @errors: 2339
account.$toPlain().pin;
