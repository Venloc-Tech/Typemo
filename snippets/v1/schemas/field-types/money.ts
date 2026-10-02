import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ collection: "payments" })
class Payment extends Entity {
  @Prop(() => Types.Decimal128, { required: true }) // [!code highlight]
  amount!: Types.Decimal128;
}
const Payments = client.connection.model(Payment);
const payment = await Payments.create({ amount: "1.10" });
console.log(payment.amount.toString());
// → 1.10
console.log(payment.$toPlain().amount);
// → "1.10"
