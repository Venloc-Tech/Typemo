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
const created = await Payments.create({ amount: 30, __t: "card", last4: "1111" } as never);
console.log(created.constructor.name);
// → CardPayment

try {
  await Payments.create({ amount: 1, __t: "crypto" } as never);
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Payment failed at path "__t" for "crypto" (string): "crypto" is not a discriminator value of Payment (known: card, transfer) [type]
