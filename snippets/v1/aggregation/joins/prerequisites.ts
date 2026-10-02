import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  country!: string;
}

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => Number, { required: true })
  total!: number;
}

@Schema({ collection: "archived_orders" })
export class ArchivedOrder extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Date, { required: true })
  archivedAt!: Date;
}

@Schema({ collection: "categories" })
export class Category extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String)
  parent?: string;
}
