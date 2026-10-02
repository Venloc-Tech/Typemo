import { Discriminator, Entity, Prop, Schema, TypemoClient, type Discriminators, type DiscriminatorValue } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "payments", discriminators: () => [CardPayment, TransferPayment] }) // [!code highlight]
class Payment extends Entity {
  declare readonly __t?: Discriminators<CardPayment | TransferPayment>; // [!code highlight]
  @Prop(() => Number, { required: true })
  amount!: number;
}

@Discriminator("card")
class CardPayment extends Payment {
  declare readonly __t: DiscriminatorValue<"card">;
  @Prop(() => String, { required: true })
  last4!: string;
}

@Discriminator("transfer")
class TransferPayment extends Payment {
  declare readonly __t: DiscriminatorValue<"transfer">;
  @Prop(() => String, { required: true })
  iban!: string;
}

const Payments = client.db().model(Payment);
export const statement = async (): Promise<string[]> => {
  const rows = await Payments.find().sort({ amount: 1 }).plain();
  return rows.map((row) => {
    if (row.__t === "card") return `card ${row.last4}`;
    //                                         ^?
    if (row.__t === "transfer") return `transfer ${row.iban}`;
    return `payment ${row.amount}`;
  });
};
console.log(await statement());
// → ["payment 5", "card 4242", "transfer PL61 …"]
const transfers = await Payments.find({ __t: "transfer" }).plain();
console.log(transfers.length);
// → 1
