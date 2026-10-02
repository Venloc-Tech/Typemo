import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, unique: true })
  title!: string;

  @Prop(() => Number, { required: true, min: 0 })
  balance!: number;
}

declare const __askBank__: () => Promise<boolean>;

const client = await TypemoClient.connect("mongodb://localhost:27017/app");
const Accounts = client.connection.model(Account);

// a transfer whose commit is decided by an external system
export const transferWithApproval = async (from: string, to: string, amount: number): Promise<boolean> => {
  const session = await client.startSession();
  try {
    session.startTransaction();

    // the document remembers the session: $save writes into the same transaction
    const source = await Accounts.findOne({ title: from }).session(session).orFail();
    source.balance = source.balance - amount;
    await source.$save();
    await Accounts.updateOne({ title: to }, { $inc: { balance: amount } }).session(session);

    // the bank's response decides the commit
    if (await __askBank__()) {
      await session.commitTransaction();
      return true;
    }
    await session.abortTransaction();
    return false;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};
