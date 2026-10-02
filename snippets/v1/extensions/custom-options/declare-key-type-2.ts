import { Entity, Prop, Schema } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string };
  }
}
// ---cut---
// @errors: 2322
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { ext: { label: { text: 5 } } })
  title?: string;
}
