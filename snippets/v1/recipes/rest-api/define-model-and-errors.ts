import { Entity, Prop, Schema, Timestamped } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Timestamped(Entity) {
  @Prop(() => String, { required: true, unique: true, minLength: 2 })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;
}
