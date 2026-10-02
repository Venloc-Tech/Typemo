import { Discriminator, Entity, Prop, Schema, TypemoClient, type Discriminators, type DiscriminatorValue } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ collection: "payments", discriminatorKey: "kind", discriminators: () => [CardPayment] })
class Payment extends Entity {
  declare readonly kind?: Discriminators<CardPayment>;
  @Prop(() => Number, { required: true }) amount!: number;
}

@Discriminator("card")
class CardPayment extends Payment {
  declare readonly kind: DiscriminatorValue<"card">;
  @Prop(() => String, { required: true }) last4!: string;
}

const card = await client.db().model(CardPayment).create({ amount: 1, last4: "1" });
// in the database: { amount: 1, last4: "1", kind: "card" }
