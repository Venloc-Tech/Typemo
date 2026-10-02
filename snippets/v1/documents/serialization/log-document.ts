import { Entity, Prop, Schema, Spec, TypemoClient, type Hidden } from "@venloc/typemo";
@Schema({ collection: "invoices" })
class Invoice extends Entity {
  @Prop(() => String, { required: true }) customer!: string;
  @Prop(() => [String]) tags!: string[];
  @Prop(() => Spec.map(Number)) fees?: Map<string, number>;
  @Prop(() => String, { hidden: true }) note?: Hidden<string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "shop" });
const Invoices = client.db().model(Invoice);
// ---cut---
const invoice = await Invoices.create({ customer: "alice", tags: ["gift"], fees: new Map([["ship", 5]]), note: "secret" });
console.log(invoice);
// → Invoice { _id: new ObjectId("…"), customer: "alice", tags: ["gift"], fees: Map(1) { "ship" => 5 } }
