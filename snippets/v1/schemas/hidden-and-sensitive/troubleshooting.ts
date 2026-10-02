import { Entity, type Hidden, Prop, Schema } from "@venloc/typemo";
// ---cut---
// @errors: 1240
@Schema({ collection: "users" })
class User extends Entity {
  // wrong: hidden without Hidden<T>
  @Prop(() => String, { hidden: true })
  passwordHash?: string;

  // right
  @Prop(() => String, { hidden: true })
  apiKey?: Hidden<string>;
}
