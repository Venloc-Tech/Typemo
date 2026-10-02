import { Entity, Plugin, Prop, Schema, TypemoClient, type Model, type SchemaPlugin } from "@venloc/typemo";

const statics = {
  async byTitle(this: Model<Account>, title: string): Promise<number> {
    return this.countDocuments({ title });
  },
};

export const tools: SchemaPlugin<undefined, typeof statics> = {
  name: "tools",
  apply: () => {},
  statics,
};

@Plugin(tools)
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
// ---cut---
const count = await Accounts.statics(tools).byTitle("Main");
//    ^?
