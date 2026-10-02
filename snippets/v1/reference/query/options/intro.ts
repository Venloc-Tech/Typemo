import { Entity, Index, Prop, Schema } from "@venloc/typemo";

@Index({ number: 1 })
@Schema({ collection: "orders", softDelete: true })
export class Order extends Entity {
  @Prop(() => Number, { required: true })
  number!: number;

  @Prop(() => String, { required: true })
  status!: string;

  @Prop(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
