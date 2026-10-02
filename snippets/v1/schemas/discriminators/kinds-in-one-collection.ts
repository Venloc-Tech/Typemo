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
await TransferPayments.create({ amount: 500, iban: "PL61 1090 1014 0000 0712 1981 2874" });
await Payments.create({ amount: 5 });
// in the payments collection:
// → { amount: 30, last4: "4242", __t: "card" }
// → { amount: 500, iban: "PL61 …", __t: "transfer" }
// → { amount: 5 }
