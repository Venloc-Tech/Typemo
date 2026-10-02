import { Entity, Pipeline, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts", softDelete: true })
class Account extends Entity {
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => Date, { nullable: true }) deletedAt?: Date | null;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
// ---cut---
const plan = Pipeline.database()
  .documents([{ email: "ann@example.com" }, { email: "bob@example.com" }, { email: "cid@example.com" }])
  .lookup({ from: Account, localField: "email", foreignField: "email", as: "found" })
  .plan();
const rows = await client.aggregate(plan);
console.log(rows.map((row) => [row.email, row.found.length]));
// → [["ann@example.com", 1], ["bob@example.com", 0], ["cid@example.com", 0]]
