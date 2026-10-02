import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const archive = client.connection.useDb("app_archive");
// ---cut---
await client.transaction(async () => {
  await client.connection.model(Account).create({ owner: "zed", title: "Live" });
  await archive.model(Account).create({ owner: "zed", title: "Copy" });
});
