import { Entity, type Hidden, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => String, { hidden: true }) passwordHash?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017/bank");
const Customers = client.db().model(Customer);
// ---cut---
const customer = await Customers.findOne({ email: "alice@example.com" })
  .select({ "+passwordHash": true })
  .orFail();

const internal = customer.$toPlain({ hidden: true });
// → { _id: "…", name: "Alice", email: "alice@example.com", passwordHash: "$argon2id$…" }
