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
export const listForSupport = () =>
  Customers.find()
    .sort({ name: 1 })
    .plain()
    .mask({ email: Mask.email(), phone: Mask.phone(), age: Mask.bucket([18, 35, 60]) });

const customers = await listForSupport();
console.log(customers.map((customer) => [customer.email, customer.phone, customer.age]));
// → [["a***@gmail.com", "+7********67", "18–35"], ["b***@example.org", "?", "<18"]]
