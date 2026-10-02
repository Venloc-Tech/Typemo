import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "transfers", audit: true })
export class Transfer extends Entity {
  @Prop(() => String, { required: true })
  from!: string;

  @Prop(() => Number, { required: true })
  amount!: number;

  @Prop(() => String, { sensitive: "mask" })
  card?: string;
}
