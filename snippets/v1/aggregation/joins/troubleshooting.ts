// @errors: 2769
import { Entity, Prop, Schema, TypemoClient, fn, Pipeline, type RowOf } from "@venloc/typemo";

@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) country!: string;
}

@Schema({ collection: "orders" })
class Order extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
}

@Schema({ collection: "archived_orders" })
class ArchivedOrder extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => Number, { required: true }) total!: number;
  @Prop(() => Date, { required: true }) archivedAt!: Date;
}

@Schema({ collection: "categories" })
class Category extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String) parent?: string;
}

const client = await TypemoClient.connect("mongodb://localhost:27017/shop");
const Orders = client.connection.model(Order);
const Customers = client.connection.model(Customer);
const Categories = client.connection.model(Category);
// ---cut---
await Orders.aggregate((p) =>
  p.lookup({ from: Customer, localField: "custmer", foreignField: "name", as: "buyer" }),
);
