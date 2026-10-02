import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
}
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
}
@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => [Address]) places!: Address[];
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
const order = Orders.new({ customer: "alice", lines: [], places: [] });
// ---cut---
// @errors: 2684
order.places.id(order.lines[0]!._id);
