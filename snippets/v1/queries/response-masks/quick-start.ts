import { Entity, Mask, Prop, Schema, Spec, TypemoClient } from "@venloc/typemo";
@Schema()
class Card { @Prop(() => String, { required: true }) number!: string; @Prop(() => String) holder?: string; }
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
  @Prop(() => String, { nullable: true }) phone!: string | null;
  @Prop(() => Number) age?: number;
  @Prop(() => [Card]) cards!: Card[];
  @Prop(() => Spec.map(String)) notes?: Map<string, string>;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Customers = client.db().model(Customer);
// ---cut---
const rows = await Customers.find().sort({ name: 1 }).plain().mask({ email: Mask.email(), phone: Mask.phone() });
console.log(rows.map((row) => [row.email, row.phone]));
// → [["a***@gmail.com", "+7********67"], ["b***@example.org", "?"]]
