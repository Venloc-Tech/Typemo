import { Entity, type Hidden, Prop, Schema, type Selected, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true }) owner!: string;
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { required: true }) balance!: number;
  @Prop(() => String) note?: string;
  @Prop(() => String, { hidden: true }) pin?: Hidden<string>;
}
// ---cut---
type BalanceRow = Selected<Account, "owner" | "balance">;
//   ^?

type BalanceRowWithoutId = Selected<Account, "owner" | "balance" | "-_id">;
//   ^?
