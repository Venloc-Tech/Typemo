import { Typemo } from "@venloc/typemo";

declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string };
  }
}

Typemo.use({
  name: "label",
  validateProp: (value) => {
    if (typeof value !== "object" || value === null || typeof (value as { text?: unknown }).text !== "string") {
      throw new Error("label.text must be a string");
    }
  },
});
