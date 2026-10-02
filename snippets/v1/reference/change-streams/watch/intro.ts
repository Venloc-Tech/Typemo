import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { required: true })
  balance!: number;

  @Prop(() => String, { hidden: true })
  pin?: Hidden<string>;
}
