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
export const describeDocs = async (): Promise<string[]> => {
  const docs = await Payments.find();
  return docs.map((doc) => {
    if (doc instanceof CardPayment) return `card ${doc.last4}`;
    if (doc instanceof TransferPayment) return `transfer ${doc.iban}`;
    return "other";
  });
};
