import { Entity, type Hidden, Prop, Schema, type Selected, TypemoClient } from "@venloc/typemo";
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
type BalanceRow = Selected<Account, "owner" | "balance">;
// ---cut---
// wrong: a document has no contract
// @errors: 2684
await Accounts.find().select({ owner: 1, balance: 1 }).expect<BalanceRow>();
// compiler: … 'PathError<"expect<Shape>() checks rows: call .plain() or .lean() first (for a document, Contract.check its $toPlain())">'

// right: the result rows as .plain() results
await Accounts.find().select({ owner: 1, balance: 1 }).plain().expect<BalanceRow>();
