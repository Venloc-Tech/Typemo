import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
}
// ---cut---
@Schema()
class Line extends Entity { // [!code highlight]
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 1 }) qty!: number;
}

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Address) shipTo?: Address;
  @Prop(() => Line) gift?: Line; // [!code ++]
}

const Orders = client.connection.model(Order);
const order = await Orders.create({ customer: "ann", gift: { sku: "G1", qty: 1 } });
console.log(order.gift?._id.constructor.name);
// → ObjectId
