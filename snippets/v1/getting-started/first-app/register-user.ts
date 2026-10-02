import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo"; // [!code ++]

@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true, trim: true })
  name!: string;

  @Prop(() => String, { required: true, unique: true, lowercase: true })
  email!: string;

  @Prop(() => String, { hidden: true }) // [!code ++]
  passwordHash?: Hidden<string>; // [!code ++]
}
