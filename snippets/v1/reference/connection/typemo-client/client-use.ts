import { TypemoClient } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string };
  }
}
const client = new TypemoClient("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
client.use({
  name: "label",
  validateProp: (value) => {
    if (typeof value !== "object" || value === null) throw new Error("label: an object is expected");
  },
});
