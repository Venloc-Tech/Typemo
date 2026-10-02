import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => String, { required: true })
  email!: string;

  @Prop(() => String, { hidden: true }) // [!code ++]
  passwordHash?: Hidden<string>; // [!code ++]
}
