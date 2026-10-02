import { Typemo, type TypemoExtension } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string };
  }
  interface SchemaExtensions {
    label?: { readonly title: string };
  }
}
// ---cut---
export const label: TypemoExtension<"label"> = {
  name: "label",
  validateProp: (value, field) => {
    const text = (value as { text?: unknown }).text;
    if (typeof text !== "string" || text === "") throw new TypeError(`text must be a non-empty string (${field.kind})`);
  },
  validateSchema: (value) => {
    if (typeof (value as { title?: unknown }).title !== "string") throw new TypeError("title must be a string");
  },
};

Typemo.use(label);
