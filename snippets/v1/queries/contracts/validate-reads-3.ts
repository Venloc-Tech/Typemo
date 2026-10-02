import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
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
const balanceRow = {
  "~standard": {
    version: 1 as const,
    vendor: "app",
    validate: (value: unknown) => {
      const row = value as { owner?: unknown; balance?: unknown };
      if (typeof row.owner !== "string") return { issues: [{ message: "owner must be a string", path: ["owner"] }] };
      if (typeof row.balance !== "number") return { issues: [{ message: "balance must be a number", path: ["balance"] }] };
      return { value: { owner: row.owner, balance: row.balance } };
    },
    types: undefined as unknown as { input: unknown; output: { owner: string; balance: number } },
  },
};
// ---cut---
try {
  await Accounts.find().sort({ owner: 1 }).plain().parse(balanceRow);
} catch (error) {
  console.log(String(error));
  // → 'ValidationError: Validation failed: "2.balance": row 2: balance must be a number [schema]'
}
