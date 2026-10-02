import { Entity, type Hidden, Prop, Schema, Spec, TypemoClient, Versioned } from "@venloc/typemo";
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) street?: string;
}
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 0 }) qty!: number;
}
@Schema({ collection: "orders" })
class Order extends Versioned(Entity) {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => [Line]) lines!: Line[];
  @Prop(() => Address) address?: Address;
  @Prop(() => Spec.map(Number)) fees?: Map<string, number>;
  @Prop(() => String, { hidden: true }) note?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Orders = client.db().model(Order);
// ---cut---
export const openOrder = async (customer: string) => {
  const order = Orders.new({ customer, tags: [], lines: [] });
  await order.$save();
  return order._id;
};

export const renameCustomer = async (orderId: Order["_id"], customer: string) => {
  const order = await Orders.findById(orderId).orFail();
  order.customer = customer;
  await order.$save();
};

export const cancelOrder = async (orderId: Order["_id"]) => {
  const order = await Orders.findById(orderId).orFail();
  await order.$deleteOne();
};
