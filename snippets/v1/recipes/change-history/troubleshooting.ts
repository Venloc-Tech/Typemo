import { type Defaulted, Entity, PolicyContext, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "accounts", audit: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => Number, { min: 0, default: 0 }) balance!: Defaulted<number>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Accounts = client.db().model(Account);
const asActor = <R>(userId: string, work: () => R): R => PolicyContext.run({ actor: userId }, work);
// ---cut---
export const setBalanceByTitle = (userId: string, title: string, balance: number) =>
  asActor(userId, () =>
    client.transaction(async () => {
      const rows = await Accounts.find({ title }).select({ _id: 1 }).lean();
      await Accounts.updateMany({ _id: { $in: rows.map((row) => row._id) } }, { $set: { balance } });
    }),
  );
