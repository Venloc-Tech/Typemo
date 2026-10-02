import { Entity, Index, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "orders" })
@Index({ status: 1 })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  customer!: string;

  @Prop(() => String, { required: true })
  status!: string;
}
