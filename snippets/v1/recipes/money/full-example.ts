import { type Decimal128 } from "mongodb";
import { type Defaulted, Entity, Prop, Schema, Types, TypemoClient } from "@venloc/typemo";

export class __BadRequest__ extends Error {}

// money/money.ts: strings ⇄ kopecks (your code, not part of Typemo)
export class Money {
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

  // rounds to the nearest kopeck; the rate is a Decimal128 string such as "92.5031"
  static convert(minor: bigint, rate: string): bigint {
    const [whole = "0", fraction = ""] = rate.split(".");
    const scale = 10n ** BigInt(fraction.length);
    return (minor * BigInt(whole + fraction) * 2n + scale) / (scale * 2n);
  }
}

// models
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => BigInt, { min: 0n, default: 0n })
  balance!: Defaulted<bigint>;
}

@Schema({ collection: "rates" })
export class Rate extends Entity {
  @Prop(() => String, { required: true, unique: true })
  pair!: string;

  @Prop(() => Types.Decimal128, { required: true })
  value!: Decimal128;
}

export const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.db().model(Account);
const Rates = client.db().model(Rate);

// operations
export const deposit = (title: string, amount: string) =>
  Accounts.updateOne({ title }, { $inc: { balance: Money.parse(amount) } }).orFail();

export const withdraw = (title: string, amount: string) =>
  Accounts.updateOne({ title }, { $inc: { balance: -Money.parse(amount) } }).orFail();

export const transfer = (from: string, to: string, amount: string) => {
  const minor = Money.parse(amount);
  return client.transaction(async () => {
    await Accounts.updateOne({ title: from }, { $inc: { balance: -minor } }).orFail();
    await Accounts.updateOne({ title: to }, { $inc: { balance: minor } }).orFail();
  });
};

export const getBalance = async (title: string) => {
  const account = await Accounts.findOne({ title }).plain().orFail();
  return { title: account.title, balance: Money.format(BigInt(account.balance)) };
};

export const convertBalance = async (title: string, pair: string) => {
  const account = await Accounts.findOne({ title }).plain().orFail();
  const rate = await Rates.findOne({ pair }).plain().orFail();
  return Money.format(Money.convert(BigInt(account.balance), rate.value));
};
