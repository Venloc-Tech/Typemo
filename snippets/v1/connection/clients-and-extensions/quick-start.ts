import { Typemo, TypemoClient } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string };
  }
}
const check = (value: unknown): void => {
  if (typeof value !== "object" || value === null) throw new Error("label: an object is expected");
};
const client = new TypemoClient("mongodb://localhost:27017/app");
// ---cut---
Typemo.use({ name: "label", validateProp: check }); // for every client
// or
client.use({ name: "label", validateProp: check }); // only for this client
