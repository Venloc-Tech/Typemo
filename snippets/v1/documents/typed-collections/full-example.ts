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
export const addLine = async (orderId: Order["_id"], sku: string, qty: number) => {
  const order = await Orders.findById(orderId).orFail();
  order.lines.push({ sku, qty });
  await order.$save();
  return order.lines.length;
};

export const removeLine = async (orderId: Order["_id"], lineId: Order["lines"][number]["_id"]) => {
  const order = await Orders.findById(orderId).orFail();
  const removed = order.lines.pull(lineId);
  await order.$save();
  return removed.length;
};

export const setFee = async (orderId: Order["_id"], name: string, amount: number) => {
  const order = await Orders.findById(orderId).orFail();
  order.$set(`fees.${name}`, amount);
  await order.$save();
};
