import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "orders" })
export class Order extends Entity {
  @Prop(() => String, { required: true })
  number!: string;

  @Prop(() => Number, { required: true, min: 0 })
  total!: number;
}

@Schema({ collection: "job_checkpoints" })
export class Checkpoint extends Entity {
  @Prop(() => String, { required: true, unique: true })
  name!: string;

  @Prop(() => String, { required: true })
  token!: string;
}
