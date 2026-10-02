import { Contract, Entity, type Hidden, Prop, Schema, type SelectedJson, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String) note?: string;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);
const account = await Accounts.findOne({ owner: "alice" }).orFail();
// ---cut---
type Narrow = SelectedJson<Account, "owner" | "balance">;

// @errors: 2379
Contract.check<Narrow>()(account.$toJSON());
// compiler: … Property 'extra' is missing in type … but required in type '{ readonly extra: "title" | "note"; }'
