import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) street?: string;
}

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => Address)
  shipTo?: Address;
}

const Orders = client.connection.model(Order);
const order = await Orders.create({ customer: "ann", shipTo: { city: "Oslo" } });
console.log(order.$toPlain().shipTo);
// → { city: "Oslo" }
