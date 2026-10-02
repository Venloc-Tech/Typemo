import { Entity, Mask, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Customers = client.db().model(Customer);
// ---cut---
// wrong: an email mask on a number
// @errors: 2322
await Customers.find().plain().mask({ age: Mask.email() });

// right: a mask for numbers
await Customers.find().plain().mask({ age: Mask.bucket([18, 35, 60]) });
