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
@Schema({ collection: "accounts", ext: { label: { title: "Счета" } } })
export class Account extends Entity {
  @Prop(() => String, { required: true, ext: { label: { text: "Название" } } })
  title!: string;

  @Prop(() => Number, { default: 0, ext: { label: { text: "Баланс", format: (value) => value.toFixed(2) } } }) // [!code ++]
  balance!: Defaulted<number>; // [!code ++]
}
