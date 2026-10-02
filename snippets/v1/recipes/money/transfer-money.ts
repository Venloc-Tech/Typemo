import { type Decimal128 } from "mongodb";
import { Entity, Prop, Schema, Types, TypemoClient, type Defaulted } from "@venloc/typemo";
class __BadRequest__ extends Error {}
class Money {
  static parse(text: string): bigint {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) throw new __BadRequest__(`"${text}" is not an amount like 12.34`);
    return BigInt(match[1] ?? "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  }
  static format(minor: bigint): string {
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
  }
}
@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true }) title!: string;
  @Prop(() => BigInt, { min: 0n, default: 0n }) balance!: Defaulted<bigint>;
}
@Schema({ collection: "rates" })
class Rate extends Entity {
  @Prop(() => String, { required: true, unique: true }) pair!: string;
  @Prop(() => Types.Decimal128, { required: true }) value!: Decimal128;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.db().model(Account);
const Rates = client.db().model(Rate);
// ---cut---
export const transfer = (from: string, to: string, amount: string) => {
  const minor = Money.parse(amount);
  return client.transaction(async () => {
    await Accounts.updateOne({ title: from }, { $inc: { balance: -minor } }).orFail();
    await Accounts.updateOne({ title: to }, { $inc: { balance: minor } }).orFail();
  });
};
