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
const query = Categories.aggregate((p) =>
  p
    .match({ title: "Smartphones" })
    .graphLookup({
      from: Category,
      startWith: (f) => f.parent,
      connectFromField: "parent",
      connectToField: "title",
      as: "ancestors",
      depthField: "level",
    })
    .project((f) => ({ title: 1, ancestors: fn.map({ input: f.ancestors, in: (a) => a.title }), _id: 0 })),
);
const rows = await query;
//    ^?
// → [{ title: "Smartphones", ancestors: ["Phones", "Electronics"] }]
