import { Contract, Entity, type Hidden, Prop, Schema, type Selected, type SelectedJson, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => String, { required: true })
  title!: string;

  @Prop(() => Number, { required: true })
  balance!: number;

  @Prop(() => String)
  note?: string;

  @Prop(() => String, { hidden: true })
  pin?: Hidden<string>;
}

// your code: the error at the application boundary and the data validation schema
class __BadData__ extends Error {}
declare const __balanceRow__: {
  "~standard": {
    version: 1;
    vendor: string;
    validate: (value: unknown) => { value: { owner: string; balance: number } } | { issues: { message: string; path: string[] }[] };
    types: { input: unknown; output: { owner: string; balance: number } };
  };
};

type BalanceRow = Selected<Account, "owner" | "balance">;
type AccountJson = SelectedJson<Account, "owner" | "title" | "balance" | "note">;

export const createApi = (client: TypemoClient) => {
  const Accounts = client.db().model(Account);

  // list: the shape is fixed at compile time
  const listBalances = () =>
    Accounts.find().select({ owner: 1, balance: 1 }).sort({ owner: 1 }).plain().expect<BalanceRow>();

  // a list from an untrusted source: values are checked at runtime
  const listCheckedBalances = async () => {
    try {
      return await Accounts.find().sort({ owner: 1 }).plain().parse(__balanceRow__);
    } catch (error) {
      throw new __BadData__("account data is corrupted", { cause: error });
    }
  };

  // one account: the document turns into JSON by the contract
  const getAccount = async (owner: string) => {
    const account = await Accounts.findOne({ owner }).orFail();
    return Contract.check<AccountJson>()(account.$toJSON());
  };

  return { listBalances, listCheckedBalances, getAccount };
};
