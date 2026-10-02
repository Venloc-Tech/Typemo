import { ObjectId } from "mongodb";
import { Entity, Prop, type Ref, Schema } from "@venloc/typemo";

@Schema({ collection: "customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  city!: string;

  @Prop(() => ObjectId, { ref: () => Customer })
  referrer?: Ref<Customer>;
}

@Schema()
export class Item {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  qty!: number;

  @Prop(() => Number, { required: true })
  price!: number;
}

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => ObjectId, { ref: () => Customer, required: true })
  customer!: Ref<Customer>;

  @Prop(() => String, { required: true })
  status!: string;

  @Prop(() => Number, { required: true })
  total!: number;

  @Prop(() => Date, { required: true })
  placedAt!: Date;

  @Prop(() => [Item])
  items!: Item[];

  @Prop(() => String)
  note?: string;
}
