import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number)
  age?: number;

  @Prop(() => String, { hidden: true })
  passwordHash?: Hidden<string>;
}
