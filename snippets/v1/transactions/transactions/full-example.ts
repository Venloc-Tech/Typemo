import { DocumentNotFoundError, Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;
}

declare const __sendEmail__: (text: string) => void;

const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);

// transfer: a read, a check and two atomic writes in one transaction
export const transfer = async (from: string, to: string, amount: number): Promise<number> => {
  const left = await client.transaction(async () => {
    const source = await Accounts.findOne({ title: from }).orFail();
    if (source.balance < amount) throw new Error("insufficient funds");
    await Accounts.updateOne({ title: from }, { $inc: { balance: -amount } });
    await Accounts.updateOne({ title: to }, { $inc: { balance: amount } });
    return source.balance - amount;
  });

  // side effects only after the commit
  __sendEmail__(`transferred ${amount} from ${from} to ${to}`);
  return left;
};

// application boundary: account not found and insufficient funds turn into responses
export const transferRequest = async (from: string, to: string, amount: number) => {
  try {
    return { status: 200, left: await transfer(from, to, amount) };
  } catch (error) {
    if (error instanceof DocumentNotFoundError) return { status: 404 };
    if (error instanceof Error && error.message === "insufficient funds") return { status: 409 };
    throw error;
  }
};
