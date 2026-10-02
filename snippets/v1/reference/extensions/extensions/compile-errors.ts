import { Entity, Prop, Schema } from "@venloc/typemo";
// ---cut---
// @errors: 2322
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { ext: { nope: { text: "x" } } })
  title?: string;
}
