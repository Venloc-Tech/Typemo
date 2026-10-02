import { type TypemoExtension } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string; readonly format?: (value: V) => string };
  }
  interface SchemaExtensions {
    label?: { readonly title: string };
  }
}
// ---cut---
export const label: TypemoExtension<"label"> = {
  name: "label",
  validateProp: (value) => {
    if (typeof (value as { text?: unknown }).text !== "string") throw new TypeError("text must be a string");
  },
  validateSchema: (value) => {
    if (typeof (value as { title?: unknown }).title !== "string") throw new TypeError("title must be a string");
  },
};
