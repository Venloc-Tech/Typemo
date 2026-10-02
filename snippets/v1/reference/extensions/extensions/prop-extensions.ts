import { type Defaulted, Entity, Prop, Schema } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string; readonly format?: (value: V) => string };
  }
}
// ---cut---
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => Number, {
    default: 0,
    ext: { label: { text: "Баланс", format: (value) => value.toFixed(2) } },
  })
  balance!: Defaulted<number>;
}
