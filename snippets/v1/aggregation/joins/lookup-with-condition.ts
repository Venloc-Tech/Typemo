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
const query = Customers.aggregate((p) =>
  p
    .lookup({
      from: Order,
      as: "big",
      let: (f) => ({ who: f.name }),
      pipeline: (o, v) =>
        o
          .match((x) => fn.and(fn.eq(x.customer, v.who), fn.gte(x.total, 80)))
          .project({ total: 1, _id: 0 }),
    })
    .project({ name: 1, big: 1, _id: 0 }),
);
const rows = await query;
//    ^?
// → [{ name: "alice", big: [{ total: 120 }, { total: 80 }] }, { name: "bob", big: [] }]
