import { Entity, Plugin, Prop, Schema, TypemoClient, type Model, type SchemaPlugin } from "@venloc/typemo";

const statics = {
  async byTitle(this: Model<Account>, title: string): Promise<number> {
    return this.countDocuments({ title });
  },
};

// Plugin: a model method and a read hook.
export const tools: SchemaPlugin<undefined, typeof statics> = {
  name: "tools",
  apply: (builder) => {
    builder.addHook("post", "query.find", function () {
      console.log(`прочитан список ${builder.target.name}`);
    });
  },
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

await Accounts.create({ title: "Main" });
await Accounts.find(); // → прочитан список Account
console.log(await Accounts.statics(tools).byTitle("Main"));
// → 1
