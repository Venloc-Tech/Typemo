import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => String, { hidden: true })
  pin?: Hidden<string>;
}
