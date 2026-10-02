import { Entity, Pipeline, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts", softDelete: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
// 1. Which addresses from the list are already registered (deleted ones do not count).
export const registered = async (emails: string[]) => {
  const [first, ...rest] = emails.map((email) => ({ email }));
  if (first === undefined) return [];
  const rows = await client.aggregate(
    Pipeline.database()
      .documents([first, ...rest])
      .lookup({ from: Account, localField: "email", foreignField: "email", as: "found" })
      .plan(),
  );
  return rows.filter((row) => row.found.length > 0).map((row) => row.email);
};

// 2. What the server is running now (only active operations, with a time limit).
export const activeOperations = () =>
  client
    .aggregate(Pipeline.admin().currentOp({ idleConnections: false }).match({ active: true }).plan())
    .timeoutMS(5_000);

// 3. How many sessions are open on this node.
export const openSessions = async () =>
  (await client.aggregate(Pipeline.database().listLocalSessions({ allUsers: true }).plan())).length;
