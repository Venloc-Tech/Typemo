import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";
@Schema({ collection: "customers" })
class Customer extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => String, { required: true }) email!: string;
}
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
const Customers = client.db().model(Customer);
// ---cut---
// wrong: a document has no masks
// @errors: 2684
await Customers.find().mask({ email: "mask" });
// compiler: … 'PathError<"mask() masks rows: call .lean() or .plain() first — a hydrated document with masked values could be saved">'

// right: a mask on plain objects
await Customers.find().plain().mask({ email: "mask" });
