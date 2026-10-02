import { type Defaulted, Entity, Prop, Schema, Timestamped } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Timestamped(Entity) {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { min: 0, default: 0 })
  balance!: Defaulted<number>;

  @Prop(() => String)
  nickname?: string;
}
