import { Entity, Schema } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface SchemaExtensions {
    label?: { readonly title: string };
  }
}
// ---cut---
@Schema({ collection: "accounts", ext: { label: { title: "Accounts" } } })
export class Account extends Entity {}
