import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Payment extends Entity {
  @Prop(() => String, { sensitive: "mask" }) // [!code highlight]
  card?: string;
  @Prop(() => Number, { sensitive: "hide" }) // [!code highlight]
  cvv?: number;
}
const Payments = client.db().model(Payment);
try {
  await Payments.create({ card: 5 as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to string failed at path "card" for "?" (string): expected a string [type]
try {
  await Payments.create({ cvv: "x" as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to number failed at path "cvv" for "[hidden]" (string): expected a number [type]
