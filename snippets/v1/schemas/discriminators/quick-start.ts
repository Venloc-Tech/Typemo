import { Discriminator, Entity, Prop, Schema, TypemoClient, type DiscriminatorValue } from "@venloc/typemo";
@Schema({ collection: "payments" })
class Payment extends Entity {
  @Prop(() => Number, { required: true }) amount!: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Discriminator("card") // [!code highlight]
class CardPayment extends Payment {
  declare readonly __t: DiscriminatorValue<"card">; // [!code highlight]
  @Prop(() => String, { required: true })
  last4!: string;
}

const CardPayments = client.db().model(CardPayment);
const payment = await CardPayments.create({ amount: 30, last4: "4242" });
console.log(payment.__t);
// → card
