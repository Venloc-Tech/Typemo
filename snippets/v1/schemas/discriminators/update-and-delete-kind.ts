import { Discriminator, Entity, Prop, Schema, TypemoClient, type DiscriminatorValue } from "@venloc/typemo";
@Schema({ collection: "payments" })
class Payment extends Entity {
  @Prop(() => Number, { required: true }) amount!: number;
}
@Discriminator("card")
class CardPayment extends Payment {
  declare readonly __t: DiscriminatorValue<"card">;
  @Prop(() => String, { required: true }) last4!: string;
}
@Discriminator("transfer")
class TransferPayment extends Payment {
  declare readonly __t: DiscriminatorValue<"transfer">;
  @Prop(() => String, { required: true }) iban!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Payments = client.db().model(Payment);
const CardPayments = client.db().model(CardPayment);
const TransferPayments = client.db().model(TransferPayment);
// ---cut---
await TransferPayments.create({ amount: 500, iban: "PL61" });

const other = await CardPayments.updateOne({ amount: 500 }, { $set: { amount: 8 } });
console.log(other.matchedCount);
// → 0
