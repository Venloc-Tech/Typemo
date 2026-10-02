import { Discriminator, Entity, Prop, Schema, TypemoClient, type Discriminators, type DiscriminatorValue } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "payments", discriminators: () => [Card, Transfer] }) // [!code highlight]
class Payment extends Entity {
  declare readonly __t?: Discriminators<Card | Transfer>; // [!code highlight]
  @Prop(() => Number, { required: true })
  amount!: number;
}

@Discriminator("card")
class Card extends Payment {
  declare readonly __t: DiscriminatorValue<"card">;
  @Prop(() => String, { required: true })
  last4!: string;
}

@Discriminator("transfer")
class Transfer extends Payment {
  declare readonly __t: DiscriminatorValue<"transfer">;
  @Prop(() => String, { required: true })
  iban!: string;
}

const Payments = client.db().model(Payment);
await client.db().model(Card).create({ amount: 30, last4: "4242" });
await client.db().model(Transfer).create({ amount: 500, iban: "PL61" });
await Payments.create({ amount: 5 });
const rows = await Payments.find().sort({ amount: 1 }).plain();
console.log(rows.map((row) => (row.__t === "card" ? `card ${row.last4}` : row.__t === "transfer" ? `transfer ${row.iban}` : `payment ${row.amount}`)));
// → ["payment 5", "card 4242", "transfer PL61"]
