import { type Defaulted, Entity, Prop, Schema } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string; readonly format?: (value: V) => string };
  }
  interface SchemaExtensions {
    label?: { readonly title: string };
  }
}
// ---cut---
@Schema({ collection: "accounts", ext: { label: { title: "Accounts" } } })
export class Account extends Entity {
  @Prop(() => String, { required: true, ext: { label: { text: "Name" } } })
  title!: string;

  @Prop(() => Number, { default: 0, ext: { label: { text: "Balance", format: (value) => value.toFixed(2) } } }) // [!code ++]
  balance!: Defaulted<number>; // [!code ++]
}
