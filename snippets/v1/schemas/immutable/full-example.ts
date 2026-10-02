import { Entity, type Defaulted, type Immutable, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  // the registration country never changes
  @Prop(() => String, { immutable: true })
  country?: Immutable<string>;

  @Prop(() => Number, { default: 0 })
  balance!: Defaulted<number>;
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);

// opening: the country is written on create
export const open = async (country: string) => Accounts.create({ country });

// top-up: an ordinary field changes freely
export const deposit = async (id: Account["_id"], amount: number) =>
  Accounts.updateOne({ _id: id }, { $inc: { balance: amount } });
