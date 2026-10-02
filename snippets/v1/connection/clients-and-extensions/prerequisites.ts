import { Entity, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;
}
