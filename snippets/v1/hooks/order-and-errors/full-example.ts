import { Entity, Pre, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;

  // A forbidden title cancels the save.
  @Pre("document.save")
  rejectForbidden(this: Account): void {
    if (this.title === "forbidden") throw new Error("title is forbidden");
  }
}

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Accounts = client.db().model(Account);

export const openBoth = async (): Promise<void> => {
  await client.transaction(async () => {
    await Accounts.create({ title: "in-tx" });
    await Accounts.create({ title: "forbidden" }); // the error also rolls back the first account
  });
};

try {
  await openBoth();
} catch (error) {
  console.log((error as Error).message, await Accounts.countDocuments({ title: "in-tx" }));
}
// → title is forbidden 0
