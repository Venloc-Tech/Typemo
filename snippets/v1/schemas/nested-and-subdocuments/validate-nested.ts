import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) street?: string;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Address) shipTo?: Address;
}
const Orders = client.connection.model(Order);
// ---cut---
try {
  await Orders.create({ customer: "ann", shipTo: {} as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Validation failed: "shipTo.city": the field is required [required]
try {
  await Orders.create({ customer: "ann", shipTo: { city: "x", zip: "1" } as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to document failed at path "shipTo.zip" for "1" (string): not a field of Address [unknown-key]
try {
  await Orders.create({ customer: "ann", shipTo: null as never });
} catch (error) {
  console.log((error as Error).message);
}
// → Cast to Address failed at path "shipTo" for null: null is not allowed on a path that is not nullable [null]
