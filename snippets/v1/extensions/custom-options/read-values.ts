import { type Defaulted, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string };
  }
  interface SchemaExtensions {
    label?: { readonly title: string };
  }
}
@Schema({ collection: "accounts", ext: { label: { title: "Accounts" } } })
class Account extends Entity {
  @Prop(() => String, { required: true, ext: { label: { text: "Name" } } }) title!: string;
  @Prop(() => String) note?: string;
}
const client = new TypemoClient("mongodb://localhost:27017/app");
client.use({ name: "label", validateProp: () => undefined, validateSchema: () => undefined });
const Accounts = client.db().model(Account);
// ---cut---
console.log(Accounts.schema.ext, Accounts.schema.extOf("title"), Accounts.schema.extOf("note"), Accounts.schema.extOf("nope"));
// → { label: { title: "Accounts" } } { label: { text: "Name" } } {} undefined
