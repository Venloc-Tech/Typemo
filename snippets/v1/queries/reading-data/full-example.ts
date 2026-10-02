// @filename: db.ts
import { Entity, type Hidden, Prop, type Ref, Schema, TypemoClient, Types } from "@venloc/typemo";
@Schema({ collection: "customers" })
export class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => BigInt, { required: true }) balance!: bigint;
  @Prop(() => Types.ObjectId, { ref: () => Customer, required: true }) owner!: Ref<Customer>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
export const Accounts = client.db().model(Account);
// @filename: accounts.service.ts
// ---cut---
import { CastError, DocumentNotFoundError } from "@venloc/typemo";
import { Accounts } from "./db";

// your code: errors at the application boundary
class __NotFound__ extends Error {}
class __BadRequest__ extends Error {}

// a list for a page
export const listAccounts = () =>
  Accounts.find().sort({ title: 1 }).limit(20).select({ title: 1, balance: 1 }).plain();

// one account together with its owner
export const getAccount = async (idFromUrl: string) => {
  try {
    return await Accounts.findById(idFromUrl)
      .populate({ path: "owner", select: { name: 1, email: 1 } })
      .orFail()
      .plain();
  } catch (error) {
    if (error instanceof DocumentNotFoundError) throw new __NotFound__("account not found");
    if (error instanceof CastError) throw new __BadRequest__("the id is malformed");
    throw error;
  }
};

// rename and return the updated account
export const renameAccount = (idFromUrl: string, title: string) =>
  Accounts.findByIdAndUpdate(idFromUrl, { $set: { title } }, { returnDocument: "after" })
    .orFail()
    .plain();

// top up: the amount comes as a string
export const deposit = (idFromUrl: string, amount: `${bigint}`) =>
  Accounts.findByIdAndUpdate(idFromUrl, { $inc: { balance: amount } }, { returnDocument: "after" })
    .orFail()
    .plain();

// the total over every account of a customer
export const totalBalance = async (ownerId: string) => {
  const rows = await Accounts.find({ owner: ownerId }).select({ balance: 1 }).lean();
  return rows.reduce((sum, row) => sum + row.balance, 0n).toString();
};
