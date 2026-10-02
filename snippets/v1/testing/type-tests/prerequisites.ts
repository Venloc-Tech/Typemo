import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  balance!: number;

  @Prop(() => String, { hidden: true })
  pin?: Hidden<string>;
}
