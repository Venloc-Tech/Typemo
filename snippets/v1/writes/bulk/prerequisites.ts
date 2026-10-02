import { type Defaulted, Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { min: 0, default: 0 })
  balance!: Defaulted<number>;

  @Prop(() => String)
  note?: string;
}
