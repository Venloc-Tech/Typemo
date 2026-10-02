import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => String, { required: true }) owner!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/app");
// ---cut---
const archive = client.connection.useDb("app_archive");
await archive.model(Account).create({ owner: "alice", title: "Old" });

const live = await client.connection.model(Account).countDocuments({ title: "Old" });
const old = await archive.model(Account).countDocuments({ title: "Old" });
// → live: 0, old: 1
