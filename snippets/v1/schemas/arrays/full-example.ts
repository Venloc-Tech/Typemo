import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// subdocument: an order line with its own _id
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 1 }) qty!: number;
}

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String], { enum: ["gift", "urgent"] as const })
  tags!: ("gift" | "urgent")[];
  @Prop(() => [Line]) lines!: Line[];
}

// your code: the error at the application boundary
class __BadRequest__ extends Error {}

// create an order with lines
export const placeOrder = async (customer: string, lines: { sku: string; qty: number }[]) => {
  const Orders = client.connection.model(Order);
  try {
    return await Orders.create({ customer, lines });
  } catch (error) {
    throw new __BadRequest__((error as Error).message);
  }
};

// find orders that have a line with the product
export const ordersWith = async (sku: string) => {
  const Orders = client.connection.model(Order);
  return Orders.find({ "lines.sku": sku }).plain();
};

await placeOrder("cid", [{ sku: "F1", qty: 2 }]);
console.log((await ordersWith("F1")).length);
// → 1
