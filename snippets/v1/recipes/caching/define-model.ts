import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => String, { nullable: true })
  phone!: string | null;

  @Prop(() => String, { hidden: true })
  passwordHash?: Hidden<string>;
}
