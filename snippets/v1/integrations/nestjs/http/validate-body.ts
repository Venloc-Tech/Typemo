import { Entity, Prop, Schema } from "@venloc/typemo";
// ---cut---
@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true, unique: true })
  email!: string;

  @Prop(() => String, { required: true, minLength: 2 })
  name!: string;

  @Prop(() => Number, { min: 0, max: 150 }) // [!code ++]
  age?: number; // [!code ++]

  @Prop(() => String, { enum: ["user", "admin"] as const }) // [!code ++]
  role?: "user" | "admin"; // [!code ++]
}
