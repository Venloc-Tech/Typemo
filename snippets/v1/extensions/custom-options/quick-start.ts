import { Entity, Prop, Schema, Typemo } from "@venloc/typemo";

declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string };
  }
}

Typemo.use({
  name: "label",
  validateProp: (value) => {
    if (typeof (value as { text?: unknown }).text !== "string") throw new TypeError("text must be a string");
  },
});

@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, ext: { label: { text: "Name" } } })
  title!: string;
}
