import { Discriminator, Entity, Prop, Schema, TypemoClient, type Discriminators, type DiscriminatorValue } from "@venloc/typemo";

@Schema({ collection: "payments", discriminators: () => [CardPayment, TransferPayment] })
class Payment extends Entity {
  declare readonly __t?: Discriminators<CardPayment | TransferPayment>;
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

// your code: the error at the application boundary
class __NotFound__ extends Error {}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Payments = client.db().model(Payment);
const CardPayments = client.db().model(CardPayment);
const TransferPayments = client.db().model(TransferPayment);

// write: each kind is created by its own model, the key is set automatically
export const payByCard = async (amount: number, last4: string) => CardPayments.create({ amount, last4 });
export const payByTransfer = async (amount: number, iban: string) => TransferPayments.create({ amount, iban });

// report over every kind: the base knows its children, then narrow by the key
export const statement = async () => {
  const rows = await Payments.find().sort({ amount: 1 }).plain();
  return rows.map((row) => {
    if (row.__t === "card") return `card ${row.last4}: ${row.amount}`;
    if (row.__t === "transfer") return `transfer ${row.iban}: ${row.amount}`;
    return `payment: ${row.amount}`;
  });
};

// work with one kind: the child model sees only its own documents
export const findCard = async (last4: string) => {
  const payment = await CardPayments.findOne({ last4 }).plain();
  if (payment === null) throw new __NotFound__(`no card payment ending ${last4}`);
  return payment;
};
