import { Timestamp } from "mongodb";
import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema()
export class Line {
  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  qty!: number;
}

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  sku!: string;

  @Prop(() => Number, { required: true })
  price!: number;

  @Prop(() => Number, { required: true })
  quantity!: number;

  @Prop(() => Number, { required: true })
  delta!: number;

  @Prop(() => Number, { required: true })
  ratio!: number;

  @Prop(() => Number)
  discount?: number;

  @Prop(() => Date, { required: true })
  placedAt!: Date;

  @Prop(() => Date, { required: true })
  shippedAt!: Date;

  @Prop(() => Timestamp)
  stamp?: Timestamp;

  @Prop(() => [String])
  tags!: string[];

  @Prop(() => [Number])
  prices!: number[];

  @Prop(() => [Line])
  lines!: Line[];
}
