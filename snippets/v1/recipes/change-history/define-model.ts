import { type Defaulted, Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts", audit: true })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { min: 0, default: 0 })
  balance!: Defaulted<number>;

  @Prop(() => String, { sensitive: "mask" })
  card?: string;
}
