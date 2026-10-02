import { Entity, Prop, Schema, Spec, TypemoClient, Types, Virtual, type Computed, type Defaulted, type Hidden, type Immutable, type Ref, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// nested object: an address without its own _id
@Schema({ nested: true })
class Address {
  @Prop(() => String, { required: true }) city!: string;
  @Prop(() => String) street?: string;
}

// subdocument: an order line has its own _id
@Schema()
class Line extends Entity {
  @Prop(() => String, { required: true }) sku!: string;
  @Prop(() => Number, { required: true, min: 1 }) qty!: number;
}

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Address, { required: true }) shipTo!: Address;
  @Prop(() => Line) gift?: Line;
}

// your code: the error at the application boundary
class __BadRequest__ extends Error {}

// create an order: errors of nested fields come with a path
export const placeOrder = async (customer: string, city: string) => {
  const Orders = client.connection.model(Order);
  try {
    return await Orders.create({ customer, shipTo: { city }, gift: { sku: "G1", qty: 1 } });
  } catch (error) {
    throw new __BadRequest__((error as Error).message);
  }
};

// change the city: a path to the nested field, sibling fields untouched
export const moveOrder = async (customer: string, city: string) => {
  const Orders = client.connection.model(Order);
  await Orders.updateOne({ customer }, { $set: { "shipTo.city": city } });
};

await placeOrder("zoe", "Oslo");
await moveOrder("zoe", "Rome");
const saved = await client.connection.model(Order).findOne({ customer: "zoe" }).plain();
console.log(saved?.shipTo.city, typeof saved?.gift?._id);
// → Rome string
